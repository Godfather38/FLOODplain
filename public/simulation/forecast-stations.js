export const FORECAST_STATIONS=Object.freeze({
 SCTA3:{usgsId:'09486520',reachId:'15890430',name:'Santa Cruz at Trico Road'},
 CSCA3:{usgsId:'09486500',reachId:'15903137',name:'Santa Cruz at Cortaro'},
 BWTA3:{usgsId:'09487000',reachId:'15876941',name:'Brawley Wash near Three Points'}
});
export const stationUrl=id=>'https://api.water.noaa.gov/nwps/v1/gauges/'+id;
export const zonedTime=value=>typeof value==='string'&&/(Z|[+-]\d{2}:\d{2})$/.test(value)?Date.parse(value):NaN;
