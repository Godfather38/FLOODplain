"""Offline tests for observed USGS inflow in live all-route runs; no network, no solver."""
import datetime as dt
import json
import os
from pathlib import Path
import unittest
from unittest.mock import patch

import numpy as np

import usgs_flows as usgs

FIXTURES = Path(__file__).parent / 'fixtures'
FROZEN = Path(__file__).resolve().parents[2] / 'tools/sfincs/data/brawley-avra-west-v1'
SITE = {'usgsSite': '09487000', 'parameterCd': '00060'}
NOW = dt.datetime(2026, 11, 8, 12, tzinfo=dt.timezone.utc)
# 18Z Nov 1 to 00Z Nov 2 2026: five past hours up to a 22Z cycle, then two forecast hours.
START, CYCLE, HOURS = dt.datetime(2026, 11, 1, 18), dt.datetime(2026, 11, 1, 22), 6
NWM = [1.0, 1.1, 1.2, 1.3, 1.4, 1.5, 1.6]


def nwis_body():
    return (FIXTURES / 'usgs-nwis-09487000-20261101.json').read_bytes()


def readings(body):
    return json.loads(body)['value']['timeSeries'][0]['values'][0]['value']


def edit(change):
    d = json.loads(nwis_body()); change(d); return json.dumps(d).encode()


def series_values(d):
    return d['value']['timeSeries'][0]['values'][0]['value']


def local_hhmm(x):
    return x['dateTime'][11:16]


class Server:
    """Answers NWIS and OGC requests from canned (status, body, error) tuples."""
    def __init__(self, nwis, ogc=(None, None, 'URLError: offline')):
        self.answers, self.urls, self.headers = {'nwis': nwis, 'ogc': ogc}, [], []

    def __call__(self, url, headers=None):
        self.urls.append(url); self.headers.append(headers or {})
        return self.answers['nwis' if url.startswith(usgs.NWIS) else 'ogc']


def run(server, start=START, hours=HOURS, cycle=CYCLE, nwm=NWM):
    return usgs.observed_flows(SITE, start, hours, cycle, list(nwm), get=server, now=NOW)


