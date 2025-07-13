import { weights } from '../weights.js';

export function themeSynergyScorer(card, stats) {
  const keys = new Set((card.keywords || []).map(k => k.toLowerCase()));
  let bonus = 0;
  for (const [theme, count] of Object.entries(stats.themeCounts)) {
    if (count && keys.has(theme)) {
      bonus += Math.min(count / stats.totalCards, 0.6) * weights.themeMultiplier;
    }
  }
  return bonus;
} 