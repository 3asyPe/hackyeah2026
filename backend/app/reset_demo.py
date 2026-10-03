"""Reset the demo: delete the DB and uploads, then re-seed. Run: .venv/bin/python -m app.reset_demo [--yes]

STOP THE BACKEND FIRST. A running server keeps the old DB handle and its in-process queue.
Touches only config.DB_PATH (+ -wal/-shm) and the files inside config.UPLOAD_DIR.
"""
from __future__ import annotations

import sys

from . import config, seed


def _targets():
    db = [p for p in (config.DB_PATH, *(config.DB_PATH.with_name(config.DB_PATH.name + s) for s in ("-wal", "-shm"))) if p.exists()]
    up = [p for p in config.UPLOAD_DIR.iterdir() if p.is_file()] if config.UPLOAD_DIR.is_dir() else []
    return db + up


def reset_demo() -> None:
    for p in _targets():
        p.unlink()
    seed.seed()


def main(argv: list[str]) -> int:
    print("Stop the backend first: a running server keeps the old DB handle and in-process queue.")
    if "--yes" not in argv:
        print("Would delete:")
        for p in _targets() or ["(nothing)"]:
            print(f"  {p}")
        print("Re-run with --yes to delete these files and re-seed.")
        return 1
    reset_demo()
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
