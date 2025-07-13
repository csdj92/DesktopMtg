import { weights } from '../weights.js';

export function semanticScorer(card) {
  // Corrected: Default to 0 if no semantic information is available.
  // The previous implementation defaulted to 1, which gave every card a flat
  // 100-point bonus, drowning out the other more meaningful synergy scorers.
  const raw = card.semantic_score ?? (
    (card._distance || card.distance) ? 1 - (card._distance || card.distance || 0) : 0
  );
  
  return (raw || 0) * weights.baseBoost;
} 