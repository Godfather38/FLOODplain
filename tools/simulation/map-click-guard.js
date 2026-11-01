// CSS-pixel threshold; a fresh pointer gesture resets suppression, not a timer.
export function createMapClickGuard(threshold=8){
  let origin=null,dragged=false;
  return {
    down(e){origin=[e.clientX,e.clientY];dragged=false;},
    move(e){if(origin&&Math.hypot(e.clientX-origin[0],e.clientY-origin[1])>threshold)dragged=true;},
    cancel(){dragged=true;},
    allow(e){return e?.detail===0||!dragged;}
  };
}
