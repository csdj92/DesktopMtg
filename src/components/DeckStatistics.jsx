import React, { useMemo } from 'react';

// Utility to flatten deck entries into repeated card list based on quantity
const expandEntries = (entries) => {
  const list = [];
  entries.forEach(({ card, quantity }) => {
    for (let i = 0; i < quantity; i++) {
      list.push(card);
    }
  });
  return list;
};

const manaBucketLabels = ['0', '1', '2', '3', '4', '5', '6', '7+'];

const colorMap = {
  W: { name: 'White', class: 'bg-yellow-300 text-yellow-900' },
  U: { name: 'Blue',  class: 'bg-blue-300 text-blue-900' },
  B: { name: 'Black', class: 'bg-gray-600 text-gray-100' },
  R: { name: 'Red',   class: 'bg-red-300 text-red-900' },
  G: { name: 'Green', class: 'bg-green-300 text-green-900' },
  C: { name: 'Colorless', class: 'bg-gray-300 text-gray-900' },
};

const typeCategories = [
  'Creature',
  'Instant',
  'Sorcery',
  'Artifact',
  'Enchantment',
  'Planeswalker',
  'Land',
  'Battle',
];

const DeckStatistics = ({ deck, format }) => {
  const analysis = useMemo(() => {
    const cards = [
      ...expandEntries(deck.mainboard),
      ...deck.commanders, // commanders count as 1 each
    ];

    // Mana curve buckets
    const manaCurveCounts = Array(manaBucketLabels.length).fill(0);

    // Type distribution counts
    const typeCounts = {};
    typeCategories.forEach(t => (typeCounts[t] = 0));

    // Color identity counts (by primary color of the card)
    const colorCounts = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 };

    cards.forEach((card) => {
      if (!card) return;

      // Mana value / cmc
      const cmc = card.manaValue ?? card.cmc ?? card.mana_value ?? 0;
      const idx = cmc >= 7 ? 7 : Math.max(0, Math.min(7, Math.round(cmc)));
      manaCurveCounts[idx] += 1;

      // Type
      const tLine = card.type || card.type_line || '';
      let matchedType = null;
      for (const t of typeCategories) {
        if (tLine.includes(t)) {
          matchedType = t;
          break;
        }
      }
      if (matchedType) {
        typeCounts[matchedType] += 1;
      } else {
        typeCounts['Other'] = (typeCounts['Other'] || 0) + 1;
      }

      // Color identity – if empty treat as colorless
      const colors = card.color_identity && card.color_identity.length > 0 ? card.color_identity : ['C'];
      colors.forEach((c) => {
        if (colorCounts[c] !== undefined) colorCounts[c] += 1;
      });
    });

    const totalCards = cards.length || 1;

    return { manaCurveCounts, typeCounts, colorCounts, totalCards };
  }, [deck]);

  const maxManaBucket = Math.max(...analysis.manaCurveCounts);
  const maxTypeCount = Math.max(...Object.values(analysis.typeCounts));

  return (
    <div className="widget deck-statistics space-y-4 p-4 bg-white dark:bg-zinc-800 rounded-md shadow-md">
      <h3 className="text-lg font-semibold mb-2">Deck Statistics</h3>

      {/* Mana Curve */}
      <section>
        <h4 className="font-medium">Mana Curve</h4>
        <div className="flex items-end space-x-1 h-32 mt-2">
          {analysis.manaCurveCounts.map((count, idx) => {
            const heightPercent = (count / (maxManaBucket || 1)) * 100;
            return (
              <div key={idx} className="flex-1 flex flex-col items-center">
                {/* Count */}
                <span className="text-xs mb-1 px-1">{count}</span>
                {/* Bar */}
                <div
                  style={{ height: `${heightPercent}%` }}
                  className="w-full bg-gradient-to-t from-indigo-600 to-indigo-300 rounded-t-md transition-all"
                />
                {/* Mana value label */}
                <span className="text-xs mt-1">{manaBucketLabels[idx]}</span>
              </div>
            );
          })}
        </div>
      </section>

      {/* Type Distribution */}
      <section>
        <h4 className="font-medium mt-4">Card Types</h4>
        <div className="space-y-1 mt-2">
          {Object.entries(analysis.typeCounts).map(([type, cnt]) => (
            cnt > 0 && (
              <div key={type} className="flex items-center space-x-2">
                <span className="w-24 text-xs">{type}</span>
                <div className="flex-1 bg-gray-200 dark:bg-zinc-700 rounded h-3 relative overflow-hidden">
                  <div
                    style={{ width: `${(cnt / maxTypeCount) * 100}%` }}
                    className="h-full bg-gradient-to-r from-emerald-400 to-emerald-600 rounded"
                  />
                </div>
                <span className="text-xs w-6 text-right px-1">{cnt}</span>
              </div>
            )
          ))}
        </div>
      </section>

      {/* Color Identity */}
      {format === 'commander' && (
        <section>
          <h4 className="font-medium mt-4">Color Identity</h4>
          <div className="flex space-x-4 mt-2">
            {Object.entries(analysis.colorCounts).map(([color, cnt]) => (
              cnt > 0 && (
                <div key={color} className="flex flex-col items-center text-xs pl-2">
                  {/* Color icon */}
                  <div className={`w-8 h-8 rounded-full ${colorMap[color].class} shadow`} />
                  {/* Color name */}
                  <span className="mt-1 font-medium">{colorMap[color].name}</span>
                  {/* Count */}
                  <span className="px-1">{cnt}</span>
                </div>
              )
            ))}
          </div>
        </section>
      )}
    </div>
  );
};

export default DeckStatistics; 