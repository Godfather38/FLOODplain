"""Strict, read-only NWM channel fallback from NOAA's public NODD archive.

Read the requested reach's compressed HDF5 chunks by HTTP Range, not whole
continental files. Every file's reach IDs, configuration, cycle, valid time,
units, scale/offset, and missing-value markers are checked before use.
"""
from concurrent.futures import ProcessPoolExecutor
import datetime as dt
import io
import math
import time
import urllib.request

import h5py
import numpy as np

BASE = 'https://noaa-nwm-pds.s3.amazonaws.com/'
BLOCK = 65536
MAX_FILE = 32 * 1024 * 1024
_RECORDS = {}


def stamp(t):
    return t.strftime('%Y-%m-%dT%H:%M:%SZ')


def scalar(value):
    a = np.asarray(value).reshape(-1)
    if len(a) != 1:
        raise ValueError('Expected one metadata value')
    v = a[0]
    return v.decode() if isinstance(v, bytes) else v.item() if hasattr(v, 'item') else v


class RangeFile(io.RawIOBase):
    """Bounded, cached, seekable public HTTPS reader suitable for h5py fileobj."""
    def __init__(self, url):
        super().__init__()
        self.url, self.pos, self.cache = url, 0, {}
        self.bytes_read = 0
        self.requests = 0
        with urllib.request.urlopen(urllib.request.Request(url, method='HEAD'), timeout=30) as r:
            self.size = int(r.headers['Content-Length'])
            self.etag = r.headers.get('ETag')
        if not self.etag:
            raise ValueError('NWM source has no ETag for consistent range reads')
        if not 0 < self.size <= MAX_FILE:
            raise ValueError(f'Unexpected NWM file size {self.size}: {url}')

    def readable(self): return True
    def seekable(self): return True
    def tell(self): return self.pos
    def seek(self, offset, whence=0):
        pos = offset if whence == 0 else self.pos + offset if whence == 1 else self.size + offset if whence == 2 else -1
        if pos < 0: raise ValueError('Invalid file seek')
        self.pos = pos
        return pos

    def read(self, size=-1):
        end = self.size if size is None or size < 0 else min(self.size, self.pos + size)
        if end <= self.pos: return b''
        first, last = self.pos // BLOCK, (end - 1) // BLOCK
        # Merge contiguous missing blocks into one request, including large chunks.
        block = first
        while block <= last:
            if block in self.cache:
                block += 1; continue
            finish = block
            while finish < last and finish + 1 not in self.cache: finish += 1
            lo, hi = block * BLOCK, min(self.size, (finish + 1) * BLOCK) - 1
            raw = self.fetch(lo, hi)
            for k in range(block, finish + 1):
                self.cache[k] = raw[(k - block) * BLOCK:(k - block + 1) * BLOCK]
            block = finish + 1
        raw = b''.join(self.cache[k] for k in range(first, last + 1))
        result = raw[self.pos - first * BLOCK:end - first * BLOCK]
        self.pos = end
        return result

    def readinto(self, buffer):
        raw = self.read(len(buffer)); buffer[:len(raw)] = raw
        return len(raw)

    def fetch(self, lo, hi):
        request = urllib.request.Request(self.url, headers={'Range': f'bytes={lo}-{hi}', 'If-Match': self.etag})
        for attempt in range(3):
            try:
                with urllib.request.urlopen(request, timeout=30) as r:
                    if r.status != 206 or r.headers.get('Content-Range') != f'bytes {lo}-{hi}/{self.size}':
                        raise ValueError('NWM server did not honor the exact byte range')
                    raw = r.read(hi - lo + 2)
                if len(raw) != hi - lo + 1:
                    raise ValueError('Truncated NWM byte range')
                self.requests += 1; self.bytes_read += len(raw)
                return raw
            except (OSError, ValueError):
                if attempt == 2: raise
                time.sleep(attempt + 1)


def source_file(t, cycle):
    if t <= cycle:
        # NOAA standard analysis tm00 is valid at the filename hour; its
        # initialization/reference time is three hours earlier.
        config, reference = 'analysis_and_assimilation', t - dt.timedelta(hours=3)
        path = f'nwm.{t:%Y%m%d}/analysis_assim/nwm.t{t:%H}z.analysis_assim.channel_rt.tm00.conus.nc'
    else:
        lead = int((t - cycle).total_seconds() / 3600)
        if not 1 <= lead <= 18: raise ValueError('NWM short-range lead is outside 1–18 hours')
        config, reference = 'short_range', cycle
        path = f'nwm.{cycle:%Y%m%d}/short_range/nwm.t{cycle:%H}z.short_range.channel_rt.f{lead:03d}.conus.nc'
    return BASE + path, config, reference


def decoded_time(dataset):
    if scalar(dataset.attrs.get('units')) != 'minutes since 1970-01-01 00:00:00 UTC':
        raise ValueError('Unsupported NWM time units')
    value = scalar(dataset[()])
    if not isinstance(value, (int, float)) or not math.isfinite(value):
        raise ValueError('Invalid NWM time')
    return dt.datetime(1970, 1, 1) + dt.timedelta(minutes=float(value))


def record_key(url, config, reference, valid, reaches):
    return (url, config, stamp(reference), stamp(valid), tuple(sorted(str(x) for x in reaches)))


