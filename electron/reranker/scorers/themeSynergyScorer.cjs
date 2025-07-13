const { weights } = require('../weights.cjs');
const { normalizeKeywords } = require('../keywordUtils.cjs');

function themeSynergyScorer(card, stats) {
  const keys = new Set(normalizeKeywords(card.keywords));
  let bonus = 0;
  for (const [theme, count] of Object.entries(stats.themeCounts)) {
    if (count && keys.has(theme)) {
      bonus += Math.min(count / stats.totalCards, 0.6) * weights.themeMultiplier;
    }
  }
  return bonus;
}

module.exports = { themeSynergyScorer }; 