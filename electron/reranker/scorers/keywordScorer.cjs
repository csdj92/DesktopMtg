const { weights } = require('../weights.cjs');
const { normalizeKeywords } = require('../keywordUtils.cjs');

function keywordScorer(card, stats) {
  const keys = new Set(normalizeKeywords(card.keywords));
  let bonus = 0;
  stats.deckKeywords.forEach(kw => {
    if (keys.has(kw)) bonus += weights.keywordBonus;
  });
  return bonus;
}

module.exports = { keywordScorer }; 