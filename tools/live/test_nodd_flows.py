"""Offline checks for original NOAA NODD data and NWPS fallback selection."""
import datetime as dt
import io
import json
from pathlib import Path
import unittest
from unittest.mock import patch

import h5py
import numpy as np
import nodd_flows as nodd
import run_live_sfincs as live

CYCLE = dt.datetime(2026, 11, 6, 6)
VALID = CYCLE + dt.timedelta(hours=1)
URL, CONFIG, REF = nodd.source_file(VALID, CYCLE)
REACHES = ['15902351', '15902387']


def netcdf(config='short_range', reference=CYCLE, valid=VALID, units='m3 s-1', values=None, ids=None):
    buf = io.BytesIO()
    with h5py.File(buf, 'w') as f:
        f.attrs['model_configuration'] = config
        f.attrs['model_output_type'] = 'channel_rt'
        for key, value in [('time', valid), ('reference_time', reference)]:
            d = f.create_dataset(key, data=[int((value - dt.datetime(1970, 1, 1)).total_seconds() / 60)])
            d.attrs['units'] = 'minutes since 1970-01-01 00:00:00 UTC'
        f.create_dataset('feature_id', data=np.array(ids if ids is not None else [15902351, 15902387], dtype='i8'))
        d = f.create_dataset('streamflow', data=np.array(values if values is not None else [0, 60], dtype='f8'))
        d.attrs['units'] = units
        d.attrs['scale_factor'] = .01
        d.attrs['add_offset'] = 0.
        d.attrs['_FillValue'] = -999900
        d.attrs['missing_value'] = -999900
        d.attrs['valid_range'] = [0, 5000000]
    return buf.getvalue()


class BytesSource(io.BytesIO):
    bytes_read = 0
    etag = '"fixture"'
    def __init__(self, data):
        super().__init__(data); self.size=len(data)


