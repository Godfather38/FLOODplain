"""Export a completed observed-inflow reach scenario with native section flows."""
import argparse
import gzip
import hashlib
import json
from pathlib import Path

import numpy as np
import pandas as pd
import xarray as xr
from pyproj import Transformer


def export(root, target):
    root=Path(root); case=json.loads((root/"case.json").read_text())
    if case["fixture"]!="cortaro_trico_observed_inflow" or "Simulation finished" not in (root/"solver.log").read_text():
        raise ValueError("Reach computation incomplete")
    for item in case["inputArtifacts"]:
        if hashlib.sha256((root/item["path"]).read_bytes()).hexdigest()!=item["sha256"]:
            raise ValueError("Input changed after preparation")
    with xr.open_dataset(root/"sfincs_map.nc") as ds, xr.open_dataset(root/"sfincs_his.nc") as hs:
        if ds.h.attrs.get("units")!="m" or hs.crosssection_discharge.attrs.get("units")!="m3 s-1":
            raise ValueError("Unexpected native output units")
        dims=tuple(d for d in ds.h.dims if d!="time")
        depth=ds.h.transpose("time",*dims).values
        times=pd.DatetimeIndex(ds.time.values).tz_localize("UTC")
        history=pd.DatetimeIndex(hs.time.values).tz_localize("UTC")
        if not times.equals(pd.date_range(case["start"],case["end"],freq="1h")):
            raise ValueError("Incomplete map time coverage")
        if history[0]!=times[0] or history[-1]!=times[-1] or not history.is_monotonic_increasing or history.has_duplicates:
            raise ValueError("Incomplete history time coverage")
        if not np.isfinite(depth).all() or depth.min() < -1e-5:
            raise ValueError("Invalid/missing native depth")
        names=[(n.decode() if isinstance(n,bytes) else str(n)).strip() for n in hs.crosssection_name.values]
        q=hs.crosssection_discharge.transpose("time","crosssections").values
        if not np.isfinite(q).all(): raise ValueError("Missing native section flows")
        seconds=(history.asi8-history.asi8[0])/1e9
        outward=q[:,[names.index(n) for n in ["west_out","north_out","east_out","south_out"]]].sum(axis=1)
        net_out=float(np.trapz(outward,seconds))
        coarse_out=float(np.trapz(outward[::2],seconds[::2]))
        river=hs.river_discharge.values.reshape(len(history),-1).sum(axis=1)
        if not np.isfinite(river).all(): raise ValueError("Invalid native river source flow")
        applied_in=float(np.trapz(river,seconds))
        cell_area=case['grid']['dxM']*case['grid']['dyM']
        native_max_depth=float(depth.max())
        if case.get('geometryIntegration'):
            if ds.subgrid_volume.attrs.get('units')!='m3':
                raise ValueError('Expected native subgrid cell volumes')
            cell_volume=ds.subgrid_volume.transpose('time',*dims).values
            if not np.isfinite(cell_volume).all() or cell_volume.min() < -1e-5:
                raise ValueError('Invalid native subgrid volume')
            volume=cell_volume[:,1:-1,1:-1].sum(axis=(1,2),dtype=np.float64)
            depth=np.maximum(cell_volume,0)/cell_area
        else:
            volume=depth[:,1:-1,1:-1].sum(axis=(1,2),dtype=np.float64)*cell_area
        rainfall_volume=0.0
        if case.get('forcingSha256'):
            if ds.cumprcp.attrs.get('units') != 'm':
                raise ValueError('Unexpected native cumulative rainfall units')
            rain=ds.cumprcp.isel(timemax=-1).values[1:-1,1:-1]
            if not np.isfinite(rain).all() or (rain<0).any():
                raise ValueError('Missing native rainfall accumulation')
            rainfall_volume=float(rain.sum(dtype=np.float64)*case['grid']['dxM']*case['grid']['dyM'])
        residual=applied_in+rainfall_volume-net_out-float(volume[-1]-volume[0])
        relative=residual/max(applied_in+rainfall_volume,1)
        trico=q[:,names.index("trico_reach")]
        observed=json.loads(Path(target).read_text())["normalized"]
        if observed["siteId"]!="USGS-09486520" or observed["units"]!="m3/s":
            raise ValueError("Expected withheld Trico comparison observations")
        ot=pd.DatetimeIndex(pd.to_datetime([p["time"] for p in observed["points"]],utc=True))
        ov=np.array([p["valueM3s"] for p in observed["points"]])
        valid=(ot>=pd.Timestamp(case["evaluationStart"]))&(ot<=times[-1])&np.isfinite(ov)
        prediction=np.interp((ot.asi8-history.asi8[0])/1e9,seconds,trico)
        peak_mask=history>=pd.Timestamp(case["evaluationStart"])
        peak_index=np.flatnonzero(peak_mask)[np.argmax(trico[peak_mask])]
        observed_index=np.flatnonzero(valid)[np.argmax(ov[valid])]
        comparison={"siteId":observed["siteId"],"usedAsForcing":False,"parameterFitting":False,
                    "sourceUrl":observed["sourceUrl"],"observedQuality":observed["quality"],
                    "evaluationStart":case["evaluationStart"],"pairs":int(valid.sum()),
                    "rmseM3s":float(np.sqrt(np.mean((prediction[valid]-ov[valid])**2))),
                    "modelPeakM3s":float(trico[peak_index]),"modelPeakTime":history[peak_index].isoformat(),
                    "observedPeakM3s":float(ov[observed_index]),"observedPeakTime":ot[observed_index].isoformat(),
                    "caveat":"Illustrative model section versus station discharge; see rainfallStatus; external lateral inflows and channel geometry remain unresolved"}
        checks={"completed":True,"maximumDepthM":float(depth.max()),"nativeMaximumDepthAboveCellMinimumM":native_max_depth,"depthDefinition":case.get("geometryIntegration",{}).get("depthDefinition","uniform computational-cell depth"),"initialStorageM3":float(volume[0]),
                "finalStorageM3":float(volume[-1]),"nativeInflowIntegralM3":applied_in,
                "nativeRainfallVolumeM3":rainfall_volume,"prescribedRainfallVolumeM3":case.get("rainfallVolumeM3"),
                "prescribedInflowIntegralM3":case["prescribedInflowVolumeM3"],"nativeNetOutflowIntegralM3":net_out,
                "storageBudgetResidualM3":residual,"relativeBudgetResidual":relative,
                "outflowIntegral60vs120SecondDifferenceM3":net_out-coarse_out,
                "budgetStatus":"approximate_flux_accounted" if abs(relative)<.02 else "requires_budget_review",
                "budgetMethod":"Native enclosing section flows integrated at 60-second output; interior-cell storage and native cumulative rainfall; no inferred outlet residual",
                "huthreshM":case["huthreshM"],"rainfallStatus":case["rainfallStatus"],"comparison":comparison}
        x,y=ds.x.transpose(*dims).values,ds.y.transpose(*dims).values
        lon,lat=Transformer.from_crs(32612,4326,always_xy=True).transform(x,y)
        select=(lon>=-111.34)&(lon<=-111.27)&(lat>=32.40)&(lat<=32.49)
        checks["displayMaximumDepthM"]=float(depth[:,select].max())
        checks["hydraulicReadiness"]="requires_channel_geometry_and_rainfall_review"
        case["limitations"].append("Large modeled pooling in a deep DEM depression near 32.36185,-111.10363 needs reviewed channel/bank connectivity")
        frame_flow=np.interp((times.asi8-history.asi8[0])/1e9,seconds,trico)
        run={"schemaVersion":1,"model":"SFINCS","kind":"inundation_scenario","status":"complete","crs":"EPSG:4326",
             "cells":[{"lon":float(a),"lat":float(b)} for a,b in zip(lon[select],lat[select])],
             "frames":[{"time":t.isoformat().replace("+00:00","Z"),"depthM":np.maximum(d[select],0).tolist(),
                        "flowM3s":float(flow),"flowLocation":case["flowLocation"]} for t,d,flow in zip(times,depth,frame_flow)],
             "provenance":{"solverVersion":"source@"+case["sourceCommit"],"runId":root.name+"-"+hashlib.sha256((root/"sfincs_map.nc").read_bytes()).hexdigest()[:16],
                           "inputArtifacts":case["inputArtifacts"],"projectedCrs":case["crs"],"verticalDatum":case["verticalDatum"],
                           "upstream":case["upstream"],"geometryIntegration":case.get("geometryIntegration"),"forcingProvenance":case.get("forcingProvenance"),"forcingSha256":case.get("forcingSha256"),"initialState":case.get("initialState"),"rainfallStatus":case["rainfallStatus"],"qualityChecks":checks},
             "support":{"domainDescription":"Cortaro-to-Trico observed-inflow reach; displayed cells cropped to Trico window",
                        "limitations":case["limitations"]},"uncertainty":{"status":"not_quantified","plusMinus":None}}
    (root/"checks.json").write_text(json.dumps(checks,indent=2)+"\n")
    raw=(json.dumps(run,allow_nan=False)+"\n").encode()
    (root/"inundation.json.gz").write_bytes(gzip.compress(raw,mtime=0))
    print(json.dumps(checks))


if __name__=="__main__":
    p=argparse.ArgumentParser(description=__doc__);p.add_argument("root");p.add_argument("--target",required=True)
    a=p.parse_args();export(a.root,a.target)
