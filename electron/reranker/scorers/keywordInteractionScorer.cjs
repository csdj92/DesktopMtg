const { weights } = require('../weights.cjs');
const { keywordInteractions } = require('../keywordInteractions.cjs');
const { normalizeKeywords } = require('../keywordUtils.cjs');

function keywordInteractionScorer(card, stats) {
  const keys = normalizeKeywords(card.keywords);
  return keys.reduce((sum, key) => {
    const partners = keywordInteractions[key];
    if (!partners) return sum;
    const matches = partners.filter(p => stats.deckKeywords.has(p)).length;
    return sum + matches * weights.keywordInteractionBonus;
  }, 0);
}

module.exports = { keywordInteractionScorer }; 