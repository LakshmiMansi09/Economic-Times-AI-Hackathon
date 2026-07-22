"""
Download the public OFAC SDN list and diff it against the previously stored
snapshot to find newly added designations. No API key required — this is a
public CSV published by the US Treasury.

Source: https://sanctionslist.ofac.treas.gov/Home/SdnList
"""
import requests
import csv
import io
import json
import os
from paths import path as root_path

SDN_CSV_URL = "https://sanctionslistservice.ofac.treas.gov/api/PublicationPreview/exports/SDN.CSV"
SNAPSHOT_PATH = root_path("data", "sanctions_snapshot.json")


def fetch_sdn_list() -> list[dict]:
    resp = requests.get(SDN_CSV_URL, timeout=30)
    resp.raise_for_status()
    reader = csv.reader(io.StringIO(resp.text))
    rows = list(reader)
    entries = []
    for row in rows:
        if len(row) < 3:
            continue
        entries.append({"uid": row[0], "name": row[1], "type": row[2]})
    return entries


def diff_against_snapshot(current: list[dict]) -> list[dict]:
    previous_uids = set()
    if os.path.exists(SNAPSHOT_PATH):
        with open(SNAPSHOT_PATH) as f:
            previous = json.load(f)
        previous_uids = {e["uid"] for e in previous}

    new_entries = [e for e in current if e["uid"] not in previous_uids]

    with open(SNAPSHOT_PATH, "w") as f:
        json.dump(current, f)

    return new_entries


def fetch_new_designations() -> list[dict]:
    try:
        current = fetch_sdn_list()
    except Exception as e:
        print(f"[fetch_sanctions] failed to fetch SDN list: {e}")
        return []
    return diff_against_snapshot(current)


if __name__ == "__main__":
    new = fetch_new_designations()
    print(f"{len(new)} new designations since last run")
    print(json.dumps(new[:5], indent=2))
