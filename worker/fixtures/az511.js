// Synthetic fixtures using documented field names; not live API records.
const seconds = iso => Date.parse(iso) / 1000;
export const az511Events = [
  {ID:1, SourceId:'fixture-ramp', RoadwayName:'I-10 westbound ramp',
    Description:'Cortaro ramp to I-10 westbound closed.', IsFullClosure:true,
    StartDate:seconds('2026-11-15T18:00:00-07:00'), PlannedEndDate:seconds('2026-11-17T06:00:00-07:00'),
    Recurrence:'', RecurrenceSchedules:'', Latitude:32.4, Longitude:-111.1},
  {ID:2, SourceId:'fixture-frontage', RoadwayName:'Frontage road',
    Description:'Frontage road Massingale to Cortaro closed.', IsFullClosure:true, Latitude:32.41, Longitude:-111.11,
    StartDate:seconds('2026-11-17T18:00:00-07:00'), PlannedEndDate:seconds('2026-11-19T06:00:00-07:00')},
  {ID:3, RoadwayName:'Synthetic mainline', Description:'Synthetic mainline closure.', IsFullClosure:true,
    StartDate:seconds('2026-11-04T06:00:00-07:00'), PlannedEndDate:seconds('2026-11-05T06:00:00-07:00')},
  {ID:4, Description:'Expired synthetic event.', IsFullClosure:true,
    StartDate:seconds('2026-11-01T06:00:00-07:00'), PlannedEndDate:seconds('2026-11-02T06:00:00-07:00')},
];
