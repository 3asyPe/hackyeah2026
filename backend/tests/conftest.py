import os
import tempfile
from pathlib import Path

_tmp = Path(tempfile.mkdtemp())
os.environ.update(DATA_DIR=str(_tmp), DB_PATH=str(_tmp / "test.db"), UPLOAD_DIR=str(_tmp / "uploads"),
                  ASSESSOR="mock", MOCK_DELAY_S="0")