class NoddTests(unittest.TestCase):
    def setUp(self):
        nodd._RECORDS.clear()

    def read(self, **kw):
        with patch.object(nodd, 'RangeFile', side_effect=lambda u: BytesSource(netcdf(**kw))):
            return nodd.read_channel(URL, CONFIG, REF, VALID, REACHES)

    def test_actual_netcdf_contract_scaled_flow_zero_and_provenance(self):
        values, info = self.read()
        self.assertEqual(values, {'15902351': 0., '15902387': .6})
        self.assertEqual(info['validTime'], '2026-11-06T07:00:00Z')
        self.assertEqual(info['referenceTime'], '2026-11-06T06:00:00Z')
        self.assertEqual(info['url'], URL)
        self.assertEqual(info['etag'], '"fixture"')
        self.assertGreater(info['contentLength'], 0)

    def test_reject_wrong_config_cycle_time_or_units(self):
        for kw in [{'config': 'medium_range'}, {'reference': CYCLE - dt.timedelta(hours=1)},
                   {'valid': VALID - dt.timedelta(hours=1)}, {'units': 'ft3/s'}]:
            with self.subTest(kw=kw), self.assertRaises(ValueError):
                self.read(**kw)
        self.assertFalse(nodd._RECORDS)

    def test_reject_missing_nonfinite_negative_and_out_of_range(self):
        for value in [-999900, float('nan'), float('inf'), -1, 5000001]:
            with self.subTest(value=value), self.assertRaises(ValueError):
                self.read(values=[0, value])
        self.assertFalse(nodd._RECORDS)

    def test_missing_or_duplicate_reach_is_never_zero(self):
        for ids in [[15902351, 1], [15902351, 15902351]]:
            with self.subTest(ids=ids), self.assertRaises(ValueError):
                self.read(ids=ids)

    def test_cached_index_is_checked_against_each_file(self):
        self.read()
        u2 = URL.replace('f001', 'f002')
        with patch.object(nodd, 'RangeFile', side_effect=lambda u: BytesSource(netcdf(valid=VALID+dt.timedelta(hours=1), ids=[15902387,15902351], values=[70,10]))):
            values, _ = nodd.read_channel(u2, CONFIG, REF, VALID+dt.timedelta(hours=1), REACHES)
        self.assertAlmostEqual(values['15902351'], .1)
        self.assertAlmostEqual(values['15902387'], .7)

    def test_duplicate_in_later_file_is_rejected_even_when_first_positions_match(self):
        self.read()
        u2 = URL.replace('f001', 'f002')
        with patch.object(nodd, 'RangeFile', side_effect=lambda u: BytesSource(netcdf(valid=VALID+dt.timedelta(hours=1), ids=[15902351,15902387,15902351], values=[0,60,0]))):
            with self.assertRaisesRegex(ValueError, 'absent or duplicated'):
                nodd.read_channel(u2, CONFIG, REF, VALID+dt.timedelta(hours=1), REACHES)

    def test_cached_url_cannot_bypass_different_expected_times_or_config(self):
        self.read()
        for config,reference,valid in [('analysis_and_assimilation',REF,VALID), (CONFIG,REF-dt.timedelta(hours=1),VALID), (CONFIG,REF,VALID+dt.timedelta(hours=1))]:
            with self.subTest(config=config,reference=reference,valid=valid):
                with patch.object(nodd, 'RangeFile', side_effect=lambda u: BytesSource(netcdf())):
                    with self.assertRaises(ValueError):
                        nodd.read_channel(URL, config, reference, valid, REACHES)

    def test_actual_file_patterns_include_midnight_and_analysis(self):
        url, config, ref = nodd.source_file(CYCLE, CYCLE)
        self.assertTrue(url.endswith('nwm.20261106/analysis_assim/nwm.t06z.analysis_assim.channel_rt.tm00.conus.nc'))
        self.assertEqual((config,ref),('analysis_and_assimilation',CYCLE-dt.timedelta(hours=3)))
        url, _, _ = nodd.source_file(CYCLE+dt.timedelta(hours=18),CYCLE)
        self.assertIn('f018',url)
        with self.assertRaises(ValueError): nodd.source_file(CYCLE+dt.timedelta(hours=19),CYCLE)

    def test_full_window_and_cache_shared_across_case_reaches(self):
        def window(jobs):
            return [({'15902351': 0., '15902387': .6}, {'url': j[0], 'validTime': nodd.stamp(j[3])}) for j in jobs]
        with patch.object(nodd, 'load_window', side_effect=window) as load:
            values, info = nodd.hourly(REACHES[0], CYCLE, 2, CYCLE, REACHES)
            other, _ = nodd.hourly(REACHES[1], CYCLE, 2, CYCLE, REACHES)
        self.assertEqual(values,[0,0,0]); self.assertEqual(other,[.6,.6,.6])
        self.assertEqual(load.call_count,1); self.assertEqual(len(info['files']),3)

    def test_missing_hour_aborts_without_caching_partial_window(self):
        with patch.object(nodd, 'load_window', side_effect=ValueError('missing hour')):
            with self.assertRaisesRegex(RuntimeError, 'could not be verified'):
                nodd.hourly(REACHES[0], CYCLE, 2, CYCLE, REACHES)
        self.assertFalse(nodd._RECORDS)

    def test_valid_nwps_does_not_call_fallback(self):
        sources=[]
        with patch.object(live,'nwps_hourly',return_value=([0,1],0)), patch.object(nodd,'hourly') as raw:
            self.assertEqual(live.nwm_hourly(REACHES[0],CYCLE,1,sources),([0,1],0))
        raw.assert_not_called(); self.assertEqual(sources[0]['provider'],'NWPS')

    def test_nwps_failure_uses_verified_fallback_and_keeps_source(self):
        sources=[]
        with patch.object(live,'nwps_hourly',side_effect=live.NwmInputError('shortRange.series missing')), patch.object(nodd,'hourly',return_value=([0,.6],{'provider':'NOAA NODD'})):
            self.assertEqual(live.nwm_hourly(REACHES[0],CYCLE,1,sources),([0,.6],0))
        self.assertEqual(sources[0]['provider'],'NOAA NODD')
        self.assertIn('shortRange.series',sources[0]['nwpsIssue'])

    def test_both_sources_fail_without_any_dry_substitute(self):
        with patch.object(live,'nwps_hourly',side_effect=live.NwmInputError('NWPS empty')), patch.object(nodd,'hourly',side_effect=RuntimeError('NODD missing')):
            with self.assertRaisesRegex(live.NwmInputError,'NWPS empty.*NODD missing'):
                live.nwm_hourly(REACHES[0],CYCLE,1)


class Response(io.BytesIO):
    def __init__(self, data=b'', status=200, **headers):
        super().__init__(data); self.status=status; self.headers=headers


