"""
Fetch current Brent and WTI prices from oilpriceapi.com's free tier.
Docs: https://www.oilpriceapi.com/
"""
import requests
import os
import time

BASE_URL = "https://api.oilpriceapi.com/v1/prices/latest"


def fetch_prices() -> dict:
    api_key = os.environ.get("OILPRICEAPI_KEY")
    if not api_key:
        print("[fetch_prices] OILPRICEAPI_KEY not set — skipping")
        return {}

    headers = {"Authorization": f"Token {api_key}"}
    results = {}
    for code in ["BRENT_CRUDE_USD", "WTI_USD"]:
        try:
            resp = requests.get(f"{BASE_URL}?by_code={code}", headers=headers, timeout=15)
            resp.raise_for_status()
            data = resp.json()["data"]
            results[code] = {
                "price": data["price"],
                "timestamp": data.get("timestamp", time.time()),
            }
        except Exception as e:
            print(f"[fetch_prices] failed for {code}: {e}")
    return results


if __name__ == "__main__":
    import json
    print(json.dumps(fetch_prices(), indent=2))
