"""
Burst-sample live AIS positions from aisstream.io within each corridor's
bounding box. Because this runs inside a scheduled GitHub Actions job (no
always-on server), we open the websocket, collect messages for a fixed
window, then close it — a deliberate trade-off documented in the README.

Anomaly rules kept intentionally simple and explainable:
  - speed_jump: reported speed changes implausibly fast between two messages
    from the same vessel (> 15 knots delta within a short window)
  - ais_gap: a vessel seen earlier in the run stops transmitting for the
    rest of the sampling window (possible AIS "dark" behaviour)

Docs: https://aisstream.io/documentation
"""
import json
import time
import os
import threading

try:
    import websocket
    _WEBSOCKET_AVAILABLE = True
except ImportError:
    _WEBSOCKET_AVAILABLE = False

AISSTREAM_URL = "wss://stream.aisstream.io/v0/stream"
SAMPLE_SECONDS = int(os.environ.get("AIS_SAMPLE_SECONDS", "90"))


def _bbox_to_polygon(bbox: dict) -> list:
    return [[
        [bbox["min_lat"], bbox["min_lon"]],
        [bbox["max_lat"], bbox["max_lon"]],
    ]]


def sample_corridor(corridor_id: str, corridor_cfg: dict, api_key: str) -> list[dict]:
    """Open a websocket, subscribe to this corridor's bbox, collect messages
    for SAMPLE_SECONDS, then close. Returns raw position reports."""
    messages = []
    stop_flag = {"stop": False}

    def on_message(ws, message):
        try:
            data = json.loads(message)
            if data.get("MessageType") == "PositionReport":
                report = data["Message"]["PositionReport"]
                messages.append({
                    "mmsi": report.get("UserID"),
                    "lat": report.get("Latitude"),
                    "lon": report.get("Longitude"),
                    "sog": report.get("Sog"),  # speed over ground, knots
                    "timestamp": time.time(),
                })
        except Exception as e:
            print(f"[fetch_ais] parse error: {e}")

    def on_open(ws):
        sub = {
            "APIKey": api_key,
            "BoundingBoxes": [_bbox_to_polygon(corridor_cfg["bbox"])],
            "FilterMessageTypes": ["PositionReport"],
        }
        ws.send(json.dumps(sub))

    def on_error(ws, error):
        print(f"[fetch_ais] websocket error ({corridor_id}): {error}")

    ws = websocket.WebSocketApp(
        AISSTREAM_URL, on_open=on_open, on_message=on_message, on_error=on_error
    )

    wst = threading.Thread(target=ws.run_forever, daemon=True)
    wst.start()
    time.sleep(SAMPLE_SECONDS)
    ws.close()

    return messages


def detect_anomalies(messages: list[dict]) -> list[dict]:
    """Group by vessel, flag speed jumps and mid-window disappearance."""
    by_vessel: dict[int, list[dict]] = {}
    for m in messages:
        by_vessel.setdefault(m["mmsi"], []).append(m)

    anomalies = []
    for mmsi, track in by_vessel.items():
        track.sort(key=lambda x: x["timestamp"])
        for i in range(1, len(track)):
            prev, curr = track[i - 1], track[i]
            if prev["sog"] is not None and curr["sog"] is not None:
                if abs(curr["sog"] - prev["sog"]) > 15:
                    anomalies.append({
                        "mmsi": mmsi,
                        "type": "speed_jump",
                        "detail": f"{prev['sog']}kn -> {curr['sog']}kn",
                        "timestamp": curr["timestamp"],
                    })
        # gap: vessel stopped transmitting significantly before window end
        last_seen = track[-1]["timestamp"]
        window_end = messages[-1]["timestamp"] if messages else last_seen
        if window_end - last_seen > 45 and len(track) > 1:
            anomalies.append({
                "mmsi": mmsi,
                "type": "ais_gap",
                "detail": f"no signal for {round(window_end - last_seen)}s before window end",
                "timestamp": last_seen,
            })
    return anomalies


def fetch_all(corridors: dict) -> dict:
    if not _WEBSOCKET_AVAILABLE:
        print("[fetch_ais] 'websocket-client' package not installed — skipping AIS sampling. "
              "Run: pip install websocket-client")
        return {cid: {"messages": 0, "anomalies": []} for cid in corridors}

    api_key = os.environ.get("AISSTREAM_API_KEY")
    if not api_key:
        print("[fetch_ais] AISSTREAM_API_KEY not set — skipping AIS sampling")
        return {cid: {"messages": 0, "anomalies": []} for cid in corridors}

    results = {}
    for corridor_id, cfg in corridors.items():
        msgs = sample_corridor(corridor_id, cfg, api_key)
        anomalies = detect_anomalies(msgs)
        results[corridor_id] = {"messages": len(msgs), "anomalies": anomalies}
        print(f"[fetch_ais] {corridor_id}: {len(msgs)} msgs, {len(anomalies)} anomalies")
    return results


if __name__ == "__main__":
    from paths import path as root_path
    with open(root_path("data", "corridors.json")) as f:
        corridors = json.load(f)
    print(json.dumps(fetch_all(corridors), indent=2))
