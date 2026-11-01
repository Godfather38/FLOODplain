import json
from pathlib import Path
import numpy as np
import pandas as pd
import argparse, hashlib
p=argparse.ArgumentParser(description='Read-only common-window integration of retained USGS observations')
p.add_argument('--gauges',type=Path,required=True)
a=p.parse_args();b=a.gauges
out={'method':'Original USGS approved discharge; common UTC window; trapezoidal integration; exact 0.028316846592 cfs-to-m3/s; no travel-time adjustment','events':{}}
for event,stem in [('2013','evaluation-2013-07'),('2014','benchmark-2014-09')]:
    arrays={}
    for station in ['cortaro','trico']:
        raw=json.loads((b/f'{station}-{stem}.json').read_text())['raw']['features']
        p=[f['properties'] for f in raw]
        t=pd.DatetimeIndex([x['time'] for x in p]);q=np.array([float(x['value'])*0.028316846592 for x in p]); order=np.argsort(t.asi8)
        arrays[station]=(t[order],q[order],p)
    start=max(x[0][0] for x in arrays.values());end=min(x[0][-1] for x in arrays.values())
    grid=np.unique(np.concatenate([t.asi8[(t>=start)&(t<=end)] for t,q,p in arrays.values()]))
    values={k:np.interp(grid,t.asi8,q) for k,(t,q,p) in arrays.items()}
    e={'start':str(start),'end':str(end),'stations':{},'sourceFiles':{k:{'path':f'{k}-{stem}.json','sha256':hashlib.sha256((b/f'{k}-{stem}.json').read_bytes()).hexdigest()} for k in arrays}}
    for k,(t,q,p) in arrays.items():
        v=values[k]; i=int(np.argmax(v)); e['stations'][k]={'volumeM3':float(np.trapz(v,(grid-grid[0])/1e9)),'peakM3s':float(v[i]),'peakTime':str(pd.Timestamp(grid[i],tz='UTC')),'initialM3s':float(v[0]),'finalM3s':float(v[-1]),'maxNativeGapMinutes':float(np.diff(t.asi8).max()/6e10),'qualifiedSamples':sum(bool(x.get('qualifier')) for x in p),'approvalStatuses':sorted(set(x.get('approval_status','') for x in p))}
    e['tricoMinusCortaroVolumeM3']=e['stations']['trico']['volumeM3']-e['stations']['cortaro']['volumeM3']
    e['tricoToCortaroVolumeRatio']=e['stations']['trico']['volumeM3']/e['stations']['cortaro']['volumeM3']
    e['peakLagMinutes']=(pd.Timestamp(e['stations']['trico']['peakTime'])-pd.Timestamp(e['stations']['cortaro']['peakTime'])).total_seconds()/60
    out['events'][event]=e
print(json.dumps(out,indent=2))
