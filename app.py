"""
Flask backend for the LLM lesson.

Runtime deps: flask, tiktoken. All embedding/attention/distribution data is
precomputed offline into JSON (see precompute/).

Routes:
  GET  /                  -> home page with a Start button
  GET  /learn/<n>         -> learning page n  (1..6)
  GET  /quiz/<n>          -> quiz page n      (1..3)
  GET  /results           -> quiz results page

  POST /api/start         -> reset session, record start time
  POST /api/track         -> record a per-page event (entry, selection, etc.)
  POST /api/tokenize      -> real BPE tokenization (cl100k_base, GPT-4 family)
  GET  /api/lesson        -> the canonical sentence + per-variant attention,
                             distributions, and the autoregressive loop trace
  GET  /api/embeddings    -> curated word vectors + 2D/3D projections
  POST /api/quiz_check    -> partial-credit grading for Q1/Q2/Q3
  GET  /api/state         -> the current single-user session (used by results)

Single-user assumption: state lives in one JSON file at data/user_state.json.
A real app would key this by user id.
"""

import json
import time
from pathlib import Path

import tiktoken
from flask import Flask, render_template, request, jsonify, redirect, url_for

app = Flask(__name__)


@app.after_request
def no_store_on_dynamic(resp):
    """Prevent the browser from caching dynamic pages (or putting them in
    bfcache). Without this, back-navigation restores a DOM snapshot from
    before the user submitted quizzes — so /results would show 0/3 even
    after a perfect run, the Start button would stay disabled at
    "Starting…", and the vocab slider would remember its prior position.
    Static assets under /static are left alone."""
    if not request.path.startswith("/static/"):
        resp.headers.setdefault("Cache-Control", "no-store")
    return resp

DATA = Path(__file__).resolve().parent / "data"
LESSON = json.loads((DATA / "lesson.json").read_text())
try:
    EMBED = json.loads((DATA / "embeddings.json").read_text())
except FileNotFoundError:
    EMBED = {"words": {}, "clusters": [], "variance_explained": {}}

ENC = tiktoken.get_encoding("cl100k_base")  # GPT-4 family

STATE_FILE = DATA / "user_state.json"

# Learning beat for each /learn/<n>. Quiz screens are /quiz/<n>.
LEARN_SCREENS = ["tokens", "embeddings", "attention", "distribution", "loop", "lesson-complete"]
QUIZ_SCREENS  = ["q1", "q2", "q3"]


# ----------------------------------------------------------------------------
# Single-user state — persisted to disk so reloads don't lose progress.
# ----------------------------------------------------------------------------
def _empty_state():
    return {"started_at": None, "events": [], "quiz": {}, "score": None}

def load_state():
    if STATE_FILE.exists():
        try:
            return json.loads(STATE_FILE.read_text())
        except json.JSONDecodeError:
            pass
    return _empty_state()

def save_state(state):
    STATE_FILE.write_text(json.dumps(state, indent=2))

def record_event(kind: str, payload: dict | None = None):
    state = load_state()
    state["events"].append({
        "kind": kind,
        "at": time.time(),
        "data": payload or {},
    })
    save_state(state)
    return state


# ----------------------------------------------------------------------------
# Pages
# ----------------------------------------------------------------------------
@app.route("/")
def home():
    return render_template("home.html")


@app.route("/learn/<int:n>")
def learn(n):
    if n < 1 or n > len(LEARN_SCREENS):
        return redirect(url_for("home"))
    return render_template(
        "index.html",
        start_screen=LEARN_SCREENS[n - 1],
        route_kind="learn",
        route_n=n,
        total_learn=len(LEARN_SCREENS),
        total_quiz=len(QUIZ_SCREENS),
    )


@app.route("/quiz/<int:n>")
def quiz(n):
    if n < 1 or n > len(QUIZ_SCREENS):
        return redirect(url_for("home"))
    return render_template(
        "index.html",
        start_screen=QUIZ_SCREENS[n - 1],
        route_kind="quiz",
        route_n=n,
        total_learn=len(LEARN_SCREENS),
        total_quiz=len(QUIZ_SCREENS),
    )


@app.route("/results")
def results():
    return render_template(
        "index.html",
        start_screen="results",
        route_kind="results",
        route_n=0,
        total_learn=len(LEARN_SCREENS),
        total_quiz=len(QUIZ_SCREENS),
    )


# ----------------------------------------------------------------------------
# Session tracking
# ----------------------------------------------------------------------------
@app.route("/api/start", methods=["POST"])
def api_start():
    state = _empty_state()
    state["started_at"] = time.time()
    state["events"].append({"kind": "start", "at": state["started_at"], "data": {}})
    save_state(state)
    return jsonify({"ok": True})


@app.route("/api/track", methods=["POST"])
def api_track():
    body = request.json or {}
    kind = body.get("kind", "event")
    record_event(kind, body.get("data") or {})
    return jsonify({"ok": True})


@app.route("/api/state")
def api_state():
    resp = jsonify(load_state())
    # The results page reads this; browsers love to cache GETs.
    resp.headers["Cache-Control"] = "no-store"
    return resp


# ----------------------------------------------------------------------------
# Live BPE tokenization
# ----------------------------------------------------------------------------
def tokenize_text(text: str):
    """Return [{text, id}] using real cl100k_base BPE."""
    ids = ENC.encode(text)
    return [{"text": ENC.decode([i]), "id": int(i)} for i in ids]


@app.route("/api/tokenize", methods=["POST"])
def api_tokenize():
    text = request.json.get("text", "")
    return jsonify({"tokens": tokenize_text(text), "length": len(text)})


