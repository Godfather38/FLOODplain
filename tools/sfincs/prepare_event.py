"""Change only event forcing and dates in the frozen 86466e7 native case."""
import argparse, hashlib, json, re
from pathlib import Path
from prepare_reach import prepare as prepare_forcing


def prepare(source, target, terrain, upstream, forcing, protocol, allow_six_hour_scenario=False):
    source, target = Path(source), Path(target)
    freeze = json.loads(Path(protocol).read_text())
    if target.exists():
        raise FileExistsError('Preserve previous cases')
    staged = target.with_name(target.name + '-forcing-preparation')
    # Reuse established input validation and HydroMT precipitation serialization.
    # This temporary regular grid is not executed or used as hydraulic geometry.
    prepare_forcing(staged, terrain, upstream, forcing=forcing, dry_start=True, allow_six_hour_scenario=allow_six_hour_scenario)
    event = json.loads((staged/'case.json').read_text())
    if any(event[k].replace('+00:00','Z') != freeze[p] for k,p in [('start','eventStart'),('end','eventEnd')]):
        raise ValueError('Event window differs from preregistered protocol')
    from pandas import Timestamp, Timedelta
    evaluation_start = Timestamp(freeze['evaluationStart'])
    if not Timestamp(event['start']) + Timedelta(hours=24) <= evaluation_start < Timestamp(event['end']):
        raise ValueError('Evaluation must follow at least 24 hours initialization and precede end')
    event['evaluationStart'] = evaluation_start.isoformat()
    case = json.loads((source/'case.json').read_text())
    if (event['upstream']['cellRow'],event['upstream']['cellColumn']) != (case['upstream']['cellRow'],case['upstream']['cellColumn']):
        raise ValueError('Gauge source cell differs from frozen configuration')
    target.mkdir(parents=True)
    for item in freeze['inputArtifacts']:
        data = (source/item['path']).read_bytes()
        if hashlib.sha256(data).hexdigest() != item['sha256']:
            raise ValueError('Frozen input mismatch: '+item['path'])
        (target/item['path']).write_bytes(data)
    def config(path):
        return dict(line.split('=',1) for line in path.read_text().splitlines() if '=' in line)
    old = {k.strip():v.strip() for k,v in config(target/'sfincs.inp').items()}
    fresh = {k.strip():v.strip() for k,v in config(staged/'sfincs.inp').items()}
    text = (target/'sfincs.inp').read_text()
    for key in ('tref','tstart','tstop','dtmaxout'):
        text = re.sub(r'(?m)^'+key+r'\s*=.*$',f'{key:20s} = {fresh[key]}',text)
    (target/'sfincs.inp').write_text(text)
    for name in ('rainfall.nc','sfincs.dis'):
        (target/name).write_bytes((staged/name).read_bytes())
    for key in ('start','end','evaluationStart','prescribedInflowVolumeM3','rainfallStatus','forcingProvenance','forcingQuality','forcingSha256','rainfallVolumeM3','initialState'):
        case[key] = event[key]
    case['upstream']['sourceUrl'] = event['upstream']['sourceUrl']
    case['upstream']['sha256'] = event['upstream']['sha256']
    case['initialState']['description'] = freeze.get('initialStateDescription',case['initialState']['description'])
    case['evaluationProtocol'] = freeze
    case['validationRole'] = freeze['validationRole']
    if allow_six_hour_scenario:
        case['limitations'].append('Qualified antecedent rainfall: July16 00-06UTC six-hour Stage IV total uniformly allocated to hours; product discrepancy -32.25 to +5.61 mm against five available hourly sums; not recovered hourly observations')
    case['limitations'] = [x.replace('2014','historical event') for x in case['limitations'] if 'iterative development comparison' not in x]
    if freeze.get('initialStateDescription'):
        case['limitations']=[x.replace('Assumed dry initial state followed by 24 hours of observed inflow and Stage IV rainfall spinup',freeze['initialStateDescription']) for x in case['limitations']]
    case['limitations'].append('Frozen configuration evaluated on 2013; 2015 terrain and levee condition postdate this event; no event-specific tuning')
    case['inputArtifacts'] = [{'path':i['path'],'sha256':hashlib.sha256((target/i['path']).read_bytes()).hexdigest()} for i in freeze['inputArtifacts']]
    changed = [i['path'] for i,j in zip(case['inputArtifacts'],freeze['inputArtifacts']) if i['sha256'] != j['sha256']]
    if set(changed) != {'sfincs.inp','sfincs.dis','rainfall.nc'}:
        raise ValueError('Unexpected native input changes: '+repr(changed))
    case['frozenGeometryVerification'] = {'referenceCommit':freeze['configurationCommit'],'changedNativeFiles':changed,'allOtherNativeFilesIdentical':True}
    (target/'case.json').write_text(json.dumps(case,indent=2)+'\n')
    print(json.dumps(case['frozenGeometryVerification']))

if __name__ == '__main__':
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('source');p.add_argument('target')
    for name in ('terrain','upstream','forcing','protocol'):p.add_argument('--'+name,required=True)
    p.add_argument('--allow-six-hour-scenario',action='store_true')
    a=p.parse_args();prepare(**vars(a))
