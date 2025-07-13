const { weights } = require('../weights.cjs');

function tribalScorer(card, stats) {
  if (!stats.tribalTrigger) return 0;
  const text = (card.oracle_text || card.text || '').toLowerCase();
  return /choose.*type|tribal/.test(text) ? weights.keywordBonus : 0;
}

module.exports = { tribalScorer }; 