def read_channel(url, config, reference, valid, reaches):
    key = record_key(url, config, reference, valid, reaches)
    if key in _RECORDS: return _RECORDS[key]
    with RangeFile(url) as raw:
        with h5py.File(raw, 'r') as f:
            if scalar(f.attrs.get('model_configuration')) != config:
                raise ValueError('Wrong NWM configuration')
            if scalar(f.attrs.get('model_output_type')) != 'channel_rt':
                raise ValueError('Wrong NWM output type')
            if decoded_time(f['reference_time']) != reference or decoded_time(f['time']) != valid:
                raise ValueError('NWM reference/valid time differs from the requested forcing hour')
            ids, flow = f['feature_id'], f['streamflow']
            if ids.ndim != 1 or flow.shape != ids.shape:
                raise ValueError('NWM reach and streamflow dimensions differ')
            if scalar(flow.attrs.get('units')) != 'm3 s-1':
                raise ValueError('Unexpected NWM streamflow units')
            factor = float(scalar(flow.attrs.get('scale_factor', 1)))
            offset = float(scalar(flow.attrs.get('add_offset', 0)))
            if not math.isfinite(factor) or factor <= 0 or not math.isfinite(offset):
                raise ValueError('Invalid NWM scale/offset')
            missing = [scalar(flow.attrs[name]) for name in ('_FillValue', 'missing_value') if name in flow.attrs]
            limits = np.asarray(flow.attrs.get('valid_range', [])).reshape(-1)
            if len(limits) not in (0, 2): raise ValueError('Invalid NWM valid_range')
            values = {}
            # Read the inventory once per file. A matching cached position alone
            # cannot prove this file has no second copy of the same reach.
            inventory = ids[:]
            for reach in key[-1]:
                matches = np.flatnonzero(inventory == int(reach))
                if len(matches) != 1: raise ValueError(f'NWM reach {reach} is absent or duplicated')
                index = int(matches[0])
                packed = scalar(flow[index])
                if not isinstance(packed, (int, float)) or not math.isfinite(packed) or packed in missing:
                    raise ValueError(f'NWM reach {reach} has no finite flow at {stamp(valid)}')
                if len(limits) and not limits[0] <= packed <= limits[1]:
                    raise ValueError(f'NWM reach {reach} is outside valid_range')
                value = packed * factor + offset
                if not math.isfinite(value) or value < 0:
                    raise ValueError(f'NWM reach {reach} has invalid flow at {stamp(valid)}')
                values[reach] = value
        info = {'url': url, 'configuration': config, 'referenceTime': stamp(reference),
                'validTime': stamp(valid), 'units': 'm3/s', 'bytesRead': raw.bytes_read,
                'etag': raw.etag, 'contentLength': raw.size}
    _RECORDS[key] = (values, info)
    return values, info


def load_window(args):
    """Separate processes avoid h5py's global I/O lock while bounding requests."""
    with ProcessPoolExecutor(max_workers=4) as pool:
        futures = [pool.submit(read_channel_args, job) for job in args]
        try:
            return [f.result() for f in futures]
        except BaseException:
            for future in futures: future.cancel()
            raise


def read_channel_args(args):
    try:
        return read_channel(*args)
    except (OSError, ValueError, KeyError, TypeError) as error:
        raise RuntimeError(f'{error}. Source: {args[0]}') from error


def hourly(reach, start, hours, cycle, reaches=None):
    """Return verified values plus provenance; any missing hour aborts the fallback."""
    reaches = tuple(str(x) for x in (reaches or [reach]))
    if str(reach) not in reaches: raise ValueError('Requested reach missing from fallback inventory')
    if any(t.tzinfo is not None or t.minute or t.second or t.microsecond for t in (start, cycle)):
        raise ValueError('NODD forcing requires naive UTC whole-hour timestamps')
    if type(hours) is not int or hours < 0 or start > cycle:
        raise ValueError('Invalid NODD forcing window')
    jobs = []
    for k in range(hours + 1):
        valid = start + dt.timedelta(hours=k)
        url, config, reference = source_file(valid, cycle)
        key = record_key(url, config, reference, valid, reaches)
        if key not in _RECORDS:
            jobs.append((url, config, reference, valid, reaches))
    if jobs:
        try:
            results = load_window(jobs)
        except (OSError, ValueError, KeyError, TypeError) as error:
            raise RuntimeError(f'NOAA NODD forcing window could not be verified for reach {reach}: {error}') from error
        # All hours verify before any values from this window become reusable.
        for job, result in zip(jobs, results):
            _RECORDS[record_key(*job)] = result
    out, sources = [], []
    for k in range(hours + 1):
        t = start + dt.timedelta(hours=k)
        url, config, reference = source_file(t, cycle)
        try:
            values, info = read_channel(url, config, reference, t, reaches)
        except (OSError, ValueError, KeyError, TypeError) as error:
            raise RuntimeError(f'NOAA NODD forcing unavailable at {stamp(t)} for reach {reach}: {error}. Source: {url}') from error
        out.append(values[str(reach)]); sources.append(info)
    return out, {'provider': 'NOAA NODD', 'reachId': str(reach), 'hrrrCycle': stamp(cycle),
                 'start': stamp(start), 'end': stamp(start + dt.timedelta(hours=hours)),
                 'method': 'Hourly analysis at each past time, then same-cycle short-range forecast; no gap filling',
                 'files': sources}
