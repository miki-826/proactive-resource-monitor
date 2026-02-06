#!/usr/bin/env python3
"""Generate cron_status.json for the static dashboard.

This script queries Clawdbot cron jobs via the CLI and writes a small,
front-end-friendly JSON file into this project directory.

Usage:
  python3 update_cron_data.py

Designed to be run periodically (cron/systemd timer).

Outputs:
  - cron_status.json (same directory)
  - resource_history.json (time-series for charts; same directory)
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
HISTORY_PATH = os.path.join(HERE, "resource_history.json")

# Keep the dashboard snappy: retain a bounded window of samples.
# (24h @ 60s interval = 1440 points)
HISTORY_RETENTION_MS = 24 * 60 * 60 * 1000
HISTORY_MAX_POINTS = 2000


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


def _loadavg() -> dict[str, float] | None:
    try:
        # /proc/loadavg: "0.01 0.05 0.15 1/234 5678"
        parts = _read_text("/proc/loadavg").split()
        if len(parts) < 3:
            return None
        one = _safe_float(parts[0])
        five = _safe_float(parts[1])
        fifteen = _safe_float(parts[2])
        if one is None or five is None or fifteen is None:
            return None
        return {"1m": one, "5m": five, "15m": fifteen}
    except Exception:
        return None


def _cpu_temp_c() -> float | None:
    """Try to read CPU temperature in Celsius (common on Raspberry Pi/Linux)."""
    candidates = [
        "/sys/class/thermal/thermal_zone0/temp",
        "/sys/class/hwmon/hwmon0/temp1_input",
    ]
    for p in candidates:
        try:
            raw = _read_text(p).strip()
            v = _safe_int(raw)
            if v is None:
                continue
            # usually milli-degC
            if v > 1000:
                return round(v / 1000.0, 1)
            return float(v)
        except Exception:
            continue
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


def _vcgencmd_get_throttled() -> dict[str, Any] | None:
    """Return Raspberry Pi throttling info if vcgencmd is available.

    vcgencmd get_throttled -> e.g. "throttled=0x0"
    See: https://www.raspberrypi.com/documentation/computers/os.html#vcgencmd
    """

    if shutil.which("vcgencmd") is None:
        return None

    try:
        code, out, _err = _run_cmd(["vcgencmd", "get_throttled"], timeout_s=5)
        if code != 0:
            return None
        out = out.strip()
        if "=" not in out:
            return None
        _k, v = out.split("=", 1)
        v = v.strip()
        # expected hex like 0x50005
        try:
            bits = int(v, 16)
        except Exception:
            return {"raw": out}

        # Bits summary (current):
        # 0: under-voltage
        # 1: arm frequency capped
        # 2: currently throttled
        # 3: soft temp limit active
        # (historical) 16..19 mirrors 0..3
        def has(bit: int) -> bool:
            return bool(bits & (1 << bit))

        current = {
            "underVoltage": has(0),
            "freqCapped": has(1),
            "throttled": has(2),
            "softTempLimit": has(3),
        }
        past = {
            "underVoltage": has(16),
            "freqCapped": has(17),
            "throttled": has(18),
            "softTempLimit": has(19),
        }

        return {"raw": out, "hex": v, "bits": bits, "current": current, "past": past}
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


def _mem_info() -> dict[str, int] | None:
    """Return memory info in kB from /proc/meminfo (total/available)."""
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
        return {"totalKb": total_kb, "availableKb": avail_kb}
    except Exception:
        return None


def _mem_usage_pct() -> float | None:
    """Compute memory usage percent from /proc/meminfo."""
    mi = _mem_info()
    if not mi:
        return None
    total_kb = mi["totalKb"]
    avail_kb = mi["availableKb"]
    used = total_kb - avail_kb
    pct = (used / total_kb) * 100.0
    return round(pct, 1)


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


def _load_history() -> dict[str, Any]:
    try:
        if not os.path.exists(HISTORY_PATH):
            return {"generatedAtMs": None, "retentionMs": HISTORY_RETENTION_MS, "points": []}
        return json.loads(_read_text(HISTORY_PATH))
    except Exception:
        return {"generatedAtMs": None, "retentionMs": HISTORY_RETENTION_MS, "points": []}


def _save_history(obj: dict[str, Any]) -> None:
    tmp = HISTORY_PATH + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False)
        f.write("\n")
    os.replace(tmp, HISTORY_PATH)


def _append_history(now_ms: int, system: dict[str, Any]) -> None:
    """Append a single system snapshot to resource_history.json.

    This file is intentionally small and stable for front-end charts.
    """

    hist = _load_history()
    points = hist.get("points", []) or []

    # only keep what we chart (avoid leaking large objects)
    p = {
        "atMs": now_ms,
        "cpu": system.get("cpuUsagePct"),
        "mem": system.get("memUsagePct"),
        "disk": system.get("diskUsagePct"),
        "tempC": system.get("cpuTempC"),
        "load1": (system.get("loadavg") or {}).get("1m"),
    }

    # de-dup if the generator is triggered twice in the same ms
    if points and points[-1].get("atMs") == now_ms:
        points[-1] = p
    else:
        points.append(p)

    cutoff = now_ms - HISTORY_RETENTION_MS
    points = [x for x in points if isinstance(x, dict) and (x.get("atMs") or 0) >= cutoff]
    if len(points) > HISTORY_MAX_POINTS:
        points = points[-HISTORY_MAX_POINTS:]

    out = {
        "generatedAtMs": now_ms,
        "generatedAtIso": _iso(now_ms),
        "retentionMs": HISTORY_RETENTION_MS,
        "maxPoints": HISTORY_MAX_POINTS,
        "points": points,
    }
    _save_history(out)


def main() -> int:
    generated_at_ms = int(time.time() * 1000)

    cron_cmd = ["clawdbot", "cron", "list", "--all", "--json"]

    # --- system snapshot ---
    cpu_sample = _read_cpu_sample()
    mem = _mem_info()
    system = {
        "hostname": platform.node() or None,
        "os": platform.system() or None,
        "release": platform.release() or None,
        "arch": platform.machine() or None,
        "uptimeSec": _uptime_seconds(),
        "loadavg": _loadavg(),
        "cpuTempC": _cpu_temp_c(),
        "throttling": _vcgencmd_get_throttled(),
        "cpuUsagePct": _cpu_usage_pct(cpu_sample, generated_at_ms),
        "memUsagePct": _mem_usage_pct(),
        "mem": mem,
        "diskUsagePct": _disk_usage_pct("/"),
    }

    # Always try to update the history; failures should not break the main JSON.
    try:
        _append_history(generated_at_ms, system)
    except Exception:
        pass

    # --- cron ---
    try:
        # cron の取得は CLI の状態次第で遅くなることがあるため、短めにタイムアウト。
        # 失敗時は直前の cron_status.json を読み込んで "stale" 扱いにする。
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
        # If the cron query fails (e.g., high load / CLI timeout), keep the last
        # known jobs so the dashboard stays useful, and mark it as stale.
        prev_jobs: list[dict[str, Any]] = []
        prev_generated_at_iso: str | None = None
        try:
            if os.path.exists(OUT_PATH):
                prev = json.loads(_read_text(OUT_PATH))
                prev_jobs = prev.get("jobs", []) or []
                prev_generated_at_iso = prev.get("generatedAtIso")
        except Exception:
            prev_jobs = []
            prev_generated_at_iso = None

        out_obj = {
            "generatedAtMs": generated_at_ms,
            "generatedAtIso": _iso(generated_at_ms),
            "cronStale": True,
            "cronError": str(e),
            "previousGeneratedAtIso": prev_generated_at_iso,
            "system": system,
            "jobs": prev_jobs,
        }

    tmp_path = OUT_PATH + ".tmp"
    with open(tmp_path, "w", encoding="utf-8") as f:
        json.dump(out_obj, f, ensure_ascii=False, indent=2)
        f.write("\n")

    os.replace(tmp_path, OUT_PATH)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
