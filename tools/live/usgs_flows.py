"""Observed USGS gauge discharge for the past (analysis) hours of a live all-route run.

For an inlet whose registry entry has "observed": {"usgsSite": ..., "parameterCd": "00060"},
every forcing hour at or before the HRRR cycle uses the USGS instantaneous discharge at that
top-of-hour time, taken the same way tools/sfincs/brawley/build_brawley_inflow.py made the
frozen observed variant: the reading at that exact time, or the straight line between the two
neighbouring readings when both are within 15 minutes; cfs x 0.0283168 = m3/s.

Forecast hours (after the cycle) keep the NWM short-range flow unchanged: no bias correction and
no invented recession. An hour with no valid USGS value keeps that hour's NWM value and is
flagged; if USGS cannot be read at all, every hour is NWM and the provenance says so. A missing
reading is never zero flow. USGS provisional data is labelled provisional.

Sources: the NWIS IV service first, then the USGS Water Data OGC API. An optional key in the
environment variable USGS_API_KEY is sent only as a request header to the OGC API; it is never
part of a URL or of the recorded provenance.
"""
import datetime as dt
import hashlib
import json
import math
import os
import urllib.error
import urllib.parse
import urllib.request

CFS = 0.0283168  # m3/s per ft3/s, the factor build_brawley_inflow.py used
UNITS = {'ft3/s': CFS, 'ft^3/s': CFS, 'ftÂ³/s': CFS, 'cfs': CFS, 'm3/s': 1.0, 'm^3/s': 1.0, 'mÂ³/s': 1.0}
NWIS = 'https://waterservices.usgs.gov/nwis/iv/'
OGC = 'https://api.waterdata.usgs.gov/ogcapi/v0/collections/continuous/items'
BRACKET = dt.timedelta(minutes=15)
ISO = lambda t: t.strftime('%Y-%m-%dT%H:%M:%SZ')


class UsgsFormatError(ValueError):
    """The response cannot be read as discharge for the requested site and parameter."""


def utc_naive(text):
    if not isinstance(text, str):
        raise UsgsFormatError('reading has no timestamp')
    t = dt.datetime.fromisoformat(text.replace('Z', '+00:00'))
    if t.tzinfo is None:
        raise UsgsFormatError('reading timestamp has no time zone')
    return t.astimezone(dt.timezone.utc).replace(tzinfo=None)


def reading(value, nodata=None):
    """A finite, non-negative discharge, or None. A no-data flag is missing, never zero."""
    if value is None or isinstance(value, bool):
        return None
    try:
        v = float(value)
    except (TypeError, ValueError):
        return None
    if not math.isfinite(v) or v < 0 or (nodata is not None and v == float(nodata)):
        return None
    return v


def add(values, conflicts, t, v, qualifiers):
    if t in conflicts:
        return
    if t in values and values[t]['value'] != v:
        # Two different readings for one time: neither can be trusted.
        del values[t]; conflicts.add(t); return
    values[t] = {'value': v, 'qualifiers': sorted(set(qualifiers))}


def parse_nwis(body, site, parameter):
    """{time: {'value', 'qualifiers'}} in the response's units, and that unit's m3/s factor."""
    try:
        data = json.loads(body)
        series = data['value']['timeSeries']
    except (ValueError, KeyError, TypeError) as error:
        raise UsgsFormatError(f'not an NWIS IV JSON response: {error}') from error
    if not isinstance(series, list):
        raise UsgsFormatError('timeSeries is not a list')
    values, conflicts, factor = {}, set(), None
    for ts in series:
        try:
            codes = {c['value'] for c in ts['sourceInfo']['siteCode']}
            variables = {c['value'] for c in ts['variable']['variableCode']}
            unit = ts['variable']['unit']['unitCode']
            nodata = ts['variable'].get('noDataValue')
            blocks = ts['values']
        except (KeyError, TypeError) as error:
            raise UsgsFormatError(f'time series is missing {error}') from error
        if site not in codes or parameter not in variables:
            continue
        if unit not in UNITS:
            raise UsgsFormatError(f'unknown discharge units {unit!r}')
        if factor is not None and UNITS[unit] != factor:
            raise UsgsFormatError('time series disagree on units')
        factor = UNITS[unit]
        for block in blocks:
            for x in (block or {}).get('value') or []:
                if not isinstance(x, dict):
                    raise UsgsFormatError('malformed reading')
                v = reading(x.get('value'), nodata)
                if v is None:
                    continue
                add(values, conflicts, utc_naive(x.get('dateTime')), v, x.get('qualifiers') or [])
    return values, factor


