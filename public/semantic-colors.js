/** Shared display colors only; risk scoring remains in logic.js. */
export const RISK_COLORS = Object.freeze({1:'#256b2b',2:'#275fa3',3:'#805500',4:'#ad4315',5:'#b51f2a'});
export const UNKNOWN_COLOR = '#62576f';
export function installRiskColors() {
  for (const [level,color] of Object.entries(RISK_COLORS)) document.documentElement.style.setProperty('--s'+level,color);
  document.documentElement.style.setProperty('--sq',UNKNOWN_COLOR);
}

