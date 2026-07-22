"""
Single entry point for the whole local prototype.

    python app.py

This starts:
  - a Flask server serving the dashboard (docs/) and the live data (data/)
  - a background thread that runs the ingestion+scoring pipeline on a loop
  - a POST /api/run endpoint to trigger a run immediately (used by the
    dashboard's "Refresh now" button)

No GitHub Actions, no GitHub Pages — everything runs in this one process.
"""
import os
import sys
import threading
import time
import traceback
from datetime import datetime, timezone

from dotenv import load_dotenv
from flask import Flask, jsonify, send_from_directory

ROOT_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(ROOT_DIR, "scripts"))
load_dotenv(os.path.join(ROOT_DIR, ".env"))

from run_pipeline import main as run_pipeline_once  # noqa: E402

app = Flask(__name__, static_folder=None)

INTERVAL_SECONDS = int(os.environ.get("PIPELINE_INTERVAL_SECONDS", "900"))
PORT = int(os.environ.get("PORT", "5000"))

_state = {
    "last_run_started": None,
    "last_run_finished": None,
    "last_run_ok": None,
    "last_error": None,
    "run_count": 0,
    "running": False,
}
_state_lock = threading.Lock()


def _run_once_locked():
    with _state_lock:
        if _state["running"]:
            return {"skipped": True, "reason": "a run is already in progress"}
        _state["running"] = True
        _state["last_run_started"] = datetime.now(timezone.utc).isoformat()

    try:
        scores = run_pipeline_once()
        with _state_lock:
            _state["last_run_ok"] = True
            _state["last_error"] = None
            _state["run_count"] += 1
        return {"skipped": False, "scores": scores}
    except Exception as e:
        traceback.print_exc()
        with _state_lock:
            _state["last_run_ok"] = False
            _state["last_error"] = str(e)
        return {"skipped": False, "error": str(e)}
    finally:
        with _state_lock:
            _state["running"] = False
            _state["last_run_finished"] = datetime.now(timezone.utc).isoformat()


def _background_loop():
    # Run once immediately on startup so the dashboard has data right away,
    # then repeat on the configured interval.
    while True:
        print(f"[agent loop] starting run at {datetime.now(timezone.utc).isoformat()}")
        _run_once_locked()
        print(f"[agent loop] sleeping {INTERVAL_SECONDS}s")
        time.sleep(INTERVAL_SECONDS)


# ---- Dashboard + data serving ----

@app.route("/")
@app.route("/<path:filename>")
def serve_dashboard(filename="index.html"):
    docs_dir = os.path.join(ROOT_DIR, "docs")
    if os.path.exists(os.path.join(docs_dir, filename)):
        return send_from_directory(docs_dir, filename)
    return send_from_directory(docs_dir, "index.html")  # simple fallback for clean URLs


@app.route("/data/<path:filename>")
def serve_data(filename):
    return send_from_directory(os.path.join(ROOT_DIR, "data"), filename)


# ---- API ----

@app.route("/api/status")
def api_status():
    with _state_lock:
        return jsonify(dict(_state))


@app.route("/api/run", methods=["POST"])
def api_run():
    result = _run_once_locked()
    return jsonify(result)


def main():
    missing = [k for k in ["GROQ_API_KEY", "OILPRICEAPI_KEY", "AISSTREAM_API_KEY"] if not os.environ.get(k)]
    if missing:
        print(f"WARNING: missing keys {missing} — those sources will be skipped, not fatal.")
        print("Copy .env.example to .env and fill them in to enable live data for all sources.\n")

    t = threading.Thread(target=_background_loop, daemon=True)
    t.start()

    print(f"Dashboard running at http://localhost:{PORT}")
    app.run(host="0.0.0.0", port=PORT, debug=False, use_reloader=False)


if __name__ == "__main__":
    main()
