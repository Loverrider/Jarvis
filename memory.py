import re

import database
import llm
from config import (
    EXTRACT_SYSTEM,
    MAX_CONTEXT_CHARS,
    MEMORY_CATEGORIES,
    MEMORY_TOP_K,
    PAST_TOP_K,
)

STOPWORDS = set(
    """
    il lo la i gli le un uno una di a da in con su per tra fra e ed o ma se che chi cui non mi ti ci vi si
    sono ho hai ha abbiamo avete hanno del dello della dei degli delle al allo alla ai agli alle dal dallo
    dalla dai dagli dalle nel nello nella nei negli nelle sul sullo sulla sui sugli sulle come cosa quale
    quali quando dove perche perché piu più anche gia già poi mio mia miei mie tuo tua tuoi tue suo sua suoi
    sue questo questa questi queste quello quella quelli quelle essere fare puoi può posso vorrei voglio
    dammi dimmi utente molto tutto tutti tutte ogni solo sempre ancora ecco fai fatto fatti stato stata
    the and for that with this what how you are was have from your can please just like
    """.split()
)

TOKEN_RE = re.compile(r"[^\W_]+", re.UNICODE)

# "ricorda che ...", "ricordati di ...", "memorizza: ..." (serve sempre che / di / :)
EXPLICIT_RE = re.compile(
    r"\b(?:ricordati|ricorda|memorizza|tieni a mente|non dimenticare)"
    r"\s*(?:(?:che|di)\b|:)\s*([^\n]{3,300})",
    re.I | re.U,
)


def keywords(text, limit=12):
    seen = []
    for token in TOKEN_RE.findall((text or "").lower()):
        if token in STOPWORDS:
            continue
        if len(token) < 3 and not token.isdigit():
            continue
        stem = token[:6]
        if stem not in seen:
            seen.append(stem)
        if len(seen) >= limit:
            break
    return seen


def has_explicit(text):
    return bool(EXPLICIT_RE.search(text or ""))


# ---------------- recupero ----------------

def retrieve(query, limit=MEMORY_TOP_K):
    query_kw = set(keywords(query))
    memories = database.list_memories()

    scored = []
    core = []

    for m in memories:
        tokens = set(keywords(m["content"]))
        overlap = len(query_kw & tokens)

        if overlap > 0:
            score = overlap * (1 + 0.15 * m["importance"]) / (1 + 0.04 * len(tokens))
            scored.append((score, m))

        if m["category"] == "profilo" and m["importance"] >= 4:
            core.append(m)

    scored.sort(key=lambda x: x[0], reverse=True)

    selected = [m for _, m in scored[:limit]]
    selected_ids = {m["id"] for m in selected}

    for m in core[:4]:
        if m["id"] not in selected_ids:
            selected.append(m)
            selected_ids.add(m["id"])

    database.touch_memories([m["id"] for m in selected])

    return [
        {"id": m["id"], "content": m["content"], "category": m["category"]}
        for m in selected
    ]


def retrieve_past(query, conv_id, limit=PAST_TOP_K):
    kws = keywords(query)
    if not kws:
        return []

    rows = database.search_messages_like(kws[:6], conv_id)
    needed = min(2, len(kws))
    kw_set = set(kws)

    scored = []
    seen = set()

    for row in rows:
        tokens = set(keywords(row["content"], limit=200))
        overlap = len(kw_set & tokens)

        if overlap < needed:
            continue

        key = row["content"][:80]
        if key in seen:
            continue
        seen.add(key)

        score = overlap - 0.0005 * len(row["content"])
        scored.append((score, row))

    scored.sort(key=lambda x: x[0], reverse=True)

    result = []
    for _, row in scored[:limit]:
        text = re.sub(r"\s+", " ", row["content"]).strip()[:300]
        role = "utente" if row["role"] == "user" else "jarvis"
        result.append({"role": role, "content": text})

    return result


def build_context_block(memories, past):
    parts = []

    if memories:
        lines = "\n".join(f"- {m['content']}" for m in memories)
        parts.append(
            "INFORMAZIONI MEMORIZZATE SULL'UTENTE "
            "(usale solo se pertinenti):\n" + lines
        )

    if past:
        lines = "\n".join(f"- [{p['role']}] {p['content']}" for p in past)
        parts.append("STRALCI DI CONVERSAZIONI PASSATE (possibili riferimenti):\n" + lines)

    return "\n\n".join(parts)[:MAX_CONTEXT_CHARS]


