"""
Combine the four live signals into one 0-100 risk score per corridor:

  score = normalize(
      W_NEWS   * decayed_news_severity
    + W_AIS    * ais_anomaly_pressure
    + W_PRICE  * price_momentum_zscore
    + W_SANCT  * sanctions_delta_pressure
  )

Exponential decay on news severity (half-life ~60h) is what makes the score
behave like a live instrument rather than a ratchet: it cools down on its
own if nothing new happens, instead of staying pinned at a stale high value.

Weights below are starting points — calibrated against the 2026 Hormuz
backtest (see backtest.py) rather than picked arbitrarily.
"""
import json
import math
import os
import time
from datetime import datetime, timezone
from dateutil import parser as dateparser
from paths import path as root_path

# Default weights — overridden by data/calibrated_weights.json if backtest.py
# has been run to calibrate them against the 2026 Hormuz crisis.
W_NEWS = 0.40
W_AIS = 0.25
W_PRICE = 0.20
W_SANCT = 0.15

NEWS_HALFLIFE_HOURS = 60.0
DECAY_LAMBDA = math.log(2) / NEWS_HALFLIFE_HOURS

EVENTS_PATH = root_path("data", "events", "all_events.json")
SCORES_DIR = root_path("data", "scores")
PRICE_HISTORY_PATH = root_path("data", "price_history.json")
CALIBRATED_WEIGHTS_PATH = root_path("data", "calibrated_weights.json")


def _load_weights() -> dict:
    if os.path.exists(CALIBRATED_WEIGHTS_PATH):
        with open(CALIBRATED_WEIGHTS_PATH) as f:
            w = json.load(f)
        return w
    return {"news": W_NEWS, "ais": W_AIS, "price": W_PRICE, "sanctions": W_SANCT}


def _load_json(path: str, default):
    if os.path.exists(path):
        with open(path) as f:
            return json.load(f)
    return default


def _hours_between(timestamp_str: str, as_of: datetime) -> float:
    try:
        ts = dateparser.parse(timestamp_str)
        if ts.tzinfo is None:
            ts = ts.replace(tzinfo=timezone.utc)
        return (as_of - ts).total_seconds() / 3600.0
    except Exception:
        return 999.0  # treat unparseable timestamps as very old


def decayed_news_pressure(events: list[dict], corridor_id: str, as_of: datetime = None) -> float:
    """as_of defaults to now (live scoring); pass a past datetime to replay
    what the score would have looked like at that moment (backtesting)."""
    as_of = as_of or datetime.now(timezone.utc)
    relevant = [e for e in events if e["corridor"] == corridor_id and _hours_between(e["timestamp"], as_of) >= 0]
    total = 0.0
    for e in relevant:
        age_h = _hours_between(e["timestamp"], as_of)
        weight = e["severity"] * e["confidence"] * math.exp(-DECAY_LAMBDA * age_h)
        total += weight
    return total


def ais_pressure(ais_result: dict) -> float:
    anomalies = ais_result.get("anomalies", [])
    # simple count-based pressure, capped so one noisy run doesn't dominate
    return min(len(anomalies) / 5.0, 1.0)


def price_momentum_zscore(price_history: list[dict], window: int = 20, as_of: datetime = None) -> float:
    """as_of lets backtesting compute momentum using only prices known up to
    that point in the replayed timeline, rather than the full series."""
    series = price_history
    if as_of is not None:
        series = [p for p in price_history if _hours_between(p["timestamp"], as_of) >= 0]
    if len(series) < 3:
        return 0.0
    prices = [p["price"] for p in series[-window:]]
    latest = prices[-1]
    mean = sum(prices) / len(prices)
    variance = sum((p - mean) ** 2 for p in prices) / max(len(prices) - 1, 1)
    std = math.sqrt(variance)
    if std == 0:
        return 0.0
    return max(min((latest - mean) / std, 3.0), -3.0)  # clip to [-3, 3]


def sanctions_pressure(new_designations: list[dict], corridor_cfg: dict) -> float:
    relevant_names = {e.lower() for e in corridor_cfg.get("relevant_entities", [])}
    hits = sum(
        1 for d in new_designations
        if any(name in d["name"].lower() for name in relevant_names)
    )
    return min(hits / 2.0, 1.0)


def normalize_to_100(raw: float) -> float:
    # raw is a weighted sum of components roughly in [0, ~1.5]; squash to 0-100
    return round(100 * (1 - math.exp(-1.5 * max(raw, 0))), 1)


def compute_corridor_score(
    corridor_id: str,
    corridor_cfg: dict,
    all_events: list[dict],
    ais_results: dict,
    price_history: list[dict],
    new_sanctions: list[dict],
    as_of: datetime = None,
) -> dict:
    weights = _load_weights()
    news_component = decayed_news_pressure(all_events, corridor_id, as_of=as_of)
    ais_component = ais_pressure(ais_results.get(corridor_id, {}))
    price_component = max(price_momentum_zscore(price_history, as_of=as_of), 0) / 3.0  # only upside momentum raises risk
    sanctions_component = sanctions_pressure(new_sanctions, corridor_cfg)

    raw = (
        weights["news"] * news_component
        + weights["ais"] * ais_component
        + weights["price"] * price_component
        + weights["sanctions"] * sanctions_component
    )

    return {
        "corridor": corridor_id,
        "corridor_name": corridor_cfg["name"],
        "score": normalize_to_100(raw),
        "components": {
            "news_pressure": round(news_component, 3),
            "ais_pressure": round(ais_component, 3),
            "price_momentum": round(price_component, 3),
            "sanctions_pressure": round(sanctions_component, 3),
        },
        "computed_at": (as_of or datetime.now(timezone.utc)).isoformat(),
    }


def run_scoring(corridors: dict, ais_results: dict, new_sanctions: list[dict]) -> list[dict]:
    all_events = _load_json(EVENTS_PATH, [])
    price_history = _load_json(PRICE_HISTORY_PATH, [])

    os.makedirs(SCORES_DIR, exist_ok=True)
    results = []
    for corridor_id, cfg in corridors.items():
        result = compute_corridor_score(
            corridor_id, cfg, all_events, ais_results, price_history, new_sanctions
        )
        results.append(result)

        # append to this corridor's score history file
        history_path = os.path.join(SCORES_DIR, f"{corridor_id}.json")
        history = _load_json(history_path, [])
        history.append(result)
        with open(history_path, "w") as f:
            json.dump(history[-2000:], f, indent=2)  # cap history file size

    with open(os.path.join(SCORES_DIR, "latest.json"), "w") as f:
        json.dump(results, f, indent=2)

    return results


if __name__ == "__main__":
    with open(root_path("data", "corridors.json")) as f:
        corridors = json.load(f)
    results = run_scoring(corridors, ais_results={}, new_sanctions=[])
    print(json.dumps(results, indent=2))
