// Presentation only: retain unknown evidence in the rating/recommendation data.
export function visibleSourceChecks(point){return (point.checks??[]).filter(c=>c.src!=='none');}
export function pointReadingSummary(point){
 // A synthetic placeholder is not a source reporting conditions.
 return point.checks?.some(c=>c.src==='none'&&c.why===point.why)?'':point.why??'';
}
export function locationGroupTitle(points,hasFlagged){
 if(points.some(p=>p.evidenceAvailable===false))return 'Route locations';
 return hasFlagged?'Looks normal':'Every stretch looks normal';
}
