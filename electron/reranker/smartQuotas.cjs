// Smart quota system that adapts based on commander strategy and deck composition

const BASE_QUOTAS = {
  LAND_TARGET: 38,
  RAMP_TARGET: 10,
  DRAW_TARGET: 8,
  REMOVAL_TARGET: 8,
};

// Analyze commander to determine initial strategy and quota adjustments
function analyzeCommander(commander) {
  const adjustments = { land: 0, ramp: 0, draw: 0, removal: 0 };
  const type = (commander.type_line || commander.type || '').toLowerCase();
  const text = (commander.oracle_text || commander.text || '').toLowerCase();
  const manaCost = commander.manaValue || commander.cmc || commander.mana_value || 0;
  const colors = commander.color_identity || [];

  // High-cost commanders need more ramp
  if (manaCost >= 6) {
    adjustments.ramp += 3;
    adjustments.land += 2;
  } else if (manaCost >= 4) {
    adjustments.ramp += 1;
  } else if (manaCost <= 2) {
    // Low-cost commanders can run fewer lands
    adjustments.land -= 2;
  }

  // Analyze commander abilities
  if (text.includes('draw') && text.includes('card')) {
    adjustments.draw -= 2; // Commander provides card draw
  }
  
  if (text.includes('destroy') || text.includes('exile') || text.includes('counter')) {
    adjustments.removal -= 2; // Commander provides removal
  }

  if (text.includes('search') && text.includes('library')) {
    adjustments.ramp += 1; // Tutoring synergizes with ramp
  }

  // Token strategies
  if (text.includes('token') || text.includes('create')) {
    adjustments.removal += 1; // Token decks need more protection
  }

  // Artifact commanders
  if (text.includes('artifact') || type.includes('artifact')) {
    adjustments.ramp += 2; // Artifact decks often ramp with mana rocks
  }

  // Graveyard strategies
  if (text.includes('graveyard') || text.includes('flashback') || text.includes('unearth')) {
    adjustments.draw += 1; // Graveyard decks need more card selection
  }

  // Color-based adjustments
  if (colors.includes('G')) { // Green
    adjustments.ramp += 1; // Green is good at ramp
  }
  if (colors.includes('U')) { // Blue
    adjustments.draw += 1; // Blue is good at card draw
  }
  if (colors.includes('W') || colors.includes('B')) { // White or Black
    adjustments.removal += 1; // White and Black are good at removal
  }
  if (colors.includes('R') && manaCost <= 3) { // Red + low cost
    adjustments.land -= 1; // Aggressive red decks run fewer lands
  }

  return adjustments;
}

// Analyze current deck state to make ongoing adjustments
function analyzeDeckState(currentDeck) {
  const adjustments = { land: 0, ramp: 0, draw: 0, removal: 0 };
  const allCards = [...currentDeck.mainboard, ...(currentDeck.commanders || [])];
  
  if (allCards.length === 0) return adjustments;

  // Calculate average mana cost
  const totalCmc = allCards.reduce((sum, card) => {
    return sum + (card.manaValue || card.cmc || card.mana_value || 0);
  }, 0);
  const avgCmc = totalCmc / allCards.length;

  // High average CMC needs more ramp and lands
  if (avgCmc >= 4) {
    adjustments.ramp += 2;
    adjustments.land += 1;
  } else if (avgCmc <= 2.5) {
    adjustments.land -= 2;
  }

  // Count existing categories
  const counts = { land: 0, ramp: 0, draw: 0, removal: 0, creatures: 0 };
  allCards.forEach(card => {
    const type = (card.type_line || card.type || '').toLowerCase();
    const text = (card.oracle_text || card.text || '').toLowerCase();

    if (type.includes('land')) counts.land++;
    else if (type.includes('creature')) counts.creatures++;
    
    if (text.includes('add') && text.match(/\{[wubrgc]\}/)) counts.ramp++;
    if (text.includes('draw') && text.includes('card')) counts.draw++;
    if (text.includes('destroy') || text.includes('exile') || text.includes('counter')) counts.removal++;
  });

  // If we have lots of creatures, we might need more protection
  const creatureRatio = counts.creatures / allCards.length;
  if (creatureRatio > 0.6) {
    adjustments.removal += 1; // Creature-heavy decks need more removal
  }

  // Detect emerging themes
  const themes = detectThemes(allCards);
  
  if (themes.combo > 0.3) {
    adjustments.draw += 3; // Combo decks need more card selection
    adjustments.removal -= 1;
  }
  
  if (themes.control > 0.3) {
    adjustments.removal += 2; // Control decks need more removal
    adjustments.draw += 1;
    adjustments.land += 1;
  }
  
  if (themes.aggro > 0.3) {
    adjustments.land -= 2; // Aggro decks run fewer lands
    adjustments.removal -= 1;
  }

  if (themes.ramp > 0.3) {
    adjustments.ramp += 1; // Ramp decks want more ramp
    adjustments.land += 1;
  }

  return adjustments;
}

