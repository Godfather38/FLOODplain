"""Interpret the pinned native dry branch; never alter signed water volumes."""
import hashlib
from pathlib import Path
import h5py
import numpy as np
SOURCE_COMMIT='f3647fc0289bb15cb2512d60686cef74cb853c78'
ENGINE_SHA256='c4917bc54158b0943d6d128b45c4346a33d059fb5d93808d05520c975e38f090'
STATIC_SHA256={'sfincs.nc':'76b60da1bcceacd448d3817f1ec28383dfc475bbd9a10d86d419a280558059a0','sfincs_subgrid.nc':'e57fc0d61a7ef8a82c101b1772f27383775d5b8870201df2f1fb7eca8f9dfdb2'}
# Conservative interpretation limits, NOT solver accuracy/error bounds. Much
# narrower than the separate 1 mm package materiality check. Never infer safety.
MAX_DEPTH_M=1e-7
MAX_VOLUME_M3=1e-5

class NativeDryEvidence:
 def __init__(self,active,bottom,capacity,provenance):
  self.eligible=(np.asarray(active)==1)&np.isfinite(bottom)&(np.asarray(bottom)>-20)&np.isfinite(capacity)&(np.asarray(capacity)>0)
  self.provenance=dict(provenance,sourceCommit=SOURCE_COMMIT,maxResidualDepthM=MAX_DEPTH_M,maxResidualVolumeM3=MAX_VOLUME_M3,meaning='Pinned SFINCS modeled dry state; raw residual retained; not observed road safety',thresholdMeaning='Conservative interpretation limits, not a solver error bound')
 def classify(self,volume,surface,area):
  v=np.asarray(volume,dtype=float);z=np.asarray(surface,dtype=float);a=np.asarray(area,dtype=float)
  if v.shape!=self.eligible.shape or z.shape!=v.shape or a.shape!=v.shape:raise ValueError('Native dry evidence shape mismatch')
  # The pinned continuity branch sets zs to the finite subgrid minimum when
  # volume<=1e-6; wet-only NetCDF output suppresses that dry level. Compact
  # export represents that sentinel as NaN. Finite/wet or infinite surfaces
  # contradict this branch and are never overridden.
  return self.eligible&np.isfinite(v)&(v<0)&(v>=-MAX_VOLUME_M3)&np.isfinite(a)&(a>0)&(v>=-MAX_DEPTH_M*a)&(np.isnan(z)|(z==-99999.0))

def load_evidence(work,order,case,completed,source_commit):
 if case!='picture-rocks' or not completed or source_commit!=SOURCE_COMMIT:return None
 work=Path(work)
 if any(not (work/n).exists() or hashlib.sha256((work/n).read_bytes()).hexdigest()!=h for n,h in STATIC_SHA256.items()):return None
 config={l.split('=',1)[0].strip():l.split('=',1)[1].strip() for l in (work/'sfincs.inp').read_text().splitlines() if '=' in l}
 if float(config.get('theta','nan'))!=1 or config.get('sbgfile')!='sfincs_subgrid.nc':return None
 with h5py.File(work/'sfincs.nc') as mesh,h5py.File(work/'sfincs_subgrid.nc') as sub:
  mask,bottom,capacity=mesh['mask'][:],sub['z_zmin'][:],sub['z_volmax'][:]
 if not np.array_equal(np.sort(order),np.arange(len(mask))):return None
 return NativeDryEvidence(mask[order],bottom[order],capacity[order],{'staticSha256':STATIC_SHA256,'scope':'picture-rocks pinned physical case','completedNativeRun':True})

def verified_engine_source(work):
 engine=Path(work).parent/'engine';p=engine/'SOURCE_COMMIT';binary=engine/'sfincs'
 if p.exists() and binary.exists() and hashlib.sha256(binary.read_bytes()).hexdigest()==ENGINE_SHA256:return p.read_text().strip()
 return None
