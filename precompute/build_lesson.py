"""
Hand-curated lesson data for the canonical sentence:

  "The chef who trained in {Paris|Tokyo|prison|space} finally opened her own ___"

Why hand-curated, not real GPT-2:
- Real attention weights from small models are noisy and hard to read;
  pedagogy benefits from clean, deliberate weighting.
- The blank's distribution is hand-shaped to make the "context shapes
  prediction" lesson visible at a glance — Paris distribution is dominated
  by refined French establishments; prison distribution shifts toward
  gritty street food; space goes surreal.

Writes ../data/lesson.json.
"""

import json
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / "data" / "lesson.json"


# Tokens of the sentence prefix, the swap, and the suffix.
# Stored without leading-space markers; frontend handles spacing.
PREFIX = ["The", "chef", "who", "trained", "in"]
SUFFIX = ["finally", "opened", "her", "own"]
SWAP_POSITION = 5  # index in the full token list

VARIANTS = ["Paris", "Tokyo", "prison", "space"]


# ---------------------------------------------------------------------------
# Attention weights — for the BLANK position, how much it leans on each
# prior token. Designed so:
#   - Paris/Tokyo: balanced over chef + location + own (familiar template)
#   - prison:      shifts mass to "prison" (model needs disambiguation)
#   - space:       dominated by "space" (model anchors on the unusual word)
# All rows sum to 1.0.
# ---------------------------------------------------------------------------
ATTENTION = {
    "Paris": {
        "The":     0.02, "chef":  0.22, "who": 0.04, "trained": 0.10, "in": 0.03,
        "Paris":   0.20, "finally": 0.04, "opened": 0.12, "her": 0.04, "own": 0.19,
    },
    "Tokyo": {
        "The":     0.02, "chef":  0.21, "who": 0.04, "trained": 0.10, "in": 0.03,
        "Tokyo":   0.21, "finally": 0.04, "opened": 0.12, "her": 0.04, "own": 0.19,
    },
    "prison": {
        "The":     0.02, "chef":  0.17, "who": 0.03, "trained": 0.08, "in": 0.03,
        "prison":  0.30, "finally": 0.05, "opened": 0.10, "her": 0.04, "own": 0.18,
    },
    "space": {
        "The":     0.02, "chef":  0.13, "who": 0.03, "trained": 0.08, "in": 0.03,
        "space":   0.35, "finally": 0.06, "opened": 0.10, "her": 0.04, "own": 0.16,
    },
}


# ---------------------------------------------------------------------------
# Top-15 next-token distributions for the BLANK, per variant.
# Tail (probability mass beyond top-15) is implied via "tail" key.
# ---------------------------------------------------------------------------
DISTRIBUTIONS = {
    "Paris": [
        ("restaurant",   0.30),
        ("bistro",       0.18),
        ("bakery",       0.10),
        ("café",         0.10),
        ("patisserie",   0.07),
        ("shop",         0.05),
        ("food truck",   0.04),
        ("catering",     0.03),
        ("place",        0.025),
        ("business",     0.022),
        ("studio",       0.018),
        ("pop-up",       0.015),
        ("gallery",      0.010),
        ("cookbook",     0.008),
        ("tv show",      0.005),
    ],
    "Tokyo": [
        ("restaurant",   0.24),
        ("sushi bar",    0.17),
        ("izakaya",      0.12),
        ("ramen shop",   0.10),
        ("noodle bar",   0.07),
        ("bakery",       0.06),
        ("café",         0.05),
        ("shop",         0.05),
        ("kitchen",      0.04),
        ("food truck",   0.03),
        ("catering",     0.025),
        ("business",     0.020),
        ("studio",       0.015),
        ("chain",        0.010),
        ("pop-up",       0.005),
    ],
    "prison": [
        ("food truck",   0.22),
        ("restaurant",   0.20),
        ("catering",     0.13),
        ("kitchen",      0.10),
        ("diner",        0.08),
        ("bakery",       0.06),
        ("café",         0.04),
        ("shop",         0.04),
        ("pop-up",       0.04),
        ("business",     0.035),
        ("studio",       0.020),
        ("place",        0.015),
        ("soup kitchen", 0.015),
        ("bar",          0.010),
        ("chain",        0.005),
    ],
    "space": [
        ("restaurant",   0.18),
        ("space station", 0.12),
        ("cafeteria",    0.11),
        ("food line",    0.09),
        ("business",     0.08),
        ("ship",         0.07),
        ("kitchen",      0.06),
        ("bakery",       0.05),
        ("chain",        0.05),
        ("enterprise",   0.04),
        ("lab",          0.04),
        ("agency",       0.035),
        ("consultancy",  0.030),
        ("academy",      0.025),
        ("franchise",    0.020),
    ],
}


