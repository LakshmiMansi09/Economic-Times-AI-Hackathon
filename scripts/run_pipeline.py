"""
The orchestrating agent's single run. Called on a schedule by GitHub
Actions. Each run:
  1. fetches news, AIS, prices, sanctions
  2. extracts structured events from new news via the LLM (RAG-grounded)
  3. appends new events + price snapshot to the knowledge graph store
  4. computes the live risk score per corridor
  5. copies the updated data into docs/ so GitHub Pages picks it up

Every run's output is a git commit — the score history IS the audit trail.
"""
import json
import os
import sys
from datetime import datetime, timezone
from dotenv import load_dotenv

sys.path.insert(0, os.path.dirname(__file__))
load_dotenv(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), ".env"))

from paths import path as root_path
from fetch_news import fetch_all as fetch_news_all
from fetch_ais import fetch_all as fetch_ais_all
from fetch_prices import fetch_prices
from fetch_sanctions import fetch_new_designations
from extract import extract_all
from score import run_scoring

EVENTS_PATH = root_path("data", "events", "all_events.json")
PRICE_HISTORY_PATH = root_path("data", "price_history.json")


def _load_json(path, default):
    if os.path.exists(path):
        with open(path) as f:
            return json.load(f)
    return default


def main():
    print(f"=== Pipeline run at {datetime.now(timezone.utc).isoformat()} ===")

    with open(root_path("data", "corridors.json")) as f:
        corridors = json.load(f)

    # 1. Fetch
    print("Fetching news...")
    articles = fetch_news_all(corridors, timespan="15min")
    print(f"  {len(articles)} articles")

    print("Sampling AIS...")
    ais_results = fetch_ais_all(corridors)

    print("Fetching prices...")
    prices = fetch_prices()

    print("Checking sanctions list...")
    new_sanctions = fetch_new_designations()
    print(f"  {len(new_sanctions)} new designations")

    # 2. Extract
    print("Extracting structured events via LLM...")
    new_events = extract_all(articles)
    print(f"  {len(new_events)} events extracted")

    # 3. Persist to knowledge graph store
    os.makedirs(os.path.dirname(EVENTS_PATH), exist_ok=True)
    all_events = _load_json(EVENTS_PATH, [])
    all_events.extend(new_events)
    with open(EVENTS_PATH, "w") as f:
        json.dump(all_events[-10000:], f, indent=2)  # cap file size

    if prices:
        price_history = _load_json(PRICE_HISTORY_PATH, [])
        for code, data in prices.items():
            price_history.append({
                "code": code,
                "price": data["price"],
                "timestamp": data["timestamp"],
            })
        with open(PRICE_HISTORY_PATH, "w") as f:
            json.dump(price_history[-5000:], f, indent=2)

    # 4. Score
    print("Computing corridor risk scores...")
    scores = run_scoring(corridors, ais_results, new_sanctions)
    for s in scores:
        print(f"  {s['corridor_name']}: {s['score']}")

    print("=== Pipeline run complete ===")
    return scores


if __name__ == "__main__":
    main()
