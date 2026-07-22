"""
Minimal local vector store for the RAG retrieval step. No managed vector DB —
just sentence-transformers embeddings (free, open, CPU-friendly) stored as a
numpy array + a parallel JSON metadata file, both committed to the repo.

This intentionally stays narrow: it only supports "find similar past events
for this corridor/event_type", which is the one thing the extraction prompt
needs for consistent severity calibration.
"""
from __future__ import annotations
import json
import os
import numpy as np
from paths import path as root_path

try:
    from sentence_transformers import SentenceTransformer
    _EMBEDDINGS_AVAILABLE = True
except ImportError:
    _EMBEDDINGS_AVAILABLE = False

MODEL_NAME = "all-MiniLM-L6-v2"
INDEX_DIR = root_path("data", "vector_index")
VECTORS_PATH = os.path.join(INDEX_DIR, "vectors.npy")
META_PATH = os.path.join(INDEX_DIR, "meta.json")

_model = None


def get_model() -> SentenceTransformer:
    global _model
    if _model is None:
        _model = SentenceTransformer(MODEL_NAME)
    return _model


def load_index() -> tuple[np.ndarray, list[dict]]:
    if os.path.exists(VECTORS_PATH) and os.path.exists(META_PATH):
        vectors = np.load(VECTORS_PATH)
        with open(META_PATH) as f:
            meta = json.load(f)
        return vectors, meta
    return np.zeros((0, 384), dtype=np.float32), []


def save_index(vectors: np.ndarray, meta: list[dict]) -> None:
    os.makedirs(INDEX_DIR, exist_ok=True)
    np.save(VECTORS_PATH, vectors)
    with open(META_PATH, "w") as f:
        json.dump(meta, f)


def add_events(events: list[dict]) -> None:
    """events: list of {event_id, corridor, event_type, summary, severity}"""
    if not events:
        return
    if not _EMBEDDINGS_AVAILABLE:
        print("[vector_store] 'sentence-transformers' not installed — new events won't be "
              "indexed for RAG retrieval, but extraction still works without calibration anchors. "
              "Run: pip install sentence-transformers")
        return
    vectors, meta = load_index()
    model = get_model()
    texts = [f"{e['corridor']} {e['event_type']}: {e['summary']}" for e in events]
    new_vectors = model.encode(texts, normalize_embeddings=True)
    vectors = np.vstack([vectors, new_vectors]) if vectors.shape[0] else new_vectors
    meta.extend(events)
    save_index(vectors, meta)


def retrieve_similar(corridor: str, event_type: str, query_text: str, top_k: int = 5) -> list[dict]:
    """Retrieve the most similar past events, filtered to the same corridor
    where possible, for use as calibration anchors in the extraction prompt."""
    if not _EMBEDDINGS_AVAILABLE:
        return []  # extraction proceeds without calibration anchors — degraded, not broken

    vectors, meta = load_index()
    if vectors.shape[0] == 0:
        return []

    model = get_model()
    query_vec = model.encode([f"{corridor} {event_type}: {query_text}"], normalize_embeddings=True)[0]
    sims = vectors @ query_vec  # cosine similarity, since vectors are normalized

    # Prefer same-corridor matches, but fall back to global if too few.
    same_corridor_idx = [i for i, m in enumerate(meta) if m["corridor"] == corridor]
    pool = same_corridor_idx if len(same_corridor_idx) >= top_k else list(range(len(meta)))

    ranked = sorted(pool, key=lambda i: -sims[i])[:top_k]
    return [meta[i] | {"similarity": float(sims[i])} for i in ranked]
