"""Reject incomplete or mismatched coarse model packages before publication."""
import datetime as dt
import gzip
import hashlib
import json
import math
from pathlib import Path
import sys


def parse(value):
    if not isinstance(value,str): raise ValueError('Missing timestamp')
    parsed=dt.datetime.fromisoformat(value.replace('Z','+00:00'))
    if parsed.tzinfo is None: raise ValueError('Timestamp has no timezone')
    return parsed.astimezone(dt.timezone.utc)


def verify(folder, cycle_iso):
    folder=Path(folder); cycle=parse(cycle_iso)
    m=json.loads((folder/'manifest.json').read_text())
    if m.get('kind')!='live_sfincs_run' or m.get('finished') is not True:
        raise ValueError('Coarse SFINCS did not finish')
    if parse(m.get('hrrrCycle'))!=cycle:
        raise ValueError('Coarse model cycle differs from requested forcing')
    expected=[cycle+dt.timedelta(hours=h) for h in range(-6,19)]
    if m.get('frameCount')!=len(expected) or parse(m.get('firstFrame'))!=expected[0] or parse(m.get('lastFrame'))!=expected[-1]:
        raise ValueError('Coarse manifest does not cover the full expected forecast window')
    water=(folder/'water.json.gz').read_bytes()
    descriptor=(m.get('files') or {}).get('water.json.gz') or {}
    if descriptor.get('bytes')!=len(water) or descriptor.get('sha256')!=hashlib.sha256(water).hexdigest():
        raise ValueError('Coarse water file does not match its manifest checksum')
    body=json.loads(gzip.decompress(water))
    if not m.get('runId') or body.get('runId')!=m['runId']:
        raise ValueError('Coarse water run identity differs from manifest')
    frames=body.get('frames')
    if not isinstance(frames,list) or len(frames)!=len(expected) or [parse(f.get('time')) for f in frames]!=expected:
        raise ValueError('Coarse water frames are missing, reordered, or do not cover the full forecast window')
    count=None
    for frame in frames:
        values=frame.get('surfaceM')
        if not isinstance(values,list) or not values or (count is not None and len(values)!=count):
            raise ValueError('Coarse water frame has missing or inconsistent cell values')
        count=len(values)
        valid=[v for v in values if v is not None]
        if not valid or any(isinstance(v,bool) or not isinstance(v,(int,float)) or not math.isfinite(v) for v in valid):
            raise ValueError('Coarse water frame has no usable finite model water')
    print(f'Verified completed coarse run {m["runId"]}: {len(frames)} hourly frames, {count} cells')


if __name__=='__main__':
    verify(*sys.argv[1:])
