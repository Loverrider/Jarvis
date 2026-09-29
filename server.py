import json
import os
import re
import socket
import threading
import time
import traceback

import requests
from flask import Flask, Response, jsonify, render_template, request
from waitress import serve
from werkzeug.exceptions import HTTPException

import config
import database
import llm
import memory

TEMPLATE_DIR = os.path.join(config.BASE_DIR, "templates")
STATIC_DIR = os.path.join(config.BASE_DIR, "static")

VOICE_NOTE = (
    "MODALITÀ VOCALE: l'utente ascolta la tua risposta ad alta voce. "
    "Rispondi in modo breve e naturale, come in una conversazione parlata: "
    "al massimo 3-4 frasi, senza elenchi, tabelle, titoli o markdown. "
    "Non leggere codice: se serve codice, scrivilo in un blocco markdown "
    "e dì a voce solo in una frase cosa fa."
)

app = Flask(
    __name__,
    template_folder=TEMPLATE_DIR,
    static_folder=STATIC_DIR,
    static_url_path="/static",
)

app.config["SEND_FILE_MAX_AGE_DEFAULT"] = 0
app.config["TEMPLATES_AUTO_RELOAD"] = True

VISIT_CACHE = {}
VISIT_CACHE_SECONDS = 30


def log(tag, message):
    now = time.strftime("%H:%M:%S")
    print(
        f"[{now}] {tag:<9} {message}",
        flush=True,
    )


def lan_ip():
    s = socket.socket(
        socket.AF_INET,
        socket.SOCK_DGRAM,
    )

    try:
        s.connect(
            ("10.255.255.255", 1)
        )

        return s.getsockname()[0]

    except OSError:
        return "127.0.0.1"

    finally:
        s.close()


def check_files():
    required = [
        os.path.join(
            TEMPLATE_DIR,
            "index.html",
        ),
        os.path.join(
            STATIC_DIR,
            "css",
            "style.css",
        ),
        os.path.join(
            STATIC_DIR,
            "css",
            "voice.css",
        ),
        os.path.join(
            STATIC_DIR,
            "js",
            "galaxy.js",
        ),
        os.path.join(
            STATIC_DIR,
            "js",
            "app.js",
        ),
        os.path.join(
            STATIC_DIR,
            "js",
            "voice.js",
        ),
    ]

    missing = [
        p
        for p in required
        if not os.path.isfile(p)
    ]

    for p in missing:
        log(
            "ERROR",
            f"File mancante: {p}",
        )

    return not missing


@app.errorhandler(Exception)
def handle_error(error):
    if isinstance(
        error,
        HTTPException,
    ):
        return error

    log(
        "ERROR",
        f"{request.method} {request.path} | "
        f"{type(error).__name__}: {error}",
    )

    traceback.print_exc()

    return (
        jsonify(
            {
                "error": "Errore interno del server.",
                "type": type(error).__name__,
                "detail": str(error),
            }
        ),
        500,
    )


def clean_user_agent(user_agent):
    ua = user_agent or ""

    if "Edg/" in ua:
        browser = "Microsoft Edge"
    elif (
        "Chrome/" in ua
        or "CriOS/" in ua
    ):
        browser = "Google Chrome"
    elif (
        "Firefox/" in ua
        or "FxiOS/" in ua
    ):
        browser = "Mozilla Firefox"
    elif (
        "Safari/" in ua
        and "Chrome/" not in ua
    ):
        browser = "Safari"
    else:
        browser = "Browser sconosciuto"

    if "Windows" in ua:
        os_name = "Windows"
    elif "Android" in ua:
        os_name = "Android"
    elif (
        "iPhone" in ua
        or "iPad" in ua
    ):
        os_name = "iOS"
    elif "Mac OS X" in ua:
        os_name = "macOS"
    elif "Linux" in ua:
        os_name = "Linux"
    else:
        os_name = "Sistema sconosciuto"

    if (
        "Mobile" in ua
        or "Android" in ua
        or "iPhone" in ua
    ):
        device = "Telefono/Tablet"
    else:
        device = "PC"

    return (
        browser,
        os_name,
        device,
    )


def get_client_info():
    ip = request.headers.get(
        "X-Forwarded-For",
        request.remote_addr
        or "sconosciuto",
    )

    user_agent = request.headers.get(
        "User-Agent",
        "",
    )

    browser, os_name, device = (
        clean_user_agent(
            user_agent
        )
    )

    return (
        ip.split(",")[0].strip(),
        browser,
        os_name,
        device,
        user_agent,
    )


