"""Decode genuine NOAA GRIB2 and IEM quantitative indexed PNG fixtures offline.

No reflectivity conversion, image-color estimation, missing-to-zero filling,
network requests, or full-basin inference. Run from the repository root.
"""
import datetime as dt
import gzip
import hashlib
import io
import json
import math
from pathlib import Path

import eccodes as ec
from PIL import Image

UTC = dt.timezone.utc
MRMS_SOURCE = "https://noaa-mrms-pds.s3.amazonaws.com/CONUS/PrecipRate_00.00/20201014/MRMS_PrecipRate_00.00_20201014-000000.grib2.gz"
IEM_ROOT = "https://mesonet.agron.iastate.edu/archive/data/2014/09/08/GIS/mrms/"


def iso(value):
    return value.isoformat(timespec="seconds").replace("+00:00", "Z")


def provenance(path, url):
    data = Path(path).read_bytes()
    return {"path": str(path).replace("\\", "/"), "sourceUrl": url,
            "sha256": hashlib.sha256(data).hexdigest(), "bytes": len(data)}


def nearest_pixel(lon, lat, west, north, dx, dy, width, height):
    if dx <= 0 or dy >= 0:
        raise ValueError("Require a north-up, east-positive grid")
    x, y = (lon - west) / dx, (lat - north) / dy
    # Pixel centers, not corners. Deterministic ties toward increasing index.
    col, row = math.floor(x + 0.5), math.floor(y + 0.5)
    if not (0 <= col < width and 0 <= row < height):
        raise ValueError("Requested coordinate is outside source coverage")
    return row, col


def rain_envelope(terrain, source, product, start, minutes, rates, metadata):
    if any(not isinstance(v, (int, float)) or not math.isfinite(v) or v < 0 or v > 500 for v in rates):
        raise ValueError("Missing or out-of-range rainfall; no zero substitution")
    return {"schemaVersion": 1, "kind": "radar-estimate", "units": "mm/h", "source": source,
            "product": product, "grid": [[c["lon"], c["lat"]] for c in terrain["cells"]],
            "frames": [{"start": iso(start), "durationMinutes": minutes, "rates": rates}],
            "provenance": metadata,
            "warning": "Recorded radar-derived estimate, not gauge truth or live data. Partial event only; no full-basin or bridge prediction."}


def decode_mrms(path, terrain):
    compressed = Path(path).read_bytes()
    if len(compressed) > 5_000_000:
        raise ValueError("Bounded fixture limit: 5 MB compressed")
    with gzip.GzipFile(fileobj=io.BytesIO(compressed)) as stream:
        raw = stream.read(8_000_001)
    if len(raw) > 8_000_000 or raw[:4] != b"GRIB" or raw[7] != 2 or raw[-4:] != b"7777" or int.from_bytes(raw[8:16], "big") != len(raw):
        raise ValueError("Expected one complete bounded GRIB edition 2 message")
    handle = ec.codes_new_from_message(raw)
    try:
        keys = ["edition", "centre", "discipline", "parameterCategory", "parameterNumber", "dataDate", "dataTime",
                "second", "stepType", "forecastTime", "gridType", "Ni", "Nj", "packingType", "bitmapPresent",
                "latitudeOfFirstGridPointInDegrees", "longitudeOfFirstGridPointInDegrees",
                "iDirectionIncrementInDegrees", "jDirectionIncrementInDegrees", "iScansNegatively",
                "jScansPositively", "jPointsAreConsecutive", "alternativeRowScanning", "shortName", "units"]
        meta = {key: ec.codes_get(handle, key) for key in keys}
        if (str(meta["centre"]), meta["discipline"], meta["parameterCategory"], meta["parameterNumber"]) != ("161", 209, 6, 1):
            raise ValueError("Require NOAA MRMS PrecipRate product identity 161 / 209 / 6 / 1")
        if meta["stepType"] != "instant" or meta["forecastTime"] != 0:
            raise ValueError("Require instantaneous analysis, not forecast or accumulation")
        if meta["gridType"] != "regular_ll" or any(meta[k] != 0 for k in ("iScansNegatively", "jScansPositively", "jPointsAreConsecutive", "alternativeRowScanning")):
            raise ValueError("Unsupported grid or scan orientation")
        width, height = meta["Ni"], meta["Nj"]
        if width * height > 30_000_000:
            raise ValueError("Source grid exceeds bounded decoder limit")
        west = ((meta["longitudeOfFirstGridPointInDegrees"] + 180) % 360) - 180
        north, dx, dy = meta["latitudeOfFirstGridPointInDegrees"], meta["iDirectionIncrementInDegrees"], -meta["jDirectionIncrementInDegrees"]
        pixels = [nearest_pixel(c["lon"], c["lat"], west, north, dx, dy, width, height) for c in terrain["cells"]]
        indices = [row * width + col for row, col in pixels]
        rates = [float(v) for v in ec.codes_get_elements(handle, "values", indices)]
        # ecCodes tables do not name this local MRMS field: do not infer units from
        # its unknown shortName. Verify numeric product identity, then use NOAA's table.
        date = dt.datetime.strptime(str(meta["dataDate"]) + str(meta["dataTime"]).zfill(4), "%Y%m%d%H%M").replace(tzinfo=UTC, second=meta["second"])
        independent_nearest = ec.codes_grib_find_nearest(handle, terrain["center"]["lat"], terrain["center"]["lon"], npoints=1)[0]
        center_index = terrain["crossingCell"]
        if int(independent_nearest["index"]) != indices[center_index] or float(independent_nearest["value"]) != rates[center_index]:
            raise ValueError("ecCodes nearest-coordinate cross-check disagrees with affine indexing")
        evidence = {"original": provenance(path, MRMS_SOURCE), "decoder": "ECMWF ecCodes", "decoderVersion": ec.codes_get_api_version(),
                    "grib": meta, "productTable": "https://www.nssl.noaa.gov/projects/mrms/operational/tables.php",
                    "unitsBasis": "NOAA product 209/6/1 is mm/h; ecCodes shortName and units are unknown for this local table entry",
                    "cellMethod": "Nearest source pixel center; no spatial downscaling", "pixelRowsCols": pixels,
                    "centerNearestCrossCheck": dict(independent_nearest), "sourceResolutionDegrees": [dx, dy],
                    "timeMethod": "Instantaneous rate held forward for two minutes; parser fixture only, not 2014 event rainfall"}
        return rain_envelope(terrain, MRMS_SOURCE, "MRMS PrecipRate", date, 2, rates, evidence)
    finally:
        ec.codes_release(handle)


