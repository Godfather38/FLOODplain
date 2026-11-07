"""Snapshot Pima County ALERT rain + stream sensors near Avra Valley.

The county's ALERT map feeds (currain.php / currentstream.php) are public
JSON but do not send CORS headers, so a web page can't read them directly.
A scheduled GitHub Action runs this every ~10 minutes and publishes the
trimmed result to the `data` branch, which the app reads from
raw.githubusercontent.com.

Usage: python3 tools/snapshot_alert.py OUT.json
"""
import json
import sys
from datetime import datetime, timedelta, timezone
from urllib.request import Request, urlopen

BASE = "https://alertmap.rfcd.pima.gov/gmap/gmap_files/php/"
UA = "FLOODplain/0.1 (personal flood-route check; github.com/godfather38/floodplain)"
BOX = (-111.50, 32.05, -110.95, 32.56)  # W, S, E, N: Avra Valley + Santa Cruz upstream
AZ = timezone(timedelta(hours=-7))  # Arizona: MST all year, no DST
RAIN_KEYS = ["m10", "m30", "h1", "h3", "h6", "d1", "d3", "d7", "d30"]


def get(name):
    with urlopen(Request(BASE + name, headers={"User-Agent": UA}), timeout=60) as r:
        return json.load(r)["data"]


def inside(d):
    try:
        x, y = float(d["longitude"]), float(d["latitude"])
    except (KeyError, ValueError):
        return False
    return BOX[0] <= x <= BOX[2] and BOX[1] <= y <= BOX[3]


def iso(local):
    """ALERT last_rpt is Arizona wall-clock time with no zone. A value that already
    carries a zone keeps it (replacing it would move the time). Unreadable -> None.
    A future time is kept as sent; the rules refuse to use it."""
    if not isinstance(local, str) or len(local.strip()) < 16:  # a date alone has no time
        return None
    try:
        t = datetime.fromisoformat(local.strip().replace("Z", "+00:00").replace("z", "+00:00"))
    except (TypeError, ValueError):
        return None
    return (t if t.tzinfo else t.replace(tzinfo=AZ)).isoformat()


def num(v):
    try:
        v = float(v)
    except (TypeError, ValueError):
        return None
    return None if v <= -90 else v


def main(out):
    rain = [{
        "site": d["site"], "name": d["name"].strip(),
        "lat": float(d["latitude"]), "lon": float(d["longitude"]),
        "last_rpt": iso(d.get("last_rpt")), "maintenance": bool(d.get("UnderMaintenance")),
        "in": {k: num(v) for k, v in zip(RAIN_KEYS, d.get("rain") or [])},
    } for d in get("currain.php") if inside(d) and d.get("source") in ("pima", "pinal")]
    stream = [{
        "site": d["site"], "name": d["name"].strip(),
        "lat": float(d["latitude"]), "lon": float(d["longitude"]),
        "last_rpt": iso(d.get("last_rpt")), "maintenance": bool(d.get("UnderMaintenance")),
        "stage_ft": num(d.get("stage")), "flow_cfs": num(d.get("flow")),
    } for d in get("currentstream.php") if inside(d) and d.get("source") in ("pima", "pinal")]
    snap = {
        "fetched_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "source": "Pima County Regional Flood Control District ALERT (provisional data)",
        "rain_windows": RAIN_KEYS, "rain": rain, "stream": stream,
    }
    with open(out, "w") as f:
        json.dump(snap, f, indent=1)
    print(f"{len(rain)} rain, {len(stream)} stream sensors -> {out}")


if __name__ == "__main__":
    main(sys.argv[1])