# ---------------------------------------------------------------------------
# Autoregressive continuation (Paris variant). After picking "restaurant"
# for the blank, here are 6 more steps. Each step is a top-8 distribution.
# Final sentence:
#   "The chef who trained in Paris finally opened her own restaurant,
#    serving rustic French cuisine."
# ---------------------------------------------------------------------------
LOOP = [
    # after "restaurant"
    {"pick": ",", "options": [
        (",",            0.28),
        (" in",          0.16),
        (" that",        0.12),
        (" serving",     0.10),
        (" with",        0.07),
        (" near",        0.05),
        (" specializing", 0.04),
        (" featuring",   0.03),
    ]},
    {"pick": " serving", "options": [
        (" serving",     0.22),
        (" a",           0.18),
        (" which",       0.12),
        (" and",         0.10),
        (" specializing", 0.08),
        (" featuring",   0.06),
        (" offering",    0.05),
        (" inspired",    0.04),
    ]},
    {"pick": " rustic", "options": [
        (" rustic",      0.13),
        (" classic",     0.12),
        (" traditional", 0.11),
        (" modern",      0.10),
        (" authentic",   0.10),
        (" homemade",    0.08),
        (" upscale",     0.06),
        (" seasonal",    0.05),
    ]},
    {"pick": " French", "options": [
        (" French",      0.45),
        (" Italian",     0.10),
        (" Mediterranean", 0.08),
        (" Provençal",   0.07),
        (" country",     0.06),
        (" European",    0.05),
        (" peasant",     0.04),
        (" Spanish",     0.03),
    ]},
    {"pick": " cuisine", "options": [
        (" cuisine",     0.24),
        (" dishes",      0.20),
        (" food",        0.15),
        (" classics",    0.10),
        (" fare",        0.08),
        (" specialties", 0.06),
        (" recipes",     0.04),
        (" plates",      0.03),
    ]},
    {"pick": ".", "options": [
        (".",            0.40),
        (" with",        0.15),
        (" and",         0.10),
        (" to",          0.08),
        (" in",          0.07),
        (" alongside",   0.04),
        (" using",       0.04),
        (" served",      0.03),
    ]},
]


# ---------------------------------------------------------------------------
# Quiz 3 data — three sub-puzzles mirroring Q2's structure.
#   1. Pick the most likely (click 1 of 4)
#   2. Rank 4 candidates by likelihood (drag to slots)
#   3. Match temperatures to generated continuations (drag chips)
# ---------------------------------------------------------------------------
QUIZ3 = {
    "puzzles": [
        {
            "kind": "pick",
            "prompt": "I'll grab a coffee from the ___",
            "candidates": ["café", "vending machine", "coworker", "typewriter"],
            "answer": "café",
            "explain": "Coffee usually comes from a place built for it. A typewriter never.",
        },
        {
            "kind": "rank",
            "prompt": "The doctor wrote a ___",
            "candidates": ["prescription", "note", "novel", "sandwich"],
            # ordered from most→least likely
            "order":      ["prescription", "note", "novel", "sandwich"],
            "explain": "Doctors prescribe constantly, write notes often, write novels rarely, make sandwiches only as a joke.",
        },
        {
            "kind": "temp",
            "prompt": "She opened the ___",
            "samples": [
                {"text": "door.",                                "temperature": 0.1},
                {"text": "letter from her mother.",              "temperature": 0.8},
                {"text": "saxophone case full of moonlight.",    "temperature": 1.5},
            ],
            "temps": [0.1, 0.8, 1.5],
            "explain": "Cold temperature picks the most obvious next word. Hot temperature reaches deep into the tail.",
        },
    ],
}


# ---------------------------------------------------------------------------
# Quiz 1 data — rank these strings by token count.
# All 5 have distinct counts in cl100k_base, so the answer is unambiguous.
# Easy to interact with (drag, like Q2 ranking), fun if you know the answer.
# ---------------------------------------------------------------------------
QUIZ1 = {
    "candidates": [
        "the",
        "Tokyo",
        "unbelievable",
        "GPT-4o",
        "antidisestablishmentarianism",
    ],
}


# ---------------------------------------------------------------------------
# Quiz 2 data — embedding navigation.
# Three sub-puzzles. Targets are hidden; correctness scored by distance
# in the 2D embedding map (loaded from embeddings.json on the client).
# ---------------------------------------------------------------------------
QUIZ2 = {
    "puzzles": [
        {
            "kind": "interpolate",
            "prompt": "A puppy is a young dog. Click where you'd expect 'puppy' to live, given dog and wolf are visible.",
            "anchors": ["dog", "wolf"],
            "target": "puppy",
        },
        {
            "kind": "extrapolate",
            "prompt": "Drag the marker so 'enormous' is further along the size axis than 'big'.",
            "anchors": ["tiny", "big"],
            "target": "enormous",
        },
        {
            "kind": "analogy",
            "prompt": "Solve: Paris is to France as ??? is to Japan. Click where the answer lives.",
            "anchors": ["paris", "france", "japan"],
            "target": "tokyo",
        },
    ],
}


def build():
    data = {
        "sentence": {
            "prefix": PREFIX,
            "suffix": SUFFIX,
            "swap_position": SWAP_POSITION,
            "variants": VARIANTS,
            "default_variant": "Paris",
            "blank_label": "___",
        },
        "attention": ATTENTION,
        "distributions": {k: [list(p) for p in v] for k, v in DISTRIBUTIONS.items()},
        "loop": LOOP,
        "quiz1": QUIZ1,
        "quiz2": QUIZ2,
        "quiz3": QUIZ3,
    }

    # Sanity checks
    for v, att in ATTENTION.items():
        s = sum(att.values())
        assert abs(s - 1.0) < 0.001, f"attention[{v}] sums to {s}"
    for v, dist in DISTRIBUTIONS.items():
        s = sum(p for _, p in dist)
        assert 0.95 < s < 1.05, f"distribution[{v}] sums to {s}"
    for step in LOOP:
        s = sum(p for _, p in step["options"])
        assert 0.6 < s < 1.05, f"loop step sums to {s}"

    OUT.parent.mkdir(exist_ok=True)
    with open(OUT, "w") as f:
        json.dump(data, f, indent=2)
    print(f"Wrote {OUT}  ({OUT.stat().st_size/1024:.1f} KB)")


if __name__ == "__main__":
    build()
