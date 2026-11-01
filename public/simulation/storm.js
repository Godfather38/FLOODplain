export function validateStormFrame(manifest,entry,frame){
 const count=manifest.grid.rows*manifest.grid.cols;
 if(frame.start!==entry.start||frame.end!==entry.end||frame.units!=='mm'||Date.parse(frame.end)-Date.parse(frame.start)!==3600000||!Array.isArray(frame.depthMm)||frame.depthMm.length!==count||frame.depthMm.some(v=>v!==null&&(!Number.isFinite(v)||v<0)))throw Error('Invalid hourly forcing frame');
 return frame;
}
export function cellAt(grid,lon,lat){const col=Math.floor((lon-grid.west)/grid.dx+.5),row=Math.floor((lat-grid.north)/grid.dy+.5);if(col<0||row<0||col>=grid.cols||row>=grid.rows)return null;return row*grid.cols+col;}
