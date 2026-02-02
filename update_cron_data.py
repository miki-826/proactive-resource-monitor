#!/usr/bin/env python3
"""Generate cron_status.json for the static dashboard.

This script queries Clawdbot cron jobs via the CLI and writes a small,
front-end-friendly JSON file into this project directory.

Usage:
  python3 update_cron_data.py

Designed to be run periodically (cron/systemd timer).

Outputs:
  - cron_status.json (same directory)
  - .cpu_state.json (internal state for CPU usage diff; same directory)
"""

from __future__ import annotations

import json
import os
import platform
import shutil
import subprocess
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any

HERE = os.path.dirname(os.path.abspath(__file__))
OUT_PATH = os.path.join(HERE, "cron_status.json")
CPU_STATE_PATH = os.path.join(HERE, ".cpu_state.json")


def _iso(ms: int | None) -> str | None:
    if not ms:
        return None
    return datetime.fromtimestamp(ms / 1000, tz=timezone.utc).isoformat()


def _read_text(path: str) -> str:
    with open(path, "r", encoding="utf-8") as f:
        return f.read()


def _safe_float(v: str) -> float | None:
    try:
        return float(v)
    except Exception:
        return None


def _safe_int(v: str) -> int | None:
    try:
        return int(v)
    except Exception:
        return None


@dataclass
class CpuSample:
    total: int
    idle: int


def _read_cpu_sample() -> CpuSample | None:
    """Read /proc/stat and return aggregated CPU counters.

    /proc/stat first line: cpu  user nice system idle iowait irq softirq steal guest guest_nice
    We treat idle = idle + iowait; total = sum of all fields.
    """

    try:
        first = _read_text("/proc/stat").splitlines()[0]
        parts = first.split()
        if not parts or parts[0] != "cpu":
            return None
        nums = [int(x) for x in parts[1:] if x.isdigit()]
        if len(nums) < 5:
            return None
        idle = nums[3] + (nums[4] if len(nums) > 4 else 0)
        total = sum(nums)
        return CpuSample(total=total, idle=idle)
    except Exception:
        return None


def _load_cpu_state() -> dict[str, Any] | None:
    try:
        with open(CPU_STATE_PATH, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return None


def _save_cpu_state(sample: CpuSample, at_ms: int) -> None:
    tmp = CPU_STATE_PATH + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump({"atMs": at_ms, "total": sample.total, "idle": sample.idle}, f)
        f.write("\n")
    os.replace(tmp, CPU_STATE_PATH)


def _cpu_usage_pct(now: CpuSample | None, now_ms: int) -> float | None:
    if not now:
        return None

    prev = _load_cpu_state()
    _save_cpu_state(now, now_ms)

    if not prev:
        return None

    prev_total = _safe_int(str(prev.get("total")))
    prev_idle = _safe_int(str(prev.get("idle")))

    if prev_total is None or prev_idle is None:
        return None

    total_delta = now.total - prev_total
    idle_delta = now.idle - prev_idle
    if total_delta <= 0:
        return None

    usage = (1.0 - (idle_delta / total_delta)) * 100.0
    # clamp
    if usage < 0:
        usage = 0.0
    if usage > 100:
        usage = 100.0
    return round(usage, 1)


def _mem_usage_pct() -> float | None:
    """Compute memory usage percent from /proc/meminfo."""
    try:
        meminfo = {}
        for line in _read_text("/proc/meminfo").splitlines():
            if ":" not in line:
                continue
            k, rest = line.split(":", 1)
            meminfo[k.strip()] = rest.strip()

        total_kb = _safe_int(meminfo.get("MemTotal", "").split()[0])
        avail_kb = _safe_int(meminfo.get("MemAvailable", "").split()[0])
        if not total_kb or avail_kb is None:
            return None

        used = total_kb - avail_kb
        pct = (used / total_kb) * 100.0
        return round(pct, 1)
    except Exception:
        return None


def _disk_usage_pct(path: str = "/") -> float | None:
    try:
        du = shutil.disk_usage(path)
        if du.total <= 0:
            return None
        pct = (du.used / du.total) * 100.0
        return round(pct, 1)
    except Exception:
        return None


def _uptime_seconds() -> int | None:
    try:
        # /proc/uptime: "12345.67 8910.11"
        up = _read_text("/proc/uptime").split()[0]
        v = _safe_float(up)
        if v is None:
            return None
        return int(v)
    except Exception:
        return None


def _run_cmd(cmd: list[str], timeout_s: int = 20) -> tuple[int, str, str]:
    proc = subprocess.run(
        cmd,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        check=False,
        timeout=timeout_s,
    )
    return proc.returncode, proc.stdout, proc.stderr


def main() -> int:
    generated_at_ms = int(time.time() * 1000)

    cron_cmd = ["clawdbot", "cron", "list", "--all", "--json"]

    # --- system snapshot ---
    cpu_sample = _read_cpu_sample()
    system = {
        "hostname": platform.node() or None,
        "os": platform.system() or None,
        "release": platform.release() or None,
        "arch": platform.machine() or None,
        "uptimeSec": _uptime_seconds(),
        "cpuUsagePct": _cpu_usage_pct(cpu_sample, generated_at_ms),
        "memUsagePct": _mem_usage_pct(),
        "diskUsagePct": _disk_usage_pct("/"),
    }

    # --- cron ---
    try:
        code, out, err = _run_cmd(cron_cmd, timeout_s=20)
        if code != 0:
            raise RuntimeError(err.strip() or f"cron list failed: {code}")

        raw = json.loads(out)
        jobs = raw.get("jobs", []) or []

        normalized_jobs = []
        for j in jobs:
            state = j.get("state") or {}
            schedule = j.get("schedule") or {}

            normalized_jobs.append(
                {
                    "id": j.get("id"),
                    "name": j.get("name"),
                    "enabled": bool(j.get("enabled")),
                    "schedule": {
                        "kind": schedule.get("kind"),
                        "expr": schedule.get("expr"),
                    },
                    "lastRun": {
                        "status": state.get("lastStatus"),
                        "atMs": state.get("lastRunAtMs"),
                        "atIso": _iso(state.get("lastRunAtMs")),
                        "durationMs": state.get("lastDurationMs"),
                        "error": state.get("lastError"),
                    },
                    "nextRun": {
                        "atMs": state.get("nextRunAtMs"),
                        "atIso": _iso(state.get("nextRunAtMs")),
                    },
                }
            )

        out_obj: dict[str, Any] = {
            "generatedAtMs": generated_at_ms,
            "generatedAtIso": _iso(generated_at_ms),
            "source": {"command": " ".join(cron_cmd)},
            "system": system,
            "jobs": normalized_jobs,
        }

    except Exception as e:
        out_obj = {
            "generatedAtMs": generated_at_ms,
            "generatedAtIso": _iso(generated_at_ms),
            "error": str(e),
            "system": system,
            "jobs": [],
        }

    tmp_path = OUT_PATH + ".tmp"
    with open(tmp_path, "w", encoding="utf-8") as f:
        json.dump(out_obj, f, ensure_ascii=False, indent=2)
        f.write("\n")

    os.replace(tmp_path, OUT_PATH)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
