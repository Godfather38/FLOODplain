"""Cortaro-to-Trico observed-inflow scenario; target observations are never inputs."""
import argparse
import hashlib
import json
from pathlib import Path

import geopandas as gpd
import numpy as np
import pandas as pd
import rasterio
import xarray as xr
from hydromt_sfincs import SfincsModel
from pyproj import Transformer
from shapely.geometry import Point, shape
from shapely.ops import transform, unary_union, nearest_points

from prepare_case import SOURCE_COMMIT


def prepare(root, terrain, upstream, threshold=0.01, forcing=None, initial_map=None, dry_start=False, flowline=None):
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
    placement = {'method':'containing gauge-coordinate cell','shiftM':0.0}
    if flowline:
        network=json.loads(Path(flowline).read_text())
        river=unary_union([transform(tx.transform,shape(f['geometry'])) for f in network['features']])
        point=nearest_points(Point(gx,gy),river)[1]
        distance=point.distance(Point(gx,gy))
        if distance>150:
            raise ValueError('River placement exceeds bounded one-cell-diagonal offset')
        placement={'method':'nearest point on official USGS downstream NLDI flowline; not elevation optimization',
                   'shiftM':distance,'originalX':gx,'originalY':gy,
                   'sourceUrl':'https://api.water.usgs.gov/nldi/linked-data/nwissite/USGS-09486500/navigation/DM/flowlines?distance=35',
                   'sha256':hashlib.sha256(Path(flowline).read_bytes()).hexdigest()}
        gx,gy=point.x,point.y
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
    rainfall_metadata = {}
    if forcing:
        rain = json.loads(Path(forcing).read_text())
        if rain['status'] != 'complete' or rain['missingCellHours'] or rain['units'] != 'mm/h' or rain['crs'] != 'EPSG:4326':
            raise ValueError('Require complete verified hourly rainfall')
        event_start = pd.Timestamp(rain['frames'][0]['start'])
        event_end = pd.Timestamp(rain['frames'][-1]['end'])
        keep = (times >= event_start) & (times <= event_end)
        times, flow = times[keep], flow[keep]
        if times[0] != event_start or times[-1] != event_end:
            raise ValueError('River boundary does not cover rainfall event')
        if initial_map and dry_start:
            raise ValueError('Choose one initial-state policy')
        if not initial_map and not dry_start:
            raise ValueError('Explicit initial-state policy required')
        if initial_map:
            with xr.open_dataset(initial_map) as initial:
                if not np.array_equal(initial.zb.values, bed):
                    raise ValueError('Initial-state terrain differs')
                initial_depth = initial.h.sel(time=event_start.tz_localize(None)).values
                if not np.isfinite(initial_depth).all() or (initial_depth < 0).any():
                    raise ValueError('Invalid initial depths')
                model.set_states(model.mask.copy(data=(bed+initial_depth).astype(np.float32)), name='zsini')
        xs, ys = np.meshgrid(west+(np.arange(nx)+.5)*dx, south+(np.arange(ny)+.5)*dy)
        lon, lat = Transformer.from_crs(32612,4326,always_xy=True).transform(xs,ys)
        slon, slat = np.array(rain['lon']), np.array(rain['lat'])
        if not (slon.min() <= lon.min() <= lon.max() <= slon.max() and slat.min() <= lat.min() <= lat.max() <= slat.max()):
            raise ValueError('Rainfall does not cover terrain')
        ix = np.abs(lon[...,None]-slon).argmin(axis=-1)
        iy = np.abs(lat[...,None]-slat).argmin(axis=-1)
        values, starts, previous = [], [], event_start
        for frame in rain['frames']:
            a,b = pd.Timestamp(frame['start']),pd.Timestamp(frame['end'])
            source = np.asarray(frame['precipMmH'],dtype=float)
            if a != previous or (b-a).total_seconds()!=3600 or source.shape!=(len(slat),len(slon)) or not np.isfinite(source).all() or (source<0).any():
                raise ValueError('Invalid rainfall interval or raster')
            starts.append(a.tz_convert('UTC').tz_localize(None)); values.append(source[iy,ix]); previous=b
        rate=xr.DataArray(np.asarray(values+[values[-1]],dtype=np.float32),dims=('time','y','x'),
                          coords={'time':starts+[event_end.tz_localize(None)],'y':ys[:,0],'x':xs[0]},name='precip_2d',attrs={'units':'mm/hr'})
        rate.raster.set_crs(32612)
        model.set_forcing(rate,name='precip_2d')
        model.setup_config(dtwnd=60,storecumprcp=1,ampr_block=1,netamprfile='rainfall.nc')
        rainfall_metadata={'rainfallStatus':'complete_stage_iv_analysis', 'forcingProvenance':rain['provenance'],
            'forcingQuality':rain['sourceQuality'],'forcingSha256':hashlib.sha256(Path(forcing).read_bytes()).hexdigest(),
            'rainfallVolumeM3':float(np.sum(np.asarray(values)[:,1:-1,1:-1])*dx*dy/1000),
            'initialState':{'sourceSha256':hashlib.sha256(Path(initial_map).read_bytes()).hexdigest() if initial_map else None,'time':event_start.isoformat(),
                'description':('Water levels from prior observed-inflow-only spinup; antecedent rainfall unknown; velocities reinitialized, not a full restart' if initial_map else 'Assumed dry initial state followed by 24 hours of observed inflow and Stage IV rainfall spinup')}}
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
    files = [p for p in root.iterdir() if p.is_file() and (p.name.startswith("sfincs.") or p.name in {"sections.crs", "rainfall.nc"})]
    manifest = {"fixture":"cortaro_trico_observed_inflow", "sourceCommit":SOURCE_COMMIT,
                "crs":"EPSG:32612", "verticalDatum":"NAVD88 per USGS terrain catalog; discharge needs no stage-datum conversion",
                "start":times[0].isoformat(), "end":times[-1].isoformat(),
                "evaluationStart":(times[0]+pd.Timedelta(hours=24)).isoformat(),
                "grid":{"ny":ny,"nx":nx,"dxM":dx,"dyM":dy}, "terrainEvidence":evidence,
                "upstream":{"siteId":obs["siteId"],"lon":gauge_lon,"lat":gauge_lat,"x":gx,"y":gy,
                            "placement":placement,"cellRow":row,"cellColumn":col,"cellBedM":float(bed[row,col]),
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
    if flowline:
        manifest['limitations'][3]='Inflow placed on official USGS flowline near Cortaro; unresolved cross-channel velocity distribution and 100 m channel geometry'
    if forcing:
        manifest.update(rainfall_metadata)
        manifest['evaluationStart']=(times[0]+pd.Timedelta(hours=24) if dry_start else times[0]).isoformat()
        manifest['limitations'][1]='Stage IV local rainfall included; external lateral tributary inflows omitted; local rainfall upstream of Cortaro may double count a small boundary-adjacent area'
        manifest['limitations'][4]='Uniform assumed roughness and zero infiltration; not calibrated. '+rainfall_metadata['initialState']['description']
    (root/"case.json").write_text(json.dumps(manifest,indent=2)+"\n")
    print(json.dumps({"grid":[ny,nx],"upstreamCell":[row,col],"bedM":float(bed[row,col]),"hours":(end-start).total_seconds()/3600}))


if __name__=="__main__":
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("root");parser.add_argument("--terrain",required=True);parser.add_argument("--upstream",required=True)
    parser.add_argument("--threshold",type=float,default=.01)
    parser.add_argument('--forcing');parser.add_argument('--initial-map');parser.add_argument('--dry-start',action='store_true');parser.add_argument('--flowline')
    args=parser.parse_args();prepare(args.root,args.terrain,args.upstream,args.threshold,args.forcing,args.initial_map,args.dry_start,args.flowline)