def sse(data):
    return (
        "data: "
        + json.dumps(
            data,
            ensure_ascii=False,
        )
        + "\n\n"
    )


def ms_since(t0):
    return int(
        (time.perf_counter() - t0)
        * 1000
    )


def step(
    step_id,
    state,
    detail="",
    ms=None,
):
    data = {
        "type": "step",
        "id": step_id,
        "state": state,
        "detail": detail,
    }

    if ms is not None:
        data["ms"] = ms

    return sse(data)


def resolve_conversation(
    conv_id,
    message,
):
    try:
        conv_id = int(
            conv_id
        )
    except (
        TypeError,
        ValueError,
    ):
        conv_id = None

    if (
        conv_id
        and database.get_conversation(
            conv_id
        )
    ):
        return conv_id, False

    title = re.sub(
        r"\s+",
        " ",
        message,
    ).strip()[:48]

    if not title:
        title = "Nuova conversazione"

    return (
        database.create_conversation(
            title
        ),
        True,
    )


def trim_history(history):
    total = 0
    kept = []

    for item in reversed(
        history
    ):
        total += len(
            item["content"]
        )

        if (
            total
            > config.HISTORY_MAX_CHARS
        ):
            break

        kept.append(item)

    return list(
        reversed(kept)
    )


def tok(text):
    return (
        int(
            len(text)
            / config.CHARS_PER_TOKEN
        )
        + 1
    )


def prepare(
    context,
    history,
    message,
):
    now = time.strftime(
        "%Y-%m-%d %H:%M"
    )

    base = (
        llm.get_model_system()
        or config.FALLBACK_SYSTEM
    ) + (
        f"\n\nData e ora locale: {now}."
    )

    budget = (
        config.NUM_CTX
        - config.ANSWER_RESERVE_TOKENS
    )

    history = list(history)

    dropped_history = 0
    dropped_context = False

    def build(ctx):
        return (
            base
            + (
                "\n\n" + ctx
                if ctx
                else ""
            )
        )

    def total(ctx):
        return (
            tok(build(ctx))
            + sum(
                tok(m["content"])
                for m in history
            )
            + tok(message)
        )

    while (
        history
        and total(context)
        > budget
    ):
        history.pop(0)
        dropped_history += 1

    while (
        history
        and history[0]["role"]
        != "user"
    ):
        history.pop(0)
        dropped_history += 1

    if (
        context
        and total(context)
        > budget
    ):
        context = ""
        dropped_context = True

    tokens = total(context)

    messages = [
        {
            "role": "system",
            "content": build(
                context
            ),
        }
    ]

    messages.extend(
        {
            "role": m["role"],
            "content": m["content"],
        }
        for m in history
    )

    messages.append(
        {
            "role": "user",
            "content": message,
        }
    )

    info = {
        "tokens": tokens,
        "budget": budget,
        "dropped_history": dropped_history,
        "dropped_context": dropped_context,
    }

    return messages, info


def extraction_worker(
    user_message,
    answer,
):
    try:
        with llm.OLLAMA_LOCK:
            saved = (
                memory.extract_with_llm(
                    user_message,
                    answer,
                )
            )

        for item in saved:
            log(
                "MEMORY",
                "Nuovo ricordo (LLM): "
                + item["content"],
            )

    except Exception as error:
        log(
            "ERROR",
            "Estrazione memoria fallita | "
            f"{type(error).__name__}: {error}",
        )


@app.route("/")
def index():
    (
        ip,
        browser,
        os_name,
        device,
        user_agent,
    ) = get_client_info()

    cache_key = (
        f"{ip}|{user_agent}"
    )

    now = time.time()

    if (
        now
        - VISIT_CACHE.get(
            cache_key,
            0,
        )
        > VISIT_CACHE_SECONDS
    ):
        VISIT_CACHE[
            cache_key
        ] = now

        log(
            "CONNECT",
            f"Entrata | IP: {ip} | "
            f"Dispositivo: {device} | "
            f"OS: {os_name} | "
            f"Browser: {browser}",
        )

    return render_template(
        "index.html",
        model=config.MODEL,
    )