class RangeReaderTests(unittest.TestCase):
    def test_exact_ranges_etag_seek_readinto_and_cache(self):
        payload=b'abcdefghij';requests=[]
        def open_url(request,**kw):
            requests.append(request)
            if request.get_method()=='HEAD':return Response(**{'Content-Length':'10','ETag':'"fixed"'})
            self.assertEqual(request.headers['Range'],'bytes=0-9')
            self.assertEqual(request.headers['If-match'],'"fixed"')
            return Response(payload,206,**{'Content-Range':'bytes 0-9/10'})
        with patch.object(nodd.urllib.request,'urlopen',side_effect=open_url):
            with nodd.RangeFile(URL) as f:
                self.assertEqual(f.read(3),b'abc');f.seek(-2,2);b=bytearray(4)
                self.assertEqual(f.readinto(b),2);self.assertEqual(b[:2],b'ij');f.seek(0)
                self.assertEqual(f.read(),payload);self.assertEqual(f.bytes_read,10)
        self.assertEqual(len(requests),2)

    def test_head_publication_gap_retries_same_object_then_validates(self):
        missing = lambda: nodd.urllib.error.HTTPError(URL, 404, 'Not Found', {}, None)
        responses = [missing(), missing(), Response(**{'Content-Length': '10', 'ETag': '"fixed"'})]
        with patch.object(nodd.urllib.request, 'urlopen', side_effect=responses) as request, patch.object(nodd.time, 'sleep') as sleep:
            with nodd.RangeFile(URL) as source:
                self.assertEqual((source.url, source.size, source.etag), (URL, 10, '"fixed"'))
        self.assertEqual(request.call_count, 3)
        for call in request.call_args_list:
            self.assertEqual(call.args[0].full_url, URL)
            self.assertEqual(call.args[0].get_method(), 'HEAD')
            self.assertEqual(call.kwargs['timeout'], 30)
        self.assertEqual([call.args[0] for call in sleep.call_args_list], [15, 45])

    def test_head_permanent_absence_is_bounded_and_never_cached(self):
        missing = nodd.urllib.error.HTTPError(URL, 404, 'Not Found', {}, None)
        nodd._RECORDS.clear()
        with patch.object(nodd.urllib.request, 'urlopen', side_effect=missing) as request, patch.object(nodd.time, 'sleep') as sleep:
            with self.assertRaisesRegex(RuntimeError, '404.*Source:'):
                nodd.read_channel_args((URL, CONFIG, REF, VALID, REACHES))
        self.assertEqual(request.call_count, 3)
        self.assertEqual(sleep.call_count, 2)
        self.assertFalse(nodd._RECORDS)

    def test_head_transient_network_and_server_errors_are_retried(self):
        errors = [nodd.urllib.error.URLError('connection reset'), TimeoutError('timed out')]
        errors += [nodd.urllib.error.HTTPError(URL, code, 'Unavailable', {}, None)
                   for code in [408, 429, 500, 502, 503, 504]]
        for error in errors:
            with self.subTest(error=error):
                response = Response(**{'Content-Length': '10', 'ETag': '"fixed"'})
                with patch.object(nodd.urllib.request, 'urlopen', side_effect=[error, response]) as request, patch.object(nodd.time, 'sleep') as sleep:
                    with nodd.RangeFile(URL) as source:
                        self.assertEqual(source.size, 10)
                self.assertEqual(request.call_count, 2)
                sleep.assert_called_once_with(15)

    def test_head_other_http_errors_do_not_wait_for_publication(self):
        for status in [401, 403, 412]:
            with self.subTest(status=status):
                error = nodd.urllib.error.HTTPError(URL, status, 'Rejected', {}, None)
                with patch.object(nodd.urllib.request, 'urlopen', side_effect=error) as request, patch.object(nodd.time, 'sleep') as sleep:
                    with self.assertRaises(nodd.urllib.error.HTTPError):
                        nodd.RangeFile(URL)
                self.assertEqual(request.call_count, 1)
                sleep.assert_not_called()

    def test_head_retry_does_not_accept_invalid_metadata(self):
        for headers in [{'Content-Length': '10'}, {'Content-Length': '0', 'ETag': '"fixed"'}]:
            with self.subTest(headers=headers):
                missing = nodd.urllib.error.HTTPError(URL, 404, 'Not Found', {}, None)
                with patch.object(nodd.urllib.request, 'urlopen', side_effect=[missing, Response(**headers)]) as request, patch.object(nodd.time, 'sleep') as sleep:
                    with self.assertRaises(ValueError):
                        nodd.RangeFile(URL)
                self.assertEqual(request.call_count, 2)
                sleep.assert_called_once_with(15)

    def test_ignored_range_or_truncated_bytes_rejected(self):
        for result in [Response(b'abc',200),Response(b'abc',206,**{'Content-Range':'bytes 0-9/10'})]:
            with self.subTest(status=result.status):
                with patch.object(nodd.urllib.request,'urlopen',side_effect=[Response(**{'Content-Length':'10','ETag':'"x"'}),result]), patch.object(nodd.time,'sleep',side_effect=ValueError('retry stopped')):
                    with nodd.RangeFile(URL) as f:
                        with self.assertRaises(ValueError):f.read(10)


if __name__=='__main__':unittest.main()
