"""
Fetch recent news articles from GDELT's free DOC 2.0 API for each corridor's
keyword set. GDELT requires no API key for the DOC API at low volume.

Docs: https://blog.gdeltproject.org/gdelt-doc-2-0-api-debuts/
"""
import requests
import time
from urllib.parse import quote

GDELT_DOC_API = "https://api.gdeltproject.org/api/v2/doc/doc"


def fetch_news_for_corridor(corridor_id: str, corridor_cfg: dict, timespan: str = "15min") -> list[dict]:
    """
    Query GDELT for each keyword belonging to this corridor, over the given
    lookback window (default: since the last pipeline run, ~15 min).

    Returns a list of raw article dicts: {title, url, seendate, domain, sourcecountry}
    """
    articles = []
    seen_urls = set()

    for keyword in corridor_cfg["news_keywords"]:
        query = quote(f'"{keyword}"')
        url = (
            f"{GDELT_DOC_API}?query={query}"
            f"&mode=artlist&maxrecords=50&format=json&timespan={timespan}"
        )
        try:
            resp = requests.get(url, timeout=20)
            resp.raise_for_status()
            payload = resp.json()
        except Exception as e:
            print(f"[fetch_news] failed for keyword '{keyword}' ({corridor_id}): {e}")
            continue

        for art in payload.get("articles", []):
            if art.get("url") in seen_urls:
                continue
            seen_urls.add(art.get("url"))
            articles.append({
                "corridor": corridor_id,
                "title": art.get("title", ""),
                "url": art.get("url", ""),
                "seendate": art.get("seendate", ""),
                "domain": art.get("domain", ""),
                "sourcecountry": art.get("sourcecountry", ""),
                "matched_keyword": keyword,
            })

        time.sleep(1)  # be polite to the free endpoint

    return articles


def fetch_all(corridors: dict, timespan: str = "15min") -> list[dict]:
    all_articles = []
    for corridor_id, cfg in corridors.items():
        all_articles.extend(fetch_news_for_corridor(corridor_id, cfg, timespan))
    return all_articles


if __name__ == "__main__":
    import json
    from paths import path as root_path
    with open(root_path("data", "corridors.json")) as f:
        corridors = json.load(f)
    result = fetch_all(corridors)
    print(f"Fetched {len(result)} articles")
    print(json.dumps(result[:3], indent=2))
