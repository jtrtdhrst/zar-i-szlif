"""Runtime state gateway: liczniki, latencje, log bledow, cache idempotencji."""
import threading
import time
from collections import deque


class Diagnostics:
    def __init__(self, latency_window=1000, recent_window=50):
        self.lock = threading.Lock()
        self.started_at = time.time()
        self.calls = 0
        self.errors = 0
        self.by_tool = {}
        self.latencies = deque(maxlen=latency_window)
        self.recent = deque(maxlen=recent_window)
        self.profiles = {}

    def record(self, tool, ok, ms, code=None, profile=None):
        with self.lock:
            self.calls += 1
            if not ok:
                self.errors += 1
            stats = self.by_tool.setdefault(tool, {"calls": 0, "errors": 0, "msTotal": 0.0, "msMax": 0.0})
            stats["calls"] += 1
            stats["msTotal"] += ms
            stats["msMax"] = max(stats["msMax"], ms)
            if not ok:
                stats["errors"] += 1
            self.latencies.append(ms)
            self.recent.append({"ts": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                                "tool": tool, "ok": ok, "code": code, "ms": round(ms, 2)})
            if profile:
                self.profiles[profile] = self.profiles.get(profile, 0) + 1

    def snapshot(self, top=15):
        with self.lock:
            latencies = sorted(self.latencies)
            tools = []
            for name, stats in sorted(self.by_tool.items(), key=lambda kv: -kv[1]["calls"]):
                tools.append({"tool": name, "calls": stats["calls"], "errors": stats["errors"],
                              "avgMs": round(stats["msTotal"] / stats["calls"], 2) if stats["calls"] else 0,
                              "maxMs": round(stats["msMax"], 2)})
            errors = [r for r in self.recent if not r["ok"]]
            return {
                "uptimeSec": round(time.time() - self.started_at, 1),
                "calls": self.calls,
                "errors": self.errors,
                "errorRate": round(self.errors / self.calls, 4) if self.calls else 0,
                "latencyMs": {
                    "p50": _percentile(latencies, 0.50),
                    "p95": _percentile(latencies, 0.95),
                    "max": round(latencies[-1], 2) if latencies else 0,
                    "samples": len(latencies),
                },
                "profiles": dict(self.profiles),
                "tools": tools[:top],
                "recentErrors": errors[-10:],
            }


class IdempotencyStore:
    """Pamiec odpowiedzi dla powtornych zapisow z tym samym kluczem."""

    def __init__(self, ttl_sec=900, max_entries=200):
        self.lock = threading.Lock()
        self.ttl = ttl_sec
        self.max_entries = max_entries
        self.entries = {}

    def get(self, key):
        with self.lock:
            entry = self.entries.get(key)
            if not entry:
                return None
            if time.time() - entry["ts"] > self.ttl:
                self.entries.pop(key, None)
                return None
            return entry

    def put(self, key, payload):
        with self.lock:
            if len(self.entries) >= self.max_entries:
                oldest = min(self.entries, key=lambda k: self.entries[k]["ts"])
                self.entries.pop(oldest, None)
            self.entries[key] = {"ts": time.time(), "payload": payload}

    def size(self):
        with self.lock:
            return len(self.entries)


def _percentile(sorted_values, fraction):
    if not sorted_values:
        return 0
    index = min(len(sorted_values) - 1, int(round(fraction * (len(sorted_values) - 1))))
    return round(sorted_values[index], 2)
