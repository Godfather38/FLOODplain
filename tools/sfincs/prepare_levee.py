"""Import a documented levee with dated USGS crest heights using native HydroMT weirs."""
import argparse,hashlib,json
from pathlib import Path
from hydromt_sfincs import SfincsModel
from hydromt import DataCatalog


def prepare(source,target,structures):
    source,target,structures=Path(source),Path(target),Path(structures)
    if target.exists():raise FileExistsError('Preserve previous case')
    evidence=json.loads((structures/'structure-provenance.json').read_text())
    vector=structures/'lower-santa-cruz-2015-crests.gpkg'
    if hashlib.sha256(vector.read_bytes()).hexdigest()!=evidence['outputSha256']:raise ValueError('Structure provenance mismatch')
    case=json.loads((source/'case.json').read_text());target.mkdir(parents=True)
    for item in case['inputArtifacts']:
        data=(source/item['path']).read_bytes()
        if hashlib.sha256(data).hexdigest()!=item['sha256']:raise ValueError('Reference input changed')
        (target/item['path']).write_bytes(data)
    model=SfincsModel(root=str(target),mode='r+',write_gis=False);model.data_catalog=DataCatalog(fallback_lib=None);model.read()
    model.setup_structures(structures=str(vector.resolve()),stype='weir',merge=False)
    model.write_geoms();model.write_config()
    case['structureIntegration']=evidence
    case['limitations'].append('Published Lower Santa Cruz levee alignment uses USGS February 2015 crest elevations as finite overtoppable weirs; post-event condition and undocumented openings remain uncertain')
    case['inputArtifacts']=[{'path':p.name,'sha256':hashlib.sha256(p.read_bytes()).hexdigest()} for p in sorted(target.iterdir()) if p.is_file() and (p.name.startswith('sfincs.') or p.name.startswith('sfincs_') or p.name in {'sections.crs','rainfall.nc'})]
    (target/'case.json').write_text(json.dumps(case,indent=2)+'\n')
    print(json.dumps({'weirFile':model.config.get('weirfile'),'parts':len(model.geoms['weir']),'heightAdjustmentM':0,'subgridRebuilt':False}))

if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('source');p.add_argument('target');p.add_argument('--structures',required=True);a=p.parse_args();prepare(a.source,a.target,a.structures)
