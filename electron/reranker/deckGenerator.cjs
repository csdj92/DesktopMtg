const { rerankCardsByDeckSynergy } = require('./rerank.cjs');
const { computeDeckStats } = require('./deckStats.cjs');
const { getSmartQuotas, getArchetypeDescription } = require('./smartQuotas.cjs');

// Legacy quotas for fallback
const QUOTAS = {
  LAND_TARGET: 38,
  RAMP_TARGET: 10,
  DRAW_TARGET: 8,
  REMOVAL_TARGET: 8,
};

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}
function classifyCard(card) {
  const type = (card.type_line || card.type || '').toLowerCase();
  const text = (card.oracle_text || card.text || '').toLowerCase();

  if (type.includes('land')) return 'land';
  if (/add \{[wubrgc]\}/.test(text) && type.includes('artifact')) return 'ramp';
  if (/search.*library.*land/.test(text) || /rampant growth|cultivate|kodama's reach/.test(text)) return 'ramp';
  if (/draw .*card/.test(text)) return 'draw';
  if (/destroy target|exile target|counter target/.test(text)) return 'removal';
  return 'other';
}

function distributeBasics(colorIdentity, basicLookup, needed) {
  const basics = [];
  const colors = colorIdentity.size ? Array.from(colorIdentity) : ['C'];
  for (let i = 0; i < needed; i++) {
    const color = colors[i % colors.length];
    const card = basicLookup[color] || basicLookup['W'];
    if (card) basics.push({ ...card });
  }
  return basics;
}

function evaluateDeckSynergy(deck, quotas = null) {
  // Use provided quotas or fall back to base quotas
  const targets = quotas || QUOTAS;
  const { LAND_TARGET, RAMP_TARGET, DRAW_TARGET, REMOVAL_TARGET } = targets;
  
  const synergy = deck.mainboard.reduce((sum, c) => sum + (c.synergy_score || 0), 0);
  const counts = { land: 0, ramp: 0, draw: 0, removal: 0 };
  deck.mainboard.forEach(c => {
    const cat = classifyCard(c);
    if (counts[cat] !== undefined) counts[cat]++;
  });
  let penalty = 0;
  if (counts.land < LAND_TARGET) penalty -= (LAND_TARGET - counts.land) * 50;
  if (counts.ramp < RAMP_TARGET) penalty -= (RAMP_TARGET - counts.ramp) * 30;
  if (counts.draw < DRAW_TARGET) penalty -= (DRAW_TARGET - counts.draw) * 25;
  if (counts.removal < REMOVAL_TARGET) penalty -= (REMOVAL_TARGET - counts.removal) * 25;
  return synergy + penalty;
}

// Helper function to check if a card is a basic land
const isBasicLand = (card) => {
  const type = (card.type_line || card.type || '').toLowerCase();
  return type.includes('basic') && type.includes('land');
};

function buildGreedyCommanderDeck(cardPool, trials = 5) {
  // We'll get smart quotas for each commander, so start with base quotas
  let { LAND_TARGET, RAMP_TARGET, DRAW_TARGET, REMOVAL_TARGET } = QUOTAS;
  
  const basicMap = {
    W: 'Plains', U: 'Island', B: 'Swamp', R: 'Mountain', G: 'Forest',
  };
  
  const basicLookup = {};
  for (const [color, name] of Object.entries(basicMap)) {
    const card = cardPool.find(c => c.name === name);
    if (card) basicLookup[color] = card;
  }

  let best = { deck: null, synergy: -Infinity };

  for (let t = 0; t < trials; t++) {
    const cmdrPool = cardPool.filter(c => {
      const type = (c.type_line || c.type || '').toLowerCase();
      const isLegendary = type.includes('legendary') && (type.includes('creature') || type.includes('background'));
      const legalStatus = c.legalities?.commander;
      const notBanned = !legalStatus || ['legal','restricted'].includes(String(legalStatus).toLowerCase());
      return isLegendary && notBanned;
    });
    if (cmdrPool.length === 0) continue;
    const commander = cmdrPool[Math.floor(Math.random() * cmdrPool.length)];
    const colorIdentity = new Set(commander.color_identity || []);
    
    // Get smart quotas for this commander
    const smartQuotaResult = getSmartQuotas(commander, { mainboard: [], commanders: [commander] });
    const smartQuotas = smartQuotaResult.quotas;
    const archetype = getArchetypeDescription(commander, { mainboard: [], commanders: [commander] });
    
    console.log(`🎯 Building ${archetype} deck with ${commander.name}`);
    console.log(`📊 Smart quotas: Lands=${smartQuotas.LAND_TARGET}, Ramp=${smartQuotas.RAMP_TARGET}, Draw=${smartQuotas.DRAW_TARGET}, Removal=${smartQuotas.REMOVAL_TARGET}`);
    
    // Use smart quotas for this trial
    LAND_TARGET = smartQuotas.LAND_TARGET;
    RAMP_TARGET = smartQuotas.RAMP_TARGET;
    DRAW_TARGET = smartQuotas.DRAW_TARGET;
    REMOVAL_TARGET = smartQuotas.REMOVAL_TARGET;
    
    let mainboard = [];
    // Track chosen cards by NAME to enforce singleton rule (except basic lands)
    const chosenNames = new Set([commander.name]);
    const chosenIds = new Set([commander.id]); // Still track IDs to avoid exact duplicates
    
    let candidates = cardPool.filter(c => {
      if (chosenIds.has(c.id)) return false;
      // For non-basic lands, check if we already have this card name
      if (!isBasicLand(c) && chosenNames.has(c.name)) return false;
      const legalStatus = c.legalities?.commander;
      const isLegal = !legalStatus || ['legal','restricted'].includes(String(legalStatus).toLowerCase());
      const withinColors = (c.color_identity || []).every(ci => colorIdentity.has(ci));
      return isLegal && withinColors;
    });

    const fillCategory = (category, target) => {
      if (candidates.length === 0) return;
      const ranked = rerankCardsByDeckSynergy(candidates, { commanders: [commander], mainboard }, 'commander');
      const categoryCards = ranked.filter(c => classifyCard(c) === category);
      
      const picks = [];
      for (const card of categoryCards) {
        if (picks.length >= target) break;
        if (!chosenIds.has(card.id) && (isBasicLand(card) || !chosenNames.has(card.name))) {
          picks.push(card);
          chosenIds.add(card.id);
          if (!isBasicLand(card)) {
            chosenNames.add(card.name);
          }
        }
      }
      
      mainboard.push(...picks);
      candidates = candidates.filter(c => !chosenIds.has(c.id) && (isBasicLand(c) || !chosenNames.has(c.name)));
    };

    fillCategory('ramp', RAMP_TARGET);
    
    // Update quotas based on current deck state after ramp
    const updatedQuotas1 = getSmartQuotas(commander, { mainboard, commanders: [commander] });
    DRAW_TARGET = updatedQuotas1.quotas.DRAW_TARGET;
    REMOVAL_TARGET = updatedQuotas1.quotas.REMOVAL_TARGET;
    LAND_TARGET = updatedQuotas1.quotas.LAND_TARGET;
    
    fillCategory('draw', DRAW_TARGET);
    
    // Update quotas again after draw
    const updatedQuotas2 = getSmartQuotas(commander, { mainboard, commanders: [commander] });
    REMOVAL_TARGET = updatedQuotas2.quotas.REMOVAL_TARGET;
    LAND_TARGET = updatedQuotas2.quotas.LAND_TARGET;
    
    fillCategory('removal', REMOVAL_TARGET);

    const finalRanked = rerankCardsByDeckSynergy(candidates, { commanders: [commander], mainboard }, 'commander');
    
    const landCards = finalRanked.filter(c => classifyCard(c) === 'land');
    const nonBasicPicks = [];
    for (const card of landCards) {
      if (nonBasicPicks.length >= LAND_TARGET) break;
      if (!chosenIds.has(card.id) && (isBasicLand(card) || !chosenNames.has(card.name))) {
        nonBasicPicks.push(card);
        chosenIds.add(card.id);
        if (!isBasicLand(card)) {
          chosenNames.add(card.name);
        }
      }
    }
    mainboard.push(...nonBasicPicks);

    const remainingSlots = 99 - mainboard.length;
    if (remainingSlots > 0) {
        const otherCards = finalRanked.filter(c => !chosenIds.has(c.id) && (isBasicLand(c) || !chosenNames.has(c.name)));
        for (const card of otherCards) {
          if (mainboard.length >= 99) break;
          mainboard.push(card);
          chosenIds.add(card.id);
          if (!isBasicLand(card)) {
            chosenNames.add(card.name);
          }
        }
    }
    
    const landCount = mainboard.filter(c => classifyCard(c) === 'land').length;
    const missingLands = Math.max(0, LAND_TARGET - landCount);
    if (missingLands > 0) {
      mainboard.push(...distributeBasics(colorIdentity, basicLookup, missingLands));
    }
    
    const finalDeck = { commanders: [commander], mainboard: mainboard.slice(0, 99) };
    
    // Validate singleton rule for debugging
    const nameCount = new Map();
    finalDeck.mainboard.forEach(card => {
      if (!isBasicLand(card)) {
        const count = nameCount.get(card.name) || 0;
        nameCount.set(card.name, count + 1);
      }
    });
    
    const duplicates = Array.from(nameCount.entries()).filter(([name, count]) => count > 1);
    if (duplicates.length > 0) {
      console.warn(`⚠️ Found duplicate non-basic cards in deck:`, duplicates);
    }
    
    // Use the final smart quotas for evaluation
    const finalQuotas = getSmartQuotas(commander, finalDeck);
    const deckScore = evaluateDeckSynergy(finalDeck, finalQuotas.quotas);
    
    console.log(`📈 Final deck composition: ${finalDeck.mainboard.length} cards, synergy score: ${deckScore.toFixed(1)}`);
    
    if (deckScore > best.synergy) {
      best = { deck: finalDeck, synergy: deckScore };
      console.log(`🏆 New best deck found! Synergy: ${deckScore.toFixed(1)}`);
    }
  }

  if (!best.deck) {
    const fallbackCommander = cardPool.find(c => /legendary/i.test(c.type_line || '')) || cardPool[0];
    return { deck: { commanders: [fallbackCommander], mainboard: cardPool.slice(1, 100) }, synergy: 0 };
  }

  // Final cleanup: Remove any duplicate non-basic cards that might have slipped through
  const cleanedMainboard = [];
  const usedNames = new Set();
  
  for (const card of best.deck.mainboard) {
    const isBasic = isBasicLand(card);
    if (isBasic || !usedNames.has(card.name)) {
      cleanedMainboard.push(card);
      if (!isBasic) {
        usedNames.add(card.name);
      }
    }
  }
  
  best.deck.mainboard = cleanedMainboard;
  return best;
}

module.exports = {
    buildGreedyCommanderDeck,
    classifyCard,
    evaluateDeckSynergy,
    distributeBasics,
    QUOTAS,
    shuffle
} 

// Ensure bundlers that rely on static export detection can pick up named exports
exports.buildGreedyCommanderDeck = buildGreedyCommanderDeck;
exports.classifyCard = classifyCard;
exports.evaluateDeckSynergy = evaluateDeckSynergy;
exports.distributeBasics = distributeBasics;
exports.QUOTAS = QUOTAS;
exports.shuffle = shuffle; 