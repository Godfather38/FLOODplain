// Experimental conceptual runoff model. No routing/alert dependencies.
function requireValue(condition, message) { if (!condition) throw new Error(message); }
const finite = (x) => typeof x === 'number' && Number.isFinite(x);
export function validateTerrain(t) {
  requireValue(t?.schemaVersion === 1, 'Unsupported terrain schema');
  requireValue(Number.isInteger(t.rows) && Number.isInteger(t.cols) && t.rows >= 2 && t.cols >= 2 && t.rows * t.cols <= 4096, 'Terrain dimensions must be 2–4096 cells');
  requireValue(finite(t.cellSizeM) && t.cellSizeM >= 10 && t.cellSizeM <= 1000, 'Cell spacing must be 10–1000 m');
  requireValue(t.horizontalCRS === 'EPSG:4326' && t.verticalUnits === 'm', 'Terrain must use EPSG:4326 coordinates and metre elevations');
  requireValue(t.cells?.length === t.rows * t.cols, 'Terrain size mismatch');
  t.cells.forEach(c => requireValue(finite(c.elevationM) && c.elevationM > -500 && c.elevationM < 9000 && finite(c.lat) && Math.abs(c.lat) <= 90 && finite(c.lon) && Math.abs(c.lon) <= 180, 'Invalid or missing terrain cell'));
  // Row-major north-up, approximately square geographic samples. A transposed,
  // duplicated or mis-scaled grid must not silently produce plausible drainage.
  for (let i = 0; i < t.cells.length; i++) {
    const a = t.cells[i];
    for (const [j, axis] of [[i % t.cols < t.cols - 1 ? i + 1 : -1, 'east'], [i + t.cols < t.cells.length ? i + t.cols : -1, 'south']]) {
      if (j < 0) continue;
      const b = t.cells[j], dx = (b.lon - a.lon) * 111320 * Math.cos((a.lat + b.lat) * Math.PI / 360), dy = (b.lat - a.lat) * 111320;
      const along = axis === 'east' ? dx : -dy, across = axis === 'east' ? dy : dx;
      requireValue(Math.abs(along - t.cellSizeM) <= .1 * t.cellSizeM && Math.abs(across) <= .1 * t.cellSizeM, 'Terrain must be a north-up row-major grid with stated metre spacing');
    }
  }
  requireValue(Number.isInteger(t.crossingCell) && t.crossingCell >= 0 && t.crossingCell < t.cells.length, 'Invalid crossing cell');
}
export function drainage(t) {
  validateTerrain(t);
  const n = t.cells.length, downstream = Array(n).fill(-1), accumulation = Array(n).fill(1);
  // D8 steepest positive slope. Flats/pits retain water; never invent drainage through roads.
  for (let i = 0; i < n; i++) {
    const r = Math.floor(i / t.cols), c = i % t.cols;
    let best = 0;
    for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
      if ((!dr && !dc) || r + dr < 0 || r + dr >= t.rows || c + dc < 0 || c + dc >= t.cols) continue;
      const j = (r + dr) * t.cols + c + dc;
      const slope = (t.cells[i].elevationM - t.cells[j].elevationM) / (t.cellSizeM * Math.hypot(dr, dc));
      if (slope > best) { best = slope; downstream[i] = j; }
    }
    if (downstream[i] === -1 && (r === 0 || c === 0 || r === t.rows - 1 || c === t.cols - 1)) downstream[i] = -2;
  }
  const order = [...Array(n).keys()].sort((a,b) => t.cells[b].elevationM - t.cells[a].elevationM);
  for (const i of order) if (downstream[i] >= 0) accumulation[downstream[i]] += accumulation[i];
  const contributes = Array(n).fill(false);
  contributes[t.crossingCell] = true;
  for (const i of [...order].reverse()) if (downstream[i] >= 0 && contributes[downstream[i]]) contributes[i] = true;
  return { downstream, accumulation, contributes };
}
export function validateRain(rain, t) {
  requireValue(rain?.schemaVersion === 1 && rain.units === 'mm/h', 'Rainfall must be schema 1 in mm/h');
  requireValue(['synthetic', 'radar-estimate'].includes(rain.kind), 'Rainfall provenance must be synthetic or radar-estimate');
  requireValue(typeof rain.source === 'string' && rain.source.length > 0, 'Rainfall source required');
  requireValue(JSON.stringify(rain.grid) === JSON.stringify(gridIdentity(t)), 'Rainfall coordinates do not match terrain grid');
  requireValue(rain.frames?.length > 0 && rain.frames.length <= 720, 'Provide 1–720 rainfall intervals');
  let previousEnd;
  for (const frame of rain.frames) {
    requireValue(typeof frame.start === 'string' && frame.start.endsWith('Z') && Number.isFinite(Date.parse(frame.start)), 'Rainfall times must be UTC ISO strings');
    requireValue(finite(frame.durationMinutes) && frame.durationMinutes >= 1 && frame.durationMinutes <= 60, 'Interval must be 1–60 minutes');
    const start = Date.parse(frame.start);
    requireValue(previousEnd === undefined || Math.abs(start - previousEnd) < 1, 'Rainfall intervals must be contiguous without overlap or gaps');
    previousEnd = start + frame.durationMinutes * 60000;
    requireValue(Array.isArray(frame.rates) && frame.rates.length === t.cells.length, 'Rainfall grid size mismatch');
    requireValue(frame.rates.every(x => finite(x) && x >= 0 && x <= 500), 'Missing/negative/out-of-range radar rain; missing is not zero');
  }
  requireValue((previousEnd - Date.parse(rain.frames[0].start)) <= 86400000, 'Maximum storm length is 24 hours');
}
export function gridIdentity(t) { return t.cells.map(c => [c.lon, c.lat]); }
export function terrainDiagnostics(t, network = drainage(t)) {
  validateTerrain(t);
  const isBoundary = i => i < t.cols || i >= t.cells.length - t.cols || i % t.cols === 0 || i % t.cols === t.cols - 1;
  const contributingBoundaryCells = network.contributes.reduce((n, contributes, i) => n + Number(contributes && isBoundary(i)), 0);
  const retainedPitCells = network.downstream.filter(j => j === -1).length;
  const crossingRetainsWater = network.downstream[t.crossingCell] === -1;
  const warnings = ['Clipped local window with no external upstream inflow; not a delineated basin.', 'Sample spacing does not resolve road/culvert or channel hydraulics.'];
  if (contributingBoundaryCells) warnings.push('The crossing contributing set reaches the grid boundary; its upstream extent is truncated.');
  if (crossingRetainsWater) warnings.push('The crossing sample is an unresolved pit: arrival flow is retained, not bridge discharge.');
  if (isBoundary(t.crossingCell)) warnings.push('The crossing lies on the clipping boundary.');
  return { basinStatus: 'clipped-local-window', crossingDischargeSupported: false,
    contributingBoundaryCells, retainedPitCells, crossingRetainsWater,
    localContributingAreaKm2: network.accumulation[t.crossingCell] * t.cellSizeM ** 2 / 1e6,
    sampleSpacingM: t.cellSizeM, warnings };
}
export function syntheticRain(t) {
  return { schemaVersion: 1, units: 'mm/h', kind: 'synthetic', grid: gridIdentity(t), source: 'Invented 30-minute pulse; no radar observations',
    frames: [0, 12, 30, 45, 20, 5].map((rate, i) => ({ start: new Date(Date.UTC(2026, 6, 1, 0, i * 5)).toISOString(), durationMinutes: 5,
      rates: t.cells.map((_, j) => rate * (0.7 + 0.3 * (j % t.cols) / (t.cols - 1))) })) };
}
export function simulate(t, rain, { infiltrationMmH = 10, travelMinutes = 8, multiplier = 1, tailMinutes = 180 } = {}) {
  validateTerrain(t); validateRain(rain, t);
  requireValue(finite(infiltrationMmH) && infiltrationMmH >= 0 && infiltrationMmH <= 100, 'Infiltration must be 0–100 mm/h');
  requireValue(finite(travelMinutes) && travelMinutes >= 1 && travelMinutes <= 120, 'Travel time must be 1–120 min');
  requireValue(finite(multiplier) && multiplier >= 0 && multiplier <= 3, 'Rain multiplier must be 0–3');
  requireValue(Number.isInteger(tailMinutes) && tailMinutes >= 0 && tailMinutes <= 720, 'Drainage tail must be 0–720 min');
  const network = drainage(t), n = t.cells.length, storage = Array(n).fill(0), area = t.cellSizeM ** 2;
  const frames = rain.frames, duration = frames.reduce((s,f) => s + f.durationMinutes, 0), series = [];
  const totals = { rainfallM3: 0, infiltrationM3: 0, boundaryOutflowM3: 0, storedM3: 0, residualM3: 0 };
  let frameIndex = 0, frameEnd = frames[0].durationMinutes, elapsed = 0;
  // One-minute synchronous transfers prevent numerical order dependence. Exponential reservoir release is positive and conservative.
  while (elapsed < duration + tailMinutes - 1e-9) {
    while (elapsed >= frameEnd - 1e-9 && frameIndex < frames.length - 1) frameEnd += frames[++frameIndex].durationMinutes;
    const dt = Math.min(1, duration + tailMinutes - elapsed, elapsed < duration ? frameEnd - elapsed : Infinity);
    let rainfallM3 = 0, outflowM3 = 0, crossingInflowM3 = 0;
    for (let i = 0; i < n; i++) {
      const rate = elapsed < duration ? frames[frameIndex].rates[i] * multiplier : 0;
      const input = rate * dt / 60 / 1000 * area;
      const loss = Math.min(rate, infiltrationMmH) * dt / 60 / 1000 * area;
      rainfallM3 += input; totals.rainfallM3 += input; totals.infiltrationM3 += loss;
      storage[i] += input - loss;
      if (i === t.crossingCell) crossingInflowM3 += input - loss;
    }
    const released = storage.map((v,i) => network.downstream[i] === -1 ? 0 : v * (1 - Math.exp(-dt / travelMinutes)));
    for (let i = 0; i < n; i++) {
      storage[i] -= released[i];
      const target = network.downstream[i];
      if (target >= 0) storage[target] += released[i];
      if (target === t.crossingCell) crossingInflowM3 += released[i];
      if (target === -2) outflowM3 += released[i];
    }
    elapsed += dt; totals.boundaryOutflowM3 += outflowM3;
    series.push({ minute: elapsed, rainfallMmH: rainfallM3 / (area * n) * 1000 * 60 / dt,
      boundaryM3s: outflowM3 / (dt * 60), crossingM3s: crossingInflowM3 / (dt * 60), crossingOutflowM3s: released[t.crossingCell] / (dt * 60), storageM3: [...storage] });
  }
  totals.storedM3 = storage.reduce((a,b) => a+b, 0);
  totals.residualM3 = totals.rainfallM3 - totals.infiltrationM3 - totals.boundaryOutflowM3 - totals.storedM3;
  return { network, terrainQuality: terrainDiagnostics(t, network), series, totals, rainKind: rain.kind, parameters: { infiltrationMmH, travelMinutes, multiplier, tailMinutes } };
}
