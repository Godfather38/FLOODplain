# TNM currently omits this existing public 2021 tile. Pin the authoritative
# object already recovered for Gates model terrain, rather than treating a
# catalog omission as missing ground. Bounds generously enclose the raster;
# sample() still checks actual pixels and never fills source nodata.
SUPPLEMENTAL_TILES = ({
    "project": "AZ_PimaCounty_2021_B21", "year": 2021,
    "url": "https://prd-tnm.s3.amazonaws.com/StagedProducts/Elevation/1m/Projects/"
           "AZ_PimaCounty_2021_B21/TIFF/USGS_1M_12_x47y357_AZ_PimaCounty_2021_B21.tif",
    "bytes": 255681315, "box": (-111.319, 32.175, -111.211, 32.267),
    "published": "2024-04-05",
    "evidence": "https://github.com/Godfather38/FLOODplain/blob/633b95cc3acabeb9c0814bcbf348676a8b9efeed/tools/sfincs/data/all-route-ready-v3/gates-terrain-recovery/manifest.json",
},)


def supplement_tiles(tiles, box):
    """Add verified omitted tiles only for overlapping requests; never duplicate URLs."""
    urls = {t["url"] for t in tiles}
    w, s, e, n = box
    for tile in SUPPLEMENTAL_TILES:
        tw, ts, te, tn = tile["box"]
        if tile["url"] not in urls and w <= te and e >= tw and s <= tn and n >= ts:
            tiles.append(dict(tile))
            urls.add(tile["url"])
    return tiles
