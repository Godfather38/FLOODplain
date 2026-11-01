// Additional event only. Never rewrites frozen parameters or the September benchmark.
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { routeGauge } from '../../public/simulation/routing.js';
import { compareDischarge } from '../../public/simulation/observations.js';
import { selectAugust2014 } from './selection.mjs';
const root = 'public/simulation/data/';
const hash = s => createHash('sha256').update(s.replace(/\r\n/g, '\n')).digest('hex');
const selectionPath = 'cortaro-selection-2014-08.json';
const selectionText = await readFile(root + selectionPath, 'utf8');
const selectionRecord = JSON.parse(selectionText);
const checkedSelection = selectAugust2014(selectionRecord.raw);
if (JSON.stringify(checkedSelection) !== JSON.stringify(selectionRecord.selection)) throw new Error('Monthly selection summary differs from source');
let firstScoredAt;
try { const previous = JSON.parse(await readFile(root + 'routing-evaluation-2014-08.json', 'utf8')); firstScoredAt = previous.firstScoredAt ?? previous.generatedAt; }
catch (error) { if (error.code !== 'ENOENT') throw error; }
const frozenFiles = ['routing-frozen-2006.json', 'routing-frozen-2013.json'];
const frozenTexts = await Promise.all(frozenFiles.map(p => readFile(root + p, 'utf8')));
const frozen = frozenTexts.map(JSON.parse);
for (const f of frozen) for (const input of f.inputs) {
  if (hash(await readFile(root + input.path, 'utf8')) !== input.sha256) throw new Error('Calibration fixture differs from frozen version');
}
const paths = ['cortaro-evaluation-2014-08.json', 'trico-evaluation-2014-08.json'];
const texts = await Promise.all(paths.map(p => readFile(root + p, 'utf8')));
const [up, down] = texts.map(s => JSON.parse(s).normalized);
const scoringStart = new Date(Date.parse(up.points[0].time) + 24 * 3600000).toISOString();
const observed = { ...down, points: down.points.filter(p => p.time >= scoringStart) };
const eligible = observed.points.filter(p => p.approval === 'Approved' && p.qualifier === null);
const peak = points => points.reduce((a, b) => a.valueM3s >= b.valueM3s ? a : b);
const actualPeak = peak(eligible);
const candidates = [
  { name: 'Primary: unchanged 2006 fit', parameters: frozen[0].parameters, color: '#ea9f42' },
  { name: 'Secondary: unchanged 2013 fit', parameters: frozen[1].parameters, color: '#78b9ff' },
  { name: 'Baseline: unchanged upstream', parameters: { lagMinutes: 0, kMinutes: 0, transmission: 1 }, color: '#909ca7' }
];
const results = candidates.map(c => {
  const modeled = routeGauge(up, c.parameters);
  const points = modeled.points.filter(p => p.time >= scoringStart);
  const predictedPeak = peak(points);
  return { ...c, points, predictedPeak, score: compareDischarge(modeled, observed),
    peakErrorPercent: 100 * (predictedPeak.valueM3s / actualPeak.valueM3s - 1),
    peakTimingErrorMinutes: (Date.parse(predictedPeak.time) - Date.parse(actualPeak.time)) / 60000 };
});
const report = {
  schemaVersion: 1, generatedAt: new Date().toISOString(), firstScoredAt: firstScoredAt ?? new Date().toISOString(), event: 'August 16–23, 2014 UTC/MST-boundary window',
  selection: 'Not used in fitting. The stated selection rule is the highest Cortaro daily mean in August 2014 (August 19, 442 ft3/s). No contemporaneous full monthly response or committed pre-evaluation selection record was retained. The retained monthly source was retrieved after scoring and reproduces the rule, not the timing of the original choice. Selection history is therefore not independently documented; this is not a blinded evaluation program.',
  selectionEvidence: { path: selectionPath, sha256: hash(selectionText), retrievedAt: selectionRecord.retrievedAt,
    evidenceStatus: selectionRecord.evidenceStatus, contemporaneousSelectionRecordRetained: false, checkedSelection },
  method: 'Same fixed models, unit transmission, 24h warm-up and quality/exact-time pairing rules as September benchmark; no retuning.',
  freezeCommit: 'b4c4c1b', frozenFiles: frozenFiles.map((path, i) => ({ path, sha256: hash(frozenTexts[i]) })),
  inputSources: paths.map((path, i) => ({ path, sha256: hash(texts[i]), sourceUrl: [up, down][i].sourceUrl, quality: [up, down][i].quality })),
  scoringStart, scoringEnd: observed.points.at(-1).time, actualPeak, observed: observed.points, results,
  limitation: 'Observed upstream discharge forcing, not rainfall-runoff or crossing hydraulics. Event transfer can fail; retain all outcomes. No safety/passability inference.'
};
await writeFile(root + 'routing-evaluation-2014-08.json', JSON.stringify(report, null, 2) + '\n');
const cfs = q => q / .028316846592, fmt = (n, digits = 1) => n.toFixed(digits);
const start = Date.parse(scoringStart), end = Date.parse(report.scoringEnd);
const maxFlow = Math.max(...results.flatMap(r => r.points.map(p => cfs(p.valueM3s))), cfs(actualPeak.valueM3s));
const ymax = Math.ceil(maxFlow / 500) * 500;
const x = time => 80 + (Date.parse(time) - start) / (end - start) * 1000;
const y = value => 430 - cfs(value) / ymax * 350;
const path = points => points.map((p, i) => `${i ? 'L' : 'M'}${x(p.time).toFixed(2)},${y(p.valueM3s).toFixed(2)}`).join(' ');
const grid = Array.from({ length: 6 }, (_, i) => `<path d="M80 ${430 - i * 70}H1080" stroke="#334351"/><text x="70" y="${435 - i * 70}" text-anchor="end">${Math.round(ymax * i / 5)}</text>`).join('');
const ticks = Array.from({ length: 7 }, (_, i) => `<text x="${80 + i * 1000 / 6}" y="458" text-anchor="middle">${new Date(start + (end - start) * i / 6).toISOString().slice(5, 10)}</text>`).join('');
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1160" height="570" viewBox="0 0 1160 570"><rect width="1160" height="570" fill="#14232e"/><g font-family="Arial,sans-serif" fill="#dce8ee" font-size="14"><text x="80" y="30" font-size="23">Additional test: August 2014 Cortaro to Trico</text><text x="80" y="55">Same frozen parameters, no refitting | discharge ft3/s | UTC dates</text>${grid}${ticks}${results.slice().reverse().map(r => `<path d="${path(r.points)}" fill="none" stroke="${r.color}" stroke-width="2.5"/>`).join('')}<path d="${path(observed.points)}" fill="none" stroke="#fff" stroke-width="3"/><text x="80" y="490">24h warm-up excluded. Full-window peaks may be different storm pulses; see both curves.</text><text x="80" y="525" fill="#fff">White: observed Trico</text>${results.map((r, i) => `<text x="${80 + i * 350}" y="550" fill="${r.color}">${r.name}</text>`).join('')}</g></svg>`;
await writeFile('public/simulation/routing-evaluation-2014-08.svg', svg + '\n');
const rows = results.map(r => `<tr><td>${r.name}</td><td>${fmt(cfs(r.predictedPeak.valueM3s), 0)}</td><td>${fmt(r.peakErrorPercent)}%</td><td>${r.peakTimingErrorMinutes} min</td><td>${fmt(cfs(r.score.rmseM3s), 0)}</td><td>${fmt(r.score.nashSutcliffe, 3)}</td></tr>`).join('');
const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>FLOODplain | Independent event evaluation</title><link rel="stylesheet" href="lab.css"></head><body><main><p class="eyebrow">FLOODplain / Additional event test</p><h1>Do the frozen models transfer?</h1><p>August 2014 event, not used to fit either model. The September result and frozen parameters are unchanged.</p><aside><strong>Research evidence, including misses</strong><p>Every predeclared model is retained. Parameters were not tuned on this event. Observed upstream discharge is the forcing; this is not a rainfall-runoff forecast, road-depth estimate or bridge-failure prediction.</p></aside><img src="routing-evaluation-2014-08.svg" style="width:100%;height:auto" alt="Additional August event: observed Trico and unchanged models"><p>Observed sampled peak: ${fmt(cfs(actualPeak.valueM3s), 0)} ft3/s at ${actualPeak.time}. Negative timing error is early. With multiple pulses, the model's largest pulse may differ from the observed largest pulse, so this is not necessarily a travel-time error.</p><div style="overflow-x:auto"><table style="width:100%;text-align:left;border-spacing:14px"><thead><tr><th>Model</th><th>Peak ft3/s</th><th>Peak error</th><th>Peak timing</th><th>RMSE ft3/s</th><th>NSE</th></tr></thead><tbody>${rows}</tbody></table></div><p>${results[0].score.pairCount} matched approved unqualified points; 24h warm-up removed. NSE below zero means worse squared error than using the observed event mean as a constant retrospective reference, not a live forecast baseline.</p><p>${report.selection}</p><p><a href="data/routing-evaluation-2014-08.json" download>Download curves, scores and provenance</a> | <a href="routing-result.html">Original September benchmark</a> | <a href="./">Terrain lab and source status</a></p><p>Browser visual QA remains unperformed. No production or alert integration.</p></main></body></html>`;
await writeFile('public/simulation/routing-evaluation.html', html + '\n');
console.log(JSON.stringify({ actualPeakCfs: cfs(actualPeak.valueM3s), results: results.map(r => ({ name: r.name, peakCfs: cfs(r.predictedPeak.valueM3s), peakErrorPercent: r.peakErrorPercent, peakTimingErrorMinutes: r.peakTimingErrorMinutes, rmseCfs: cfs(r.score.rmseM3s), nse: r.score.nashSutcliffe, pairs: r.score.pairCount })) }, null, 2));
