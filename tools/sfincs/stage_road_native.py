"""Stage prepared quadtree geometry and actual frozen discharge; precipitation remains explicit."""
import argparse,json,shutil
from pathlib import Path
from datetime import datetime,timezone
import numpy as np

def main():
 p=argparse.ArgumentParser();p.add_argument('--output',type=Path,required=True);a=p.parse_args();a.output.mkdir(parents=True,exist_ok=True)
 b=Path('.sfincs-runs/road-native-boundaries-v2');params=Path('.sfincs-runs/road-parameters-v2');r=Path('tools/sfincs/data/road-dip-refinement/connected-v2');placement=json.loads((b/'boundary-placement.json').read_text());ids=[v['reachId'] for v in placement['inlets']]
 analysis={s['reachId']:s['points'] for s in json.loads((r/'frozen-analysis.json').read_text())['series']};forecast={s['reachId']:s['points'] for s in json.loads((r/'frozen-forecast.json').read_text())['series']};start=datetime(2026,10,30,16,tzinfo=timezone.utc);series=[]
 for key in ids:
  points=analysis[key]+[v for v in forecast[key] if v['time']>analysis[key][-1]['time']];times=[(datetime.fromisoformat(v['time'].replace('Z','+00:00'))-start).total_seconds() for v in points]
  if times!=list(range(0,63*3600+1,3600)):raise ValueError('Missing native discharge timestamp')
  series.append([v['flowM3s'] for v in points])
 np.savetxt(a.output/'sfincs.dis',np.column_stack([times,np.array(series).T]),fmt='%.6f')
 for source,name in [(b/'sfincs.nc','sfincs.nc'),(b/'sfincs.src','sfincs.src'),(params/'sfincs_subgrid.nc','sfincs_subgrid.nc'),(params/'infiltration.nc','infiltration.nc')]:shutil.copyfile(source,a.output/name)
 for name in ['GCN10-NOTICE.txt','GCN10-source-metadata.xml']:shutil.copyfile(Path('tools/sfincs/data/catchment-coupling')/name,a.output/name)
 baseline=Path('.sfincs-runs/aligned-current-case-20261101-13z/sfincs.inp').read_text();config={k.strip():v.strip() for line in baseline.splitlines() if '=' in line for k,v in [line.split('=',1)]}
 for key in ['mmax','nmax','dx','dy','x0','y0','rotation','depfile','mskfile','indexfile','scsfile']:config.pop(key,None)
 config.update(qtrfile='sfincs.nc',inffile='infiltration.nc',inftype='cna',storezvolume='1',storemeteo='1',dtout='900',dthisout='300',t0out=str(49*3600))
 (a.output/'sfincs.inp').write_text(''.join(f'{k:<22} = {v}\n' for k,v in config.items()),encoding='utf-8')
 result={'status':'native_component_waiting_for_expanded_rainfall','runReady':False,'solverExecuted':False,'mode':'simulated-live','gridCells':placement['activeCells'],'inlets':len(ids),'nativeFlowTimestamps':len(times),'mapOutputWindow':'Forecast only, 49h after antecedent start; 15-minute maps limit artifact size without shortening initialization','forecastIssue':'2026-11-01T13:00:00Z','forecastStart':'2026-11-01T17:00:00Z','start':'2026-10-30T16:00:00Z','end':'2026-11-02T07:00:00Z','initialization':'Same explicit dry assumed antecedent start; continuous analysis-forced history, not measured initial state','missing':['Expanded original-issue rainfall crop and standard native precipitation serialization'],'nativeInputReference':'Pinned SFINCS sfincs_infiltration.f90 requires inffile NetCDF for quadtree; scs units remain inches','knownLimits':['Current bridge elevations unknown','Published CN antecedent assumption; no measured transmission loss','Terrain dates 2019 peripheral/2021/2023, not 2026 construction survey','6.25m computational cells are not validated road-depth accuracy']}
 (a.output/'native-component.json').write_text(json.dumps(result,indent=2)+'\n',encoding='utf-8');print(json.dumps(result))
if __name__=='__main__':main()
