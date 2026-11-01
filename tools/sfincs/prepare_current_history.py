"""Join supplied native analysis and forecast timestamps without interpolation."""
import argparse
import hashlib
import json
from datetime import datetime, timedelta
from pathlib import Path


def utc(s):
    t=datetime.fromisoformat(s.replace('Z','+00:00'))
    if t.utcoffset() is None: raise ValueError('Timezone required')
    return t


def prepare(package, registry):
    names=['analysis-history.json','initialization-context.json','boundary-snapshot.json']
    history,context,forecast=[json.loads((package/n).read_text()) for n in names]
    if history['status']!='complete': raise ValueError('Incomplete analysis history')
    maps=[{str(s['reachId']):s for s in j} for j in [history['series'],context['forecastLeadInSeries'],forecast['series']]]
    result=[]; timelines=[]
    analysis_end=utc(context['commonAnalysisEnd'])
    for source in registry['sources']:
        reach=source['reachId']; points={}; roles={}
        for series,role in zip(maps,['model_analysis_not_observation','forecast_transition','forecast']):
            if reach not in series: raise ValueError('Missing reach '+reach)
            for point in series[reach]['points']:
                t=utc(point['time'])
                if role!='model_analysis_not_observation' and t<=analysis_end: continue
                if role=='model_analysis_not_observation' and t>analysis_end: continue
                value=float(point['flowM3s'])
                if not (0<=value<float('inf')): raise ValueError('Invalid flow')
                if t in points and points[t]!=value: raise ValueError('Conflicting native transition value')
                points[t]=value;roles[t]=role
        times=sorted(points)
        if any(b-a!=timedelta(hours=1) for a,b in zip(times,times[1:])): raise ValueError('Gap in supplied native history/forecast')
        if times[-1]!=utc(forecast['end']): raise ValueError('Missing forecast endpoint')
        timelines.append(times)
        result.append({'reachId':reach,'status':'ok','issuedAt':maps[2][reach]['issuedAt'],
          'retrievedAt':maps[2][reach]['retrievedAt'],'units':'m3/s',
          'points':[{'time':t.isoformat(),'flowM3s':points[t],'dataRole':roles[t]} for t in times]})
    if any(t!=timelines[0] for t in timelines[1:]): raise ValueError('Inlet timelines differ')
    return {'schemaVersion':1,'kind':'initialization_and_forecast_boundary_package','status':'complete',
      'asOf':forecast['asOf'],'start':timelines[0][0].isoformat(),'end':forecast['end'],
      'forecastStart':forecast['start'],'analysisEnd':context['commonAnalysisEnd'],'series':result,
      'method':'Analysis through common end, then native forecast transition and forecast; no interpolation or held values',
      'initialState':'Not supplied by this adapter; explicit solver initialization and rainfall history required',
      'sourceArtifacts':[{'path':n,'sha256':hashlib.sha256((package/n).read_bytes()).hexdigest()} for n in names]}


def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--package',type=Path,required=True);p.add_argument('--registry',type=Path,required=True);p.add_argument('--output',type=Path,required=True);a=p.parse_args()
    if a.output.exists():raise FileExistsError('Preserve prior package')
    result=prepare(a.package,json.loads(a.registry.read_text()));a.output.write_text(json.dumps(result,indent=2)+'\n',encoding='utf-8')
    print(json.dumps({'start':result['start'],'end':result['end'],'sourceCount':len(result['series']),'samplesPerSource':len(result['series'][0]['points']),'solverExecuted':False}))

if __name__=='__main__':main()
