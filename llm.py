import json
import threading
import time

import requests

from config import (
    KEEP_ALIVE,
    MODEL,
    NUM_CTX,
    NUM_PREDICT,
    OLLAMA_CHAT_URL,
    OLLAMA_SHOW_URL,
    OLLAMA_TAGS_URL,
    OLLAMA_TIMEOUT,
    TEMPERATURE,
    TOP_P,
)

OLLAMA_LOCK = threading.Lock()

_system_cache = None
_tags_cache = {"t": 0.0, "names": None}


def get_model_system():
    """SYSTEM definito nel Modelfile del modello (cache dopo il primo successo)."""
    global _system_cache

    if _system_cache is not None:
        return _system_cache

    try:
        response = requests.post(
            OLLAMA_SHOW_URL,
            json={"model": MODEL, "name": MODEL},
            timeout=10,
        )
        response.raise_for_status()
        system = str(response.json().get("system") or "").strip()
    except (requests.RequestException, ValueError):
        return ""

    _system_cache = system
    return system


def model_status():
    """Restituisce (ollama_online, modello_installato). Cache di 10 secondi."""
    now = time.time()

    if _tags_cache["names"] is not None and now - _tags_cache["t"] < 10:
        names = _tags_cache["names"]
    else:
        try:
            response = requests.get(OLLAMA_TAGS_URL, timeout=4)
            response.raise_for_status()
            names = [m.get("name", "") for m in response.json().get("models", [])]
        except (requests.RequestException, ValueError):
            return False, False

        _tags_cache["t"] = now
        _tags_cache["names"] = names

    installed = any(
        n == MODEL or n == MODEL + ":latest" or n.split(":")[0] == MODEL
        for n in names
    )

    return True, installed


def stream_chat(messages):
    """Genera ("chunk", testo) per ogni pezzo e alla fine ("stats", dict)."""
    payload = {
        "model": MODEL,
        "messages": messages,
        "stream": True,
        "keep_alive": KEEP_ALIVE,
        "options": {
            "temperature": TEMPERATURE,
            "top_p": TOP_P,
            "num_ctx": NUM_CTX,
            "num_predict": NUM_PREDICT,
        },
    }

    final = {}

    with requests.post(
        OLLAMA_CHAT_URL,
        json=payload,
        stream=True,
        timeout=OLLAMA_TIMEOUT,
    ) as response:
        response.raise_for_status()

        for raw in response.iter_lines():
            if not raw:
                continue

            try:
                chunk = json.loads(raw)
            except (json.JSONDecodeError, UnicodeDecodeError):
                continue

            if chunk.get("error"):
                raise requests.RequestException(str(chunk["error"]))

            content = chunk.get("message", {}).get("content", "")
            if content:
                yield ("chunk", content)

            if chunk.get("done") is True:
                final = chunk
                break

    yield (
        "stats",
        {
            "tokens": final.get("eval_count"),
            "eval_ns": final.get("eval_duration"),
            "prompt_tokens": final.get("prompt_eval_count"),
            "done_reason": final.get("done_reason"),
        },
    )


def chat_json(system, user):
    payload = {
        "model": MODEL,
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ],
        "stream": False,
        "format": "json",
        "keep_alive": KEEP_ALIVE,
        "options": {
            "temperature": 0.1,
            "num_ctx": NUM_CTX,
            "num_predict": 512,
        },
    }

    response = requests.post(
        OLLAMA_CHAT_URL,
        json=payload,
        timeout=(10, 240),
    )
    response.raise_for_status()

    content = response.json().get("message", {}).get("content", "")

    try:
        return json.loads(content)
    except json.JSONDecodeError:
        return None