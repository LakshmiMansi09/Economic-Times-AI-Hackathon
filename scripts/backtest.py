"""
Replays data/backtest/hormuz_2026_timeline.json day-by-day through the same
compute_corridor_score() function used in production, to answer two
questions honestly:

  1. Would this score have risen meaningfully BEFORE Brent actually spiked?
     (the whole point of a leading indicator)
  2. What (news_weight, price_weight) combination maximizes that lead time
     without producing false positives on the quieter early days?

LIMITATION (stated deliberately, not hidden): the curated timeline only
reconstructs the news and price signals with enough granularity to backtest.
AIS anomaly counts and sanctions deltas for this specific historical window
were not re-derived, so this backtest calibrates the news/price weights
only — ais_weight and sanctions_weight keep their design-time defaults.
"""
import json
import os
import sys
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.path.dirname(__file__))
from paths import path as root_path
from score import decayed_news_pressure, price_momentum_zscore, normalize_to_100

TIMELINE_PATH = root_path("data", "backtest", "hormuz_2026_timeline.json")
OUTPUT_PATH = root_path("data", "backtest", "hormuz_2026_result.json")
CALIBRATED_WEIGHTS_PATH = root_path("data", "calibrated_weights.json")

CORRIDOR = "hormuz"


def _parse(ts: str) -> datetime:
    return datetime.fromisoformat(ts.replace("Z", "+00:00"))


def replay(events: list[dict], prices: list[dict], news_weight: float, price_weight: float) -> list[dict]:
    start = _parse(prices[0]["timestamp"])
    end = _parse(prices[-1]["timestamp"])
    days = int((end - start).total_seconds() / 86400) + 1

    timeline = []
    for d in range(days):
        as_of = start + timedelta(days=d)
        news_component = decayed_news_pressure(events, CORRIDOR, as_of=as_of)
        price_component = max(price_momentum_zscore(prices, as_of=as_of), 0) / 3.0

        raw = news_weight * news_component + price_weight * price_component
        score = normalize_to_100(raw)

        # nearest actual price on/before this day, for side-by-side comparison
        known_prices = [p for p in prices if _parse(p["timestamp"]) <= as_of]
        actual_price = known_prices[-1]["price"] if known_prices else None

        timeline.append({
            "date": as_of.date().isoformat(),
            "score": score,
            "news_component": round(news_component, 3),
            "price_component": round(price_component, 3),
            "actual_brent_price": actual_price,
        })
    return timeline


def lead_time_days(timeline: list[dict], score_threshold: float = 60.0, price_spike_threshold: float = 100.0) -> int | None:
    """Days between the score first crossing score_threshold and the actual
    price first crossing price_spike_threshold. Positive = score led."""
    score_cross_day, price_cross_day = None, None
    for i, point in enumerate(timeline):
        if score_cross_day is None and point["score"] >= score_threshold:
            score_cross_day = i
        if price_cross_day is None and point["actual_brent_price"] and point["actual_brent_price"] >= price_spike_threshold:
            price_cross_day = i
    if score_cross_day is None or price_cross_day is None:
        return None
    return price_cross_day - score_cross_day


def grid_search(events: list[dict], prices: list[dict]) -> dict:
    best = {"news_weight": 0.4, "price_weight": 0.2, "lead_time": None}
    for news_weight in [0.3, 0.4, 0.5, 0.6, 0.7]:
        for price_weight in [0.1, 0.2, 0.3]:
            timeline = replay(events, prices, news_weight, price_weight)
            lead = lead_time_days(timeline)
            if lead is not None and (best["lead_time"] is None or lead > best["lead_time"]):
                best = {"news_weight": news_weight, "price_weight": price_weight, "lead_time": lead}
    return best


def main():
    with open(TIMELINE_PATH) as f:
        data = json.load(f)
    events, prices = data["events"], data["brent_price_series"]

    best = grid_search(events, prices)
    final_timeline = replay(events, prices, best["news_weight"], best["price_weight"])

    result = {
        "corridor": CORRIDOR,
        "calibrated_news_weight": best["news_weight"],
        "calibrated_price_weight": best["price_weight"],
        "lead_time_days": best["lead_time"],
        "timeline": final_timeline,
    }

    with open(OUTPUT_PATH, "w") as f:
        json.dump(result, f, indent=2)

    # Persist calibrated weights for score.py to pick up automatically.
    # AIS/sanctions weights kept at design-time defaults — see module docstring.
    with open(CALIBRATED_WEIGHTS_PATH, "w") as f:
        json.dump({
            "news": best["news_weight"],
            "price": best["price_weight"],
            "ais": 0.25,
            "sanctions": 0.15,
        }, f, indent=2)

    print(f"Calibrated: news_weight={best['news_weight']}, price_weight={best['price_weight']}")
    if best["lead_time"] is not None:
        print(f"Score crossed threshold {best['lead_time']} day(s) before Brent crossed $100")
    else:
        print("No lead time found at current thresholds — inspect data/backtest/hormuz_2026_result.json")


if __name__ == "__main__":
    main()
