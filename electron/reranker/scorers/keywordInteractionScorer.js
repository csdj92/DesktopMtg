import { weights } from '../weights.js';
import { keywordInteractions } from '../keywordInteractions.js';

export function keywordInteractionScorer(card, stats) {
  const keys = (card.keywords || []).map(k => k.toLowerCase());
  return keys.reduce((sum, key) => {
    const partners = keywordInteractions[key];
    if (!partners) return sum;
    const matches = partners.filter(p => stats.deckKeywords.has(p)).length;
    return sum + matches * weights.keywordInteractionBonus;
  }, 0);
} 