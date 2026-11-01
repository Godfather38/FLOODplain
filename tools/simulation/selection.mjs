// Reproducible evidence check for the specific August 2014 event-selection claim.
// This says what the retained data select, not when the original choice was made.
export function selectAugust2014(raw) {
  if (raw?.type !== 'FeatureCollection' || !Array.isArray(raw.features) || raw.features.length !== 31 || raw.links?.some(l => l.rel === 'next')) {
    throw new Error('Require a complete unpaginated 31-day August 2014 record');
  }
  const days = raw.features.map(f => {
    const p = f.properties;
    if (p?.monitoring_location_id !== 'USGS-09486500' || p.parameter_code !== '00060' || p.statistic_id !== '00003' || p.unit_of_measure !== 'ft^3/s') {
      throw new Error('Require Cortaro discharge daily means in ft^3/s');
    }
    if (p.approval_status !== 'Approved' || p.qualifier != null || p.value == null || String(p.value).trim() === '' || !Number.isFinite(Number(p.value)) || Number(p.value) < 0) {
      throw new Error('Require approved unqualified finite daily means');
    }
    return { date: p.time, dailyMeanCfs: Number(p.value) };
  }).sort((a, b) => a.date.localeCompare(b.date));
  days.forEach((p, i) => {
    if (p.date !== `2014-08-${String(i + 1).padStart(2, '0')}`) throw new Error('Missing, duplicate or out-of-month daily date');
  });
  const maximum = days.reduce((a, b) => a.dailyMeanCfs >= b.dailyMeanCfs ? a : b);
  return { station: 'USGS-09486500', statistic: 'daily mean discharge', units: 'ft^3/s', dayCount: days.length,
    rule: 'Maximum approved unqualified daily mean across all August 2014 dates; ties choose earliest date',
    selectedDate: maximum.date, selectedDailyMeanCfs: maximum.dailyMeanCfs };
}
