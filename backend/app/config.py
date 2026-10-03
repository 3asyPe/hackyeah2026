"""Runtime settings (env-overridable). .env is loaded from the backend directory."""
import os
from pathlib import Path

from dotenv import load_dotenv

BACKEND_DIR = Path(__file__).resolve().parent.parent
load_dotenv(BACKEND_DIR / ".env")


def _f(name: str, default: float) -> float:
    return float(os.getenv(name, default))


DATA_DIR = Path(os.getenv("DATA_DIR", BACKEND_DIR / "data"))
DB_PATH = Path(os.getenv("DB_PATH", DATA_DIR / "app.db"))
UPLOAD_DIR = Path(os.getenv("UPLOAD_DIR", BACKEND_DIR / "uploads"))
SAMPLES_DIR = Path(os.getenv("SAMPLES_DIR", BACKEND_DIR / "samples"))
FIXTURES_DIR = Path(os.getenv("FIXTURES_DIR", BACKEND_DIR / "fixtures" / "replay"))
SCHEMA_PATH = Path(__file__).resolve().parent / "schema.sql"

OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "").strip()
OPENAI_MODEL = os.getenv("OPENAI_MODEL", "gpt-4.1-mini").strip() or "gpt-4.1-mini"
OPENAI_TIMEOUT_S = _f("OPENAI_TIMEOUT_S", 60)
PROMPT_VERSION = "v1"
MOCK_DELAY_S = _f("MOCK_DELAY_S", 1.0)  # also applied to replay hits, so "Processing" stays visible

# auto -> openai when a key is set, else replay (recorded fixtures, keyword mock on a miss)
ASSESSOR = os.getenv("ASSESSOR", "auto").strip().lower() or "auto"
if ASSESSOR not in ("auto", "openai", "replay", "mock"):
    raise ValueError(f"ASSESSOR must be auto, openai, replay or mock (got {ASSESSOR!r})")
ASSESSOR_MODE = ("openai" if OPENAI_API_KEY else "replay") if ASSESSOR == "auto" else ASSESSOR

OPERATOR_TOKEN = os.getenv("OPERATOR_TOKEN", "demo").strip() or "demo"

MAX_PHOTO_BYTES = 10 * 1024 * 1024
MAX_DESCRIPTION_CHARS = int(_f("MAX_DESCRIPTION_CHARS", 2000))
MIN_RECEIPT_TOKEN_CHARS = 16
MAX_INCIDENT_AGE_H = _f("MAX_INCIDENT_AGE_H", 72)  # reports older than this are rejected
MAP_MAX_AGE_H = _f("MAP_MAX_AGE_H", 24)  # public map hides incidents whose latest report is older
ASSESS_WORKERS = int(_f("ASSESS_WORKERS", 4))

# Grouping (ERD §10)
MIN_TOP_CONFIDENCE = _f("MIN_TOP_CONFIDENCE", 50)  # top severity/urgency confidence below this => in_review
GROUP_MAX_DISTANCE_M = _f("GROUP_MAX_DISTANCE_M", 200)
GROUP_MAX_TIME_MIN = _f("GROUP_MAX_TIME_MIN", 60)
GROUP_DISTANCE_WEIGHT = _f("GROUP_DISTANCE_WEIGHT", 1)
GROUP_TIME_WEIGHT = _f("GROUP_TIME_WEIGHT", 5)

# Notification simulation
SIM_RADIUS_M = int(_f("SIM_RADIUS_M", 1000))
SIM_MIN_RECIPIENTS = 20
SIM_MAX_RECIPIENTS = 300
