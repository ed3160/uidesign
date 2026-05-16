# How LLMs finish your sentence

An interactive 10-minute lesson on how language models read, embed, attend,
and sample. Five learn screens, three quiz puzzles, one canonical sentence.

Built with Flask + jQuery + SVG. No build step.

## Run it

You need Python 3.10 or newer.

```bash
# 1. Create a virtual env and install deps
python3 -m venv .venv
source .venv/bin/activate            # macOS / Linux
# .venv\Scripts\activate             # Windows (PowerShell or cmd)

pip install -r requirements.txt

# 2. Start the server
python app.py
```

Then open <http://127.0.0.1:5050> in any modern browser.

That's everything. No env vars, no database, no API keys. Single-user, state
lives in `data/user_state.json`.

## What's in here

```
app.py                 Flask backend — routes, tokenizer, quiz grading
templates/             home.html + index.html (lesson shell)
static/css/styles.css  Design system
static/js/app.js       Front-end runtime (vanilla jQuery, SVG-first)
data/
  lesson.json          The canonical sentence + attention weights +
                       next-token distributions + quiz definitions
  embeddings.json      Curated GloVe-50d words + 2D/3D PCA projections
precompute/            Offline scripts that built data/*.json (optional)
```

The two files in `data/` are everything the runtime loads. The
`precompute/` scripts are how those files were generated; you don't need
to re-run them unless you want to extend the vocabulary or change the
lesson copy.

### Re-generating the data (optional)

```bash
# Regenerate the lesson JSON (no downloads)
python precompute/build_lesson.py

# Regenerate the embeddings JSON (downloads ~820MB of GloVe vectors the
# first time, into precompute/.cache/)
python precompute/build_embeddings.py
```

## Routes

| URL                | Renders                                   |
|--------------------|-------------------------------------------|
| `/`                | Home page with a Start button             |
| `/learn/<n>`       | Learning beat `n` (1–6)                   |
| `/quiz/<n>`        | Quiz question `n` (1–3)                   |
| `/results`         | Score + per-question breakdown            |
| `POST /api/start`  | Reset session, stamp start time           |
| `POST /api/track`  | Log a page-enter or interaction event     |
| `POST /api/tokenize` | Live BPE via tiktoken (cl100k_base)     |
| `GET  /api/lesson` | Lesson JSON                               |
| `GET  /api/embeddings` | Embeddings JSON                       |
| `POST /api/quiz_check` | Grade a quiz submission, persist it   |
| `GET  /api/state`  | The current single-user session           |

## Stopping the server

`Ctrl+C` in the terminal.
