import React, { useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { BarChart3, TrendingUp, Eye, EyeOff, Sparkles, Droplet, Type, Brain, Layers, Flame, Mountain, Swords as SwordsIcon } from 'lucide-react';

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
  W: { name: 'White', class: 'bg-yellow-300 text-yellow-900', symbol: '☀️', hex: '#FFFBD5' },
  U: { name: 'Blue', class: 'bg-blue-300 text-blue-900', symbol: '💧', hex: '#0E68AB' },
  B: { name: 'Black', class: 'bg-gray-600 text-gray-100', symbol: '💀', hex: '#150B00' },
  R: { name: 'Red', class: 'bg-red-300 text-red-900', symbol: '🔥', hex: '#D3202A' },
  G: { name: 'Green', class: 'bg-green-300 text-green-900', symbol: '🌲', hex: '#00733E' },
  C: { name: 'Colorless', class: 'bg-gray-300 text-gray-900', symbol: '⚪', hex: '#CAC5C0' },
};

// Mapping of mana symbols to human-readable names for charts
const manaSymbolNames = { W: 'White', U: 'Blue', B: 'Black', R: 'Red', G: 'Green', C: 'Colorless', X: 'Variable' };

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

const rarityColors = {
  'common': '#1F2937',
  'uncommon': '#6B7280',
  'rare': '#D97706',
  'mythic': '#DC2626',
  'special': '#7C3AED',
};

// Reusable Stat Card component for the dashboard layout
const StatCard = ({ title, icon, children, className = '', headerContent }) => (
  <motion.div
    className={`bg-white dark:bg-zinc-800/50 p-4 rounded-xl shadow-lg border border-transparent dark:border-zinc-700/50 ${className}`}
    initial={{ opacity: 0, y: 20 }}
    animate={{ opacity: 1, y: 0 }}
    transition={{ duration: 0.4 }}
    whileHover={{ scale: 1.02, transition: { duration: 0.2 } }}
  >
    <div className="flex items-center justify-between mb-2">
      <div className="flex items-center gap-3 text-lg font-semibold text-gray-800 dark:text-gray-200">
        {icon}
        <h4 className="font-semibold">{title}</h4>
      </div>
      {headerContent}
    </div>
    <div className="space-y-4">{children}</div>
  </motion.div>
);

