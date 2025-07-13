const { weights } = require('../weights.cjs');

function utilityScorer(card) {
  const text = (card.oracle_text || card.text || '').toLowerCase();
  let bonus = 0;
  if (/draw.*card/.test(text)) bonus += weights.utility.draw;
  if (/destroy|exile/.test(text)) bonus += weights.utility.removal;
  if (/search.*library/.test(text)) bonus += weights.utility.tutor;
  return bonus;
}

module.exports = { utilityScorer }; 