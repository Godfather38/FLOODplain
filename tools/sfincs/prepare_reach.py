"""Cortaro-to-Trico observed-inflow scenario; target observations are never inputs."""
import argparse
import hashlib
import json
from pathlib import Path

import geopandas as gpd
import numpy as np
import pandas as pd
import rasterio
from hydromt_sfincs import SfincsModel
from pyproj import Transformer
from shapely.geometry import Point

from prepare_case import SOURCE_COMMIT


def prepare(root, terrain, upstream, threshold=0.01):
    root, terrain, upstream = Path(root), Path(terrain), Path(upstream)
    if root.exists() and any(root.iterdir()):
        raise FileExistsError("Preserve previous run; use an empty directory")
    evidence = json.loads((terrain / "terrain.json").read_text())
    for name, expected in [("terrain.tif", evidence["sha256"]), ("catalog.json", evidence["catalogSha256"])]:
        if hashlib.sha256((terrain/name).read_bytes()).hexdigest() != expected:
            raise ValueError("Terrain provenance mismatch")
    catalog = json.loads((terrain/"catalog.json").read_text())
    if catalog.get("exceededTransferLimit"):
        raise ValueError("Incomplete terrain catalog")
    if {f["attributes"].get("VerticalDatum") for f in catalog["features"]} != {"North American Vertical Datum of 1988 (NAVD 88)"}:
        raise ValueError("Terrain vertical datum not consistently NAVD88")
    gauge = json.loads(upstream.read_text())
    obs = gauge["normalized"]
    if obs["siteId"] != "USGS-09486500" or obs["units"] != "m3/s":
        raise ValueError("Require independent Cortaro discharge, not target Trico observations")
    times = pd.DatetimeIndex(pd.to_datetime([p["time"] for p in obs["points"]], utc=True))
    flow = np.array([p["valueM3s"] for p in obs["points"]])
    original = np.array([p["originalValueCfs"] for p in obs["points"]])
    if (not times.is_monotonic_increasing or times.has_duplicates or
        np.max(np.diff(times.asi8))/1e9 > 900 or not np.isfinite(flow).all() or (flow < 0).any() or
        not np.allclose(flow, original*0.028316846592, rtol=1e-12)):
        raise ValueError("Invalid upstream timing, units, or flow coverage")
    if any(p["approval"] != "Approved" or p["qualifier"] for p in obs["points"]):
        raise ValueError("Review upstream qualifiers before use")
    coordinates = {tuple(f["geometry"]["coordinates"]) for f in gauge["raw"]["features"]}
    if len(coordinates) != 1:
        raise ValueError("Upstream location changed within evidence")
    gauge_lon, gauge_lat = coordinates.pop()
    tx = Transformer.from_crs(4326, 32612, always_xy=True)
    gx, gy = tx.transform(gauge_lon, gauge_lat)
    with rasterio.open(terrain/"terrain.tif") as raster:
        if raster.crs.to_epsg() != 32612 or raster.transform.b or raster.transform.d:
            raise ValueError("Require north-up metric terrain")
        z = raster.read(1, masked=True)
        if np.ma.getmaskarray(z).any() or not np.isfinite(z).all():
            raise ValueError("Missing terrain")
        dx, dy = raster.res
        west, south, east, north = raster.bounds
        ny, nx = z.shape
        bed = np.flipud(z.data).astype(np.float32)
    col, row = int((gx-west)//dx), int((gy-south)//dy)
    if not (2 <= col < nx-2 and 2 <= row < ny-2):
        raise ValueError("Actual upstream gauge must lie inside the domain, away from artificial edges")
    model = SfincsModel(root=str(root), mode="w", write_gis=False)
    model.setup_grid(x0=west, y0=south, dx=dx, dy=dy, nmax=ny, mmax=nx, rotation=0, epsg=32612)
    model.set_grid(model.mask.copy(data=bed), name="dep")
    mask = np.ones((ny,nx), dtype=np.uint8)
    mask[[0,-1],:] = 3
    mask[:,[0,-1]] = 3
    model.set_grid(model.mask.copy(data=mask), name="msk")
    start, end = times[0].tz_localize(None), times[-1].tz_localize(None)
    model.setup_config(tref=start.strftime("%Y%m%d %H%M%S"), tstart=start.strftime("%Y%m%d %H%M%S"),
                       tstop=end.strftime("%Y%m%d %H%M%S"), dtout=3600, dthisout=60,
                       dtmaxout=(end-start).total_seconds(), dtmax=20, zsini=0, qinf=0,
                       manning=0.04, huthresh=threshold, advection=1, store_river_discharge=True,
                       indexfile="sfincs.ind", mskfile="sfincs.msk", depfile="sfincs.dep", crsfile="sections.crs")
    locations = gpd.GeoDataFrame(index=[1], geometry=[Point(gx,gy)], crs=32612)
    model.setup_discharge_forcing(timeseries=pd.DataFrame({1:flow}, index=times.tz_localize(None)), locations=locations)
    model.write()
    model.write_forcing(fmt="%14.8f")
    # Clockwise enclosing section: native positive left-normal flux is outward.
    left,right,bottom,top = west+dx,east-dx,south+dy,north-dy
    trico_lon, trico_lat = -111.30196666666666,32.47158888888889
    trico_x, trico_y = tx.transform(trico_lon,trico_lat)
    sections = {"west_out": [(left,bottom),(left,top)], "north_out": [(left,top),(right,top)],
                "east_out": [(right,top),(right,bottom)], "south_out": [(right,bottom),(left,bottom)],
                "trico_reach": [(trico_x,trico_y-1000),(trico_x,trico_y+1000)]}
    with (root/"sections.crs").open("w", newline="\n") as stream:
        for name, points in sections.items():
            stream.write(name+"\n2 2\n")
            for x,y in points:
                stream.write(f"{x:.3f} {y:.3f}\n")
    files = [p for p in root.iterdir() if p.is_file() and (p.name.startswith("sfincs.") or p.name=="sections.crs")]
    manifest = {"fixture":"cortaro_trico_observed_inflow", "sourceCommit":SOURCE_COMMIT,
                "crs":"EPSG:32612", "verticalDatum":"NAVD88 per USGS terrain catalog; discharge needs no stage-datum conversion",
                "start":times[0].isoformat(), "end":times[-1].isoformat(),
                "evaluationStart":(times[0]+pd.Timedelta(hours=24)).isoformat(),
                "grid":{"ny":ny,"nx":nx,"dxM":dx,"dyM":dy}, "terrainEvidence":evidence,
                "upstream":{"siteId":obs["siteId"],"lon":gauge_lon,"lat":gauge_lat,"x":gx,"y":gy,
                            "cellRow":row,"cellColumn":col,"cellBedM":float(bed[row,col]),
                            "cellCenterDistanceM":float(np.hypot(west+(col+.5)*dx-gx,south+(row+.5)*dy-gy)),
                            "sourceUrl":obs["sourceUrl"],"sha256":hashlib.sha256(upstream.read_bytes()).hexdigest(),
                            "interpolation":"linear between approved 15-minute observations; no extrapolation or time shift"},
                "prescribedInflowVolumeM3":float(np.trapz(flow,(times.asi8-times.asi8[0])/1e9)),
                "rainfallStatus":"omitted_unknown: corrected historical hourly raster is incomplete; not observed dry",
                "huthreshM":threshold,"manning":0.04,"sections":sections,
                "flowLocation":{"name":"Illustrative 2 km transverse Trico reach section","lon":trico_lon,"lat":trico_lat,
                                "projectedEndpoints":sections["trico_reach"],"crs":"EPSG:32612"},
                "inputArtifacts":[{"path":p.name,"sha256":hashlib.sha256(p.read_bytes()).hexdigest()} for p in sorted(files)],
                "limitations":["Observed upstream-flow scenario, not a forecast or complete 2014 hindcast",
                               "Local rainfall and lateral tributary inflows omitted because historical rainfall is incomplete",
                               "100 m contemporary terrain cannot resolve channel bathymetry, bridges, culverts, or 2014 morphology",
                               "Cortaro discharge enters its containing grid cell without prescribed velocity distribution",
                               "Uniform assumed roughness, zero infiltration, dry start with 24-hour spinup; not calibrated",
                               "Artificial zero-depth outer boundaries; sampled native section fluxes give an approximate water budget",
                               "Trico observations are withheld from forcing and parameter selection; section comparison is approximate",
                               "No road passability, bridge failure, scour, or quantified accuracy interval"]}
    (root/"case.json").write_text(json.dumps(manifest,indent=2)+"\n")
    print(json.dumps({"grid":[ny,nx],"upstreamCell":[row,col],"bedM":float(bed[row,col]),"hours":(end-start).total_seconds()/3600}))


if __name__=="__main__":
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("root");parser.add_argument("--terrain",required=True);parser.add_argument("--upstream",required=True)
    parser.add_argument("--threshold",type=float,default=.01)
    args=parser.parse_args();prepare(args.root,args.terrain,args.upstream,args.threshold)
