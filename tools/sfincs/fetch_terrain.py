"""Fetch a bounded raw USGS 3DEP elevation crop; never a rendered hillshade."""
import argparse
import datetime as dt
import hashlib
import json
import math
from pathlib import Path

import numpy as np
import rasterio
import requests
from pyproj import Transformer

SERVICE = "https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer"
BOUNDS = [-111.34, 32.40, -111.27, 32.49]


def fetch(root):
    root = Path(root)
    root.mkdir(parents=True, exist_ok=True)
    if (root / "terrain.tif").exists():
        raise FileExistsError("Terrain already exists; retain cached evidence or use a new directory")
    transform = Transformer.from_crs(4326, 32612, always_xy=True)
    corners = [transform.transform(x, y) for x in BOUNDS[::2] for y in BOUNDS[1::2]]
    resolution = 100
    xmin, ymin = [math.floor(min(p[i] for p in corners) / resolution) * resolution for i in (0, 1)]
    xmax, ymax = [math.ceil(max(p[i] for p in corners) / resolution) * resolution for i in (0, 1)]
    width, height = int((xmax-xmin)/resolution), int((ymax-ymin)/resolution)
    params = {"f": "json", "bbox": f"{xmin},{ymin},{xmax},{ymax}", "bboxSR": 32612,
              "imageSR": 32612, "size": f"{width},{height}", "format": "tiff",
              "pixelType": "F32", "interpolation": "RSP_BilinearInterpolation",
              "renderingRule": json.dumps({"rasterFunction": "None"})}
    response = requests.get(SERVICE + "/exportImage", params=params, timeout=90)
    response.raise_for_status()
    result = response.json()
    if "error" in result or "href" not in result:
        raise ValueError(result)
    # The service supplies its own data URL. Restrict it to the official host.
    from urllib.parse import urlparse
    if urlparse(result["href"]).hostname != "elevation.nationalmap.gov":
        raise ValueError("Unexpected export download host")
    with requests.get(result["href"], stream=True, timeout=90) as data:
        data.raise_for_status()
        content = bytearray()
        for chunk in data.iter_content(65536):
            content.extend(chunk)
            if len(content) > 5_000_000:
                raise ValueError("Terrain exceeds 5 MB bound")
    path = root / "terrain.tif"
    path.write_bytes(content)
    with rasterio.open(path) as raster:
        z = raster.read(1, masked=True)
        if raster.count != 1 or raster.dtypes[0] != "float32" or raster.crs.to_epsg() != 32612:
            raise ValueError("Expected one raw float elevation band in EPSG:32612")
        if raster.width != width or raster.height != height or not np.allclose(raster.res, [100, 100]):
            raise ValueError("Unexpected terrain grid dimensions/resolution")
        if np.ma.getmaskarray(z).any() or not np.isfinite(z.data).all():
            raise ValueError("Terrain contains missing elevation; no automatic filling")
        if z.min() < 400 or z.max() > 1000:
            raise ValueError("Elevation outside broad local plausibility bounds")
        stats = {"minM": float(z.min()), "maxM": float(z.max()), "width": width, "height": height,
                 "resolutionM": resolution, "boundsProjected": list(raster.bounds)}
    query = {"f": "json", "geometry": ",".join(map(str, BOUNDS)), "geometryType": "esriGeometryEnvelope",
             "inSR": 4326, "spatialRel": "esriSpatialRelIntersects", "returnGeometry": "false",
             "outFields": "OBJECTID,Name,VerticalDatum,AcquisitionDate,Source,URL,Resolution_X,Resolution_Y",
             "where": "Category=1", "orderByFields": "OBJECTID", "resultRecordCount": 100}
    metadata_response = requests.get(SERVICE + "/query", params=query, timeout=60)
    metadata_response.raise_for_status()
    metadata = metadata_response.json()
    (root / "catalog.json").write_text(json.dumps(metadata, indent=2) + "\n")
    manifest = {"source": "USGS 3DEP dynamic raw elevation service", "service": SERVICE,
                "requestUrl": response.url, "exportResponse": result,
                "retrievedAt": dt.datetime.now(dt.timezone.utc).isoformat(),
                "sha256": hashlib.sha256(content).hexdigest(), "bytes": len(content),
                "crs": "EPSG:32612", "requestedWgs84Bounds": BOUNDS,
                "verticalUnits": "m", "verticalDatum": "Requires review of catalog metadata; no datum conversion applied",
                "statistics": stats, "interpolation": "server bilinear, 100 m grid",
                "limitations": ["Contemporary terrain, not surveyed September 2014 geometry",
                                "100 m cells cannot resolve bridge or culvert openings",
                                "No hydrologic conditioning or missing-elevation filling"]}
    (root / "terrain.json").write_text(json.dumps(manifest, indent=2) + "\n")
    print(json.dumps(stats))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("root")
    fetch(parser.parse_args().root)
