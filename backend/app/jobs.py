"""Bounded worker pool for report assessment."""
from __future__ import annotations

import logging
from concurrent.futures import Future, ThreadPoolExecutor

from . import config, processing

log = logging.getLogger("jobs")
_executor: ThreadPoolExecutor | None = None


def _done(report_id: str, fut: Future) -> None:
    if not fut.cancelled() and (exc := fut.exception()) is not None:
        log.error("assessment of report %s failed", report_id, exc_info=exc)


def submit(report_id: str) -> None:
    global _executor
    if _executor is None:
        _executor = ThreadPoolExecutor(max_workers=config.ASSESS_WORKERS, thread_name_prefix="assess")
    _executor.submit(processing.process_report, report_id).add_done_callback(lambda f: _done(report_id, f))


def shutdown() -> None:
    global _executor
    if _executor is not None:
        _executor.shutdown(wait=False, cancel_futures=True)
        _executor = None
