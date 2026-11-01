import {test} from 'node:test';
import assert from 'node:assert/strict';
import {acceptInundationRun} from '../public/simulation/inundation-contract.js';
test('solver boundary preserves missing depth and requires location/provenance without producing invented results',()=>{
 const run={schemaVersion:1,model:'SFINCS',kind:'inundation_scenario',status:'complete',crs:'EPSG:4326',cells:[{lon:-111.3,lat:32.4}],frames:[{time:'2014-09-08T18:00:00Z',depthM:[null]}],provenance:{solverVersion:'test-fixture',runId:'synthetic-contract-test',inputArtifacts:['synthetic-test-only']},support:{domainDescription:'synthetic contract fixture',limitations:['Not a solver result']},uncertainty:{status:'uncalibrated',plusMinus:null}};
 assert.equal(acceptInundationRun(run).frames[0].depthM[0],null);
 assert.equal(acceptInundationRun({...run,provenance:{}}).status,'unsupported');
 assert.equal(acceptInundationRun({...run,frames:[{...run.frames[0],depthM:[-1]}]}).status,'unsupported');
 assert.equal(acceptInundationRun({...run,status:'running'}).status,'insufficient_data');
});