# ---------------- salvataggio ----------------

def _clean(content):
    content = re.sub(r"\s+", " ", str(content or "")).strip()
    content = content.strip("\"'`“”‘’ ")
    content = content[:300]
    if content and content[-1] not in ".!?":
        content += "."
    return content


def _is_duplicate(new_tokens, old_tokens):
    if not old_tokens or not new_tokens:
        return False

    inter = len(old_tokens & new_tokens)
    union = len(old_tokens | new_tokens)
    smaller = min(len(old_tokens), len(new_tokens))

    if union and inter / union >= 0.7:
        return True

    return smaller >= 4 and inter / smaller >= 0.8


def add_memory(content, category="altro", importance=3, source="auto"):
    content = _clean(content)
    if len(content) < 6:
        return None

    if category not in MEMORY_CATEGORIES:
        category = "altro"

    try:
        importance = max(1, min(5, int(importance)))
    except (TypeError, ValueError):
        importance = 3

    new_tokens = set(keywords(content))
    if not new_tokens:
        return None

    for m in database.list_memories():
        old_tokens = set(keywords(m["content"]))

        if _is_duplicate(new_tokens, old_tokens):
            best = content if len(content) >= len(m["content"]) else m["content"]
            database.update_memory(m["id"], best, max(importance, m["importance"]))
            return None

    mem_id = database.insert_memory(content, category, importance, source)
    return {"id": mem_id, "content": content, "category": category}


RULES = [
    (
        re.compile(r"\bmi chiamo ([^\W\d_][\w'\-]{1,29})", re.I | re.U),
        "Il nome dell'utente è {0}.",
        "profilo",
        5,
    ),
    (
        re.compile(r"\bho (\d{1,3}) anni\b", re.I),
        "L'utente ha {0} anni.",
        "profilo",
        4,
    ),
    (
        re.compile(
            r"\b(?:vivo|abito|risiedo) (?:a|in|ad) ([\w' \-]{2,40}?)(?:[.,;!?\n]|$| e | ma )",
            re.I | re.U,
        ),
        "L'utente vive a {0}.",
        "profilo",
        4,
    ),
    (
        re.compile(
            r"\blavoro (?:come|da) ([\w' \-]{2,40}?)(?:[.,;!?\n]|$| e | ma )",
            re.I | re.U,
        ),
        "L'utente lavora come {0}.",
        "profilo",
        4,
    ),
    (
        re.compile(r"(?<!non )\bmi piace(?:no)? ([^.!?\n]{2,80})", re.I | re.U),
        "All'utente piace {0}.",
        "preferenze",
        3,
    ),
    (
        re.compile(r"\bnon mi piace(?:no)? ([^.!?\n]{2,80})", re.I | re.U),
        "All'utente non piace {0}.",
        "preferenze",
        3,
    ),
    (
        EXPLICIT_RE,
        "{0}",
        "esplicito",
        5,
    ),
]


def remember_rules(text):
    saved = []

    for pattern, template, category, importance in RULES:
        for match in pattern.finditer(text or ""):
            value = match.group(1).strip(" .,;:!?")
            if len(value) < 3:
                continue

            content = template.format(value)
            if category == "esplicito":
                content = content[0].upper() + content[1:]

            result = add_memory(content, category, importance, "regola")
            if result:
                saved.append(result)

    return saved


def extract_with_llm(user_message, answer):
    data = llm.chat_json(
        EXTRACT_SYSTEM,
        f"MESSAGGIO UTENTE:\n{user_message[:2000]}\n\n"
        f"RISPOSTA ASSISTENTE:\n{answer[:800]}",
    )

    if not isinstance(data, dict):
        return []

    items = data.get("memories")
    if not isinstance(items, list):
        return []

    saved = []

    for item in items[:4]:
        if not isinstance(item, dict):
            continue

        content = str(item.get("content", "")).strip()
        category = str(item.get("category", "altro")).lower()

        try:
            importance = int(item.get("importance", 3))
        except (TypeError, ValueError):
            importance = 3

        result = add_memory(content, category, importance, "llm")
        if result:
            saved.append(result)

    return saved