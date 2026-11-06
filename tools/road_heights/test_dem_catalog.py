"""Offline catalog guards: python -m unittest discover -s tools/road_heights -p 'test_*.py'."""
import unittest
from known_dem_tiles import SUPPLEMENTAL_TILES, supplement_tiles


class CatalogTests(unittest.TestCase):
    box = (-111.42, 32.16, -110.93, 32.60)

    def test_missing_verified_tile_added(self):
        self.assertEqual(supplement_tiles([], self.box), list(SUPPLEMENTAL_TILES))

    def test_existing_catalog_record_not_duplicated_or_replaced(self):
        tile = {**SUPPLEMENTAL_TILES[0], 'published': 'newer catalog value'}
        self.assertEqual(supplement_tiles([tile], self.box), [tile])

    def test_out_of_region_requests_unchanged(self):
        self.assertEqual(supplement_tiles([], (-120, 40, -119, 41)), [])

    def test_unrelated_catalog_records_preserved(self):
        other = {'url': 'other', 'project': 'older'}
        self.assertEqual(supplement_tiles([other], self.box), [other, *SUPPLEMENTAL_TILES])