// Enhanced Bar Chart Component
const EnhancedBarChart = ({ data, title, color, showPercentages = false }) => {
  if (!data || data.length === 0) return null;

  const maxValue = Math.max(...data.map(d => d.value));
  const total = data.reduce((sum, d) => sum + d.value, 0);

  return (
    <div className="space-y-2">
      <h5 className="text-sm font-medium">{title}</h5>
      <div className="space-y-1">
        {data.map((item, index) => {
          const percentage = total > 0 ? (item.value / total) * 100 : 0;
          const widthPercentage = maxValue > 0 ? (item.value / maxValue) * 100 : 0;
          const barColor = typeof color === 'function' ? color(item.label) : color || '#6366f1';
          const gradient = `linear-gradient(to right, ${barColor}BF, ${barColor})`;
          
          return (
            <div key={index} className="flex items-center space-x-2 group">
              <span className="w-20 text-xs font-medium truncate capitalize">{item.label}</span>
              <div className="flex-1 bg-gray-200 dark:bg-zinc-700 rounded-full h-5 relative overflow-hidden">
                <motion.div
                  className="h-full rounded-full"
                  style={{ background: gradient }}
                  initial={{ width: 0 }}
                  animate={{ width: `${widthPercentage}%` }}
                  transition={{ duration: 0.8, delay: index * 0.05 }}
                />
                <span className="absolute inset-0 flex items-center pr-2 justify-end text-xs font-bold text-white mix-blend-difference">
                  {item.value}
                </span>
              </div>
              <div className="flex items-center ml-2 min-w-[2rem]">
                <span className="text-xl text-left font-bold text-gray-700 dark:text-gray-300">
                  {item.value}
                </span>
              </div>
              {showPercentages && (
                <span className="w-12 text-xs text-gray-500 dark:text-gray-400 group-hover:text-gray-800 dark:group-hover:text-gray-200 transition-colors">
                  {percentage.toFixed(1)}%
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

// Mana Curve Chart with enhanced visualization
const ManaCurveChart = ({ data, title }) => {
  const maxValue = Math.max(...data);
  const total = data.reduce((sum, val) => sum + val, 0);

  // Distinct colors for each mana cost bucket
  const bucketColors = [
    '#9CA3AF', // 0 - gray
    '#F87171', // 1 - red
    '#FB923C', // 2 - orange
    '#FBBF24', // 3 - amber
    '#34D399', // 4 - emerald
    '#60A5FA', // 5 - blue
    '#A78BFA', // 6 - violet
    '#F472B6', // 7+ - pink
  ];

  return (
    <div className="space-y-2">
      <h5 className="text-sm font-medium">{title}</h5>
      <div className="flex items-end space-x-1 h-[200px] bg-gray-50 dark:bg-zinc-800/30 rounded-lg p-2">
        {data.map((count, idx) => {
          const heightPercent = maxValue > 0 ? (count / maxValue) * 100 : 0;
          const percentage = total > 0 ? (count / total) * 100 : 0;

          return (
            <div key={idx} className="flex-1 flex flex-col items-center h-full">
              {/* Count */}
              <motion.div
                className="text-xs mb-1 font-medium"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: idx * 0.1 }}
              >
                {count}
              </motion.div>

              {/* Bar Area (fills remaining space) */}
              <div className="flex-1 flex items-end w-full h-full">
                <motion.div
                  className="w-full rounded-t-md relative group cursor-pointer"
                  style={{
                    height: `${heightPercent}%`,
                    minHeight: count > 0 ? '8px' : '4px',
                    backgroundColor: '#6366f1',
                  }}
                >
                  {count > 0 && (
                    <div className="absolute -bottom-8 left-1/2 transform -translate-x-1/2 bg-zinc-800 text-white text-xs px-2 py-1 rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap z-10">
                      {percentage.toFixed(1)}% of deck
                    </div>
                  )}
                </motion.div>
              </div>

              {/* Label */}
              <span className="text-xs mt-1 font-medium">{manaBucketLabels[idx]}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
};

// Donut Chart Component
const DonutChart = ({ data, title, colors, size = 150 }) => {
  const total = data.reduce((sum, item) => sum + item.value, 0);
  if (total === 0) return null;

  let cumulativePercentage = 0;
  const radius = size / 2 - 15;
  const circumference = 2 * Math.PI * radius;

  return (
    <div className="flex flex-col items-center">
      <h5 className="text-sm font-medium mb-2">{title}</h5>
      <div className="relative">
        <svg width={size} height={size} className="transform -rotate-90">
          <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="#e5e7eb" strokeWidth="15" />
          {data.map((item, index) => {
            const percentage = (item.value / total) * 100;
            const offset = circumference - (cumulativePercentage / 100) * circumference;
            cumulativePercentage += percentage;
            
            return (
              <motion.circle
                key={index}
                cx={size / 2}
                cy={size / 2}
                r={radius}
                fill="none"
                stroke={colors[item.label.toLowerCase()] || '#6366f1'}
                strokeWidth="15"
                strokeDasharray={circumference}
                strokeDashoffset={offset}
                strokeLinecap="round"
                initial={{ strokeDashoffset: circumference }}
                animate={{ strokeDashoffset: circumference - (percentage / 100) * circumference }}
                transition={{ duration: 0.8, delay: index * 0.1, ease: "easeOut" }}
              />
            );
          })}
        </svg>
        <div 
          className="absolute pointer-events-none z-10 flex items-center justify-center"
          style={{ 
            left: `${size / 2}px`, 
            top: `${size / 2}px`, 
            transform: 'translate(-50%, -50%)',
            width: '1px',
            height: '1px'
          }}
        >
          <span className="text-2xl font-bold text-gray-900 dark:text-gray-100">{total}</span>
        </div>
      </div>
       <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1">
        {data.map((item, index) => (
          <div key={index} className="flex items-center text-xs">
            <div
              className="w-2.5 h-2.5 rounded-full mr-2"
              style={{ backgroundColor: colors[item.label.toLowerCase()] || '#6366f1' }}
            />
            <span className="capitalize">{item.label}:</span>
            <span className="font-semibold ml-1">{item.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
};

// Scatter Plot for Creature Stats
const CreatureScatterPlot = ({ data, title }) => {
  if (!data || data.length === 0) return null;

  const maxPower = Math.max(...data.map(c => c.power), 5);
  const maxToughness = Math.max(...data.map(c => c.toughness), 5);

  const getPointColor = (colors) => {
    if (!colors || colors.length === 0) return '#CAC5C0'; // Colorless
    if (colors.length > 1) return '#FFD700'; // Gold for multicolor
    const color = colors[0];
    return colorMap[color]?.hex || '#CAC5C0';
  }

  return (
    <div>
      <h5 className="text-sm font-medium mb-2">{title}</h5>
      <div className="flex">
        {/* Y-axis label */}
        <div className="flex items-center justify-center mr-2" style={{ minWidth: '3rem' }}>
          <span className="text-xs font-medium text-gray-500 dark:text-gray-400 whitespace-nowrap transform -rotate-90">Toughness</span>
        </div>
        
        {/* Chart container */}
        <div className="flex-1 flex flex-col">
          {/* Y-axis numbers */}
          <div className="flex">
            <div className="flex flex-col justify-between h-56 pr-2" style={{ minWidth: '2rem' }}>
              {[...Array(maxToughness + 1)].map((_, i) => (
                <span key={i} className="text-xs text-gray-500 dark:text-gray-400 text-right leading-none">
                  {maxToughness - i}
                </span>
              ))}
            </div>
            
            {/* Plot area */}
            <div className="relative flex-1 h-56 bg-gray-100 dark:bg-zinc-700/50 rounded-lg border border-gray-200 dark:border-zinc-600">
              {/* Vertical grid lines */}
              {[...Array(maxPower + 1)].map((_, i) => (
                <div 
                  key={`v-${i}`} 
                  className="absolute top-0 bottom-0 border-r border-gray-200 dark:border-zinc-600/50" 
                  style={{ left: `${(i / maxPower) * 100}%` }}
                />
              ))}
              
              {/* Horizontal grid lines */}
              {[...Array(maxToughness + 1)].map((_, i) => (
                <div 
                  key={`h-${i}`} 
                  className="absolute left-0 right-0 border-t border-gray-200 dark:border-zinc-600/50" 
                  style={{ top: `${(i / maxToughness) * 100}%` }}
                />
              ))}
              
              {/* Data points */}
              {data.map((creature, index) => (
                <motion.div
                  key={index}
                  className="absolute w-3 h-3 rounded-full border-2 border-white dark:border-zinc-800 shadow-md group cursor-pointer z-10"
                  style={{
                    left: `calc(${(creature.power / maxPower) * 100}% - 6px)`,
                    top: `calc(${((maxToughness - creature.toughness) / maxToughness) * 100}% - 6px)`,
                    backgroundColor: getPointColor(creature.colors),
                  }}
                  initial={{ opacity: 0, scale: 0 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ delay: index * 0.02 }}
                >
                  <div className="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 w-max bg-black text-white text-xs px-2 py-1 rounded opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-30">
                    {creature.name} (P/T: {creature.power}/{creature.toughness})
                  </div>
                </motion.div>
              ))}
            </div>
          </div>
          
          {/* X-axis numbers */}
          <div className="flex mt-1 ml-8">
            <div className="flex justify-between flex-1">
              {[...Array(maxPower + 1)].map((_, i) => (
                <span key={i} className="text-xs text-gray-500 dark:text-gray-400 text-center">
                  {i}
                </span>
              ))}
            </div>
          </div>
          
          {/* X-axis label */}
          <div className="text-center text-xs font-medium text-gray-500 dark:text-gray-400 mt-1">Power</div>
        </div>
      </div>
    </div>
  )
};

const DeckStatistics = ({ deck, format, deckAnalysis }) => {
  const [showAdvanced, setShowAdvanced] = useState(false);

  const analysis = useMemo(() => {
    const cards = [
      ...expandEntries(deck.mainboard),
      ...deck.commanders, // commanders count as 1 each
    ];

    // Basic counts
    const manaCurveCounts = Array(manaBucketLabels.length).fill(0);

    // Arrays & accumulators for mana value statistics
    const allManaCosts = [];
    const nonlandManaCosts = [];
    let totalManaCostAll = 0;

    const typeCounts = {};
    typeCategories.forEach(t => (typeCounts[t] = 0));
    const colorCounts = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 };
    const rarityCounts = { common: 0, uncommon: 0, rare: 0, mythic: 0, special: 0 };
    const manaSymbolCounts = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0, X: 0 };

    // Advanced analysis
    let totalManaCost = 0;
    let validManaCards = 0;
    const keywords = new Map();
    const powerToughnessDistribution = { '0-1': 0, '2-3': 0, '4-5': 0, '6+': 0 };
    const nonlandCards = [];
    const creatureStats = [];

    cards.forEach((card) => {
      if (!card) return;

      // Determine the primary face to analyze (handles DFCs)
      const primaryFace = (card.card_faces && card.card_faces.length > 0) ? card.card_faces[0] : card;
      const tLine = (primaryFace.type_line || card.type_line || card.type || '').toLowerCase();

      // Mana curve / mana value tracking
      // Use root card's cmc, as it's usually defined there for the whole card
      const cmc = card.manaValue ?? card.cmc ?? card.mana_value ?? 0;

      // Accumulate for statistics (includes lands)
      allManaCosts.push(cmc);
      totalManaCostAll += cmc;

      const idx = cmc >= 7 ? 7 : Math.max(0, Math.min(7, Math.round(cmc)));

      // Only non-land cards are considered for the mana curve visual & non-land stats
      if (!tLine.includes('land')) {
        manaCurveCounts[idx] += 1;
        nonlandManaCosts.push(cmc);
        totalManaCost += cmc;
        validManaCards += 1;
        nonlandCards.push(card);
      }

      // Type analysis
      let matchedType = null;
      for (const t of typeCategories) {
        if (tLine.includes(t.toLowerCase())) {
          matchedType = t;
          break;
        }
      }
      if (matchedType) {
        typeCounts[matchedType] += 1;
      } else {
        typeCounts['Other'] = (typeCounts['Other'] || 0) + 1;
      }

      // Color identity
      const colors = card.color_identity && card.color_identity.length > 0 ? card.color_identity : ['C'];
      colors.forEach((c) => {
        if (colorCounts[c] !== undefined) colorCounts[c] += 1;
      });

      // Mana cost symbol analysis
      // Use primaryFace.mana_cost to be more accurate for DFCs
      const manaCost = primaryFace.mana_cost || card.mana_cost || card.manaCost || '';
      if (manaCost) {
        const symbols = manaCost.match(/\{([WUBRG0-9XC]+)\}/g) || [];
        symbols.forEach(symbol => {
          const clean = symbol.replace(/[{}]/g, '');
          if (/^[WUBRG]$/.test(clean)) {
            manaSymbolCounts[clean] += 1;
          } else if (/^[0-9]+$/.test(clean)) {
            manaSymbolCounts.C += parseInt(clean);
          } else if (clean === 'X') {
            manaSymbolCounts.X += 1;
          }
        });
      }

      // Rarity analysis
      const rarity = (card.rarity || '').toLowerCase();
      if (rarityCounts[rarity] !== undefined) {
        rarityCounts[rarity] += 1;
      } else {
        rarityCounts.special += 1;
      }

      // Power/Toughness analysis for creatures
      if (tLine.includes('creature') && primaryFace.power && primaryFace.toughness) {
        const power = parseInt(primaryFace.power, 10) || 0;
        const toughness = parseInt(primaryFace.toughness, 10) || 0;
        creatureStats.push({ name: card.name, power, toughness, colors: card.color_identity });
        const avg = (power + toughness) / 2;
        
        if (avg <= 1) powerToughnessDistribution['0-1'] += 1;
        else if (avg <= 3) powerToughnessDistribution['2-3'] += 1;
        else if (avg <= 5) powerToughnessDistribution['4-5'] += 1;
        else powerToughnessDistribution['6+'] += 1;
      }

      // Keyword analysis - check both faces for keywords
      const cardText = [
          (card.oracle_text || card.text || ''),
          ...((card.card_faces || []).map(face => face.oracle_text || face.text || ''))
      ].join('\n').toLowerCase();
      
      const commonKeywords = [
        'flying', 'trample', 'haste', 'vigilance', 'lifelink', 'deathtouch',
        'first strike', 'double strike', 'menace', 'reach', 'hexproof',
        'indestructible', 'flash', 'defender', 'prowess', 'scry', 'draw'
      ];
      
      commonKeywords.forEach(keyword => {
        if (cardText.includes(keyword)) {
          keywords.set(keyword, (keywords.get(keyword) || 0) + 1);
        }
      });
    });

    // Helper to calculate median
    const calculateMedian = (arr) => {
      if (!arr || arr.length === 0) return 0;
      const sorted = [...arr].sort((a, b) => a - b);
      const mid = Math.floor(sorted.length / 2);
      return sorted.length % 2 !== 0
        ? sorted[mid]
        : (sorted[mid - 1] + sorted[mid]) / 2;
    };

    const totalCards = cards.length || 1;

    const avgManaCostWithLands = totalCards > 0 ? totalManaCostAll / totalCards : 0;
    const avgManaCostWithoutLands = validManaCards > 0 ? totalManaCost / validManaCards : 0;

    const medianManaCostWithLands = calculateMedian(allManaCosts);
    const medianManaCostWithoutLands = calculateMedian(nonlandManaCosts);

    const totalManaValue = totalManaCostAll;

    // Calculate curve quality (how well distributed the curve is)
    const idealCurve = [0.05, 0.15, 0.25, 0.25, 0.15, 0.10, 0.05, 0.05]; // Rough ideal percentages
    const actualCurve = manaCurveCounts.map(count => count / totalCards);
    const curveDeviation = idealCurve.reduce((sum, ideal, idx) => 
      sum + Math.abs(ideal - actualCurve[idx]), 0
    );

    return {
      manaCurveCounts,
      typeCounts,
      colorCounts,
      rarityCounts,
      manaSymbolCounts,
      totalCards,
      avgManaCost: avgManaCostWithoutLands,
      avgManaCostWithLands,
      medianManaCostWithLands,
      medianManaCostWithoutLands,
      totalManaValue,
      curveDeviation,
      nonlandCards: nonlandCards.length,
      landCards: totalCards - nonlandCards.length,
      creatureStats,
      keywords: Array.from(keywords.entries()).sort((a, b) => b[1] - a[1]).slice(0, 10),
      powerToughnessDistribution,
    };
  }, [deck]);

  // Prepare data for charts
  const typeChartData = Object.entries(analysis.typeCounts)
    .filter(([_, count]) => count > 0)
    .map(([type, count]) => ({ label: type, value: count }));

  const rarityChartData = Object.entries(analysis.rarityCounts)
    .filter(([_, count]) => count > 0)
    .map(([rarity, count]) => ({ label: rarity, value: count }));

  const colorChartData = Object.entries(analysis.colorCounts)
    .filter(([_, count]) => count > 0)
    .map(([color, count]) => ({ label: colorMap[color].name, value: count }));

  const manaSymbolChartData = Object.entries(analysis.manaSymbolCounts)
    .filter(([_, count]) => count > 0)
    .map(([symbol, count]) => ({ label: manaSymbolNames[symbol] || symbol, value: count }));

  const powerToughnessChartData = Object.entries(analysis.powerToughnessDistribution)
    .filter(([_, count]) => count > 0)
    .map(([range, count]) => ({ label: range, value: count }));
  
  const topKeywordsChartData = analysis.keywords
    .map(([keyword, count]) => ({ label: keyword, value: count }));

  const overviewStats = [
    { label: 'Total Cards', value: analysis.totalCards, color: 'text-blue-500', icon: <Layers size={22} /> },
    { label: 'Avg. Cost', value: analysis.avgManaCost.toFixed(2), color: 'text-green-500', icon: <Flame size={22} /> },
    { label: 'Non-lands', value: analysis.nonlandCards, color: 'text-purple-500', icon: <SwordsIcon size={22} /> },
    { label: 'Lands', value: analysis.landCards, color: 'text-amber-500', icon: <Mountain size={22} /> },
  ];

  // Header content for Mana Curve card
  const manaCurveHeader = (
    <div className="text-right">
      <div className="text-xs text-gray-500 dark:text-gray-400 flex items-center justify-end gap-4">
        <span>Avg MV: <span className="font-semibold text-gray-800 dark:text-gray-200">{analysis.avgManaCostWithLands.toFixed(2)}</span> / <span className="font-semibold">{analysis.avgManaCost.toFixed(2)}</span></span>
        <span>Total MV: <span className="font-semibold text-gray-800 dark:text-gray-200">{analysis.totalManaValue}</span></span>
      </div>
    </div>
  );

  return (
    <div className="widget deck-statistics space-y-4 p-4 bg-gray-100 dark:bg-zinc-900 rounded-lg">
      <div className="flex items-center justify-between">
        <h3 className="text-xl font-bold flex items-center gap-2 text-gray-800 dark:text-gray-200">
          <BarChart3 size={20} />
          Deck Statistics
        </h3>
        <button
          onClick={() => setShowAdvanced(!showAdvanced)}
          className="flex items-center gap-2 text-sm font-medium px-3 py-1.5 rounded-full transition-colors bg-white dark:bg-zinc-800 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-zinc-700"
        >
          {showAdvanced ? <EyeOff size={14} /> : <Eye size={14} />}
          <span>{showAdvanced ? 'Basic View' : 'Advanced View'}</span>
        </button>
      </div>

      {/* Deck Analysis Section */}
      {deckAnalysis && (
        <motion.div 
          className="deck-analysis-section"
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
        >
          <div className="text-sm text-gray-700 dark:text-gray-200 leading-relaxed bg-gradient-to-r from-blue-100 to-indigo-100 dark:from-zinc-800 dark:to-zinc-700 p-4 rounded-xl border-l-4 border-blue-400">
            <h4 className="text-base font-semibold text-gray-800 dark:text-gray-200 mb-2 flex items-center gap-2">
              <Sparkles size={16} className="text-blue-500" />
              AI Deck Analysis
            </h4>
            {deckAnalysis}
          </div>
        </motion.div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Overview Section */}
        <StatCard title="Overview" icon={<TrendingUp size={20} />} className="lg:col-span-3">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {overviewStats.map(stat => (
              <div key={stat.label} className="text-center p-3 bg-gray-50 dark:bg-zinc-800/50 rounded-lg flex flex-col items-center justify-center space-y-1">
                <div className={`p-2 rounded-full bg-gray-200 dark:bg-zinc-700 ${stat.color}`}>{stat.icon}</div>
                <div className="text-2xl font-bold text-gray-800 dark:text-gray-200">{stat.value}</div>
                <div className="text-xs text-gray-500 dark:text-gray-400">{stat.label}</div>
              </div>
            ))}
          </div>
        </StatCard>
        
        {/* Mana Curve Section */}
        <StatCard title="Mana Curve" icon={<BarChart3 size={20} />} className="lg:col-span-2">
        <div className="mt-4 pt-4 border-t border-gray-200 dark:border-zinc-700">
            <div className="text-xs text-gray-500 dark:text-gray-400 flex items-center justify-center gap-4">
              <span>Avg Mana Value: <span className="font-semibold text-gray-800 dark:text-gray-200">{analysis.avgManaCostWithLands.toFixed(2)}</span> / <span className="font-semibold"> Without Lands: {analysis.avgManaCost.toFixed(2)}</span></span>
              <span>Total Mana Value: <span className="font-semibold text-gray-800 dark:text-gray-200">{analysis.totalManaValue}</span></span>
            </div>
          </div>
          <ManaCurveChart data={analysis.manaCurveCounts} title="" />
          {/* Mana value statistics below the chart */}
          
          <AnimatePresence>
            {showAdvanced && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                className="overflow-hidden"
              >
                <div className="mt-4 pt-4 border-t border-gray-200 dark:border-zinc-700 grid grid-cols-1 md:grid-cols-2 gap-6">
                  <EnhancedBarChart
                    data={manaSymbolChartData}
                    title="Mana Symbol Distribution"
                    color="#8b5cf6"
                    showPercentages
                  />
                  <div className="bg-gray-50 dark:bg-zinc-900 p-3 rounded-lg">
                    <h5 className="text-sm font-medium mb-2">Curve Analysis</h5>
                    <div className="text-xs space-y-2">
                      <div className="flex justify-between"><span>Curve Quality:</span> <span className="font-semibold">{analysis.curveDeviation < 0.3 ? '🟢 Excellent' : analysis.curveDeviation < 0.5 ? '🟡 Good' : '🔴 Needs Work'}</span></div>
                      <div className="flex justify-between"><span>Low Cost (0-2):</span> <span className="font-semibold">{((analysis.manaCurveCounts[0] + analysis.manaCurveCounts[1] + analysis.manaCurveCounts[2]) / analysis.totalCards * 100).toFixed(1)}%</span></div>
                      <div className="flex justify-between"><span>Mid Cost (3-5):</span> <span className="font-semibold">{((analysis.manaCurveCounts[3] + analysis.manaCurveCounts[4] + analysis.manaCurveCounts[5]) / analysis.totalCards * 100).toFixed(1)}%</span></div>
                      <div className="flex justify-between"><span>High Cost (6+):</span> <span className="font-semibold">{((analysis.manaCurveCounts[6] + analysis.manaCurveCounts[7]) / analysis.totalCards * 100).toFixed(1)}%</span></div>
                    </div>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </StatCard>

        {/* Types & Rarities Section */}
        <StatCard title="Card Types" icon={<Type size={20} />}>
          <EnhancedBarChart
            data={typeChartData}
            title=""
            color={(label) => `hsl(${typeCategories.indexOf(label) * 45}, 70%, 55%)`}
            showPercentages
          />
          <AnimatePresence>
            {showAdvanced && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                className="overflow-hidden"
              >
                <div className="mt-4 pt-4 border-t border-gray-200 dark:border-zinc-700">
                  <DonutChart
                    data={rarityChartData}
                    title="Rarity Distribution"
                    colors={rarityColors}
                  />
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </StatCard>

        {/* Color Identity Section */}
        {format === 'commander' && (
          <StatCard title="Color Identity" icon={<Droplet size={20} />} className="lg:col-span-1">
            <div className="flex flex-wrap gap-4 justify-evenly">
              {Object.entries(analysis.colorCounts).filter(([_, c]) => c > 0).map(([color, cnt]) => (
                <motion.div
                  key={color}
                  className="flex flex-col items-center text-center"
                  initial={{ scale: 0.8, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  transition={{ delay: Object.keys(colorMap).indexOf(color) * 0.1 }}
                >
                  <div className={`w-10 h-10 rounded-full ${colorMap[color].class} shadow-lg flex items-center justify-center text-lg`}>
                    {colorMap[color].symbol}
                  </div>
                  <span className="mt-2 text-sm font-medium">{cnt}</span>
                  <span className="text-xs text-gray-500">{((cnt / analysis.totalCards) * 100).toFixed(1)}%</span>
                </motion.div>
              ))}
            </div>
             <AnimatePresence>
              {showAdvanced && colorChartData.length > 0 && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  className="overflow-hidden"
                >
                  <div className="mt-4 pt-4 border-t border-gray-200 dark:border-zinc-700">
                    <EnhancedBarChart
                      data={colorChartData}
                      title="Color Distribution"
                      color={(label) => Object.values(colorMap).find(c => c.name === label)?.hex || '#6366f1'}
                      showPercentages
                    />
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </StatCard>
        )}

        {/* Advanced Analysis Section */}
        <AnimatePresence>
          {showAdvanced && (
            <StatCard title="Advanced Analysis" icon={<Brain size={20} />} className="lg:col-span-3">
              <div className="space-y-8">

                
                {analysis.keywords.length > 0 && (
                  <div className="border-t border-gray-200 dark:border-zinc-700 pt-6">
                    <EnhancedBarChart
                      data={topKeywordsChartData}
                      title="Top Keywords"
                      color="#ef4444"
                      showPercentages={false}
                    />
                  </div>
                )}

                <div className="border-t border-gray-200 dark:border-zinc-700 pt-6">
                  <div className="bg-gray-50 dark:bg-zinc-900 p-4 rounded-lg">
                    <h5 className="text-sm font-medium mb-2">Deck Composition</h5>
                     <div className="text-xs space-y-2">
                      <div className="flex justify-between"><span>Spell Density:</span><span className="font-medium">{((analysis.nonlandCards / analysis.totalCards) * 100).toFixed(1)}%</span></div>
                      <div className="flex justify-between"><span>Land Ratio:</span><span className="font-medium">{((analysis.landCards / analysis.totalCards) * 100).toFixed(1)}%</span></div>
                      <div className="flex justify-between"><span>Creatures:</span><span className="font-medium">{analysis.typeCounts.Creature || 0} ({(((analysis.typeCounts.Creature || 0) / analysis.totalCards) * 100).toFixed(1)}%)</span></div>
                      <div className="flex justify-between"><span>Instants/Sorceries:</span><span className="font-medium">{(analysis.typeCounts.Instant || 0) + (analysis.typeCounts.Sorcery || 0)} ({((((analysis.typeCounts.Instant || 0) + (analysis.typeCounts.Sorcery || 0)) / analysis.totalCards) * 100).toFixed(1)}%)</span></div>
                    </div>
                  </div>
                </div>
              </div>
            </StatCard>
          )}
        </AnimatePresence>

      </div>
    </div>
  );
};

export default DeckStatistics; 