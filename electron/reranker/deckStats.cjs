const { normalizeKeywords } = require('./keywordUtils.cjs');

function computeDeckStats(deck) {
  const allCards = [...deck.mainboard, ...(deck.commanders || [])];
  const totalCards = allCards.length || 1;

  // --- Theme counts ---
  const themes = [
    'graveyard',
    'counters',
    'tokens',
    'artifacts',
    'spells',
    'lifegain',
    'sacrifice',
    'tribal',
  ];

  const themeCounts = themes.reduce((acc, theme) => {
    const count = allCards.reduce((sum, c) => {
      const keywords = normalizeKeywords(c.keywords);
      return sum + (keywords.includes(theme) ? 1 : 0);
    }, 0);
    return { ...acc, [theme]: count };
  }, {});

  // --- Curve needs ---
  const curve = { '0': 0, '1': 0, '2': 0, '3': 0, '4': 0, '5': 0, '6': 0, '7+': 0 };
  allCards.forEach(c => {
    const cmc = c.manaValue || c.cmc || c.mana_value || 0;
    const key = cmc >= 7 ? '7+' : String(cmc);
    curve[key]++;
  });

  const ideal = {
    '0': 0.05,
    '1': 0.15,
    '2': 0.2,
    '3': 0.2,
    '4': 0.15,
    '5': 0.1,
    '6': 0.08,
    '7+': 0.07,
  };

  const curveNeeds = Object.fromEntries(
    Object.entries(curve).map(([cost, cnt]) => [
      cost,
      Math.max(0, (ideal[cost] || 0.05) - cnt / totalCards),
    ]),
  );

  // --- Deck keyword set ---
  const deckKeywords = new Set(
    allCards.flatMap(c => normalizeKeywords(c.keywords)),
  );

  const tribalTrigger = deckKeywords.has('tribal');

  return { themeCounts, curveNeeds, totalCards, deckKeywords, tribalTrigger };
} 

module.exports = { computeDeckStats }; 