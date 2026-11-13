"""Extract 16 real Picture Rocks cells for a bounded mechanism test, not a forecast."""
import importlib.util,json,hashlib,tarfile
from pathlib import Path
import numpy as np,xarray as xr,xugrid as xu
base=Path('H:/AI/Projects/FLOODplain-coverage/.sfincs-runs/current-picture-rocks-20261113T224142Z/native')
out=Path('.sfincs-runs/pr-16-real-cells');out.mkdir(exist_ok=True)
g=xu.open_dataset(base/'sfincs.nc').load()
c=next(c for c in json.load(open('tools/live/all-route-cases.json'))['cases'] if c['case']=='picture-rocks')
ids=np.load(c['faceMapping']['path']);target=int(np.flatnonzero(ids==527725)[0]);n=g['n'].values.copy();m=g['m'].values.copy();l=g['level'].values.copy()
selected=np.flatnonzero((l==l[target])&(n>=n[target]-1)&(n<=n[target]+2)&(m>=m[target]-1)&(m<=m[target]+2));assert len(selected)==16
neighbors=np.stack([g[k].values for k in ('mu1','mu2','nu1','nu2')],axis=1)-1
row,col=np.nonzero(neighbors>=0);destinations=neighbors[row,col]
sg=xr.open_dataset(base/'sfincs_subgrid.nc').load();assert len(row)==sg.sizes['npuv']
keep=np.isin(row,selected)&np.isin(destinations,selected)
lookup={(int(row[i]),int(destinations[i])):int(i) for i in np.flatnonzero(keep)}
g['mask'].values[:]=0;g['mask'].values[selected]=1;g['snapwave_mask'].values[:]=0
factor=2**(int(l[target])-1);g.attrs['dx']/=factor;g.attrs['dy']/=factor;g.attrs['nmax']*=factor;g.attrs['mmax']*=factor;g.attrs['nr_levels']=1;g['level'].values[selected]=1
spec=importlib.util.spec_from_file_location('builder','H:/AI/Projects/FloodPLAIN-sfincs/.sfincs-runs/cht-refinement-source/quadtree_builder.py');b=importlib.util.module_from_spec(spec);spec.loader.exec_module(b)
small=b.cut_inactive_cells(g);small.ugrid.to_netcdf(out/'sfincs.nc')
key={(int(n[i]),int(m[i])):int(i) for i in selected}
order=[key[(int(bb),int(cc))] for a,bb,cc in zip(small['level'].values,small['n'].values,small['m'].values)]
uv=[]
for i in range(16):
 for k in ('mu1','mu2','nu1','nu2'):
  j=int(small[k].values[i])-1
  if j>=0:uv.append(lookup[(order[i],order[j])])
sg.isel(np=order,npuv=uv).to_netcdf(out/'sfincs_subgrid.nc')
inf=xr.open_dataset(base/'infiltration.nc').load();inf.isel(mesh2d_nFaces=order).to_netcdf(out/'infiltration.nc')
# Preserve the previous bounded pulse schedule to isolate actual geometry/CNA handling.
prior=Path('.sfincs-runs/small-native-regression/case')
(out/'sfincs.precip').write_bytes((prior/'sfincs.precip').read_bytes())
lines=[]
for line in (prior/'sfincs.inp').read_text().splitlines():
 k=line.split('=',1)[0].strip()
 if k not in ('indexfile','mskfile','depfile','scsfile','mmax','nmax','dx','dy','x0','y0','rotation'):lines.append(line)
lines+=['qtrfile = sfincs.nc','inffile = infiltration.nc','inftype = cna']
(out/'sfincs.inp').write_text('\n'.join(lines)+'\n')
meta={'kind':'real-cell-synthetic-forcing-regression-not-forecast','cells':16,'sourceFaces':[int(ids[i]) for i in order],'targetSourceFace':527725,'boundary':'closed crop, upstream flow intentionally absent','rain':'same bounded artificial light/heavy/dry pulse as initial fixture','limitations':['Not current forecast forcing','Crop excludes external fluxes and soil history','Cannot establish full-route correctness'],'archiveSha256':None,'files':[]}
for p in sorted(out.glob('*')):
 if p.is_file():meta['files'].append({'path':p.name,'sha256':hashlib.sha256(p.read_bytes()).hexdigest(),'bytes':p.stat().st_size})
dest=Path('tools/live/fixtures/pr-real-cells');dest.mkdir(parents=True,exist_ok=True)
with tarfile.open(dest/'fixture.tar.gz','w:gz') as t:
 for item in meta['files']:t.add(out/item['path'],arcname=item['path'])
meta['archiveSha256']=hashlib.sha256((dest/'fixture.tar.gz').read_bytes()).hexdigest();(dest/'fixture.json').write_text(json.dumps(meta,indent=2));print(json.dumps(meta))