class ObservedInflowTests(unittest.TestCase):
    def test_normal_past_hours_use_gauge_and_forecast_keeps_nwm(self):
        server = Server((200, nwis_body(), None))
        q, p = run(server)
        cfs = {local_hhmm(r): float(r['value']) for r in readings(nwis_body())}
        expect = [cfs[f'{h}:00'] for h in (11, 12, 13, 14, 15)]  # 18Z..22Z in MST
        self.assertEqual(q[:5], [round(v * 0.0283168, 6) for v in expect])
        self.assertEqual(q[5:], NWM[5:])  # forecast hours unchanged, no bias correction
        self.assertEqual(p['status'], 'observed')
        self.assertEqual(p['counts'], {'hours': 7, 'pastHours': 5, 'usgsHours': 5, 'nwmFallbackHours': 0,
                                       'nwmForecastHours': 2, 'provisionalHours': 5})
        self.assertTrue(p['provisional']); self.assertIn('provisional', p['note'])
        self.assertEqual(p['provider'], 'USGS NWIS IV'); self.assertEqual(p['httpStatus'], 200)
        self.assertEqual(p['fetchedAt'], '2026-11-08T12:00:00Z')
        self.assertEqual([h['source'] for h in p['hourly']], ['usgs'] * 5 + ['nwm'] * 2)
        self.assertEqual(p['hourly'][-1]['reason'], 'forecast_hour')
        self.assertEqual(len(server.urls), 1)
        self.assertIn('startDT=2026-11-01T17:45Z', server.urls[0]); self.assertIn('endDT=2026-11-01T22:15Z', server.urls[0])

    def test_units_cfs_converted_once_and_m3s_kept(self):
        q, _ = run(Server((200, nwis_body(), None)))
        self.assertAlmostEqual(q[0], 49.4 * 0.0283168, places=6)
        metric = edit(lambda d: d['value']['timeSeries'][0]['variable']['unit'].update(unitCode='m3/s'))
        q, p = run(Server((200, metric, None)))
        self.assertEqual(q[0], 49.4); self.assertEqual(p['requests'][0]['unitFactorM3s'], 1.0)

    def test_unknown_units_rejected_then_nwm_everywhere(self):
        bad = edit(lambda d: d['value']['timeSeries'][0]['variable']['unit'].update(unitCode='ft'))
        q, p = run(Server((200, bad, None)))
        self.assertEqual(q, NWM); self.assertEqual(p['status'], 'unavailable')
        self.assertIn('unknown discharge units', p['requests'][0]['error'])

    def test_partial_gap_falls_back_to_that_hours_nwm_and_is_flagged(self):
        def gap(d):
            v = series_values(d)
            # 19Z: reading and one neighbour removed (no bracket within 15 min). 20Z: no-data flags.
            v[:] = [x for x in v if local_hhmm(x) not in ('12:00', '12:15')]
            for x in v:
                if local_hhmm(x) in ('13:00', '13:15'): x['value'] = '-999999'
        q, p = run(Server((200, edit(gap), None)))
        self.assertEqual(q[1], NWM[1]); self.assertEqual(q[2], NWM[2])
        self.assertNotIn(0.0, q)
        flagged = [h['time'] for h in p['hourly'] if h.get('flagged')]
        self.assertEqual(flagged, ['2026-11-01T19:00:00Z', '2026-11-01T20:00:00Z'])
        self.assertEqual(p['status'], 'partial'); self.assertEqual(p['counts']['nwmFallbackHours'], 2)
        self.assertEqual(p['counts']['usgsHours'], 3)

    def test_interpolates_only_between_readings_within_15_minutes(self):
        drop_top = lambda d: series_values(d).__setitem__(slice(None), [x for x in series_values(d) if local_hhmm(x) != '12:00'])
        q, p = run(Server((200, edit(drop_top), None)))
        r = {local_hhmm(x): float(x['value']) for x in readings(nwis_body())}
        self.assertAlmostEqual(q[1], round((r['11:45'] + r['12:15']) / 2 * 0.0283168, 6), places=6)
        self.assertEqual(p['hourly'][1]['source'], 'usgs')

    def test_total_outage_uses_nwm_for_all_hours_and_says_so(self):
        server = Server((503, None, 'HTTP 503'), (None, None, 'URLError: timed out'))
        q, p = run(server)
        self.assertEqual(q, NWM); self.assertEqual(p['status'], 'unavailable')
        self.assertIn('could not be read; NWM used for all hours', p['note'])
        self.assertEqual([a['httpStatus'] for a in p['requests']], [503, None])
        self.assertEqual(len(server.urls), 2)  # NWIS, then the OGC API
        self.assertEqual(p['counts']['nwmFallbackHours'], 5)

    def test_malformed_nwis_falls_back_to_ogc_api(self):
        ogc = (FIXTURES / 'usgs-ogc-09487000-20261106.json').read_bytes()
        start, cycle = dt.datetime(2026, 11, 6, 0), dt.datetime(2026, 11, 6, 3)
        server = Server((200, b'<html>maintenance</html>', None), (200, ogc, None))
        q, p = run(server, start=start, hours=4, cycle=cycle, nwm=[5, 5, 5, 5, 5])
        # A reported 0.00 ft3/s is a real zero reading, distinct from missing.
        self.assertEqual(q, [0.0, 0.0, 0.0, 0.0, 5]); self.assertEqual(p['provider'], 'USGS Water Data OGC API')
        self.assertIn('malformed', p['requests'][0]['error']); self.assertTrue(p['provisional'])

    def test_malformed_everywhere_never_zero(self):
        for body in (b'not json', b'{"value": {}}', json.dumps({'value': {'timeSeries': [{'values': 3}]}}).encode()):
            q, p = run(Server((200, body, None), (200, b'{"features": 7}', None)))
            self.assertEqual(q, NWM); self.assertEqual(p['status'], 'unavailable')

    def test_stale_no_data_in_window(self):
        old = edit(lambda d: d['value']['timeSeries'][0]['values'][0].update(value=[]))
        q, p = run(Server((200, old, None), (200, b'{"type":"FeatureCollection","features":[]}', None)))
        self.assertEqual(q, NWM); self.assertEqual(p['status'], 'stale'); self.assertIsNone(p['newestReading'])
        self.assertIn('no valid reading', p['note'])

    def test_readings_outside_the_window_are_stale(self):
        q, p = run(Server((200, nwis_body(), None)), start=dt.datetime(2026, 11, 3, 0), cycle=dt.datetime(2026, 11, 3, 4))
        self.assertEqual(q, NWM); self.assertEqual(p['status'], 'stale')

    def test_wrong_site_is_not_used(self):
        other = edit(lambda d: d['value']['timeSeries'][0]['sourceInfo']['siteCode'][0].update(value='09487100'))
        q, p = run(Server((200, other, None)))
        self.assertEqual(q, NWM); self.assertEqual(p['status'], 'stale')

    def test_conflicting_duplicate_reading_is_missing(self):
        def dup(d):
            v = series_values(d)
            x = dict(next(x for x in v if local_hhmm(x) == '11:00')); x['value'] = '1'; v.append(x)
        q, p = run(Server((200, edit(dup), None)))
        self.assertEqual(q[0], NWM[0]); self.assertTrue(p['hourly'][0]['flagged'])

    def test_api_key_is_a_header_never_in_urls_or_provenance(self):
        with patch.dict(os.environ, {'USGS_API_KEY': 'k-secret-123'}):
            server = Server((503, None, 'HTTP 503'))
            _, p = run(server)
        self.assertNotIn('k-secret-123', json.dumps(p)); self.assertNotIn('k-secret-123', ''.join(server.urls))
        self.assertEqual(server.headers[1], {'X-Api-Key': 'k-secret-123'})

    def test_bad_nwm_length_rejected(self):
        with self.assertRaises(ValueError):
            run(Server((200, nwis_body(), None)), nwm=NWM[:-1])

    @unittest.skipUnless((FROZEN / 'observed/raw/iv_09487000_2026-11-01.json').exists(), 'frozen case data not checked out')
    def test_same_hourly_values_as_the_frozen_observed_variant(self):
        values = {}
        for name in ('iv_09487000_2026-10-30.json', 'iv_09487000_2026-11-01.json'):
            got, factor = usgs.parse_nwis((FROZEN / 'observed/raw' / name).read_bytes(), '09487000', '00060')
            values.update(got)
        n = 0
        for part in ('history', 'forecast'):
            for x in json.loads((FROZEN / f'brawley-avra-west-{part}-observed.json').read_text())['series'][0]['points']:
                v, _ = usgs.at(values, dt.datetime.fromisoformat(x['time'][:-1]))
                self.assertEqual(round(v * factor, 6), x['flowM3s'], x['time']); n += 1
        self.assertEqual(n, 65)