// Detect deck themes based on current cards
function detectThemes(cards) {
  const themes = { combo: 0, control: 0, aggro: 0, ramp: 0 };
  const totalCards = cards.length || 1;

  cards.forEach(card => {
    const type = (card.type_line || card.type || '').toLowerCase();
    const text = (card.oracle_text || card.text || '').toLowerCase();
    const cmc = card.manaValue || card.cmc || card.mana_value || 0;

    // Combo indicators
    if (text.includes('tutor') || text.includes('search') || 
        text.includes('infinite') || text.includes('combo')) {
      themes.combo += 1;
    }

    // Control indicators
    if (text.includes('counter') || text.includes('destroy') || 
        text.includes('exile') || text.includes('board wipe')) {
      themes.control += 1;
    }

    // Aggro indicators
    if ((type.includes('creature') && cmc <= 3) || 
        text.includes('haste') || text.includes('first strike')) {
      themes.aggro += 1;
    }

    // Ramp indicators
    if (text.includes('add') && text.match(/\{[wubrgc]\}/) || 
        text.includes('search') && text.includes('land')) {
      themes.ramp += 1;
    }
  });

  // Normalize to percentages
  Object.keys(themes).forEach(theme => {
    themes[theme] = themes[theme] / totalCards;
  });

  return themes;
}

// Get smart quotas based on commander and current deck state
function getSmartQuotas(commander, currentDeck = { mainboard: [], commanders: [] }) {
  const commanderAdjustments = analyzeCommander(commander);
  const deckStateAdjustments = analyzeDeckState(currentDeck);

  // Combine adjustments
  const totalAdjustments = {
    land: commanderAdjustments.land + deckStateAdjustments.land,
    ramp: commanderAdjustments.ramp + deckStateAdjustments.ramp,
    draw: commanderAdjustments.draw + deckStateAdjustments.draw,
    removal: commanderAdjustments.removal + deckStateAdjustments.removal,
  };

  // Apply adjustments to base quotas with bounds
  const smartQuotas = {
    LAND_TARGET: Math.max(32, Math.min(42, BASE_QUOTAS.LAND_TARGET + totalAdjustments.land)),
    RAMP_TARGET: Math.max(6, Math.min(16, BASE_QUOTAS.RAMP_TARGET + totalAdjustments.ramp)),
    DRAW_TARGET: Math.max(5, Math.min(15, BASE_QUOTAS.DRAW_TARGET + totalAdjustments.draw)),
    REMOVAL_TARGET: Math.max(4, Math.min(12, BASE_QUOTAS.REMOVAL_TARGET + totalAdjustments.removal)),
  };

  return {
    quotas: smartQuotas,
    adjustments: totalAdjustments,
    reasoning: {
      commander: commanderAdjustments,
      deckState: deckStateAdjustments,
    }
  };
}

// Get archetype description for logging
function getArchetypeDescription(commander, currentDeck) {
  const themes = detectThemes([...currentDeck.mainboard, ...(currentDeck.commanders || [])]);
  const topTheme = Object.entries(themes).reduce((a, b) => themes[a[0]] > themes[b[0]] ? a : b);
  
  const manaCost = commander.manaValue || commander.cmc || commander.mana_value || 0;
  const colors = commander.color_identity || [];
  
  let archetype = 'Midrange';
  
  if (topTheme[1] > 0.3) {
    archetype = topTheme[0].charAt(0).toUpperCase() + topTheme[0].slice(1);
  } else if (manaCost >= 6) {
    archetype = 'Big Mana';
  } else if (manaCost <= 2) {
    archetype = 'Aggressive';
  } else if (colors.length >= 3) {
    archetype = 'Multicolor Value';
  }

  return archetype;
}

module.exports = {
  getSmartQuotas,
  analyzeCommander,
  analyzeDeckState,
  detectThemes,
  getArchetypeDescription,
  BASE_QUOTAS
}; 