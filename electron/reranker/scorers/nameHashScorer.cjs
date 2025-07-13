const { weights } = require('../weights.cjs');

function nameHashScorer(card) {
  const name = (card.name || '').toLowerCase();
  const hash = [...name].reduce((sum, ch) => sum + ch.charCodeAt(0), 0);
  return (hash % weights.nameHashMax) / weights.nameHashMax;
}

module.exports = { nameHashScorer }; 