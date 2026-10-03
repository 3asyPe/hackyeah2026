import threading
import time
from concurrent.futures import ThreadPoolExecutor

from app import jobs, processing


def test_concurrent_first_submits_create_one_executor(monkeypatch):
    created = []

    class Counting(ThreadPoolExecutor):
        def __init__(self, *a, **k):
            time.sleep(0.05)
            created.append(self)
            super().__init__(*a, **k)

    monkeypatch.setattr(jobs, "ThreadPoolExecutor", Counting)
    monkeypatch.setattr(processing, "process_report", lambda rid: None)
    jobs.shutdown()
    start = threading.Barrier(8)

    def go():
        start.wait()
        jobs.submit("r")

    ts = [threading.Thread(target=go) for _ in range(8)]
    [t.start() for t in ts]
    [t.join() for t in ts]
    try:
        assert len(created) == 1
    finally:
        jobs.shutdown()
