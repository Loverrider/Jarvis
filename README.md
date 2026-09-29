# JARVIS

![Python](https://img.shields.io/badge/Python-3.10%2B-3776AB?logo=python&logoColor=white)
![Flask](https://img.shields.io/badge/Flask-Waitress-000000?logo=flask&logoColor=white)
![Ollama](https://img.shields.io/badge/Ollama-local%20LLM-8A2BE2)
![SQLite](https://img.shields.io/badge/SQLite-persistent%20memory-003B57?logo=sqlite&logoColor=white)

A private AI assistant that runs entirely on your own computer.
It uses a local language model (Qwen 2.5 Coder 14B via [Ollama](https://ollama.com)), so your data never leaves your machine.

## Features

- **Web chat.** Open it from your PC or from your phone on the same network. The interface is responsive and mobile-friendly.
- **Persistent memory.** Conversations and personal facts (name, preferences, projects) are stored in a local SQLite database.
- **Automatic memory extraction.** Useful information about you is detected and saved, using simple rules plus the model itself.
- **Context retrieval.** Before every answer, JARVIS searches its memory and past conversations and passes the relevant parts to the model.
- **Recent context.** The latest messages of the conversation are always included, trimmed to fit the model's context window.
- **Real reasoning steps.** The UI shows what actually happens: request analysis, memory lookup, context check, generation. Timings and tokens per second are included. The model's private chain of thought is never shown.
- **Voice mode.** Talk to it and it answers out loud, sentence by sentence while it generates.
- **Custom personality.** Behavior comes from your own `Modelfile`, which the server reads through Ollama.
- **Memory manager.** View, add and delete memories from the side panel.

## How it works

1. The browser sends your message to a Flask server.
2. The server retrieves relevant memories, past conversation snippets and recent messages.
3. It builds the prompt and streams it to Ollama.
4. The answer streams back to the browser in real time and is saved.
5. New facts about you are extracted and stored for future chats.

## Requirements

- Python 3.10 or newer
- [Ollama](https://ollama.com) installed and running
- A GPU or enough RAM for a 14B model (about 9 GB for the default quantization)

## Installation

```bash
git clone https://github.com/<your-username>/jarvis.git
cd jarvis

pip install -r requirements.txt

ollama pull qwen2.5-coder:14b
ollama create jarvis -f Modelfile

python server.py
```

Then open `http://localhost` in your browser.

## Configuration

Settings live in `config.py`. The most common ones can be overridden with environment variables.

| Variable | Default | Description |
|---|---|---|
| `JARVIS_MODEL` | `jarvis` | Ollama model name |
| `JARVIS_PORT` | `80` | Server port |
| `JARVIS_HOST` | `0.0.0.0` | Bind address |
| `OLLAMA_BASE` | `http://127.0.0.1:11434` | Ollama URL |

Example (Windows PowerShell):

```powershell
$env:JARVIS_PORT=8080; python server.py
```

Example (Linux / macOS):

```bash
JARVIS_PORT=8080 python server.py
```

Other useful values in `config.py`: `NUM_CTX` (context size), `NUM_PREDICT` (max answer length), `TEMPERATURE`, `LLM_EXTRACTION` (turn automatic memory extraction on or off).

## Using it from your phone or another PC

The server listens on all network interfaces and prints your LAN address at startup (`Rete: http://<IP>`).
Both devices must be on the same network. If the page does not open, allow the port in your firewall.

Windows (PowerShell as administrator):

```powershell
New-NetFirewallRule -DisplayName "JARVIS" -Direction Inbound -Protocol TCP -LocalPort 80 -Action Allow
```

Linux:

```bash
sudo ufw allow 80/tcp
```

## Voice mode

Press **Voce** in the top bar, then talk. JARVIS listens, thinks and answers out loud. Tap the orb to interrupt it.

- The microphone requires **HTTPS or `localhost`**. On plain `http://<IP>` browsers block it, while speech output still works.
- Speech recognition uses the browser's own service (Chrome, Edge, Safari) and needs internet only for transcription. The model stays local.
- In voice mode answers are short and code is not read aloud. It is written in the chat instead.

## Memory

Memories are saved in three ways:

1. **Rules** for clear statements such as name, age, city, job and likes.
2. **Explicit commands**, for example: `Ricorda che preferisco codice commentato`.
3. **Model extraction** after longer messages, in the background.

Everything is stored in `data/jarvis.db` and can be edited or deleted from the memory panel.

## Project structure

```
jarvis/
├── server.py          web server and API
├── config.py          settings
├── database.py        SQLite storage
├── llm.py             Ollama connection
├── memory.py          memory and retrieval
├── Modelfile          model personality and parameters
├── requirements.txt
├── data/              created automatically (jarvis.db)
├── templates/
│   └── index.html
└── static/
    ├── css/
    │   ├── style.css
    │   └── voice.css
    └── js/
        ├── galaxy.js  animated background
        ├── app.js     chat, memory and UI logic
        └── voice.js   voice mode
```

## Tech stack

| Part | Technology |
|---|---|
| Backend | Python, Flask, Waitress |
| Model runtime | Ollama |
| Database | SQLite |
| Frontend | HTML, CSS, vanilla JavaScript |
| Voice | Browser Speech Recognition and Speech Synthesis |

## Troubleshooting

| Problem | Fix |
|---|---|
| `TemplateNotFound: index.html` | Make sure `templates/index.html` exists and is not named `index.html.txt` |
| "Ollama offline" in the UI | Start Ollama (`ollama serve` or the desktop app) |
| "Modello mancante" | Run `ollama create jarvis -f Modelfile` |
| Port 80 in use or permission denied | Use another port, for example `JARVIS_PORT=8080` |
| Old CSS or JS after an update | Hard refresh with `Ctrl+F5` |
| Changed the Modelfile | Run `ollama create jarvis -f Modelfile` again and restart the server |

## Notes

- The interface and the default prompts are in Italian.
- There is no authentication. Only expose the server on networks you trust.

## License

MIT (add a `LICENSE` file to the repository).