def parse_ogc(body, site, parameter):
    try:
        data = json.loads(body)
        features = data['features']
    except (ValueError, KeyError, TypeError) as error:
        raise UsgsFormatError(f'not a Water Data OGC JSON response: {error}') from error
    if not isinstance(features, list):
        raise UsgsFormatError('features is not a list')
    values, conflicts, factor = {}, set(), None
    for f in features:
        p = (f or {}).get('properties') if isinstance(f, dict) else None
        if not isinstance(p, dict):
            raise UsgsFormatError('malformed feature')
        if p.get('monitoring_location_id') != 'USGS-' + site or p.get('parameter_code') != parameter:
            continue
        if p.get('statistic_id') not in (None, '00011'):  # 00011 = instantaneous
            continue
        unit = p.get('unit_of_measure')
        if unit not in UNITS:
            raise UsgsFormatError(f'unknown discharge units {unit!r}')
        if factor is not None and UNITS[unit] != factor:
            raise UsgsFormatError('readings disagree on units')
        factor = UNITS[unit]
        v = reading(p.get('value'))
        if v is None:
            continue
        status = p.get('approval_status')
        quals = ['P'] if status == 'Provisional' else ['A'] if status == 'Approved' else []
        extra = p.get('qualifier')
        quals += extra if isinstance(extra, list) else [extra] if isinstance(extra, str) else []
        add(values, conflicts, utc_naive(p.get('time')), v, quals)
    return values, factor


def at(values, t):
    """Instantaneous value at t; straight line between the two neighbours within 15 min. None if not bracketed."""
    if t in values:
        return values[t]['value'], values[t]['qualifiers']
    before = [k for k in values if k < t and t - k <= BRACKET]
    after = [k for k in values if k > t and k - t <= BRACKET]
    if not before or not after:
        return None, None
    a, b = max(before), min(after); w = (t - a) / (b - a)
    quals = sorted(set(values[a]['qualifiers']) | set(values[b]['qualifiers']))
    return values[a]['value'] + w * (values[b]['value'] - values[a]['value']), quals


def http_get(url, headers=None, timeout=30):
    """(HTTP status or None, body bytes or None, error text or None). Never raises."""
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers=headers or {}), timeout=timeout) as r:
            return r.status, r.read(), None
    except urllib.error.HTTPError as error:
        return error.code, None, f'HTTP {error.code}'
    except (OSError, ValueError) as error:
        return None, None, f'{type(error).__name__}: {error}'


def requests_for(site, parameter, first, last):
    s, e = first.strftime('%Y-%m-%dT%H:%MZ'), last.strftime('%Y-%m-%dT%H:%MZ')
    nwis = NWIS + '?' + urllib.parse.urlencode({'format': 'json', 'sites': site, 'parameterCd': parameter, 'startDT': s, 'endDT': e}, safe=':')
    ogc = OGC + '?' + urllib.parse.urlencode({'f': 'json', 'monitoring_location_id': 'USGS-' + site, 'parameter_code': parameter,
                                              'time': f'{ISO(first)}/{ISO(last)}', 'limit': 10000}, safe=':/')
    key = os.environ.get('USGS_API_KEY')
    return [('USGS NWIS IV', nwis, parse_nwis, {}), ('USGS Water Data OGC API', ogc, parse_ogc, {'X-Api-Key': key} if key else {})]


