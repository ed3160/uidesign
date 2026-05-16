"""
One-time dev script.
Downloads GloVe-6B-50d (or reads cached), extracts a curated wordlist,
computes PCA→2D and PCA→3D projections, finds nearest neighbors in 50d.
Writes ../data/embeddings.json.

Not shipped at runtime. The lesson only loads embeddings.json.
"""

import json
import os
import zipfile
import urllib.request
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent
CACHE = ROOT / ".cache"
CACHE.mkdir(exist_ok=True)
GLOVE_URL = "http://nlp.stanford.edu/data/glove.6B.zip"
GLOVE_ZIP = CACHE / "glove.6B.zip"
GLOVE_TXT = CACHE / "glove.6B.50d.txt"

OUT = ROOT.parent / "data" / "embeddings.json"


# Curated vocabulary. Themed clusters create visible structure on the map.
# Includes every word the lesson + quizzes reference.
WORDS = {
    # royalty / gender — for vector arithmetic
    "royalty": ["king", "queen", "prince", "princess", "man", "woman", "boy", "girl"],
    # animals — clustering + interpolation (puppy)
    "animals": ["dog", "puppy", "cat", "kitten", "wolf", "fox", "lion", "tiger",
                "bear", "horse", "cow", "sheep", "mouse", "rabbit", "elephant",
                "fish", "bird", "eagle", "owl"],
    # places — geo cluster + capital/country analogies
    "places": ["paris", "france", "london", "england", "tokyo", "japan",
               "rome", "italy", "madrid", "spain", "berlin", "germany",
               "moscow", "russia", "beijing", "china"],
    # jobs — semantic cluster around chef
    "jobs": ["chef", "baker", "doctor", "nurse", "teacher", "lawyer",
             "scientist", "artist", "writer", "soldier", "engineer", "pilot",
             "farmer", "actor", "musician"],
    # food — cluster around chef/restaurant
    "food": ["bread", "cake", "pizza", "sushi", "pasta", "rice", "cheese",
             "wine", "coffee", "tea", "soup", "salad", "meat", "fruit"],
    # buildings — cluster where "restaurant" lives
    "buildings": ["restaurant", "bakery", "kitchen", "cafe", "hospital",
                  "school", "library", "museum", "hotel", "store", "market",
                  "office", "factory"],
    # sizes — for extrapolation (tiny→big→enormous)
    "sizes": ["tiny", "small", "big", "large", "huge", "enormous", "gigantic"],
    # emotions
    "emotions": ["happy", "sad", "angry", "calm", "excited", "scared",
                 "surprised", "proud", "afraid"],
    # verbs (sentence-related)
    "verbs": ["opened", "closed", "walked", "ran", "ate", "drank", "cooked",
              "baked", "learned", "taught", "trained", "studied", "sang",
              "danced", "fought"],
    # time
    "time": ["morning", "evening", "night", "day", "week", "year"],
}

ALL_WORDS = sorted({w for ws in WORDS.values() for w in ws})


def download_if_needed():
    if GLOVE_TXT.exists():
        return
    if not GLOVE_ZIP.exists():
        print(f"Downloading {GLOVE_URL} (~822MB, one-time)...")
        urllib.request.urlretrieve(GLOVE_URL, GLOVE_ZIP)
    print("Extracting 50d file...")
    with zipfile.ZipFile(GLOVE_ZIP) as z:
        with z.open("glove.6B.50d.txt") as src, open(GLOVE_TXT, "wb") as dst:
            dst.write(src.read())
    print("Done.")


def load_vectors():
    want = set(ALL_WORDS)
    out = {}
    with open(GLOVE_TXT, "r", encoding="utf-8") as f:
        for line in f:
            sp = line.find(" ")
            w = line[:sp]
            if w in want:
                vec = np.array([float(x) for x in line[sp + 1:].split()], dtype=np.float32)
                out[w] = vec
                if len(out) == len(want):
                    break
    missing = want - set(out)
    if missing:
        print(f"WARN: not found in GloVe: {sorted(missing)}")
    return out


def pca(X, k):
    """Plain numpy PCA. Returns (k-dim coords, total_var_explained)."""
    Xc = X - X.mean(0, keepdims=True)
    U, S, Vt = np.linalg.svd(Xc, full_matrices=False)
    coords = Xc @ Vt[:k].T  # (N, k)
    var = (S ** 2)
    explained = var[:k].sum() / var.sum()
    return coords, float(explained)


def normalize_coords(coords):
    """Rescale per-dim to [-1, 1] for easy plotting."""
    lo = coords.min(0)
    hi = coords.max(0)
    rng = np.maximum(hi - lo, 1e-6)
    return (2 * (coords - lo) / rng - 1).astype(float)


def nearest_neighbors(vecs, words, k=6):
    """Cosine NN among curated set."""
    M = np.stack([vecs[w] for w in words], 0)
    M = M / (np.linalg.norm(M, axis=1, keepdims=True) + 1e-9)
    sim = M @ M.T
    np.fill_diagonal(sim, -1.0)
    nn = {}
    for i, w in enumerate(words):
        idx = np.argsort(-sim[i])[:k]
        nn[w] = [words[j] for j in idx]
    return nn


def build():
    download_if_needed()
    vecs = load_vectors()
    words = [w for w in ALL_WORDS if w in vecs]
    X = np.stack([vecs[w] for w in words], 0)

    xy, var2 = pca(X, 2)
    xyz, var3 = pca(X, 3)
    xy = normalize_coords(xy)
    xyz = normalize_coords(xyz)

    nn = nearest_neighbors(vecs, words, k=6)

    # cluster label per word
    cluster_of = {}
    for cluster, ws in WORDS.items():
        for w in ws:
            cluster_of[w] = cluster

    data = {
        "clusters": list(WORDS.keys()),
        "words": {},
        "variance_explained": {"2d": var2, "3d": var3},
    }
    for i, w in enumerate(words):
        data["words"][w] = {
            "vec": vecs[w].round(4).tolist(),
            "xy": [round(float(xy[i, 0]), 4), round(float(xy[i, 1]), 4)],
            "xyz": [round(float(xyz[i, j]), 4) for j in range(3)],
            "cluster": cluster_of.get(w, "other"),
            "nn": nn[w],
        }
    OUT.parent.mkdir(exist_ok=True)
    with open(OUT, "w") as f:
        json.dump(data, f)
    print(f"Wrote {OUT}  ({OUT.stat().st_size/1024:.1f} KB, {len(words)} words)")
    print(f"PCA variance explained: 2d={var2:.2%}, 3d={var3:.2%}")


if __name__ == "__main__":
    build()
