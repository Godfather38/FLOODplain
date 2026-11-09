"""Stage prepared quadtree geometry and frozen/observed discharge for an arbitrary hourly window (validation copy).

Copy of tools/sfincs/stage_route_case_native.py with the 63-hour window parameterized (--hours, --map-start-hours,
--inflow as one file or --history/--forecast as before). Every other check is kept: one discharge value per
hour from the window start through tstop, no missing timestamp, the same baseline sfincs.inp keys, the same
copied geometry/parameter files. tstop is written explicitly from the window (the original inherits 07Z from the baseline).
"""
import argparse,json,shutil
from pathlib import Path
from datetime import datetime,timedelta,timezone
import numpy as np

def main():
 p=argparse.ArgumentParser();p.add_argument('--output',type=Path,required=True);p.add_argument('--boundaries',type=Path,required=True);p.add_argument('--parameters',type=Path,required=True)
 p.add_argument('--inflow',type=Path);p.add_argument('--history',type=Path);p.add_argument('--forecast',type=Path)
 p.add_argument('--hours',type=int,required=True,help='window length from 2026-10-30T16Z (63 reproduces the frozen case)');p.add_argument('--map-start-hours',type=int,default=49)
 p.add_argument('--note',default='');a=p.parse_args();a.output.mkdir(parents=True,exist_ok=True)
 b=a.boundaries;params=a.parameters;placement=json.loads((b/'boundary-placement.json').read_text());ids=[v['reachId'] for v in placement['inlets']]
 start=datetime(2026,10,30,16,tzinfo=timezone.utc);end=start+timedelta(hours=a.hours);series=[]
 if a.inflow:src={s['reachId']:s['points'] for s in json.loads(a.inflow.read_text())['series']}
 else:
  analysis={s['reachId']:s['points'] for s in json.loads(a.history.read_text())['series']};forecast={s['reachId']:s['points'] for s in json.loads(a.forecast.read_text())['series']}
  src={k:analysis[k]+[v for v in forecast[k] if v['time']>analysis[k][-1]['time']] for k in analysis}
 for key in ids:
  points=src[key];times=[(datetime.fromisoformat(v['time'].replace('Z','+00:00'))-start).total_seconds() for v in points]
  if times!=list(range(0,a.hours*3600+1,3600)):raise ValueError('Missing native discharge timestamp')
  if any(v['flowM3s'] is None or not np.isfinite(v['flowM3s']) or v['flowM3s']<0 for v in points):raise ValueError('Missing or negative discharge')
  series.append([v['flowM3s'] for v in points])
 np.savetxt(a.output/'sfincs.dis',np.column_stack([times,np.array(series).T]),fmt='%.6f')
 for source,name in [(b/'sfincs.nc','sfincs.nc'),(b/'sfincs.src','sfincs.src'),(params/'sfincs_subgrid.nc','sfincs_subgrid.nc'),(params/'infiltration.nc','infiltration.nc')]:shutil.copyfile(source,a.output/name)
 for name in ['GCN10-NOTICE.txt','GCN10-source-metadata.xml']:shutil.copyfile(Path('tools/sfincs/data/catchment-coupling')/name,a.output/name)
 baseline=Path('.sfincs-runs/aligned-current-case-20261101-13z/sfincs.inp').read_text();config={k.strip():v.strip() for line in baseline.splitlines() if '=' in line for k,v in [line.split('=',1)]}
 for key in ['mmax','nmax','dx','dy','x0','y0','rotation','depfile','mskfile','indexfile','scsfile']:config.pop(key,None)
 if config.get('tref')!='20261030 160000' or config.get('tstart')!='20261030 160000':raise ValueError('Baseline reference time changed')
 config.update(tstop=end.strftime('%Y%m%d %H%M%S'),qtrfile='sfincs.nc',inffile='infiltration.nc',inftype='cna',storezvolume='1',storemeteo='1',dtout='900',dthisout='300',t0out=str(a.map_start_hours*3600))
 (a.output/'sfincs.inp').write_text(''.join(f'{k:<22} = {v}\n' for k,v in config.items()),encoding='utf-8')
 iso=lambda t:t.strftime('%Y-%m-%dT%H:%M:%SZ')
 result={'status':'native_component_waiting_for_expanded_rainfall','runReady':False,'solverExecuted':False,'mode':'validation-extended-window','gridCells':placement['activeCells'],'inlets':len(ids),'nativeFlowTimestamps':len(times),'windowHours':a.hours,
  'mapOutputWindow':f'{iso(start+timedelta(hours=a.map_start_hours))}..{iso(end)} every 15 min ({a.hours-a.map_start_hours} h after {a.map_start_hours} h of antecedent run)','forecastIssue':'2026-11-01T13:00:00Z','forecastStart':'2026-11-01T17:00:00Z','start':iso(start),'end':iso(end),
  'initialization':'Same explicit dry assumed antecedent start; continuous analysis-forced history, not measured initial state','windowNote':a.note,'missing':['Expanded original-issue rainfall crop and standard native precipitation serialization'],'nativeInputReference':'Pinned SFINCS sfincs_infiltration.f90 requires inffile NetCDF for quadtree; scs units remain inches','knownLimits':['Current bridge elevations unknown','Published CN antecedent assumption; no measured transmission loss','Terrain dates 2019 peripheral/2021/2023, not 2026 construction survey','6.25m computational cells are not validated road-depth accuracy']}
 (a.output/'native-component.json').write_text(json.dumps(result,indent=2)+'\n',encoding='utf-8');print(json.dumps(result))
if __name__=='__main__':main()
