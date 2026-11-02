// Presentation only: leave source artifacts and solver values in their original units.
export function imperialSourceText(text='') {
 return text
 .replace('Straight span roadway profile inferred between intact near-span approaches; no surveyed deck or camber measurement.', 'The road height is estimated from the approaches on both sides. The bridge deck has not been surveyed.')
 .replace('Total elevation uncertainty is not quantified. Sample-window spread is not an accuracy/confidence interval. Deck camber, structural clearance and changes since terrain acquisition remain unknown.', 'The size of the height error is unknown. The estimate may miss the deck’s curve or changes since the terrain was recorded.')
 .replace('Native zs in the unchanged', 'Water-surface estimate from the')
 .replace('Not gauge flow or cell-average depth. Bridge opening is not explicitly modeled.', 'The model does not represent the bridge opening itself.')
 .replace('Single channel-ground reference, not surveyed bathymetry or the lowest channel point.', 'This is one ground-height sample. It may not be the deepest part of the channel.')
 .replace(/(\d+(?:\.\d+)?)\s+(?:m|meters|metres)\b/g, (_, value) => `${(Number(value)/0.3048).toFixed(1)} ft`);
}