@app.route(
    "/health",
    methods=["GET"],
)
def health():
    online, installed = (
        llm.model_status()
    )

    if not online:
        return (
            jsonify(
                {
                    "ok": False,
                    "ollama": "offline",
                    "model": config.MODEL,
                }
            ),
            503,
        )

    return jsonify(
        {
            "ok": True,
            "ollama": "online",
            "model": config.MODEL,
            "model_installed": installed,
        }
    )


@app.route(
    "/api/conversations",
    methods=["GET"],
)
def api_conversations():
    return jsonify(
        database.list_conversations()
    )


@app.route(
    "/api/conversations/<int:conv_id>",
    methods=["GET"],
)
def api_conversation(conv_id):
    if not database.get_conversation(
        conv_id
    ):
        return (
            jsonify(
                {
                    "error": "Conversazione non trovata."
                }
            ),
            404,
        )

    return jsonify(
        database.get_messages(
            conv_id
        )
    )


@app.route(
    "/api/conversations/<int:conv_id>",
    methods=["DELETE"],
)
def api_conversation_delete(
    conv_id,
):
    database.delete_conversation(
        conv_id
    )

    return jsonify(
        {"ok": True}
    )


@app.route(
    "/api/memories",
    methods=["GET"],
)
def api_memories():
    return jsonify(
        database.list_memories()
    )


@app.route(
    "/api/memories",
    methods=["POST"],
)
def api_memories_add():
    data = (
        request.get_json(
            silent=True
        )
        or {}
    )

    content = str(
        data.get(
            "content",
            "",
        )
    ).strip()

    if len(content) < 3:
        return (
            jsonify(
                {
                    "error": "Ricordo troppo corto."
                }
            ),
            400,
        )

    result = memory.add_memory(
        content,
        "esplicito",
        5,
        "manuale",
    )

    if result is None:
        return jsonify(
            {
                "ok": True,
                "duplicate": True,
            }
        )

    return (
        jsonify(
            {
                "ok": True,
                "memory": result,
            }
        ),
        201,
    )


@app.route(
    "/api/memories/<int:mem_id>",
    methods=["DELETE"],
)
def api_memories_delete(
    mem_id,
):
    database.delete_memory(
        mem_id
    )

    return jsonify(
        {"ok": True}
    )


@app.route(
    "/api/memories",
    methods=["DELETE"],
)
def api_memories_clear():
    database.clear_memories()

    return jsonify(
        {"ok": True}
    )


