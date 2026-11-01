import test from 'node:test';import assert from 'node:assert/strict';
import {verifyCompletedGeometry,terrainArtifacts} from '../tools/simulation/prepare-completed-terrain.mjs';
import {syntheticRefinedPackage} from './fixtures/refined-renderer-synthetic.js';
function fixture(){const f=syntheticRefinedPackage(),source=structuredClone(f.manifest),target=structuredClone(f.manifest),a=structuredClone(f.geometry),b=structuredClone(f.geometry);source.provenance.meshSha256=target.provenance.meshSha256='b'.repeat(64);target.runId=b.runId='SYNTHETIC-COMPLETED';target.geometry.sha256='c'.repeat(64);return {source,target,a,b};}
test('SYNTHETIC cross-run terrain certificate requires exact ordered geometry and source bindings',()=>{
 const f=fixture(),e=verifyCompletedGeometry(f.source,f.target,f.a,f.b);assert.equal(e.sourceRunId,f.source.runId);assert.equal(e.targetRunId,f.target.runId);assert.equal(e.sourceGeometrySha256,f.source.geometry.sha256);assert.equal(e.targetGeometrySha256,f.target.geometry.sha256);assert.match(e.canonicalSha256,/^[a-f0-9]{64}$/);
 for(const mutate of [f=>f.target.provenance.meshSha256='d'.repeat(64),f=>f.target.provenance.verticalDatum='unknown',f=>f.b.runId='wrong',f=>f.a.runId='wrong',f=>f.target.status='partial',f=>f.b.cells.reverse(),f=>f.b.rings[0][0][0]+=.00001,f=>f.b.cells[0].areaM2++,f=>f.b.projectedCrs='wrong']){const x=fixture();mutate(x);assert.throws(()=>verifyCompletedGeometry(x.source,x.target,x.a,x.b));}
});
test('SYNTHETIC terrain preparation includes unchanged native, overview and water-support artifacts',()=>{
 const a=path=>({path,sha256:'a'.repeat(64),bytes:100}),index={tiles:[{levels:[{artifact:a('tile.json.gz')}]}],overviewLevels:[{artifact:a('overview.json.gz')}],waterSupport:{artifact:a('support.json.gz')}};
 const artifacts=terrainArtifacts(index,a('index.json.gz'));assert.deepEqual([...artifacts.keys()],['index.json.gz','tile.json.gz','overview.json.gz','support.json.gz']);assert.equal(artifacts.get('support.json.gz'),index.waterSupport.artifact);
 index.overviewLevels.push({artifact:{...a('tile.json.gz'),sha256:'b'.repeat(64)}});assert.throws(()=>terrainArtifacts(index,a('index.json.gz')),/Conflicting/);
});