class PrepareAndExportTests(unittest.TestCase):
    """run_live_all_route.prepare with offline stand-ins for the case archive, HRRR and NWM."""
    CYCLE = dt.datetime(2026, 11, 1, 22)

    def prepare(self, inlets, server):
        import tempfile
        import h5py
        import numpy as np
        import run_live_all_route as live
        tmp = tempfile.TemporaryDirectory(); self.addCleanup(tmp.cleanup)
        work = Path(tmp.name) / 'work'
        hours = live.SPIN + live.AHEAD

        def unpack(c, w):
            with h5py.File(w / 'precip_2d.nc', 'w') as f:
                t = f.create_dataset('time', data=np.zeros(hours)); t.attrs['units'] = np.bytes_('minutes since 2026-10-30T16:00:00')
                f['x'] = np.array([470000., 471000.]); f['y'] = np.array([3570000., 3571000.])
                f.create_dataset('Precipitation', data=np.zeros((hours, 2, 2)))
            (w / 'sfincs.inp').write_text('tref                 = 20261030 160000\ndtout                = 900\n')

        def nwm(reach, start, n, sources, reaches):
            sources.append({'provider': 'NWPS', 'reachId': reach})
            return [0.5] * (n + 1), 0
        case = {'case': 'test-case', 'modelVersion': 'test-v1', 'archiveSha256': 'a', 'inlets': inlets}
        with patch.object(live, 'case_entry', return_value=case), patch.object(live, 'unpack', unpack), \
                patch.object(live, 'apcp_hour', return_value=(None, None, None)), \
                patch.object(live, 'regrid', return_value=np.zeros((2, 2))), \
                patch.object(live, 'nwm_hourly', nwm), patch.object(usgs, 'http_get', server):
            live.prepare('test-case', work, live.ISO(self.CYCLE))
        dis = np.loadtxt(work / 'sfincs.dis')
        return json.loads((work / 'live-case.json').read_text()), dis, live.SPIN

    def test_observed_inlet_replaces_only_past_hours_and_records_provenance(self):
        inlets = [{'reachId': '15876941', 'x': 0, 'y': 0, 'observed': SITE}, {'reachId': '1', 'x': 0, 'y': 0}]
        meta, dis, spin = self.prepare(inlets, Server((200, nwis_body(), None)))
        self.assertEqual(dis.shape, (64, 3))
        # 18Z..22Z (rows 41..45) are the gauge; earlier past hours have no reading in the fixture -> NWM, flagged.
        cfs = {local_hhmm(r): float(r['value']) for r in readings(nwis_body())}
        np.testing.assert_allclose(dis[41:46, 1], [round(cfs[f'{h}:00'] * 0.0283168, 6) for h in (11, 12, 13, 14, 15)], atol=1e-6)
        np.testing.assert_allclose(dis[:41, 1], 0.5); np.testing.assert_allclose(dis[46:, 1], 0.5)
        np.testing.assert_allclose(dis[:, 2], 0.5)
        src = meta['inflowSource']
        self.assertEqual(src[0]['source'], 'usgs+nwm'); self.assertEqual(src[0]['usgsStatus'], 'partial')
        self.assertEqual((src[0]['usgsHours'], src[0]['nwmFallbackHours'], src[0]['nwmForecastHours']), (5, 41, 18))
        self.assertTrue(src[0]['provisional']); self.assertEqual(src[0]['httpStatus'], 200)
        self.assertEqual(src[1], {'reachId': '1', 'source': 'nwm', 'nwmProvider': 'NWPS'})
        self.assertEqual(len(meta['flowSources'][0]['observed']['hourly']), 64)
        self.assertIn('USGS 09487000', meta['method'])
        self.assertTrue(any('15876941' in n for n in meta['flowNotes']))

    def test_usgs_outage_runs_on_nwm_and_metadata_says_so(self):
        inlets = [{'reachId': '15876941', 'x': 0, 'y': 0, 'observed': SITE}]
        meta, dis, _ = self.prepare(inlets, Server((500, None, 'HTTP 500'), (None, None, 'URLError: offline')))
        np.testing.assert_allclose(dis[:, 1], 0.5)
        self.assertEqual(meta['inflowSource'][0]['source'], 'nwm')
        self.assertEqual(meta['inflowSource'][0]['usgsStatus'], 'unavailable')
        self.assertIn('NWM used for all hours', meta['inflowSource'][0]['note'])

    def test_inflow_source_reaches_both_road_files(self):
        import tempfile
        import numpy as np
        import test_export_road_forecast as roads
        import test_local_road_forecast as localroads
        src = [{'reachId': '15876941', 'source': 'usgs+nwm', 'usgsStatus': 'observed'}]
        with tempfile.TemporaryDirectory() as tmp:
            f = roads.forecast(); f.add_frame('2026-11-06T12:00:00Z', np.zeros(3), np.zeros(3))
            f.write(Path(tmp) / 'r.json', roads.manifest(f.times) | {'inflowSource': src})
            self.assertEqual(json.loads((Path(tmp) / 'r.json').read_text())['inflowSource'], src)
            g = localroads.local([localroads.st('a')])
            for t in localroads.T: g.add_frame(t, np.zeros(3), np.zeros(3))
            g.write(Path(tmp) / 'l.json', localroads.manifest(localroads.T) | {'inflowSource': src})
            data = json.loads((Path(tmp) / 'l.json').read_text())
            # Full list or a condensed object: either way it names the gauged inlet and its source.
            for where in (data['inflowSource'], data['summary'].get('inflowSource', data['inflowSource'])):
                self.assertIn('15876941', json.dumps(where)); self.assertIn('usgs+nwm', json.dumps(where))
            # A package without inflow provenance never claims a USGS source.
            g.write(Path(tmp) / 'l.json', localroads.manifest(localroads.T))
            self.assertNotIn('usgs', json.dumps(json.loads((Path(tmp) / 'l.json').read_text()).get('inflowSource')))


if __name__ == '__main__':
    unittest.main()