# ----------------------------------------------------------------------------
# Lesson + embeddings
# ----------------------------------------------------------------------------
@app.route("/api/lesson")
def api_lesson():
    return jsonify(LESSON)


@app.route("/api/embeddings")
def api_embeddings():
    return jsonify(EMBED)


# ----------------------------------------------------------------------------
# Quiz checking
# ----------------------------------------------------------------------------
def check_q1(student_order: list) -> dict:
    """Q1 is a rank-by-token-count puzzle.
    Grade by: how many candidates are in a slot whose rank-by-real-count matches.
    Ties allow either arrangement (we score on the *count* in the slot, not
    the candidate's identity)."""
    candidates = LESSON["quiz1"]["candidates"]
    counts = {c: len(ENC.encode(c)) for c in candidates}
    sorted_truth = sorted(counts.values())             # ascending counts

    student_counts = [counts.get(c, -1) for c in student_order]
    positions_correct = sum(1 for i, cnt in enumerate(student_counts)
                            if i < len(sorted_truth) and cnt == sorted_truth[i])
    n = len(candidates)

    # pair count: how many ordered pairs respect the true ascending order
    pairs_total = n * (n - 1) // 2
    pairs_right = 0
    for i in range(n):
        for j in range(i + 1, n):
            if student_counts[i] <= student_counts[j]:
                pairs_right += 1

    # pass if at most one inversion — i.e. one adjacent swap is forgiven
    correct = pairs_right >= pairs_total - 1

    return {
        "counts": counts,
        "true_order": [c for c, _ in sorted(counts.items(), key=lambda kv: kv[1])],
        "positions_correct": positions_correct,
        "pairs_right": pairs_right,
        "pairs_total": pairs_total,
        "correct": correct,
    }


def check_q2(answers: list) -> dict:
    """answers: list of {kind, target, x, y}. Score by distance in [-1,1]^2 space."""
    puzzles = LESSON["quiz2"]["puzzles"]
    words = EMBED.get("words", {})
    results = []
    total = 0.0
    for ans, puz in zip(answers, puzzles):
        target = puz["target"]
        twords = words.get(target)
        if not twords:
            results.append({"target": target, "ok": False, "dist": None})
            continue
        tx, ty = twords["xy"]
        d = ((ans["x"] - tx) ** 2 + (ans["y"] - ty) ** 2) ** 0.5
        # max distance in [-1,1]^2 is 2*sqrt(2) ≈ 2.83
        score = max(0.0, 1.0 - d / 1.0)  # within radius 1.0 → full credit decays
        results.append({
            "target": target,
            "target_xy": [tx, ty],
            "your_xy": [ans["x"], ans["y"]],
            "dist": round(d, 3),
            "score": round(score, 3),
            "ok": d < 0.45,
        })
        total += score
    avg = total / max(len(results), 1)
    return {
        "puzzles": results,
        "avg_score": round(avg, 3),
        "correct": avg >= 0.6,
    }


def check_q3(answers: list) -> dict:
    """Q3 is three sub-puzzles. answers is a list aligned with quiz3.puzzles."""
    puzzles = LESSON["quiz3"]["puzzles"]
    results = []
    correct_count = 0
    for ans, puz in zip(answers, puzzles):
        if puz["kind"] == "pick":
            pick = ans.get("pick")
            ok = (pick == puz["answer"])
            results.append({
                "kind": "pick", "ok": ok,
                "your": pick, "answer": puz["answer"],
                "explain": puz["explain"],
            })
        elif puz["kind"] == "rank":
            order = list(ans.get("order", []))
            truth = puz["order"]
            positions_correct = sum(1 for i, c in enumerate(order)
                                    if i < len(truth) and c == truth[i])
            ok = positions_correct >= len(truth) - 1
            results.append({
                "kind": "rank", "ok": ok,
                "positions_correct": positions_correct,
                "your": order, "answer": truth,
                "explain": puz["explain"],
            })
        elif puz["kind"] == "temp":
            match = ans.get("match", {})
            hits = 0
            details = []
            for s in puz["samples"]:
                given = match.get(s["text"])
                ok_one = given is not None and abs(float(given) - s["temperature"]) < 0.01
                hits += int(ok_one)
                details.append({"text": s["text"], "your": given,
                                "answer": s["temperature"], "ok": ok_one})
            ok = hits >= 2          # ≥ 2 of 3 right counts as pass
            results.append({
                "kind": "temp", "ok": ok,
                "hits": hits, "details": details,
                "explain": puz["explain"],
            })
        if results[-1]["ok"]:
            correct_count += 1

    overall = correct_count >= 2     # ≥ 2 of 3 sub-puzzles
    return {"results": results, "correct": overall, "sub_correct": correct_count}


@app.route("/api/quiz_check", methods=["POST"])
def api_quiz_check():
    body = request.json or {}
    qid = body.get("qid")
    if qid == "q1":
        res = check_q1(body.get("order", []))
    elif qid == "q2":
        res = check_q2(body.get("answers", []))
    elif qid == "q3":
        res = check_q3(body.get("answers", []))
    else:
        return jsonify({"error": "unknown qid"}), 400

    # Persist the submission + grade for this question on the user's session.
    state = load_state()
    state["quiz"][qid] = {
        "submitted_at": time.time(),
        "answer": body,
        "result": res,
        "correct": bool(res.get("correct")),
    }
    # Recompute overall score from whatever is graded so far.
    state["score"] = sum(1 for q in state["quiz"].values() if q.get("correct"))
    state["events"].append({
        "kind": "quiz_submit",
        "at": time.time(),
        "data": {"qid": qid, "correct": bool(res.get("correct"))},
    })
    save_state(state)
    return jsonify(res)


if __name__ == "__main__":
    app.run(debug=True, port=5050)
