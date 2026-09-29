import sqlite3
import time
from contextlib import contextmanager

from config import DB_PATH


def connect():
    conn = sqlite3.connect(DB_PATH, timeout=30)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


@contextmanager
def db():
    conn = connect()
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def init_db():
    with db() as c:
        c.executescript(
            """
            CREATE TABLE IF NOT EXISTS conversations (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                title TEXT NOT NULL,
                created_at REAL NOT NULL,
                updated_at REAL NOT NULL
            );

            CREATE TABLE IF NOT EXISTS messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                conversation_id INTEGER NOT NULL
                    REFERENCES conversations(id) ON DELETE CASCADE,
                role TEXT NOT NULL,
                content TEXT NOT NULL,
                created_at REAL NOT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_messages_conv
                ON messages(conversation_id, id);

            CREATE TABLE IF NOT EXISTS memories (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                content TEXT NOT NULL,
                category TEXT NOT NULL DEFAULT 'altro',
                importance INTEGER NOT NULL DEFAULT 3,
                source TEXT NOT NULL DEFAULT 'auto',
                created_at REAL NOT NULL,
                updated_at REAL NOT NULL,
                last_used REAL,
                uses INTEGER NOT NULL DEFAULT 0
            );
            """
        )


# ---------------- conversazioni ----------------

def create_conversation(title):
    now = time.time()
    with db() as c:
        cur = c.execute(
            "INSERT INTO conversations (title, created_at, updated_at) VALUES (?, ?, ?)",
            (title, now, now),
        )
        return cur.lastrowid


def get_conversation(conv_id):
    with db() as c:
        row = c.execute(
            "SELECT id, title, created_at, updated_at FROM conversations WHERE id=?",
            (conv_id,),
        ).fetchone()
    return dict(row) if row else None


def list_conversations(limit=100):
    with db() as c:
        rows = c.execute(
            "SELECT id, title, updated_at FROM conversations "
            "ORDER BY updated_at DESC LIMIT ?",
            (limit,),
        ).fetchall()
    return [dict(r) for r in rows]


def delete_conversation(conv_id):
    with db() as c:
        c.execute("DELETE FROM conversations WHERE id=?", (conv_id,))


def touch_conversation(conv_id):
    with db() as c:
        c.execute(
            "UPDATE conversations SET updated_at=? WHERE id=?",
            (time.time(), conv_id),
        )


# ---------------- messaggi ----------------

def add_message(conv_id, role, content):
    with db() as c:
        cur = c.execute(
            "INSERT INTO messages (conversation_id, role, content, created_at) "
            "VALUES (?, ?, ?, ?)",
            (conv_id, role, content, time.time()),
        )
        return cur.lastrowid


def get_messages(conv_id):
    with db() as c:
        rows = c.execute(
            "SELECT id, role, content, created_at FROM messages "
            "WHERE conversation_id=? ORDER BY id ASC",
            (conv_id,),
        ).fetchall()
    return [dict(r) for r in rows]


def recent_messages(conv_id, limit):
    with db() as c:
        rows = c.execute(
            "SELECT role, content FROM messages WHERE conversation_id=? "
            "ORDER BY id DESC LIMIT ?",
            (conv_id, limit),
        ).fetchall()
    return [dict(r) for r in reversed(rows)]


def search_messages_like(terms, exclude_conv, limit=300):
    if not terms:
        return []
    clause = " OR ".join(["m.content LIKE ? ESCAPE '\\'"] * len(terms))
    params = [exclude_conv or 0]
    for t in terms:
        safe = t.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
        params.append(f"%{safe}%")
    params.append(limit)
    with db() as c:
        rows = c.execute(
            "SELECT m.role, m.content, m.conversation_id FROM messages m "
            f"WHERE m.conversation_id != ? AND ({clause}) "
            "ORDER BY m.id DESC LIMIT ?",
            params,
        ).fetchall()
    return [dict(r) for r in rows]


# ---------------- memorie ----------------

def list_memories():
    with db() as c:
        rows = c.execute(
            "SELECT id, content, category, importance, source, created_at, "
            "updated_at, uses FROM memories ORDER BY updated_at DESC"
        ).fetchall()
    return [dict(r) for r in rows]


def insert_memory(content, category, importance, source):
    now = time.time()
    with db() as c:
        cur = c.execute(
            "INSERT INTO memories (content, category, importance, source, "
            "created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
            (content, category, importance, source, now, now),
        )
        return cur.lastrowid


def update_memory(mem_id, content, importance):
    with db() as c:
        c.execute(
            "UPDATE memories SET content=?, importance=?, updated_at=? WHERE id=?",
            (content, importance, time.time(), mem_id),
        )


def delete_memory(mem_id):
    with db() as c:
        c.execute("DELETE FROM memories WHERE id=?", (mem_id,))


def clear_memories():
    with db() as c:
        c.execute("DELETE FROM memories")


def touch_memories(ids):
    if not ids:
        return
    now = time.time()
    with db() as c:
        c.executemany(
            "UPDATE memories SET uses=uses+1, last_used=? WHERE id=?",
            [(now, i) for i in ids],
        )