def observed_flows(observed, start, hours, cycle, nwm, get=None, now=None):
    """Replace the past hours of one inlet's NWM series with USGS readings where they exist.

    observed: the registry inlet's "observed" object. nwm: the complete verified NWM series
    (hours + 1 values, analysis then short range). Returns (values, provenance)."""
    site, parameter = str(observed['usgsSite']), str(observed.get('parameterCd', '00060'))
    get = get or http_get
    if len(nwm) != hours + 1:
        raise ValueError('NWM series does not cover the forcing window')
    times = [start + dt.timedelta(hours=k) for k in range(hours + 1)]
    past = [t for t in times if t <= cycle]
    fetched = ISO(now or dt.datetime.now(dt.timezone.utc))
    attempts, values, factor, used = [], {}, None, None
    if past:
        for provider, url, parse, headers in requests_for(site, parameter, past[0] - BRACKET, past[-1] + BRACKET):
            status, body, error = get(url, headers)
            attempt = {'provider': provider, 'url': url, 'httpStatus': status, 'fetchedAt': fetched}
            if body is not None:
                attempt.update(bytes=len(body), sha256=hashlib.sha256(body).hexdigest())
                try:
                    got, unit_factor = parse(body, site, parameter)
                    in_window = {t: v for t, v in got.items() if past[0] - BRACKET <= t <= past[-1] + BRACKET}
                    attempt.update(readings=len(in_window), unitFactorM3s=unit_factor)
                    if in_window:
                        values, factor, used = in_window, unit_factor, provider
                        attempts.append(attempt); break
                    attempt['error'] = 'no valid readings in the requested window'
                except UsgsFormatError as e:
                    attempt['error'] = f'malformed: {e}'
            else:
                attempt['error'] = error
            attempts.append(attempt)
    out, hourly = [], []
    for k, t in enumerate(times):
        if t > cycle:
            out.append(nwm[k]); hourly.append({'time': ISO(t), 'source': 'nwm', 'reason': 'forecast_hour'}); continue
        v, quals = at(values, t) if values else (None, None)
        if v is None:
            out.append(nwm[k]); hourly.append({'time': ISO(t), 'source': 'nwm', 'reason': 'no_valid_usgs_value', 'flagged': True}); continue
        q = round(v * factor, 6)
        out.append(q)
        hourly.append({'time': ISO(t), 'source': 'usgs', 'qualifiers': quals, 'provisional': 'P' in quals})
    usgs_hours = sum(h['source'] == 'usgs' for h in hourly)
    fallback = sum(h.get('reason') == 'no_valid_usgs_value' for h in hourly)
    provisional = sum(bool(h.get('provisional')) for h in hourly)
    reached = any(a.get('httpStatus') == 200 and 'readings' in a for a in attempts)
    if not past:
        status = 'no_past_hours'
    elif usgs_hours == len(past):
        status = 'observed'
    elif usgs_hours:
        status = 'partial'
    elif reached:
        status = 'stale'  # the service answered but had no usable reading in the window
    else:
        status = 'unavailable'
    newest = max(values) if values else None
    if status == 'observed':
        note = f'USGS {site} observed discharge for all {usgs_hours} past hours'
    elif status == 'partial':
        note = f'USGS {site} observed discharge for {usgs_hours} of {len(past)} past hours; {fallback} hours with no valid USGS value use NWM (flagged)'
    elif status == 'stale':
        note = f'USGS {site} had no valid reading in the past window; NWM used for all hours'
    elif status == 'unavailable':
        note = f'USGS {site} could not be read; NWM used for all hours'
    else:
        note = 'No past hours in the window; NWM used for all hours'
    if provisional:
        note += f' ({provisional} provisional hours, subject to revision)'
    return out, {
        'provider': used, 'usgsSite': site, 'parameterCd': parameter, 'status': status, 'fetchedAt': fetched,
        'requests': attempts, 'httpStatus': attempts[-1]['httpStatus'] if attempts else None,
        'counts': {'hours': len(times), 'pastHours': len(past), 'usgsHours': usgs_hours, 'nwmFallbackHours': fallback,
                   'nwmForecastHours': len(times) - len(past), 'provisionalHours': provisional},
        'provisional': provisional > 0, 'newestReading': ISO(newest) if newest else None,
        'method': ('Past hours (at or before the HRRR cycle): USGS instantaneous discharge at the top of the hour, or the straight line '
                   'between the two readings within 15 minutes; cfs x 0.0283168 = m3/s. An hour with no valid USGS value uses that '
                   "hour's NWM value (flagged). Forecast hours: NWM short-range unchanged; no bias correction, no recession added. "
                   'Missing readings are never zero flow.'),
        'note': note, 'hourly': hourly,
    }
