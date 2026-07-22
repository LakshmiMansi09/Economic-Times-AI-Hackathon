"""
Core extraction step: for each raw news article, call the LLM to produce a
structured Event against a fixed ontology, grounded by 3-5 similar past
events retrieved from the vector store (the narrow RAG step).

Uses Groq's free tier (Llama 3.x) by default. Swap GROQ_MODEL for a larger
model, or swap this module's client for the Anthropic API, without changing
anything else in the pipeline — the ontology and prompt are the contract.
"""
from __future__ import annotations
import json
import os
import uuid

try:
    from groq import Groq
    _GROQ_AVAILABLE = True
except ImportError:
    _GROQ_AVAILABLE = False

from vector_store import retrieve_similar, add_events

GROQ_MODEL = os.environ.get("GROQ_MODEL", "llama-3.1-70b-versatile")

EVENT_TYPES = [
    "attack", "seizure", "sanctions_designation", "military_buildup",
    "diplomatic_statement", "market_reaction", "accident", "other",
]

EXTRACTION_SYSTEM_PROMPT = f"""You are an energy supply chain risk analyst extracting
structured events from news articles about maritime chokepoints that affect crude oil
and LNG shipping (Strait of Hormuz, Bab-el-Mandeb/Red Sea, Strait of Malacca).

For the given article, output ONLY a JSON object with this exact schema:
{{
  "corridor": "<one of: hormuz, red_sea, malacca, or null if not clearly about one of these>",
  "actors": ["<countries, organizations, or named entities involved>"],
  "event_type": "<one of: {', '.join(EVENT_TYPES)}>",
  "severity": <float 0.0-1.0, how much this event increases near-term supply disruption risk>,
  "confidence": <float 0.0-1.0, how confident you are this article describes a real,
                 specific, corridor-relevant event rather than commentary or repetition>,
  "summary": "<one sentence, factual, no speculation>"
}}

Calibrate severity and confidence against the reference events below, which are past
extractions for this corridor and event type. Use them as anchors: if this article
describes something clearly more severe than the anchors (e.g. an actual attack vs. a
diplomatic statement), score higher; if it's routine commentary, score lower.

If the article is not substantively about one of the three corridors, set corridor to null.
Output ONLY the JSON object, no other text.
"""


def _build_user_prompt(article: dict, anchors: list[dict]) -> str:
    anchor_text = "\n".join(
        f"- [{a['event_type']}, severity={a['severity']:.2f}] {a['summary']}"
        for a in anchors
    ) or "(no prior reference events yet — use your own judgment)"

    return f"""Article title: {article['title']}
Source: {article['domain']} ({article['sourcecountry']})
Published: {article['seendate']}
Matched keyword: {article['matched_keyword']}

Reference events for calibration:
{anchor_text}

Extract the structured event now."""


def extract_event(article: dict, client: Groq) -> dict | None:
    # Narrow RAG: retrieve similar past events for the corridor this article's
    # keyword belongs to, using the keyword match as a rough corridor guess
    # before the LLM confirms it.
    rough_corridor = article["corridor"]
    anchors = retrieve_similar(rough_corridor, "other", article["title"], top_k=5)

    try:
        completion = client.chat.completions.create(
            model=GROQ_MODEL,
            messages=[
                {"role": "system", "content": EXTRACTION_SYSTEM_PROMPT},
                {"role": "user", "content": _build_user_prompt(article, anchors)},
            ],
            temperature=0.1,
            response_format={"type": "json_object"},
        )
        parsed = json.loads(completion.choices[0].message.content)
    except Exception as e:
        print(f"[extract] failed on '{article['title'][:60]}...': {e}")
        return None

    if not parsed.get("corridor") or parsed.get("confidence", 0) < 0.4:
        return None  # low-confidence or off-topic — drop rather than pollute the graph

    event = {
        "event_id": str(uuid.uuid4()),
        "corridor": parsed["corridor"],
        "actors": parsed.get("actors", []),
        "event_type": parsed["event_type"],
        "severity": float(parsed["severity"]),
        "confidence": float(parsed["confidence"]),
        "summary": parsed["summary"],
        "source_url": article["url"],
        "source_domain": article["domain"],
        "timestamp": article["seendate"],
    }
    return event


def extract_all(articles: list[dict]) -> list[dict]:
    if not _GROQ_AVAILABLE:
        print("[extract] 'groq' package not installed — skipping extraction. "
              "Run: pip install groq")
        return []

    api_key = os.environ.get("GROQ_API_KEY")
    if not api_key:
        print("[extract] GROQ_API_KEY not set — skipping extraction")
        return []

    client = Groq(api_key=api_key)
    events = []
    for article in articles:
        event = extract_event(article, client)
        if event:
            events.append(event)

    add_events(events)  # index the new events for future RAG retrieval
    return events


if __name__ == "__main__":
    from paths import path as root_path
    with open(root_path("data", "corridors.json")) as f:
        corridors = json.load(f)
    from fetch_news import fetch_all as fetch_news_all
    articles = fetch_news_all(corridors, timespan="1h")
    events = extract_all(articles)
    print(f"Extracted {len(events)} events from {len(articles)} articles")
    print(json.dumps(events[:3], indent=2))
