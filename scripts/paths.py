"""
Every other module in scripts/ imports ROOT_DIR from here so that file paths
(data/corridors.json, data/events/..., etc.) resolve correctly no matter
where the process was launched from — important once app.py starts
importing these modules directly instead of running them as standalone
scripts from inside scripts/.
"""
import os

ROOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def path(*parts: str) -> str:
    return os.path.join(ROOT_DIR, *parts)
