const { weights } = require('../weights.cjs');

function semanticScorer(card) {
  // Corrected: Default to 0 if no semantic information is available.
  const raw = card.semantic_score ?? (
    (card._distance || card.distance) ? 1 - (card._distance || card.distance || 0) : 0
  );
  
  return (raw || 0) * weights.baseBoost;
}

module.exports = { semanticScorer }; 