import { weights } from '../weights.js';

export function keywordScorer(card, stats) {
  const keys = new Set((card.keywords || []).map(k => k.toLowerCase()));
  let bonus = 0;
  stats.deckKeywords.forEach(kw => {
    if (keys.has(kw)) bonus += weights.keywordBonus;
  });
  return bonus;
} 