@app.route(
    "/chat",
    methods=["POST"],
)
def chat():
    (
        client_ip,
        browser,
        os_name,
        device,
        _,
    ) = get_client_info()

    data = (
        request.get_json(
            silent=True
        )
        or {}
    )

    message = str(
        data.get(
            "message",
            "",
        )
    ).strip()

    requested_conv = data.get(
        "conversation_id"
    )

    voice = bool(
        data.get(
            "voice",
            False,
        )
    )

    if not message:
        return (
            jsonify(
                {
                    "error": "Messaggio vuoto."
                }
            ),
            400,
        )

    if (
        len(message)
        > config.MAX_MESSAGE_CHARS
    ):
        return (
            jsonify(
                {
                    "error": "Messaggio troppo lungo."
                }
            ),
            413,
        )

    log(
        "REQUEST",
        f"Richiesta | IP: {client_ip} | "
        f"{device} | {os_name} | "
        f"{browser} | "
        f"{len(message)} caratteri"
        + (
            " | voce"
            if voice
            else ""
        ),
    )

    def generate():
        start = time.perf_counter()

        acquired = False
        stream = None

        try:
            (
                conv_id,
                is_new,
            ) = resolve_conversation(
                requested_conv,
                message,
            )

            yield sse(
                {
                    "type": "init",
                    "conversation_id": conv_id,
                    "new": is_new,
                }
            )

            t = time.perf_counter()

            yield step(
                "analysis",
                "active",
                "Lettura della richiesta",
            )

            kws = memory.keywords(
                message
            )

            history = trim_history(
                database.recent_messages(
                    conv_id,
                    config.RECENT_MESSAGES,
                )
            )

            database.add_message(
                conv_id,
                "user",
                message,
            )

            yield step(
                "analysis",
                "done",
                f"{len(message)} car. · "
                f"{len(kws)} concetti chiave · "
                f"{len(history)} msg precedenti",
                ms_since(t),
            )

            t = time.perf_counter()

            yield step(
                "retrieval",
                "active",
                "Ricerca nella memoria",
            )

            memories = (
                memory.retrieve(
                    message
                )
            )

            past = (
                memory.retrieve_past(
                    message,
                    conv_id,
                )
            )

            learned = (
                memory.remember_rules(
                    message
                )
            )

            yield sse(
                {
                    "type": "memory",
                    "items": memories,
                    "past": len(past),
                }
            )

            if learned:
                for item in learned:
                    log(
                        "MEMORY",
                        "Nuovo ricordo (regola): "
                        + item[
                            "content"
                        ],
                    )

                yield sse(
                    {
                        "type": "memory_saved",
                        "items": learned,
                    }
                )

            yield step(
                "retrieval",
                "done",
                f"{len(memories)} ricordi · "
                f"{len(past)} riferimenti passati"
                + (
                    f" · {len(learned)} salvati"
                    if learned
                    else ""
                ),
                ms_since(t),
            )

            t = time.perf_counter()

            yield step(
                "verify",
                "active",
                "Controllo modello e contesto",
            )

            online, installed = (
                llm.model_status()
            )

            if not online:
                yield step(
                    "verify",
                    "failed",
                    "Ollama non raggiungibile",
                    ms_since(t),
                )

                yield sse(
                    {
                        "type": "error",
                        "message": (
                            "Ollama non è raggiungibile. "
                            "Controlla che sia avviato."
                        ),
                    }
                )

                return

            if not installed:
                yield step(
                    "verify",
                    "failed",
                    f"Modello '{config.MODEL}' non trovato",
                    ms_since(t),
                )

                yield sse(
                    {
                        "type": "error",
                        "message": (
                            f"Il modello '{config.MODEL}' "
                            "non esiste. Crealo con: "
                            f"ollama create {config.MODEL} "
                            "-f Modelfile"
                        ),
                    }
                )

                return

            context = (
                memory.build_context_block(
                    memories,
                    past,
                )
            )

            messages, info = prepare(
                context,
                history,
                message,
            )

            if voice:
                messages[0][
                    "content"
                ] += (
                    "\n\n"
                    + VOICE_NOTE
                )

            notes = [
                f"~{info['tokens']}/{info['budget']} "
                "token di contesto"
            ]

            notes.append(
                "Modelfile caricato"
                if llm.get_model_system()
                else "prompt di riserva"
            )

            if voice:
                notes.append(
                    "modalità vocale"
                )

            if info[
                "dropped_history"
            ]:
                notes.append(
                    f"{info['dropped_history']} "
                    "msg vecchi tolti"
                )

            if info[
                "dropped_context"
            ]:
                notes.append(
                    "memorie escluse per spazio"
                )

            yield step(
                "verify",
                "done",
                " · ".join(notes),
                ms_since(t),
            )

            yield step(
                "generation",
                "active",
                "Avvio del modello",
            )

            waited = 0

            while not llm.OLLAMA_LOCK.acquire(
                timeout=1
            ):
                waited += 1

                if waited == 1:
                    yield step(
                        "generation",
                        "active",
                        "In coda: modello occupato",
                    )

                if (
                    waited
                    > config.LOCK_WAIT_SECONDS
                ):
                    yield sse(
                        {
                            "type": "error",
                            "message": (
                                "JARVIS è impegnato "
                                "in un'altra elaborazione. "
                                "Riprova tra poco."
                            ),
                        }
                    )

                    return

                yield ": attesa\n\n"

            acquired = True

            log(
                "OLLAMA",
                f"Elaborazione avviata | "
                f"IP: {client_ip} | "
                f"conv {conv_id}"
                + (
                    " | VOCE"
                    if voice
                    else ""
                ),
            )

            t_gen = (
                time.perf_counter()
            )

            first = None
            parts = []
            stats = {}

            yield step(
                "generation",
                "active",
                "In attesa del primo token",
            )

            stream = llm.stream_chat(
                messages
            )

            try:
                for kind, value in stream:
                    if kind == "chunk":
                        if first is None:
                            first = (
                                time.perf_counter()
                                - t_gen
                            )

                            yield step(
                                "generation",
                                "active",
                                "Scrittura in corso · "
                                f"primo token dopo "
                                f"{first:.1f}s",
                            )

                        parts.append(
                            value
                        )

                        yield sse(
                            {
                                "type": "chunk",
                                "content": value,
                            }
                        )

                    else:
                        stats = value

            finally:
                stream.close()

            answer = "".join(
                parts
            ).strip()

            if not answer:
                yield step(
                    "generation",
                    "failed",
                    "Nessun output",
                    ms_since(t_gen),
                )

                yield sse(
                    {
                        "type": "error",
                        "message": (
                            "Il modello non ha prodotto "
                            "alcuna risposta."
                        ),
                    }
                )

                return

            if database.get_conversation(
                conv_id
            ):
                database.add_message(
                    conv_id,
                    "assistant",
                    answer,
                )

                database.touch_conversation(
                    conv_id
                )
            else:
                log(
                    "INFO",
                    f"Conversazione {conv_id} "
                    "eliminata durante la risposta",
                )

            elapsed = (
                time.perf_counter()
                - start
            )

            log(
                "RESPONSE",
                f"Risposta completata | "
                f"IP: {client_ip} | "
                f"Tempo: {elapsed:.2f}s | "
                f"{len(answer)} caratteri"
                + (
                    " | VOCE"
                    if voice
                    else ""
                ),
            )

            if (
                config.LLM_EXTRACTION
                and len(message)
                >= config.EXTRACTION_MIN_CHARS
                and not memory.has_explicit(
                    message
                )
            ):
                threading.Thread(
                    target=extraction_worker,
                    args=(
                        message,
                        answer,
                    ),
                    daemon=True,
                ).start()

            tokens = (
                stats.get(
                    "tokens"
                )
                or len(parts)
            )

            eval_ns = stats.get(
                "eval_ns"
            )

            detail = (
                f"{tokens} token"
            )

            if eval_ns:
                detail += (
                    " · "
                    + f"{tokens / (eval_ns / 1e9):.1f} "
                    "tok/s"
                )

            if (
                stats.get(
                    "done_reason"
                )
                == "length"
            ):
                detail += (
                    " · limite di token raggiunto"
                )

            yield step(
                "generation",
                "done",
                detail,
                ms_since(t_gen),
            )

            yield sse(
                {
                    "type": "done",
                    "content": answer,
                    "elapsed": round(
                        elapsed,
                        2,
                    ),
                    "conversation_id": conv_id,
                }
            )

        except requests.RequestException as error:
            log(
                "ERROR",
                f"Ollama | {error}",
            )

            yield sse(
                {
                    "type": "error",
                    "message": (
                        "Ollama non è raggiungibile "
                        "oppure il modello "
                        f"'{config.MODEL}' non esiste "
                        f"(ollama create "
                        f"{config.MODEL} -f Modelfile)."
                    ),
                }
            )

        except Exception as error:
            log(
                "ERROR",
                f"Errore server | "
                f"{type(error).__name__}: {error}",
            )

            traceback.print_exc()

            yield sse(
                {
                    "type": "error",
                    "message": (
                        "Errore interno del server."
                    ),
                }
            )

        finally:
            if stream is not None:
                try:
                    stream.close()
                except Exception:
                    pass

            if acquired:
                llm.OLLAMA_LOCK.release()

    return Response(
        generate(),
        mimetype="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


if __name__ == "__main__":
    database.init_db()

    files_ok = check_files()
    ip = lan_ip()

    print("")
    print("=" * 64)
    print(" JARVIS SERVER")
    print("=" * 64)
    print(
        f" Cartella: {config.BASE_DIR}"
    )
    print(
        f" Modello : {config.MODEL}"
    )
    print(
        f" Ollama  : {config.OLLAMA_CHAT_URL}"
    )
    print(
        f" Database: {config.DB_PATH}"
    )

    suffix = (
        ""
        if config.PORT == 80
        else f":{config.PORT}"
    )

    print(
        f" Locale  : http://127.0.0.1{suffix}"
    )

    print(
        f" Rete    : http://{ip}{suffix}"
    )

    print("=" * 64)

    if not files_ok:
        print(
            " ATTENZIONE: mancano dei file "
            "(vedi ERROR sopra)."
        )

        print("=" * 64)

    log(
        "INFO",
        "Server avviato. In attesa di connessioni...",
    )

    serve(
        app,
        host=config.HOST,
        port=config.PORT,
        threads=8,
        send_bytes=1,
        channel_timeout=900,
    )