// Real OpenMapTiles attributes only; display zoom is not hydraulic resolution.
export const wanted=['landcover','landuse','park','water','waterway','water_name','transportation','transportation_name','place','building','poi','housenumber'];
export const order={landcover:0,landuse:1,park:2,water:3,building:4,waterway:5,transportation:6,water_name:7,transportation_name:8,place:9,poi:10,housenumber:11};
export function visibleFeature(layer,p,zoom){if(layer==='building')return zoom>=15;if(layer==='poi')return zoom>=17&&!!(p.name||p['name:en'])&&Number(p.rank??1)<=7;if(layer==='housenumber')return zoom>=18;if(layer==='park')return zoom>=13;return true;}
export function labelText(layer,p,zoom){if(layer==='housenumber')return zoom>=18?String(p.housenumber||''):'';if(['waterway','water_name'].includes(layer)&&zoom<14)return '';if(layer==='park'&&zoom<16)return '';if(layer==='poi'&&zoom<17)return '';return p['name:en']||p.name||'';}
export function featureStyle(layer,p={},zoom=13){
 if(layer==='landcover')return {polygonFill:p.class==='wood'?'#e3e7de':'#eeefe7',polygonOpacity:1,lineOpacity:0};
 if(layer==='landuse'||layer==='park')return {polygonFill:layer==='park'?'#e5ebe1':p.class==='residential'?'#edebe6':p.class==='industrial'?'#e7e7e8':'#eeeee5',polygonOpacity:1,lineOpacity:0};
 if(layer==='water'){const intermittent=Number(p.intermittent)===1;return {polygonFill:intermittent?'#e0e9e8':'#c4d5d9',polygonOpacity:1,lineColor:'#a9c2c8',lineWidth:zoom>=16?.7:0,lineDasharray:intermittent?[3,3]:[]};}
 if(layer==='waterway'){const minor=['ditch','drain'].includes(p.class),intermittent=Number(p.intermittent)===1;return {lineColor:minor?'#93b6bf':'#7fa7b4',lineWidth:zoom>=16?(minor?1.2:2):1,lineDasharray:intermittent||p.brunnel==='tunnel'?[4,3]:[],lineOpacity:p.brunnel==='tunnel'?.6:.85};}
 if(layer==='building')return {polygonFill:'#d8dad6',polygonOpacity:1,lineColor:'#aeb6b4',lineWidth:zoom>=17?.8:.4};
 if(layer==='transportation'){
  const c=p.class,major=['motorway','trunk','primary'].includes(c),minor=['path','track','service'].includes(c),rail=c==='rail',close=zoom>=16,bridge=p.brunnel==='bridge',tunnel=p.brunnel==='tunnel';
  const width=rail?1.5:minor?(close?2:1):major?(close?8:4):c==='secondary'?(close?6:3):(close?4:2);
  const core={lineColor:rail?'#7e898d':minor?'#d0d2cb':'#fafbf8',lineWidth:width,lineOpacity:tunnel?.55:1,lineDasharray:rail?[5,3]:minor?[4,2]:tunnel?[5,3]:[]};
  return close&&!minor&&!rail?[{lineColor:bridge?'#7e8e94':'#c3c9c7',lineWidth:width+(bridge?3:1.5),lineOpacity:tunnel?.4:1},core]:core;
 }
 const water=['waterway','water_name'].includes(layer),small=['poi','housenumber'].includes(layer);return {textName:labelText(layer,p,zoom),textFill:water?'#486e7e':small?'#657477':'#4c5c64',textSize:layer==='place'?13:layer==='housenumber'?10:11,textHaloFill:'#fafbf6',textHaloRadius:2,textAllowOverlap:false};
}
export function labelStyle(layer,p,zoom){return featureStyle(['waterway'].includes(layer)?'water_name':layer==='park'?'poi':layer,p,zoom);}
export function featureOrder(f){const p=f.properties;return (order[p._sourceLayer]??20)*100+(p._sourceLayer==='transportation'?(p.brunnel==='tunnel'?-20:p.brunnel==='bridge'?20:0)+Number(p.layer||0):0);}
