"""Add native flow observations to a preserved case without changing its physics inputs."""
import argparse,hashlib,json,shutil
from pathlib import Path

def prepare(source,target):
    source,target=Path(source),Path(target)
    if target.exists():raise FileExistsError('Preserve prior case; choose a new directory')
    case=json.loads((source/'case.json').read_text());target.mkdir(parents=True)
    for item in case['inputArtifacts']:
        data=(source/item['path']).read_bytes()
        if hashlib.sha256(data).hexdigest()!=item['sha256']:raise ValueError('Reference input changed')
        (target/item['path']).write_bytes(data)
    sections=case['sections'];x=sections['trico_reach'][0][0]
    bottom=sections['south_out'][0][1];top=sections['north_out'][0][1]
    sections.update({'trico_full':[(x,bottom),(x,top)],
                     'trico_south_tail':[(x,bottom),sections['trico_reach'][0]],
                     'trico_north_tail':[sections['trico_reach'][1],(x,top)]})
    for value in [489000,485000,480000,475000]:sections[f'reach_x{value}']=[(value,bottom),(value,top)]
    with (target/'sections.crs').open('w',newline='\n') as out:
        for name,points in sections.items():
            out.write(name+'\n2 2\n')
            for a,b in points:out.write(f'{a:.3f} {b:.3f}\n')
    case['sectionDiagnostic']={'referenceInputCommit':'723817b','referenceRunId':41291800062,
        'purpose':'Measure flow beyond the original Trico section and along the reach; not parameter calibration',
        'physicsInputsChanged':False,'fullSectionIsGaugeMeasurement':False}
    for item in case['inputArtifacts']:
        if item['path']=='sections.crs':item['sha256']=hashlib.sha256((target/'sections.crs').read_bytes()).hexdigest()
    (target/'case.json').write_text(json.dumps(case,indent=2)+'\n')
    print(json.dumps({'newSections':len(sections)-5,'physicsInputsChanged':False}))
if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('source');p.add_argument('target');a=p.parse_args();prepare(a.source,a.target)
