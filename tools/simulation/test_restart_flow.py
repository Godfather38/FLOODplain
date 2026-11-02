import unittest
from types import SimpleNamespace
import struct
import numpy as np
import xarray as xr
from export_brawley_flow import restart, physical_edges


class RestartTests(unittest.TestCase):
    def test_record_markers_and_signed_float_values(self):
        records = [np.array([1], dtype='<i4'), np.array([602.25], dtype='<f4'),
                   np.array([-.125, .25, 0], dtype='<f4'), np.array([0], dtype='<f4')]
        data = b''.join(struct.pack('<i', a.nbytes) + a.tobytes() + struct.pack('<i', a.nbytes) for a in records)
        self.assertEqual(restart(SimpleNamespace(read_bytes=lambda: data))[1].tolist(), [-.125, .25, 0])
        with self.assertRaises(ValueError):
            restart(SimpleNamespace(read_bytes=lambda: data[:-1]))

    def test_cell_then_right_then_above_split_edge_order(self):
        values = {'mask':[1,1,1], 'mu':[1,0,0], 'mu1':[2,0,0], 'mu2':[3,0,0],
                  'nu':[0,0,0], 'nu1':[3,3,0], 'nu2':[0,0,0]}
        grid = xr.Dataset({k: ('face', v) for k,v in values.items()})
        self.assertEqual(physical_edges(grid).tolist(), [[0,1,0],[0,2,0],[0,2,1],[1,2,1]])
        grid['mask'].values[1] = 0
        with self.assertRaises(ValueError):
            physical_edges(grid)


if __name__ == '__main__':
    unittest.main()
