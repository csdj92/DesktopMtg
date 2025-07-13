import { weights } from '../weights.js';

export function curveFillingScorer(card, stats) {
  const cmc = card.manaValue || card.cmc || card.mana_value || 0;
  const key = cmc >= 7 ? '7+' : String(cmc);
  const need = stats.curveNeeds[key] || 0;
  return need > 0.05 ? need * weights.curveMultiplier : 0;
} 