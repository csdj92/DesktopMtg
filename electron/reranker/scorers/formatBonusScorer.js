import { weights } from '../weights.js';

export function formatBonusScorer(card, _stats, format) {
  let bonus = 0;
  const text = (card.oracle_text || card.text || '').toLowerCase();
  const typeLine = (card.type_line || card.type || '').toLowerCase();

  if (format === 'commander') {
    if (/each opponent|each player/.test(text)) {
      bonus += weights.format.commander.multiplayer;
    }
    if (/legendary/.test(typeLine) && /creature/.test(typeLine)) {
      bonus += weights.format.commander.legendaryCreature;
    }
  }

  return bonus;
} 