import os

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(BASE_DIR, "data")
os.makedirs(DATA_DIR, exist_ok=True)
DB_PATH = os.path.join(DATA_DIR, "jarvis.db")

OLLAMA_BASE = os.environ.get("OLLAMA_BASE", "http://127.0.0.1:11434")
OLLAMA_CHAT_URL = OLLAMA_BASE + "/api/chat"
OLLAMA_TAGS_URL = OLLAMA_BASE + "/api/tags"
OLLAMA_SHOW_URL = OLLAMA_BASE + "/api/show"
MODEL = os.environ.get("JARVIS_MODEL", "jarvis")

HOST = os.environ.get("JARVIS_HOST", "0.0.0.0")
PORT = int(os.environ.get("JARVIS_PORT", "80"))

OLLAMA_TIMEOUT = (10, 600)
NUM_CTX = 8192
NUM_PREDICT = 3072
ANSWER_RESERVE_TOKENS = 3072
CHARS_PER_TOKEN = 3.2
TEMPERATURE = 0.3
TOP_P = 0.9
KEEP_ALIVE = "30m"

RECENT_MESSAGES = 12
HISTORY_MAX_CHARS = 8000
MEMORY_TOP_K = 6
PAST_TOP_K = 3
MAX_CONTEXT_CHARS = 4000
MAX_MESSAGE_CHARS = 12000
LOCK_WAIT_SECONDS = 180

LLM_EXTRACTION = True
EXTRACTION_MIN_CHARS = 25

MEMORY_CATEGORIES = ("profilo", "preferenze", "progetti", "tecnico", "esplicito", "altro")

FALLBACK_SYSTEM = (
    "Sei JARVIS, un assistente AI locale specializzato in programmazione. "
    "Rispondi in italiano, in modo diretto e preciso. "
    "Quando scrivi codice, fornisci sempre il codice completo. "
    "Non inventare fatti e non mostrare il ragionamento interno."
)

EXTRACT_SYSTEM = (
    "Sei un estrattore di memoria. Ricevi il messaggio di un utente e la risposta di un assistente. "
    "Estrai SOLO informazioni personali durevoli sull'utente che compaiono nel MESSAGGIO UTENTE "
    "(nome, età, città, lavoro, preferenze, progetti, competenze, hardware, obiettivi, abitudini, vincoli). "
    "Ignora domande, richieste temporanee, codice, opinioni generiche e qualsiasi cosa detta solo dall'assistente. "
    "Scrivi ogni ricordo in italiano, in terza persona, iniziando con \"L'utente\", in una frase breve. "
    "Categorie ammesse: profilo, preferenze, progetti, tecnico, altro. Importanza da 1 a 5. "
    "Rispondi SOLO con JSON valido in questo formato: "
    "{\"memories\":[{\"content\":\"L'utente ...\",\"category\":\"profilo\",\"importance\":4}]} "
    "Se non c'è nulla da salvare rispondi {\"memories\":[]}. Massimo 4 ricordi."
)