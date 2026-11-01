"""Offline decoder tests against original public binary fixtures (not synthetic CSV)."""
import gzip
import importlib.util
import io
import json
import struct
import unittest
import sys
from pathlib import Path
sys.path.insert(0,'tools/simulation')

import eccodes as ec
from PIL import Image

spec = importlib.util.spec_from_file_location("decode_rainfall", "tools/simulation/decode_rainfall.py")
decoder = importlib.util.module_from_spec(spec)
spec.loader.exec_module(decoder)


class RadarFixtureTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.terrain = json.loads(Path("public/simulation/data/terrain.json").read_text())
        cls.grib_path = "test/fixtures/mrms/MRMS_PrecipRate_00.00_20201014-000000.grib2.gz"

    def test_real_grib_decode_matches_recorded_normalized_input(self):
        decoded = decoder.decode_mrms(self.grib_path, self.terrain)
        stored = json.loads(Path("public/simulation/data/rainfall-mrms-20201014.json").read_text())
        self.assertEqual(decoded["frames"], stored["frames"])
        self.assertEqual(decoded["grid"], stored["grid"])
        self.assertEqual(decoded["provenance"]["grib"]["packingType"], "grid_png")
        self.assertEqual(decoded["provenance"]["original"]["sha256"], stored["provenance"]["original"]["sha256"])
        self.assertEqual(decoded["frames"][0]["start"], "2020-10-14T00:00:00Z")
        self.assertTrue(all(v == 0 for v in decoded["frames"][0]["rates"]))

    def test_independent_png_packing_crosscheck_includes_wet_and_missing_pixels(self):
        raw = gzip.open(self.grib_path, "rb").read()
        sections, offset = {}, 16
        while raw[offset:offset + 4] != b"7777":
            size = int.from_bytes(raw[offset:offset + 4], "big")
            self.assertGreaterEqual(size, 5)
            sections[raw[offset + 4]] = raw[offset:offset + size]
            offset += size
        representation = sections[5]
        self.assertEqual(int.from_bytes(representation[9:11], "big"), 41)
        reference = struct.unpack(">f", representation[11:15])[0]
        def signed_scale(data):
            value = int.from_bytes(data, "big")
            return -(value & 0x7fff) if value & 0x8000 else value
        binary_scale = signed_scale(representation[15:17])
        decimal_scale = signed_scale(representation[17:19])
        handle = ec.codes_new_from_message(raw)
        try:
            with Image.open(io.BytesIO(sections[7][5:])) as image:
                self.assertEqual(image.size, (7000, 3500))
                anchors = [(0, 0, -3), (955, 4557, 103.8), (2253, 1870, 0)]
                values = ec.codes_get_elements(handle, "values", [row * 7000 + col for row, col, _ in anchors])
                for (row, col, expected), value in zip(anchors, values):
                    independently_decoded = (reference + image.getpixel((col, row)) * 2 ** binary_scale) * 10 ** (-decimal_scale)
                    self.assertAlmostEqual(independently_decoded, expected, places=8)
                    self.assertAlmostEqual(value, expected, places=8)
        finally:
            ec.codes_release(handle)

    def test_real_2014_hour_decodes_indexed_depth_and_preceding_interval(self):
        decoded = decoder.decode_iem_hour("test/fixtures/iem/p1h_201409081800.png", "test/fixtures/iem/p1h_201409081800.wld", self.terrain)
        stored = json.loads(Path("public/simulation/data/rainfall-iem-201409081800.json").read_text())
        self.assertEqual(decoded, stored)
        frame = decoded["frames"][0]
        self.assertEqual(frame["start"], "2014-09-08T17:00:00Z")
        self.assertEqual(frame["durationMinutes"], 60)
        self.assertEqual((min(frame["rates"]), max(frame["rates"])), (10, 19))
        self.assertEqual(decoded['provenance']['effectiveNativeCenterTransform'],[.01,0,0,-.01,-129.995,54.995])
        with Image.open("test/fixtures/iem/p1h_201409081800.png") as image:
            self.assertEqual(image.mode, "P")
            self.assertEqual(image.getpixel((1870, 2253)), 10)
            self.assertEqual(decoder.iem_mm(10), 2.5)
            self.assertEqual(decoder.legacy2014_mm(10),10)
            self.assertIsNone(decoder.legacy2014_mm(0))

    def test_quantization_breakpoints_and_missing_are_not_zero(self):
        for index, expected in [(0, 0), (100, 25), (101, 26.25), (180, 125), (181, 130), (254, 495), (255, None)]:
            self.assertEqual(decoder.iem_mm(index), expected)
        with self.assertRaises(ValueError):
            decoder.rain_envelope(self.terrain, "test", "test", decoder.dt.datetime.now(decoder.UTC), 60, [None], {})
        for rate in [-3, -1, float("nan")]:
            with self.assertRaises(ValueError):
                decoder.rain_envelope(self.terrain, "test", "test", decoder.dt.datetime.now(decoder.UTC), 2, [rate], {})

    def test_center_orientation_and_outside_domain(self):
        self.assertEqual(decoder.nearest_pixel(-111.30, 32.47, -130, 55, .01, -.01, 7000, 3500), (2253, 1870))
        with self.assertRaises(ValueError):
            decoder.nearest_pixel(-140, 32, -130, 55, .01, -.01, 7000, 3500)
        with self.assertRaises(ValueError):
            decoder.nearest_pixel(-111, 32, -130, 55, .01, .01, 7000, 3500)

    def test_independent_stage4_binary_has_real_interval_units_and_bitmap(self):
        with open('test/fixtures/stage4/ST4.2014090818.01h.grib','rb') as f:handle=ec.codes_grib_new_from_file(f)
        try:
            self.assertEqual(ec.codes_get(handle,'units'),'kg m**-2')
            self.assertEqual(ec.codes_get(handle,'stepType'),'accum')
            self.assertEqual(ec.codes_get(handle,'endStep')-ec.codes_get(handle,'startStep'),1)
            self.assertEqual(ec.codes_get(handle,'validityDate'),20140908)
            self.assertEqual(ec.codes_get(handle,'validityTime'),1800)
            self.assertEqual(ec.codes_get(handle,'bitmapPresent'),1)
            sample=ec.codes_grib_find_nearest(handle,32.4715888889,-111.3019666667,npoints=1)[0]
            self.assertAlmostEqual(sample['value'],16.25)
        finally:ec.codes_release(handle)


if __name__ == "__main__":
    unittest.main()
