from flask import Flask, render_template, request, jsonify, redirect, url_for
import json
import os
from datetime import datetime

app = Flask(__name__)

# ─── Load content from JSON ───
with open(os.path.join(app.root_path, 'data', 'lessons.json')) as f:
    LESSONS = json.load(f)
with open(os.path.join(app.root_path, 'data', 'quiz.json')) as f:
    QUIZ = json.load(f)

# ─── Single-user in-memory store ───
USER_STATE = {
    'started_at': None,
    'lesson_visits': [],   # [{lesson: n, time: iso}]
    'quiz_answers': [],    # [{q: n, answer: str, correct: bool}]
    'score': None,
}


def reset_user():
    USER_STATE['started_at'] = datetime.utcnow().isoformat()
    USER_STATE['lesson_visits'] = []
    USER_STATE['quiz_answers'] = []
    USER_STATE['score'] = None


# ─── Routes ───

@app.route('/')
def home():
    return render_template('home.html')


@app.route('/start', methods=['POST'])
def start():
    reset_user()
    return redirect(url_for('learn', n=1))


@app.route('/learn/<int:n>')
def learn(n):
    if n < 1 or n > len(LESSONS):
        return redirect(url_for('home'))
    USER_STATE['lesson_visits'].append({
        'lesson': n,
        'time': datetime.utcnow().isoformat(),
    })
    lesson = LESSONS[n - 1]
    return render_template(
        'learn.html',
        lesson=lesson,
        n=n,
        total=len(LESSONS),
        prev_n=n - 1 if n > 1 else None,
        next_n=n + 1 if n < len(LESSONS) else None,
        is_last=(n == len(LESSONS)),
    )


@app.route('/learn/<int:n>/choice', methods=['POST'])
def learn_choice(n):
    data = request.get_json() or {}
    USER_STATE['lesson_visits'].append({
        'lesson': n,
        'choice': data.get('choice'),
        'time': datetime.utcnow().isoformat(),
    })
    return jsonify({'ok': True})


@app.route('/quiz/<int:n>', methods=['GET', 'POST'])
def quiz(n):
    if n < 1 or n > len(QUIZ):
        return redirect(url_for('home'))

    if request.method == 'POST':
        answer = request.form.get('answer', '').strip()
        q = QUIZ[n - 1]
        lower = answer.lower()
        hits = sum(1 for k in q['keywords'] if k in lower)
        correct = hits >= 2 or (hits >= 1 and len(answer) > 40)
        USER_STATE['quiz_answers'].append({
            'q': n,
            'answer': answer,
            'correct': correct,
            'time': datetime.utcnow().isoformat(),
        })
        if n < len(QUIZ):
            return redirect(url_for('quiz', n=n + 1))
        else:
            score = sum(1 for a in USER_STATE['quiz_answers'] if a['correct'])
            USER_STATE['score'] = score
            return redirect(url_for('results'))

    question = QUIZ[n - 1]
    return render_template(
        'quiz.html',
        question=question,
        n=n,
        total=len(QUIZ),
    )


@app.route('/results')
def results():
    return render_template(
        'results.html',
        score=USER_STATE['score'] or 0,
        total=len(QUIZ),
        answers=USER_STATE['quiz_answers'],
        ideals=[q['ideal'] for q in QUIZ],
        questions=[q['q'] for q in QUIZ],
    )


@app.route('/api/state')
def api_state():
    """Debug: view everything the backend has stored."""
    return jsonify(USER_STATE)


if __name__ == '__main__':
    app.run(debug=True, port=5001)
