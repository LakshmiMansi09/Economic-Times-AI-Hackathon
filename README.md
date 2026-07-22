# Corridor Watch — Energy Supply Chain Risk Intelligence Agent

A local, continuously-updating geopolitical risk score for three crude oil
chokepoints (Strait of Hormuz, Bab-el-Mandeb/Red Sea, Strait of Malacca).
Runs entirely on your machine — no GitHub Actions, no cloud hosting, no
paid infrastructure.

## What this is

One Flask process that:
1. runs a background loop every `PIPELINE_INTERVAL_SECONDS` (default 15 min)
   fetching live news (GDELT), AIS (aisstream.io), prices (oilpriceapi.com),
   and sanctions (OFAC SDN list)
2. extracts structured events from the news via an LLM, grounded by a
   narrow RAG retrieval step against previously seen events
3. writes everything into a JSON-based knowledge graph under `data/`
4. computes a live 0–100 risk score per corridor with a full evidence trail
5. serves a dashboard (`docs/`) at `http://localhost:5000` showing all of it

### The dashboard

Three pages, all reading directly from the files the pipeline already
writes — no backend changes needed to get a richer frontend:

- **Overview** — a global composite risk index (arc-gauge instrument, not a
  fitness-app ring), KPI tiles (active alerts, signals in the last 24h,
  live Brent/WTI with % change), per-corridor cards with a weighted
  signal breakdown (how much of the current score is news vs. AIS vs.
  price vs. sanctions, computed from the real weights in
  `data/calibrated_weights.json`), a ranked "top signals" feed, a
  filterable intelligence log, and a dark map colored by live risk.
- **Backtest** — the 2026 Hormuz replay with stat tiles (lead time, peak
  score, peak price, days modeled) and a dual-axis score-vs-price chart.
- **Methodology** — the formula, data sources, and every stated limitation,
  plus a live-loaded view of whatever weights the scorer is actually using
  right now.

Every number on the dashboard is either read directly from a pipeline
output file or computed client-side from those files (e.g. the composite
index is the average of the three corridors' latest scores; the 24h delta
is computed by walking each corridor's score history). Nothing is
hardcoded or simulated.

### Automated tests

```bash
node tests/test_frontend_logic.js
```

Loads the real `docs/js/gauge.js` and `docs/js/app.js` into a stubbed
browser-like environment (Node's `vm` module) with realistic sample data,
and checks the actual computation logic — composite scoring, 24h deltas,
the weighted signal breakdown, price % change, and the empty-state path a
brand-new install sees before the pipeline has ever run. This does not
replace opening the dashboard in a real browser (it can't check CSS layout
or visual appearance), but it does catch logic bugs before you get there.

## Setup

```bash
python3 -m venv .venv
source .venv/bin/activate        # Windows: .venv\Scripts\activate
pip install -r requirements.txt

cp .env.example .env
# edit .env and add your free API keys:
#   GROQ_API_KEY        - https://console.groq.com
#   OILPRICEAPI_KEY      - https://www.oilpriceapi.com
#   AISSTREAM_API_KEY    - https://aisstream.io
```

## Run it

```bash
python app.py
```

Then open **http://localhost:5000**. The first pipeline run fires
immediately on startup so the dashboard has data right away, then repeats
on the configured interval. Use the **Refresh now** button in the
dashboard to trigger a run on demand (calls `POST /api/run`).

Leave the process running in a terminal — closing it stops the agent loop.

## Backtest against the real 2026 Hormuz crisis

```bash
python scripts/backtest.py
```

This replays a curated timeline of the actual Feb–May 2026 Strait of
Hormuz disruption through the same scoring function the live dashboard
uses, grid-searches the news/price weights for the best lead time against
the real Brent price spike, and writes the calibrated weights to
`data/calibrated_weights.json` — which the live scorer picks up
automatically on its next run. View the result on the **Backtest** tab of
the dashboard.

This step needs no network access — it replays a locally curated dataset
(`data/backtest/hormuz_2026_timeline.json`), documented as a
reconstruction from public reporting, not a live historical data pull.

## Repo layout

```
app.py                  Flask server + background agent loop (the entry point)
scripts/
  fetch_news.py          GDELT
  fetch_ais.py            aisstream.io, burst-sampled
  fetch_prices.py         oilpriceapi.com
  fetch_sanctions.py       OFAC SDN list, diffed each run
  vector_store.py         narrow RAG: embed + retrieve similar past events
  extract.py               LLM extraction against a fixed ontology
  score.py                 the scoring formula
  run_pipeline.py          orchestrates all of the above, one run
  backtest.py              replays the 2026 Hormuz crisis, calibrates weights
data/
  corridors.json           fixed scope: bounding boxes, keywords, suppliers
  events/all_events.json   the knowledge graph's event nodes
  scores/                  score history per corridor + latest.json
  vector_index/            embeddings for the RAG step
  backtest/                curated historical timeline + backtest output
docs/                      the dashboard, served directly by Flask
  index.html               live corridor gauges, evidence log, map
  backtest.html            score vs. actual price replay
  methodology.html         formula + stated limitations
```

## Documented trade-offs

- **AIS is burst-sampled (~90s per corridor per run), not continuously
  streamed** — a deliberate trade-off for a process that isn't always-on,
  not a silent shortcut. Documented on the dashboard's methodology page.
- **The knowledge graph is JSON, not Neo4j** — simplest option at this data
  volume; same schema would port to a real graph database if needed.
- **The backtest only calibrates the news/price weights** — AIS and
  sanctions historical data for the 2026 window wasn't independently
  reconstructed, so those two weights keep their design-time defaults.
- **Groq free tier by default** — `scripts/extract.py`'s client can be
  swapped for a stronger model without touching the ontology or pipeline.

## Note on testing

This was built and logic-tested (the backtest runs and produces a sane
score trajectory against the curated 2026 timeline) without live network
access to GDELT/aisstream/oilpriceapi/OFAC. Run the real fetchers on your
own machine to confirm live behavior — if any upstream API's response
shape has changed, the relevant `scripts/fetch_*.py` file is the place to
adjust it.
