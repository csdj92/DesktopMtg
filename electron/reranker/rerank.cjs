const { computeDeckStats } = require('./deckStats.cjs');
const { nameHashScorer } = require('./scorers/nameHashScorer.cjs');
const { semanticScorer } = require('./scorers/semanticScorer.cjs');
const { themeSynergyScorer } = require('./scorers/themeSynergyScorer.cjs');
const { curveFillingScorer } = require('./scorers/curveFillingScorer.cjs');
const { tribalScorer } = require('./scorers/tribalScorer.cjs');
const { keywordScorer } = require('./scorers/keywordScorer.cjs');
const { keywordInteractionScorer } = require('./scorers/keywordInteractionScorer.cjs');
const { formatBonusScorer } = require('./scorers/formatBonusScorer.cjs');
const { utilityScorer } = require('./scorers/utilityScorer.cjs');

const scorers = [
  nameHashScorer,
  semanticScorer,
  themeSynergyScorer,
  curveFillingScorer,
  tribalScorer,
  keywordScorer,
  keywordInteractionScorer,
  formatBonusScorer,
  utilityScorer,
];

function rerankCardsByDeckSynergy(cards, deck, format) {
  if (!Array.isArray(cards) || cards.length === 0) return [];
  const stats = computeDeckStats(deck);

  return cards
    .map(card => {
      const synergy = scorers.reduce((sum, fn) => sum + fn(card, stats, format), 0);
      return {
        ...card,
        synergy_score: Math.round(synergy * 100) / 100,
      };
    })
    .sort((a, b) => {
      const diff = b.synergy_score - a.synergy_score;
      return Math.abs(diff) < 0.01 ? a.name.localeCompare(b.name) : diff;
    });
}

module.exports = { rerankCardsByDeckSynergy }; 