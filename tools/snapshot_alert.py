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
    try:
        return datetime.fromisoformat(local).replace(tzinfo=AZ).isoformat()
    except (TypeError, ValueError):
        return None


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