def iem_mm(index):
    if not isinstance(index, int) or not 0 <= index <= 255:
        raise ValueError("Invalid indexed rainfall sample")
    if index == 255:
        return None
    if index <= 100:
        return index * .25
    if index <= 180:
        return 25 + (index - 100) * 1.25
    return 125 + (index - 180) * 5


def decode_iem_hour(png_path, world_path, terrain):
    stem = Path(png_path).stem
    if not stem.startswith("p1h_"):
        raise ValueError("Only p1h accumulation supported; never reuse this scale for a2m")
    end = dt.datetime.strptime(stem[4:], "%Y%m%d%H%M").replace(tzinfo=UTC)
    if end.minute != 0:
        raise ValueError("Hourly snapshots must end on the hour to avoid overlapping hourly accumulations")
    world = [float(x) for x in Path(world_path).read_text().split()]
    if len(world) != 6 or not all(math.isfinite(x) for x in world):
        raise ValueError("Invalid world file")
    dx, rotation_y, rotation_x, dy, west, north = world
    if rotation_y or rotation_x:
        raise ValueError("Rotated raster not supported")
    with Image.open(png_path) as image:
        if image.mode != "P" or image.width * image.height > 30_000_000:
            raise ValueError("Require bounded indexed PNG, never RGB image colors")
        pixels = [nearest_pixel(c["lon"], c["lat"], west, north, dx, dy, image.width, image.height) for c in terrain["cells"]]
        palette_indices = [image.getpixel((col, row)) for row, col in pixels]
        depths = [iem_mm(i) for i in palette_indices]
        if any(value is None for value in depths):
            raise ValueError("IEM index 255 means missing; cannot simulate this window")
        evidence = {"original": provenance(png_path, IEM_ROOT + Path(png_path).name),
                    "worldFile": provenance(world_path, IEM_ROOT + Path(world_path).name),
                    "decoder": "Pillow indexed PNG", "worldTransform": world, "imageSize": [image.width, image.height],
                    "paletteIndices": palette_indices, "pixelRowsCols": [list(p) for p in pixels],
                    "mappingSource": "https://mesonet.agron.iastate.edu/GIS/rasters.php?rid=5",
                    "intervalSource": "https://mesonet.agron.iastate.edu/rainfall/",
                    "sourceUnits": "mm accumulated over preceding hour", "intervalEnd": iso(end),
                    "timeMethod": "One non-overlapping hour; divide accumulation by 1 h to form a constant hourly mean rate; subhour timing unknown",
                    "cellMethod": "Nearest pixel using world-file pixel CENTERS; preserve 255 as missing; quantized estimate, not exact rainfall"}
    return rain_envelope(terrain, IEM_ROOT + Path(png_path).name, "IEM MRMS p1h", end - dt.timedelta(hours=1), 60, depths, evidence)


def main():
    terrain = json.loads(Path("public/simulation/data/terrain.json").read_text())
    cases = {
        "rainfall-mrms-20201014.json": decode_mrms("test/fixtures/mrms/MRMS_PrecipRate_00.00_20201014-000000.grib2.gz", terrain),
        "rainfall-iem-201409081800.json": decode_iem_hour("test/fixtures/iem/p1h_201409081800.png", "test/fixtures/iem/p1h_201409081800.wld", terrain),
    }
    for filename, result in cases.items():
        Path("public/simulation/data", filename).write_text(json.dumps(result, indent=2, allow_nan=False) + "\n", encoding="utf-8")
        rates = result["frames"][0]["rates"]
        print(filename, result["frames"][0]["start"], "rates mm/h", min(rates), max(rates))


if __name__ == "__main__":
    main()
