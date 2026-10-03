import os
import tempfile
from pathlib import Path

_tmp = Path(tempfile.mkdtemp())
os.environ.update(DATA_DIR=str(_tmp), DB_PATH=str(_tmp / "test.db"), UPLOAD_DIR=str(_tmp / "uploads"),
                  ASSESSOR="mock", MOCK_DELAY_S="0", MAX_INCIDENT_AGE_H="72", MAP_MAX_AGE_H="24",
                  MIN_TOP_CONFIDENCE="50", ASSESS_WORKERS="4")
