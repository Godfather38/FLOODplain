// The model runs both map views offer: the hourly live run and the saved runs. Every run shares
// the model's grid and terrain; paths are relative to public/simulation/data/.
// The live run is published every hour by .github/workflows/live-sfincs.yml (branch
// experiment/live-sfincs) to the live-model branch. It is shown only while it is fresh.
export const LIVE='https://raw.githubusercontent.com/Godfather38/FLOODplain/live-model/live/',LIVE_MAX_AGE_H=3;
export const BASE_DISPLAY='frozen-terrain-display.json.gz';
export const RUNS=[
 {id:'live',label:'Live: newest model run, every hour',live:true},
 {id:'13z',label:'Nov 1, 13Z forecast run',note:'Rain shown from this run\'s rainfall input.',display:'frozen-terrain-display.json.gz',rain:'frozen-map-context.json',inflow:'frozen-map-context.json',hand:'frozen-map-polygons.json.gz'},
 {id:'19z',label:'Nov 1, 19Z forecast run (more water)',note:'Rain shown from this run\'s rainfall input (HRRR 19Z forecast). Its heaviest rain, Nov 1 9–10 AM MST, fell before the first saved water hour.',display:'sfincs-current-coarse-20261101-19z-41350254061-map/frozen-terrain-display.json.gz',rain:'sfincs-current-coarse-20261101-19z-41350254061-map/rainfall.json',inflow:'sfincs-current-coarse-20261101-19z-41350254061-map/inflow.json'},
 {id:'stress',label:'Stress test: 100-year storm with a record river',note:'A what-if run of the same model, not a forecast: the 19Z run\'s ground conditions, then NOAA Atlas 14\'s 100-year 6-hour storm (2.8 in, 2.2 in in the peak hour) on every cell from 5 PM MST, and the Santa Cruz rising to its 1983 record flow (65,000 cfs) at 10 PM.',display:'sfincs-stress-storm-41633261576-map/frozen-terrain-display.json.gz',rain:'sfincs-stress-storm-41633261576-map/rainfall.json',inflow:'sfincs-stress-storm-41633261576-map/inflow.json'},
 {id:'extreme',label:'Extreme what-if: 1,000-year storm, twice the record river',note:'A deliberately extreme what-if run of the same model, far beyond anything on record and not a forecast: the 19Z run\'s ground conditions, then NOAA Atlas 14\'s 1,000-year 6-hour storm (4.0 in, 3.0 in in the peak hour) on every cell from 5 PM MST, and the Santa Cruz at twice its 1983 record flow (130,000 cfs) at 10 PM.',display:'sfincs-extreme-storm-41635232621-map/frozen-terrain-display.json.gz',rain:'sfincs-extreme-storm-41635232621-map/rainfall.json',inflow:'sfincs-extreme-storm-41635232621-map/inflow.json'},
];
