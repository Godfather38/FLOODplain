"""Parse Pima County ALERT showdata pages (rain accumulators) into UTC tip increments. Read-only helper.

Page times are Arizona MST (UTC-7, no DST), checked in observed-gauges-20261101/gauges.json timeBasisCheck.
Increments are differences of the reported accumulator between consecutive reports; a drop (reset) is not rain
and is skipped; a missing report is unknown, never zero.
"""
import gzip, html, re
from datetime import datetime, timedelta, timezone
from pathlib import Path

MST = timezone(timedelta(hours=-7))


def read_page(path: Path) -> str:
    b = gzip.open(path).read() if path.suffix == '.gz' else path.read_bytes()
    return b.decode('utf-8', errors='replace')


def parse(path: Path):
    t = read_page(path)
    txt = html.unescape(re.sub(r'<[^>]*>', '\t', re.sub(r'<script.*?</script>', ' ', t, flags=re.S)))
    rows = []
    for ln in (re.sub(r'\s*\t\s*', '\t', x).strip('\t ') for x in txt.splitlines()):
        m = re.match(r'(\d\d)/(\d\d)/(\d{4})\t(\d\d:\d\d:\d\d)\t(.*)$', ln)
        if not m:
            continue
        mo, d, y, hms, rest = m.groups()
        v = rest.split('\t')[0].replace('?', '')
        if not re.fullmatch(r'-?\d+(\.\d+)?', v):
            continue
        loc = datetime.strptime(f'{y}-{mo}-{d}T{hms}', '%Y-%m-%dT%H:%M:%S').replace(tzinfo=MST)
        rows.append((loc.astimezone(timezone.utc), float(v)))
    rows.sort()
    return rows


def tips(rows):
    out = []
    for (t0, v0), (t1, v1) in zip(rows, rows[1:]):
        if v1 > v0:
            out.append((t1, round(v1 - v0, 4)))
    return out
