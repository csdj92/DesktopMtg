const settingsManager = require('./settingsManager.cjs');

/**
 * Deck Recommendation Engine
 * 
 * This module handles all deck analysis and card recommendation logic.
 * It includes functions for analyzing deck composition, generating search queries,
 * and reranking cards based on deck synergy.
 */

/**
 * Helper function to check if a card's colors are within the commander's identity
 * @param {Object} card - The card to check
 * @param {Set} commanderId - Set of commander color identity
 * @returns {boolean} - Whether the card is within color identity
 */
const isCardInColorIdentity = (card, commanderId) => {
  if (!commanderId || commanderId.size === 0) return true;
  if (!card.color_identity || card.color_identity.length === 0) return true;
  return card.color_identity.every(color => commanderId.has(color));
};

/**
 * Helper function to rerank cards based on deck synergy
 * @param {Array} cards - Array of cards to rerank
 * @param {Object} deck - The deck object containing mainboard and commanders
 * @param {string} formatName - The format name (e.g., 'commander')
 * @param {Object} settings - Optional settings object, if null will use current settings
 * @returns {Array} - Sorted array of cards with synergy scores
 */
const rerankCardsByDeckSynergy = (cards, deck, formatName, settings = null) => {
  if (!cards || cards.length === 0) return [];
  
  // DEBUG: Check settingsManager state
  console.log('🔍 SettingsManager debug:');
  console.log('settingsManager.getSettings():', settingsManager.getSettings());
  
  // Use provided settings or fallback to current settings
  const recoSettings = settings?.recommendations || settingsManager.getSettings().recommendations;
  const weights = recoSettings.weights || {};
  const thresholds = recoSettings.thresholds || {};
  const idealCurve = recoSettings.idealCurve;
  
  // DEBUG: Log the actual settings structure
  console.log('\n🔍 SETTINGS DEBUG:');
  console.log('recoSettings:', JSON.stringify(recoSettings, null, 2));
  console.log('weights before processing:', JSON.stringify(weights, null, 2));
  
  // ===== NEW: Robust Default Handling to Prevent NaN =====
  // Helper to coerce any value to a finite number or fallback to default
  const toNumberOrDefault = (val, def) => {
    const n = Number(val);
    return Number.isFinite(n) ? n : def;
  };

  // Provide a single source of truth for every weight used in the algorithm
  const weightDefaults = {
    semantic: 1,
    themeMultiplier: 1,
    curveMultiplier: 1,
    tribalSynergy: 1,
    tribalSupport: 1,
    keywordSynergy: 1,
    cardDraw: 1,
    removal: 1,
    tutor: 1,
    typeAdjustment: 1,
    nameHashContrib: 1,
  };

  // Ensure commander sub-weights always exist - be more aggressive about this
  if (!weights.commander || typeof weights.commander !== 'object') {
    console.log('⚠️ Commander weights missing or invalid, creating default structure');
    weights.commander = {};
  }
  
  // Force commander weights to exist regardless of what's in settings
  const commanderWeightDefaults = { multiplayer: 1, legendary: 1 };
  Object.entries(commanderWeightDefaults).forEach(([key, def]) => {
    const currentVal = weights.commander[key];
    weights.commander[key] = toNumberOrDefault(currentVal, def);
    console.log(`🔧 Commander weight ${key}: ${currentVal} → ${weights.commander[key]}`);
  });

  // Apply defaults & coercion for top-level weights
  Object.entries(weightDefaults).forEach(([key, def]) => {
    weights[key] = toNumberOrDefault(weights[key], def);
  });

  // DEBUG: Log weights after processing
  console.log('weights after processing:', JSON.stringify(weights, null, 2));
  console.log('commander weights specifically:', weights.commander);

  // ===== Validate thresholds with sensible fallbacks =====
  const thresholdDefaults = {
    themeStrengthCap: 0.5,
    matchStrengthCap: 3,
    curveNeedsMin: 0.01,
  };
  Object.entries(thresholdDefaults).forEach(([key, def]) => {
    thresholds[key] = toNumberOrDefault(thresholds[key], def);
  });
  // ===== END Robust Default Handling =====

  // Existing validateWeight still protects against later malformed overrides
  const validateWeight = (weight, name, defaultValue = 1) => {
    if (isNaN(weight) || !isFinite(weight)) {
      console.warn(`[WEIGHT WARNING] Invalid weight for ${name}: ${weight}, using default: ${defaultValue}`);
      return defaultValue;
    }
    return weight;
  };
  
  // Re-validate all weights again (covers any user supplied extras)
  Object.keys(weights).forEach(key => {
    const defaultValue = weightDefaults[key] ?? 1;
    weights[key] = validateWeight(weights[key], key, defaultValue);
  });
  
  const allDeckCards = [...deck.mainboard, ...(deck.commanders || [])];
  const deckText = allDeckCards.map(card => `${card.oracle_text || card.text || ''} ${card.type_line || card.type || ''}`).join(' ').toLowerCase();
  
  console.log('\n🎯 === DECK SYNERGY ANALYSIS ===');
  console.log(`📊 Analyzing deck with ${allDeckCards.length} cards for synergy scoring...`);
  
  // Analyze deck themes for scoring
  const deckThemes = {
    graveyard: /graveyard|flashback|unearth|dredge|delve|escape|disturb/g,
    counters: /\+1\/\+1|counter|proliferate|evolve|adapt|monstrosity/g,
    tokens: /token|populate|convoke|create.*creature/g,
    artifacts: /artifact|metalcraft|affinity|improvise/g,
    spells: /instant|sorcery|storm|prowess|magecraft/g,
    lifegain: /gain.*life|lifegain|lifelink/g,
    sacrifice: /sacrifice|devour|exploit|emerge/g,
    tribal: /choose.*type|tribal|changeling/g
  };
  
  const deckThemeScores = {};
  Object.entries(deckThemes).forEach(([theme, pattern]) => {
    const matches = deckText.match(pattern);
    deckThemeScores[theme] = matches ? matches.length : 0;
  });
  
  // 🔍 LOG THEME ANALYSIS
  console.log('\n🎨 DECK THEME ANALYSIS:');
  const significantThemes = Object.entries(deckThemeScores)
    .filter(([theme, count]) => count > 0)
    .sort((a, b) => b[1] - a[1]);
  
  if (significantThemes.length > 0) {
    significantThemes.forEach(([theme, count]) => {
      const percentage = Math.round((count / allDeckCards.length) * 100);
      console.log(`  ${theme}: ${count} matches (${percentage}% of deck)`);
    });
  } else {
    console.log('  No significant themes detected');
  }
  
  // Calculate mana curve needs
  const manaCurve = { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0, '7+': 0 };
  allDeckCards.forEach(card => {
    const cmc = card.manaValue || card.cmc || card.mana_value || 0;
    if (cmc >= 7) manaCurve['7+']++;
    else manaCurve[cmc]++;
  });
  
  const totalDeckCards = allDeckCards.length || 1;
  const curveNeeds = {};
  Object.entries(manaCurve).forEach(([cost, count]) => {
    const percentage = count / totalDeckCards;
    // Use configurable ideal curve percentages
    const ideal = idealCurve[cost] || 0.05;
    curveNeeds[cost] = Math.max(0, ideal - percentage); // Higher need = bigger gap
  });
  
  // 🔍 LOG MANA CURVE ANALYSIS
  console.log('\n⚡ MANA CURVE ANALYSIS:');
  console.log('Current curve:');
  Object.entries(manaCurve).forEach(([cost, count]) => {
    const percentage = Math.round((count / totalDeckCards) * 100);
    const ideal = Math.round((idealCurve[cost] || 0.05) * 100);
    const need = curveNeeds[cost];
    const needIndicator = need > 0.05 ? ` (NEEDS MORE: ${(need * 100).toFixed(1)}%)` : '';
    console.log(`  ${cost} CMC: ${count} cards (${percentage}% vs ${ideal}% ideal)${needIndicator}`);
  });
  
  // Analyze tribal themes in the deck
  const deckTribes = new Map();
  allDeckCards.forEach(card => {
    const cardTypeLine = (card.type_line || card.type || '').toLowerCase();
    if (cardTypeLine.includes('creature')) {
      const typeMatch = cardTypeLine.match(/creature\s+—\s+(.+)/i);
      if (typeMatch) {
        const cardTribes = typeMatch[1].split(' ').map(tribe => 
          tribe.replace(/[^a-zA-Z]/g, '').toLowerCase()
        ).filter(tribe => tribe.length > 2);
        
        cardTribes.forEach(tribe => {
          const formattedTribe = tribe.charAt(0).toUpperCase() + tribe.slice(1);
          deckTribes.set(formattedTribe, (deckTribes.get(formattedTribe) || 0) + 1);
        });
      }
    }
  });
  
  // 🔍 LOG TRIBAL ANALYSIS
  console.log('\n🏛️ TRIBAL ANALYSIS:');
  const significantTribes = Array.from(deckTribes.entries())
    .filter(([tribe, count]) => count >= 2)
    .sort((a, b) => b[1] - a[1]);
  
  if (significantTribes.length > 0) {
    significantTribes.forEach(([tribe, count]) => {
      const percentage = Math.round((count / allDeckCards.length) * 100);
      console.log(`  ${tribe}: ${count} creatures (${percentage}% of deck)`);
    });
  } else {
    console.log('  No significant tribal themes detected');
  }
  
  console.log('\n🧮 SCORING WEIGHTS:');
  console.log(`  Semantic similarity: ${weights.semantic}x`);
  console.log(`  Theme multiplier: ${weights.themeMultiplier}x`);
  console.log(`  Artifacts theme: ${(weights.themeMultiplier * 0.6).toFixed(1)}x (reduced by 40%)`);
  console.log(`  Curve multiplier: ${weights.curveMultiplier}x`);
  console.log(`  Tribal synergy: ${weights.tribalSynergy}x`);
  console.log(`  Card draw bonus: ${weights.cardDraw}x`);
  console.log(`  Removal bonus: ${weights.removal}x`);
  console.log(`  Tutor bonus: ${weights.tutor}x`);
  
  // Calculate creature percentage in current deck
  const creatureCount = allDeckCards.filter(card => {
    const cardTypeLine = (card.type_line || card.type || '').toLowerCase();
    return cardTypeLine.includes('creature');
  }).length;
  
  const creaturePct = totalDeckCards > 0 ? creatureCount / totalDeckCards : 0;
  const desiredCreaturePct = (formatName || '').toLowerCase() === 'commander' ? 0.35 : 0.4; // 35% for commander, 40% for other formats
  
  console.log(`\n🦄 CREATURE ANALYSIS:`);
  console.log(`  Current creatures: ${creatureCount}/${totalDeckCards} (${Math.round(creaturePct * 100)}%)`);
  console.log(`  Desired creatures: ${Math.round(desiredCreaturePct * 100)}%`);
  
  // Score each card
  const scoredCards = cards.map(card => {
    let score = 0;
    const cardText = `${card.oracle_text || card.text || ''} ${card.type_line || card.type || ''}`.toLowerCase();
    const cardCMC = card.manaValue || card.cmc || card.mana_value || 0;
    const cmcKey = cardCMC >= 7 ? '7+' : cardCMC.toString();
    const cardName = (card.name || '').toLowerCase();
    
    // Track scoring breakdown for detailed logging
    const scoreBreakdown = {
      nameHash: 0,
      similarity: 0,
      themes: {},
      curve: 0,
      tribal: 0,
      keywords: 0,
      format: 0,
      utility: 0,
      typeAdjustment: 0
    };
    
    // Add deterministic component based on card name for consistent ordering
    const nameHash = cardName.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
    const nameHashBonus = (nameHash % 100) / 100 * weights.nameHashContrib;
    score += nameHashBonus;
    scoreBreakdown.nameHash = nameHashBonus;
    
    // Base similarity score (can be semantic, keyword-based, or combined)
    // Priority: combined_score > semantic_score > keyword_score > fallback calculation
    let similarityScore = 0;
    let scoreMethod = 'fallback';
    
    if (card.combined_score !== undefined && !isNaN(card.combined_score)) {
      similarityScore = card.combined_score;
      scoreMethod = card.score_source || 'combined';
    } else if (card.semantic_score !== undefined && !isNaN(card.semantic_score)) {
      similarityScore = card.semantic_score;
      scoreMethod = 'semantic';
    } else if (card.keyword_score !== undefined && !isNaN(card.keyword_score)) {
      similarityScore = card.keyword_score;
      scoreMethod = 'keyword';
    } else {
      // Fallback for legacy compatibility - use configurable distance conversion
      const distance = card._distance || card.distance || 1.0;
      const conversionType = recoSettings.scoring?.distanceConversion || 'sqrt';
      
      // Ensure distance is a valid number
      if (isNaN(distance) || !isFinite(distance)) {
        similarityScore = 0;
        scoreMethod = 'fallback_zero';
      } else {
        switch (conversionType) {
          case 'linear':
            similarityScore = Math.max(0, 1 - distance);
            break;
          case 'sqrt':
            similarityScore = Math.max(0, 1 - Math.sqrt(Math.abs(distance)));
            break;
          case 'exponential':
            similarityScore = Math.max(0, Math.exp(-Math.abs(distance)));
            break;
          case 'aggressive_exp':
            similarityScore = Math.max(0, Math.exp(-Math.abs(distance) * 2));
            break;
          default:
            similarityScore = Math.max(0, 1 - Math.sqrt(Math.abs(distance)));
        }
        scoreMethod = 'distance';
      }
    }
    
    // Ensure similarity score is valid
    if (isNaN(similarityScore) || !isFinite(similarityScore)) {
      console.warn(`[SIMILARITY WARNING] Invalid similarity score for card "${card.name}": ${similarityScore}`);
      similarityScore = 0;
    }
    
    // Apply configurable similarity scaling for better balance with synergy bonuses
    const similarityScale = recoSettings.scoring?.similarityScale || 200;
    const balanceMode = recoSettings.scoring?.balanceMode || 'mixed';
    
    let similarityBonus;
    switch (balanceMode) {
      case 'similarity_first':
        // Prioritize similarity scores - use higher scaling
        similarityBonus = similarityScore * similarityScale;
        break;
      case 'synergy_first':
        // Lower similarity impact - use original weight
        similarityBonus = similarityScore * weights.semantic;
        break;
      case 'mixed':
      default:
        // Balanced approach - use configurable scale
        similarityBonus = similarityScore * similarityScale;
        break;
    }
    
    score += similarityBonus;
    scoreBreakdown.similarity = similarityBonus;
    
    // Theme synergy bonuses (improved calculation)
    Object.entries(deckThemes).forEach(([theme, pattern]) => {
      if (deckThemeScores[theme] > 0) {
        const cardMatches = cardText.match(pattern);
        if (cardMatches) {
          // More sophisticated scoring based on theme prominence
          const themeStrength = Math.min(deckThemeScores[theme] / totalDeckCards, thresholds.themeStrengthCap); // Configurable cap
          const matchStrength = Math.min(cardMatches.length, thresholds.matchStrengthCap); // Configurable cap
          
          // Apply reduced multiplier for artifacts in auto-build context
          let themeMultiplier = weights.themeMultiplier;
          if (theme === 'artifacts') {
            themeMultiplier = weights.themeMultiplier * 0.6; // Reduce artifact scoring by 40%
            // Note: Artifact theme scoring reduced to prevent over-prioritization
          }
          
          const themeBonus = themeStrength * matchStrength * themeMultiplier;
          score += themeBonus;
          scoreBreakdown.themes[theme] = themeBonus;
        }
      }
    });
    
    // Mana curve filling bonus (improved)
    if (curveNeeds[cmcKey] > thresholds.curveNeedsMin) { // Configurable threshold
      const curveBonus = curveNeeds[cmcKey] * weights.curveMultiplier;
      score += curveBonus;
      scoreBreakdown.curve = curveBonus;
    }
    
    // Tribal synergy bonuses
    const cardTypeLine = card.type_line || card.type || '';
    let tribalBonus = 0;
    if (cardTypeLine.toLowerCase().includes('creature')) {
      // Extract creature types from this card
      const typeMatch = cardTypeLine.match(/creature\s+—\s+(.+)/i);
      if (typeMatch) {
        const cardTribes = typeMatch[1].split(' ').map(tribe => 
          tribe.replace(/[^a-zA-Z]/g, '').toLowerCase()
        ).filter(tribe => tribe.length > 2);
        
        // Check if this card matches any of the deck's tribal themes
        cardTribes.forEach(cardTribe => {
          allDeckCards.forEach(deckCard => {
            const deckTypeLine = (deckCard.type_line || deckCard.type || '').toLowerCase();
            if (deckTypeLine.includes('creature') && deckTypeLine.includes(cardTribe)) {
              tribalBonus += weights.tribalSynergy; // Configurable tribal synergy bonus
            }
          });
        });
      }
      
      // Check for tribal support cards (cards that care about creature types)
      const cardText = (card.oracle_text || card.text || '').toLowerCase();
      if (cardText.includes('creature type') || 
          cardText.includes('choose a creature type') ||
          cardText.includes('creatures you control') ||
          cardText.includes('creatures of the chosen type') ||
          cardText.includes('other') && cardText.includes('creatures')) {
        tribalBonus += weights.tribalSupport; // Configurable tribal support bonus
      }
    }
    score += tribalBonus;
    scoreBreakdown.tribal = tribalBonus;
    
    // Keyword synergy bonuses
    const keywords = ['flying', 'trample', 'haste', 'vigilance', 'lifelink', 'deathtouch', 'first strike', 'double strike'];
    let keywordBonus = 0;
    keywords.forEach(keyword => {
      if (cardText.includes(keyword) && deckText.includes(keyword)) {
        keywordBonus += weights.keywordSynergy; // Configurable keyword synergy bonus
      }
    });
    score += keywordBonus;
    scoreBreakdown.keywords = keywordBonus;
    
    // Format-specific bonuses
    let formatBonus = 0;
    if (formatName === 'commander') {
      // Commander format prefers singleton effects and high impact
      if (cardText.includes('each opponent') || cardText.includes('each player')) {
        formatBonus += weights.commander.multiplayer; // Configurable multiplayer bonus
      }
      if (cardText.includes('legendary') && cardTypeLine.toLowerCase().includes('creature')) {
        formatBonus += weights.commander.legendary; // Configurable legendary creature bonus
      }
    }

    // DEBUG: log format bonus calculation details

    score += formatBonus;
    // Ensure formatBonus is a finite number to avoid NaN in breakdown logs
    if (!Number.isFinite(formatBonus)) {
      console.warn(`[FORMAT BONUS WARNING] Invalid formatBonus for card "${card.name}": ${formatBonus}. Setting to 0.`);
      formatBonus = 0;
    }
    scoreBreakdown.format = formatBonus;
    
    // Utility and staple bonuses
    let utilityBonus = 0;
    if (cardText.includes('draw') && cardText.includes('card')) {
      utilityBonus += weights.cardDraw; // Configurable card draw bonus
    }
    if (cardText.includes('destroy') || cardText.includes('exile')) {
      utilityBonus += weights.removal; // Configurable removal bonus
    }
    if (cardText.includes('search') && cardText.includes('library')) {
      utilityBonus += weights.tutor; // Configurable tutoring bonus
    }
    score += utilityBonus;
    scoreBreakdown.utility = utilityBonus;
    
    // Type distribution adjustment to reduce creature bias
    let typeAdj = 0;
    const typeAdjustmentWeight = weights.typeAdjustment || 1;
    
    if (cardTypeLine.toLowerCase().includes('creature')) {
      if (creaturePct > desiredCreaturePct) {
        // Too many creatures already – penalise
        typeAdj = -10 * typeAdjustmentWeight; // configurable (default 1)
      } else {
        // Need more creatures
        typeAdj = 10 * typeAdjustmentWeight;
      }
    } else {
      if (creaturePct > desiredCreaturePct) {
        // Encourage non-creatures when creature saturation high
        typeAdj = 10 * typeAdjustmentWeight;
      }
    }
    
    // Ensure typeAdj is a valid number
    if (isNaN(typeAdj) || !isFinite(typeAdj)) {
      console.warn(`[TYPE ADJUSTMENT WARNING] Invalid typeAdj for card "${card.name}": ${typeAdj}, using 0`);
      typeAdj = 0;
    }
    
    score += typeAdj;
    scoreBreakdown.typeAdjustment = typeAdj;
    
    // Ensure score is a valid number and round to 2 decimal places for consistency
    if (isNaN(score) || !isFinite(score)) {
      console.warn(`[SCORE WARNING] Invalid score for card "${card.name}": ${score}`);
      console.warn(`  Score breakdown:`, scoreBreakdown);
      score = 0; // Fallback to 0 for invalid scores
    }
    
    const finalScore = Math.round(score * 100) / 100;
    
    return { 
      ...card, 
      synergy_score: isNaN(finalScore) ? 0 : finalScore,
      // Add debugging info about scoring method used
      _scoring_method: scoreMethod,
      _similarity_score: similarityScore,
      _score_breakdown: scoreBreakdown
    };
  });
  
  // Sort by synergy score (highest first), then by name for consistent tie-breaking
  // --- NEW: Apply semantic similarity boost ---
  scoredCards.forEach(card => {
    if (card.semantic_score >= 0.3) {
      card.synergy_score += 50;
      card._score_breakdown.semantic_boost = 50;
    } else if (card.semantic_score >= 0.25) {
      card.synergy_score += 30;
      card._score_breakdown.semantic_boost = 30;
    } else if (card.semantic_score >= 0.2) {
      card.synergy_score += 15;
      card._score_breakdown.semantic_boost = 15;
    }
  });
  const sortedCards = scoredCards.sort((a, b) => {
    const scoreDiff = b.synergy_score - a.synergy_score;
    if (Math.abs(scoreDiff) < 0.01) { // Very close scores
      return a.name.localeCompare(b.name); // Alphabetical tie-breaker
    }
    return scoreDiff;
  });
  
  // 🔍 LOG TOP SCORING CARDS WITH BREAKDOWN
  console.log('\n🏆 TOP 5 SCORING CARDS BREAKDOWN:');
  sortedCards.slice(0, 5).forEach((card, i) => {
    console.log(`\n${i + 1}. ${card.name} (Total: ${card.synergy_score})`);
    console.log(`   Similarity: ${card._similarity_score?.toFixed(3)} → ${card._score_breakdown.similarity?.toFixed(2)} pts`);
    
    const themeEntries = Object.entries(card._score_breakdown.themes || {});
    if (themeEntries.length > 0) {
      console.log(`   Themes:`);
      themeEntries.forEach(([theme, points]) => {
        console.log(`     ${theme}: ${points.toFixed(2)} pts`);
      });
    }
    
    if (card._score_breakdown.curve > 0) {
      const cardCMC = card.manaValue || card.cmc || card.mana_value || 0;
      console.log(`   Curve filling (${cardCMC}): ${card._score_breakdown.curve.toFixed(2)} pts`);
    }
    if (card._score_breakdown.tribal > 0) {
      console.log(`   Tribal synergy: ${card._score_breakdown.tribal.toFixed(2)} pts`);
    }
    if (card._score_breakdown.keywords > 0) {
      console.log(`   Keyword synergy: ${card._score_breakdown.keywords.toFixed(2)} pts`);
    }
    if (card._score_breakdown.format > 0) {
      console.log(`   Format bonus: ${card._score_breakdown.format.toFixed(2)} pts`);
    }
    if (card._score_breakdown.utility > 0) {
      console.log(`   Utility bonus: ${card._score_breakdown.utility.toFixed(2)} pts`);
    }
    if (card._score_breakdown.nameHash > 0) {
      console.log(`   Name hash: ${card._score_breakdown.nameHash.toFixed(2)} pts`);
    }
    if (card._score_breakdown.semantic_boost > 0) {
      console.log(`   Semantic boost: ${card._score_breakdown.semantic_boost.toFixed(2)} pts`);
    }
  });
  
  console.log('\n🎯 === END DECK SYNERGY ANALYSIS ===\n');
  
  return sortedCards;
};

/**
 * Advanced Oracle Text Analysis and Mechanical Pattern Matching
 * 
 * This system parses oracle text to understand complex mechanical relationships
 * and synergies beyond simple keyword matching.
 */

/**
 * Parse oracle text to extract mechanical patterns and synergies
 * @param {string} oracleText - The card's oracle text
 * @returns {Object} - Extracted patterns and mechanics
 */
const parseOracleTextPatterns = (oracleText) => {
  if (!oracleText) return {};
  
  const text = oracleText.toLowerCase();
  const patterns = {};
  
  // 1. TRIGGERED ABILITIES
  patterns.triggers = [];
  
  // Enter the battlefield triggers
  const etbMatches = text.match(/when(?:ever)?\s+(?:.*?\s+)?enters(?:\s+the\s+battlefield)?/g) || [];
  etbMatches.forEach(match => {
    patterns.triggers.push({
      type: 'enters_battlefield',
      text: match,
      affects: extractAffectedTypes(match)
    });
  });
  
  // Dies/leaves battlefield triggers  
  const diesMatches = text.match(/when(?:ever)?\s+(?:.*?\s+)?(?:dies|leaves\s+the\s+battlefield)/g) || [];
  diesMatches.forEach(match => {
    patterns.triggers.push({
      type: 'dies_or_leaves',
      text: match,
      affects: extractAffectedTypes(match)
    });
  });
  
  // Attack/combat triggers
  const attackMatches = text.match(/when(?:ever)?\s+(?:.*?\s+)?attacks?/g) || [];
  attackMatches.forEach(match => {
    patterns.triggers.push({
      type: 'attacks',
      text: match,
      affects: extractAffectedTypes(match)
    });
  });
  
  // Spell triggers
  const spellMatches = text.match(/when(?:ever)?\s+you\s+cast\s+(?:a\s+)?(?:.*?\s+)?(?:spell|instant|sorcery)/g) || [];
  spellMatches.forEach(match => {
    patterns.triggers.push({
      type: 'cast_spell',
      text: match,
      spellTypes: extractSpellTypes(match)
    });
  });
  
  // 2. MECHANICAL ENGINES (like Giott's discard/draw)
  patterns.engines = [];
  
  // Discard/Draw engines
  if (text.includes('discard') && text.includes('draw')) {
    const discardDrawPattern = /(?:may\s+)?discard.*?(?:if\s+you\s+do,?\s*)?draw/g;
    const matches = text.match(discardDrawPattern) || [];
    matches.forEach(match => {
      patterns.engines.push({
        type: 'discard_draw',
        text: match,
        optional: match.includes('may'),
        conditional: match.includes('if you do')
      });
    });
  }
  
  // Sacrifice/benefit engines
  if (text.includes('sacrifice') && (text.includes('draw') || text.includes('gain') || text.includes('deal'))) {
    patterns.engines.push({
      type: 'sacrifice_engine',
      text: text,
      benefits: extractSacrificeRewards(text)
    });
  }
  
  // Tap/untap engines
  if (text.includes('tap') || text.includes('untap')) {
    patterns.engines.push({
      type: 'tap_engine', 
      text: text,
      generates: extractTapBenefits(text)
    });
  }

  // --- NEW: Detect if card cares about tokens (even if it doesn't create them) ---
  // Look for costs or abilities that require tokens (e.g., 'tap two untapped tokens', 'sacrifice a token', etc.)
  const caresAboutTokensPatterns = [
    /tap (one|two|three|four|five|\d+) untapped tokens?/,
    /sacrifice (a|one|two|three|four|five|\d+) tokens?/,
    /return (a|one|two|three|four|five|\d+) tokens?/,
    /remove (a|one|two|three|four|five|\d+) tokens?/,
    /for each token you control/,
    /if you control.*token/,
    /if you have.*token/,
    /choose.*token/,
    /target token/,
    /tokens? you control.*(do|have|get|gain|may|can)/
  ];
  patterns.cares_about_tokens = caresAboutTokensPatterns.some(re => re.test(text));

  // 3. TYPE-BASED SYNERGIES
  patterns.typeSynergies = extractTypeSynergies(text);
  
  // 4. KEYWORD ABILITIES (enhanced detection)
  patterns.keywords = extractKeywordAbilities(text);
  
  // 5. RESOURCE MANIPULATION
  patterns.resources = extractResourceEffects(text);
  
  // 6. PROTECTION AND INTERACTION
  patterns.interaction = extractInteractionPatterns(text);
  
  return patterns;
};

/**
 * Extract creature types, artifact types, etc. from trigger text
 */
const extractAffectedTypes = (text) => {
  const types = [];
  
  // Creature types
  const creatureTypes = [
    'dwarf', 'elf', 'goblin', 'human', 'dragon', 'angel', 'demon', 'wizard', 'warrior',
    'knight', 'soldier', 'beast', 'spirit', 'zombie', 'vampire', 'merfolk', 'faerie'
  ];
  
  creatureTypes.forEach(type => {
    if (text.includes(type)) {
      types.push({ category: 'creature', type: type });
    }
  });
  
  // Card types
  const cardTypes = ['artifact', 'equipment', 'enchantment', 'planeswalker', 'instant', 'sorcery'];
  cardTypes.forEach(type => {
    if (text.includes(type)) {
      types.push({ category: 'card_type', type: type });
    }
  });
  
  return types;
};

/**
 * Extract spell types from cast triggers
 */
const extractSpellTypes = (text) => {
  const types = [];
  if (text.includes('instant')) types.push('instant');
  if (text.includes('sorcery')) types.push('sorcery');
  if (text.includes('artifact')) types.push('artifact');
  if (text.includes('enchantment')) types.push('enchantment');
  if (text.includes('creature')) types.push('creature');
  return types;
};

/**
 * Extract creature type synergies from oracle text
 */
const extractTypeSynergies = (text) => {
  const synergies = {};
  
  // Common creature types that appear in tribal strategies
  const tribalTypes = [
    'angel', 'beast', 'demon', 'dragon', 'dwarf', 'elf', 'elemental', 'faerie', 'giant',
    'goblin', 'human', 'knight', 'merfolk', 'soldier', 'spirit', 'vampire', 'warrior', 'wizard', 'zombie'
  ];
  
  tribalTypes.forEach(type => {
    if (text.includes(type)) {
      // Look for synergy patterns
      const patterns = [
        `other ${type}`,
        `${type} creatures`,
        `each ${type}`,
        `target ${type}`,
        `${type} you control`
      ];
      
      patterns.forEach(pattern => {
        if (text.includes(pattern)) {
          if (!synergies.tribal) synergies.tribal = [];
          synergies.tribal.push({
            type: type,
            pattern: pattern,
            strength: calculateTribalStrength(text, type)
          });
        }
      });
    }
  });
  
  // Equipment synergies
  if (text.includes('equipment')) {
    synergies.equipment = extractEquipmentSynergies(text);
  }
  
  // Artifact synergies
  if (text.includes('artifact')) {
    synergies.artifacts = extractArtifactSynergies(text);
  }
  
  return synergies;
};

/**
 * Calculate how strong the tribal synergy is
 */
const calculateTribalStrength = (text, type) => {
  let strength = 1;
  
  // Multiple mentions increase strength
  const mentions = (text.match(new RegExp(type, 'g')) || []).length;
  strength += mentions - 1;
  
  // Certain patterns indicate stronger synergy
  if (text.includes(`${type} creatures you control`)) strength += 2;
  if (text.includes(`other ${type}s`)) strength += 1;
  if (text.includes(`each ${type}`)) strength += 1;
  
  return Math.min(strength, 5); // Cap at 5
};

/**
 * Extract equipment-specific synergies
 */
const extractEquipmentSynergies = (text) => {
  const synergies = [];
  
  // Equipment ETB synergies
  if ((text.includes('equipment') && text.includes('enters')) || 
      (text.includes('equipment') && text.includes('enter'))) {
    synergies.push({ type: 'equipment_etb', strength: 3 });
  }
  
  // Equipment count synergies
  if (text.includes('equipment you control') || text.includes('equipments you control')) {
    synergies.push({ type: 'equipment_count', strength: 3 });
  }
  
  // Equipped creature synergies
  if (text.includes('equipped creature')) {
    synergies.push({ type: 'equipped_creature', strength: 2 });
  }
  
  // Attach/equip synergies
  if (text.includes('attach') || text.includes('equip')) {
    synergies.push({ type: 'attach_synergy', strength: 2 });
  }
  
  // Equipment tutoring/searching
  if ((text.includes('search') || text.includes('tutor')) && text.includes('equipment')) {
    synergies.push({ type: 'equipment_tutor', strength: 4 });
  }
  
  // Equipment cost reduction
  if ((text.includes('cost') || text.includes('costs')) && 
      (text.includes('less') || text.includes('reduce')) && 
      text.includes('equip')) {
    synergies.push({ type: 'equip_cost_reduction', strength: 3 });
  }
  
  // Cards that care about being equipped
  if (text.includes('if') && text.includes('equipped')) {
    synergies.push({ type: 'wants_equipment', strength: 2 });
  }
  
  return synergies;
};

/**
 * Extract artifact synergies beyond equipment
 */
const extractArtifactSynergies = (text) => {
  const synergies = [];
  
  if (text.includes('artifacts you control')) {
    synergies.push({ type: 'artifact_count', strength: 2 });
  }
  
  if (text.includes('artifact enters')) {
    synergies.push({ type: 'artifact_etb', strength: 2 });
  }
  
  if (text.includes('metalcraft') || text.includes('three or more artifacts')) {
    synergies.push({ type: 'metalcraft', strength: 3 });
  }
  
  return synergies;
};

/**
 * Extract keyword abilities with context
 */
const extractKeywordAbilities = (text) => {
  const keywords = [];
  
  const keywordPatterns = {
    'flying': /flying/g,
    'trample': /trample/g,
    'haste': /haste/g,
    'vigilance': /vigilance/g,
    'lifelink': /lifelink/g,
    'deathtouch': /deathtouch/g,
    'first_strike': /first strike/g,
    'double_strike': /double strike/g,
    'menace': /menace/g,
    'reach': /reach/g,
    'hexproof': /hexproof/g,
    'indestructible': /indestructible/g,
    'flash': /flash/g
  };
  
  Object.entries(keywordPatterns).forEach(([keyword, pattern]) => {
    const matches = text.match(pattern);
    if (matches) {
      keywords.push({
        keyword: keyword,
        count: matches.length,
        grants: text.includes(`has ${keyword}`) || text.includes(`gains ${keyword}`)
      });
    }
  });
  
  return keywords;
};

/**
 * Extract resource manipulation effects
 */
const extractResourceEffects = (text) => {
  const effects = {};
  
  // Card advantage
  if (text.includes('draw')) {
    effects.cardDraw = (text.match(/draw.*?card/g) || []).length;
  }
  
  if (text.includes('discard')) {
    effects.discard = (text.match(/discard.*?card/g) || []).length;
  }
  
  // Mana effects
  if (text.includes('add') && (text.includes('mana') || text.match(/\{[wubrg]\}/))) {
    effects.manaGeneration = true;
  }
  
  // Life effects
  if (text.includes('gain') && text.includes('life')) {
    effects.lifegain = (text.match(/gain.*?life/g) || []).length;
  }
  
  if (text.includes('lose') && text.includes('life')) {
    effects.lifeloss = (text.match(/lose.*?life/g) || []).length;
  }
  
  return effects;
};

/**
 * Extract interaction and removal patterns
 */
const extractInteractionPatterns = (text) => {
  const patterns = {};
  
  // Removal
  if (text.includes('destroy')) {
    patterns.destruction = (text.match(/destroy.*?(?:target|creature|artifact|enchantment)/g) || []).length;
  }
  
  if (text.includes('exile')) {
    patterns.exile = (text.match(/exile.*?(?:target|creature|card)/g) || []).length;
  }
  
  // Counterspells
  if (text.includes('counter') && text.includes('spell')) {
    patterns.counterspells = true;
  }
  
  // Bounce
  if (text.includes('return') && (text.includes('hand') || text.includes('owner'))) {
    patterns.bounce = true;
  }
  
  return patterns;
};

/**
 * Helper functions for specific engine types
 */
const extractSacrificeRewards = (text) => {
  const rewards = [];
  if (text.includes('draw')) rewards.push('card_draw');
  if (text.includes('gain') && text.includes('life')) rewards.push('lifegain');
  if (text.includes('deal') && text.includes('damage')) rewards.push('damage');
  if (text.includes('add') && text.includes('mana')) rewards.push('mana');
  return rewards;
};

const extractTapBenefits = (text) => {
  const benefits = [];
  if (text.includes('add') && text.includes('mana')) benefits.push('mana');
  if (text.includes('draw')) benefits.push('card_draw');
  if (text.includes('deal') && text.includes('damage')) benefits.push('damage');
  if (text.includes('scry')) benefits.push('scry');
  return benefits;
};

/**
 * Helper function to calculate keyword-based similarity when semantic search isn't available
 * Now enhanced with advanced oracle text pattern matching
 * @param {Object} card - The card to score
 * @param {string} query - The search query
 * @param {Object|null} commanderPatterns - Parsed patterns of the commander (or array of patterns for partner commanders)
 * @returns {number} - Similarity score between 0 and 1
 */
const calculateKeywordSimilarity = (card, query, commanderPatterns = null) => {
  if (!card || !query) return 0;
  
  const cardText = `${card.name || ''} ${card.type_line || card.type || ''} ${card.oracle_text || card.text || ''} ${card.mana_cost || ''}`.toLowerCase();
  const queryLower = query.toLowerCase();
  
  let score = 0;
  
  // 🔧 NEW: Advanced oracle text pattern analysis
  const cardPatterns = parseOracleTextPatterns(card.oracle_text || card.text || '');
  
  // 1. TRADITIONAL THEME MATCHING (enhanced)
  const themes = {
    'token': /token|populate|convoke|create.*creature/g,
    'counter': /\+1\/\+1|counter|proliferate|evolve|adapt|monstrosity/g,
    'artifact': /artifact|metalcraft|affinity|improvise/g,
    'graveyard': /graveyard|flashback|unearth|dredge|delve|escape|disturb/g,
    'control': /counter.*spell|destroy.*target|exile.*target|draw.*card/g,
    'aggro': /haste|first strike|double strike|menace|aggressive/g,
    'lifegain': /gain.*life|lifegain|lifelink/g,
    'flying': /flying|fly/g,
    'vigilance': /vigilance/g,
    'commander': /commander|legendary/g,
    'equipment': /equipment|attach|equip|stoneforge|steelshaper|puresteel|equipped.*creature|equip.*cost/g,
    'enters': /enters.*battlefield|when.*enters/g,
    'discard': /discard.*draw|draw.*discard/g,
    'sacrifice': /sacrifice.*gain|sacrifice.*draw|sacrifice.*deal/g
  };
  
  // Score based on theme presence (enhanced scoring)
  Object.entries(themes).forEach(([theme, pattern]) => {
    if (queryLower.includes(theme)) {
      const matches = cardText.match(pattern);
      if (matches) {
        score += matches.length * 12; // Increased base score
      }
    }
  });
  
  // 2. NEW: MECHANICAL PATTERN SYNERGY SCORING
  
  // Equipment synergy detection
  if (queryLower.includes('equipment')) {
    if (cardPatterns.typeSynergies?.equipment?.length > 0) {
      score += 10; // Strong equipment synergy bonus
    }
  }
  
  // Special bonus for equipment cards when artifacts are mentioned (reduced for auto-build)
  if (queryLower.includes('artifacts') && cardText.includes('equipment')) {
    score += 8; // Reduced artifact-equipment synergy bonus (was 15)
  }
  
  // Enter-the-battlefield trigger synergy
  if (queryLower.includes('enters') || queryLower.includes('battlefield')) {
    const etbTriggers = cardPatterns.triggers?.filter(t => t.type === 'enters_battlefield') || [];
    score += etbTriggers.length * 20; // Strong ETB synergy
  }
  
  // Tribal synergy matching
  if (cardPatterns.typeSynergies?.tribal) {
    cardPatterns.typeSynergies.tribal.forEach(tribal => {
      if (queryLower.includes(tribal.type.toLowerCase())) {
        score += tribal.strength * 20; // Tribal synergy bonus
      }
    });
  }
  
  // Discard/Draw engine synergy
  if (queryLower.includes('discard') && queryLower.includes('draw')) {
    const discardDrawEngines = cardPatterns.engines?.filter(e => e.type === 'discard_draw') || [];
    score += discardDrawEngines.length * 30; // Very strong engine synergy
  }
  
  // Resource engine matching
  if (cardPatterns.resources?.cardDraw && queryLower.includes('draw')) {
    score += cardPatterns.resources.cardDraw * 10;
  }
  
  // 3. CREATURE TYPE SPECIFIC MATCHING
  const creatureTypes = ['dwarf', 'elf', 'goblin', 'human', 'dragon', 'angel', 'vampire', 'zombie'];
  creatureTypes.forEach(type => {
    if (queryLower.includes(type) && cardText.includes(type)) {
      score += 18; // Strong tribal match
      
      // Bonus for tribal support patterns
      if (cardText.includes(`other ${type}`) || cardText.includes(`${type} creatures`)) {
        score += 12; // Tribal support bonus
      }
    }
  });
  
  // 4. ENHANCED CARD TYPE RELEVANCE
  const cardTypes = ['creature', 'instant', 'sorcery', 'artifact', 'enchantment', 'planeswalker', 'land', 'equipment'];
  cardTypes.forEach(type => {
    if (queryLower.includes(type) && cardText.includes(type)) {
      score += 8;
    }
  });
  
  // 5. MANA CURVE FITTING (enhanced)
  const curveMatches = queryLower.match(/needs more (\d+)/);
  if (curveMatches) {
    const neededCost = parseInt(curveMatches[1]);
    const cardCost = card.manaValue || card.cmc || card.mana_value || 0;
    if (Math.abs(cardCost - neededCost) <= 1) {
      score += 20; // Increased curve filling bonus
    }
  }
  
  // 6. ENHANCED KEYWORD ABILITIES
  const keywords = ['flying', 'vigilance', 'lifelink', 'first strike', 'double strike', 'trample', 'haste', 'deathtouch', 'menace', 'reach', 'hexproof'];
  keywords.forEach(keyword => {
    if (queryLower.includes(keyword) && cardText.includes(keyword)) {
      score += 12; // Increased keyword bonus
    }
  });
  
  // 7. NEW: INTERACTION PATTERN MATCHING
  if (queryLower.includes('removal') || queryLower.includes('destroy')) {
    if (cardPatterns.interaction?.destruction > 0 || cardPatterns.interaction?.exile > 0) {
      score += 15; // Removal synergy
    }
  }
  
  if (queryLower.includes('counter') && cardPatterns.interaction?.counterspells) {
    score += 15; // Counterspell synergy
  }
  
  // 8. NEW: MECHANICAL ENGINE SCORING
  if (cardPatterns.engines?.length > 0) {
    // Bonus for cards that are engines themselves
    score += cardPatterns.engines.length * 10;
    
    // Extra bonus for engines that match query patterns
    cardPatterns.engines.forEach(engine => {
      if (engine.type === 'discard_draw' && (queryLower.includes('discard') || queryLower.includes('draw'))) {
        score += 25;
      }
      if (engine.type === 'sacrifice_engine' && queryLower.includes('sacrifice')) {
        score += 20;
      }
    });
  }

  // --- NEW: Dynamic Commander-Based Scoring ---
  // If commanderPatterns is provided, boost score for cards that fulfill the commander's desires
  const commanderPatternArr = Array.isArray(commanderPatterns) ? commanderPatterns : (commanderPatterns ? [commanderPatterns] : []);
  let commanderSynergyBonus = 0;
  commanderPatternArr.forEach(cmdr => {
    if (!cmdr) return;
    // 1. If commander cares about tokens and this card creates tokens
    if (cmdr.cares_about_tokens) {
      // Card creates tokens if it matches the token theme or has a token-related engine
      const createsTokens = /create.*token/.test(cardText) || (cardPatterns.typeSynergies && cardPatterns.typeSynergies.tokens) || (cardPatterns.triggers && cardPatterns.triggers.some(t => /token/.test(t.text)));
      if (createsTokens) commanderSynergyBonus += 40; // Configurable strong bonus
    }
    // 2. If commander cares about equipment and this card is equipment or supports equipment
    if (cmdr.typeSynergies?.equipment && cardPatterns.typeSynergies?.equipment) {
      commanderSynergyBonus += 30; // Configurable strong bonus
    }
    // 3. If commander is tribal (e.g., Rabbit) and this card is that tribe or supports it
    if (cmdr.typeSynergies?.tribal && cardPatterns.typeSynergies?.tribal) {
      const cmdrTribes = cmdr.typeSynergies.tribal.map(t => t.type);
      cardPatterns.typeSynergies.tribal.forEach(tribal => {
        if (cmdrTribes.includes(tribal.type)) {
          commanderSynergyBonus += 20 + 10 * tribal.strength; // Configurable bonus
        }
      });
    }
    // 4. If commander cares about lifegain and this card enables lifegain
    if (cmdr.typeSynergies?.lifegain && cardPatterns.resources?.lifegain) {
      commanderSynergyBonus += 20;
    }
    // 5. If commander cares about card draw and this card draws cards
    if (cmdr.typeSynergies?.card_draw && cardPatterns.resources?.cardDraw) {
      commanderSynergyBonus += 20;
    }
    // 6. If commander cares about +1/+1 counters and this card adds counters
    if (cmdr.typeSynergies?.counters && /\+1\/\+1 counter/.test(cardText)) {
      commanderSynergyBonus += 20;
    }
    // 7. If commander cares about graveyard and this card interacts with graveyard
    if (cmdr.typeSynergies?.graveyard && /graveyard/.test(cardText)) {
      commanderSynergyBonus += 20;
    }
    // 8. If commander cares about artifacts and this card is an artifact or supports artifacts
    if (cmdr.typeSynergies?.artifacts && (cardPatterns.typeSynergies?.artifacts || cardText.includes('artifact'))) {
      commanderSynergyBonus += 20;
    }
    // Add more commander-based synergies as needed
  });
  score += commanderSynergyBonus;
  // --- END Dynamic Commander-Based Scoring ---

  // Normalize score to 0-1 range similar to semantic search
  // Increased max threshold due to enhanced scoring
  return Math.min(score / 150, 1);
};

/**
 * Calculate a smart hybrid score that intelligently combines semantic and keyword scores
 * @param {number} semanticScore - Semantic similarity score (0-1)
 * @param {number} keywordScore - Keyword similarity score (0-1) 
 * @param {Object} card - The card object
 * @param {string} query - The search query
 * @returns {number} - Combined hybrid score
 */
const calculateSmartHybridScore = (semanticScore, keywordScore, card, query) => {
  // Calculate confidence in each scoring method
  const semanticConfidence = semanticScore > 0.05 ? Math.min(semanticScore * 2, 1) : 0;
  const keywordConfidence = keywordScore > 0.1 ? Math.min(keywordScore * 1.5, 1) : 0;
  
  // If we have high confidence in semantic, weight it heavily
  if (semanticConfidence > 0.7) {
    return (semanticScore * 0.8) + (keywordScore * 0.2);
  }
  
  // If semantic is weak but keyword is strong, favor keyword
  if (semanticConfidence < 0.3 && keywordConfidence > 0.6) {
    return (semanticScore * 0.3) + (keywordScore * 0.7);
  }
  
  // For cards with specific keywords mentioned in query, boost keyword scoring
  const queryLower = query.toLowerCase();
  const cardText = (card.oracle_text || card.text || '').toLowerCase();
  let keywordRelevanceBoost = 0;
  
  const relevantKeywords = ['flying', 'trample', 'haste', 'vigilance', 'lifelink', 'deathtouch'];
  relevantKeywords.forEach(keyword => {
    if (queryLower.includes(keyword) && cardText.includes(keyword)) {
      keywordRelevanceBoost += 0.1;
    }
  });
  
  // Apply keyword relevance boost
  const adjustedKeywordScore = keywordScore + keywordRelevanceBoost;
  
  // Default balanced approach with slight semantic preference
  return (semanticScore * 0.6) + (adjustedKeywordScore * 0.4);
};

/**
 * Normalize strategy scores for better comparison across different approaches
 * @param {Array} cards - Array of cards with strategy scores
 * @returns {Array} - Cards with normalized strategy scores
 */
const normalizeStrategyScores = (cards) => {
  if (!cards || cards.length === 0) return cards;
  
  // Get all strategy names from the first card
  const firstCard = cards[0];
  if (!firstCard.strategy_scores) return cards;
  
  const strategyNames = Object.keys(firstCard.strategy_scores);
  
  // Calculate min/max for each strategy
  const strategyStats = {};
  strategyNames.forEach(strategy => {
    const scores = cards.map(card => card.strategy_scores[strategy] || 0);
    const min = Math.min(...scores);
    const max = Math.max(...scores);
    const range = max - min;
    
    strategyStats[strategy] = { min, max, range };
  });
  
  // Normalize each card's strategy scores to 0-1 range
  return cards.map(card => {
    const normalizedStrategyScores = {};
    
    strategyNames.forEach(strategy => {
      const originalScore = card.strategy_scores[strategy] || 0;
      const stats = strategyStats[strategy];
      
      // Normalize to 0-1 range
      const normalizedScore = stats.range > 0 ? 
        (originalScore - stats.min) / stats.range : 0;
      
      normalizedStrategyScores[strategy] = normalizedScore;
    });
    
    return {
      ...card,
      strategy_scores_normalized: normalizedStrategyScores
    };
  });
};

/**
 * Helper function to extract key strategic insights from the deck analysis query
 * @param {string} query - The deck analysis query
 * @returns {string|null} - Extracted insights or null if none found
 */
const extractDeckInsights = (query) => {
  if (!query) return null;
  
  const insights = [];
  
  // Extract deck archetype
  const archetypeMatch = query.match(/Suggest cards for a \w+ (\w+) deck/);
  if (archetypeMatch) {
    insights.push(`Deck archetype: ${archetypeMatch[1]}`);
  }
  
  // Extract key themes
  const themesMatch = query.match(/Key themes include ([^.]+)/);
  if (themesMatch) {
    insights.push(`Key themes: ${themesMatch[1]}`);
  }
  
  // Extract tribal synergies
  const tribalMatch = query.match(/focuses on ([^.]+) tribal synergies/);
  if (tribalMatch) {
    insights.push(`Tribal synergies: ${tribalMatch[1]}`);
  }
  
  // Extract important abilities
  const abilitiesMatch = query.match(/Important abilities include ([^.]+)/);
  if (abilitiesMatch) {
    insights.push(`Key abilities: ${abilitiesMatch[1]}`);
  }
  
  // Extract win conditions
  const winConditionsMatch = query.match(/Win conditions focus on ([^.]+)/);
  if (winConditionsMatch) {
    insights.push(`Win conditions: ${winConditionsMatch[1]}`);
  }
  
  // Extract mana curve needs
  const curveMatch = query.match(/needs more ([^.]+) mana cost options/);
  if (curveMatch) {
    insights.push(`Mana curve needs: ${curveMatch[1]} cost cards`);
  }
  
  return insights.length > 0 ? insights.join('. ') : null;
};

/**
 * Helper function to analyze the deck and create a search query
 * @param {Object} deck - The deck object containing mainboard and commanders
 * @param {string} formatName - The format name (e.g., 'commander')
 * @param {Object} settings - Optional settings object for query configuration
 * @returns {string} - Generated search query
 */
const analyzeDeckForQuery = (deck, formatName, settings = null) => {
  if (!deck || !deck.mainboard || deck.mainboard.length === 0) {
    return `Suggest cards for a ${formatName} deck.`;
  }

  // Always use focused mode for semantic search
  const allCards = [...deck.mainboard, ...(deck.commanders || [])];
  const cardTypes = { creature: 0, instant: 0, sorcery: 0, enchantment: 0, artifact: 0, land: 0, planeswalker: 0 };
  const manaCurve = { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0, '7+': 0 };
  const colors = new Set();
  const themes = new Map();
  const keywords = new Map();
  const tribes = new Map();
  const themePatterns = {
    'graveyard': /graveyard|flashback|unearth|dredge|delve|escape|disturb/i,
    'counters': /\+1\/\+1|counter|proliferate|evolve|adapt|monstrosity/i,
    'tokens': /token|populate|convoke|create.*creature/i,
    'artifacts': /artifact|metalcraft|affinity|improvise/i,
    'equipment': /equipment|attach|equip|stoneforge|steelshaper|puresteel/i,
    'spells': /instant|sorcery|storm|prowess|magecraft/i,
    'lifegain': /gain.*life|lifegain|lifelink/i,
    'card_draw': /draw.*card|card.*draw/i,
    'ramp': /search.*land|ramp|mana.*dork/i,
    'control': /counter.*spell|destroy.*target|exile.*target/i,
    'aggro': /haste|first strike|double strike|menace/i,
    'combo': /tutor|search.*library|infinite|combo/i
  };
  allCards.forEach(card => {
    const typeLine = (card.type_line || card.type || '').toLowerCase();
    Object.keys(cardTypes).forEach(type => {
      if (typeLine.includes(type)) cardTypes[type]++;
    });
    const cmc = card.manaValue || card.cmc || card.mana_value || 0;
    if (cmc >= 7) manaCurve['7+']++;
    else manaCurve[cmc]++;
    (card.color_identity || card.colors || []).forEach(color => colors.add(color));
    const cardText = `${card.oracle_text || card.text || ''} ${typeLine}`;
    Object.entries(themePatterns).forEach(([theme, pattern]) => {
      if (pattern.test(cardText)) {
        themes.set(theme, (themes.get(theme) || 0) + 1);
      }
    });
    if (typeLine.includes('creature')) {
      const typeMatch = typeLine.match(/creature\s+—\s+(.+)/);
      if (typeMatch) {
        typeMatch[1].split(' ').forEach(tribe => {
          const cleanTribe = tribe.replace(/[^a-zA-Z]/g, '').toLowerCase();
          if (cleanTribe.length > 2) {
            const formattedTribe = cleanTribe.charAt(0).toUpperCase() + cleanTribe.slice(1);
            tribes.set(formattedTribe, (tribes.get(formattedTribe) || 0) + 1);
          }
        });
      }
    }
    const keywordPattern = /\b(flying|trample|haste|vigilance|lifelink|deathtouch|first strike|double strike|menace|reach|hexproof|indestructible|flash|defender)\b/gi;
    const keywordMatches = cardText.match(keywordPattern) || [];
    keywordMatches.forEach(keyword => {
      keywords.set(keyword.toLowerCase(), (keywords.get(keyword.toLowerCase()) || 0) + 1);
      console.log("[DeckRecommendationEngine][" + card.name + "][" + keyword + "]");
    });
  });
  // --- NEW: If any card (especially commander) cares about tokens, force tokens theme ---
  let caresAboutTokens = false;
  for (const card of allCards) {
    const patterns = parseOracleTextPatterns(card.oracle_text || card.text || '');
    if (patterns.cares_about_tokens) {
      caresAboutTokens = true;
      break;
    }
  }
  if (caresAboutTokens) {
    themes.set('tokens', (themes.get('tokens') || 0) + 3); // Boost tokens theme count
  }
  // Get top themes
  const topThemes = [...themes.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 2)
    .map(([theme, count]) => theme);
  // Get top tribes (require at least 4 cards of the same type to be considered tribal)
  const topTribes = [...tribes.entries()]
    .sort((a, b) => b[1] - a[1])
    .filter(([tribe, count]) => count >= 4)
    .map(([tribe, count]) => tribe);
  // Get top keywords
  const topKeywords = [...keywords.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 2)
    .map(([keyword]) => keyword);
  // Get color names
  const colorMap = { W: 'white', U: 'blue', B: 'black', R: 'red', G: 'green' };
  const colorNames = Array.from(colors).map(c => colorMap[c] || c);
  // Commander names
  const commanderNames = (deck.commanders || []).map(c => c.name).join(' & ');
  const commanderKeywords = (deck.commanders || []).map(c => c.keywords).join(' & ');
  const commanderSubtypes = (deck.commanders || []).map(c => c.subtype).join(' & ');
  // --- NEW: Focused, non-redundant query template ---
  let query = '';
//   if (topTribes) {
//     query = `${colorNames.join('-')} tribal commander deck. ${topTribes[0]} tribal. ${topThemes.join(' & ')}. ${topKeywords.join(' & ')}.`;
//   } else if (topThemes.includes('combo')) {
//     query = `${colorNames.join('-')} combo commander deck. Combo. ${topThemes.filter(t => t !== 'combo').join(' & ')}. ${topKeywords.join(' & ')}.`;
//   } else {
//     query = `${colorNames.join('-')} commander deck. ${topThemes.join(' & ')}. ${topKeywords.join(' & ')}.`;
//   }
query = `${commanderNames} ${commanderKeywords} ${commanderSubtypes}`;
  return query.trim();
};

/**
 * Generate a focused, short query for better semantic search
 */
const generateFocusedQuery = (formatName, archetype, topThemes, topTribes, colors, commanders) => {
  // Start with the most important theme or tribal synergy
  const primaryFocus = topTribes.length > 0 ? 
    `${topTribes[0].tribe} tribal` : 
    topThemes.length > 0 ? topThemes[0].theme : archetype;
  
  let query = `${primaryFocus} ${formatName}`;
  
  // Add one secondary theme if available
  if (topThemes.length > 1 && topTribes.length === 0) {
    query += ` ${topThemes[1].theme}`;
  } else if (topThemes.length > 0 && topTribes.length > 0) {
    query += ` ${topThemes[0].theme}`;
  }
  
  return query;
};

/**
 * Generate a balanced query with moderate detail
 */
const generateBalancedQuery = (formatName, archetype, topThemes, topTribes, colors, commanders) => {
  let query = `${archetype} ${formatName} deck`;
  
  // Add tribal focus if significant
  if (topTribes.length > 0) {
    query += ` with ${topTribes[0].tribe} tribal synergy`;
  }
  
  // Add top 2 themes
  if (topThemes.length > 0) {
    const themes = topThemes.slice(0, 2).map(t => t.theme);
    query += ` focusing on ${themes.join(' and ')}`;
  }
  
  return query;
};

/**
 * Generate a comprehensive, detailed query (original approach)
 */
const generateComprehensiveQuery = (formatName, archetype, topThemes, topTribes, topKeywords, colors, commanders, curveGaps, allCards, themes, themePatterns) => {
  // Generate key cards examples
  const keyCards = allCards
    .filter(card => {
      // Prioritize cards that represent the deck's strategy
      const cardText = (card.oracle_text || card.text || '').toLowerCase();
      return topThemes.some(({ theme }) => themePatterns[theme]?.test(cardText));
    })
    .slice(0, 3)
    .map(card => card.name);
  let query = `Suggest cards for a ${formatName} ${archetype} deck`;
  
  // Add commander context
  if (formatName === 'commander' && commanders && commanders.length > 0) {
    const commanderNames = commanders.map(c => c.name).join(' and ');
    query += ` with ${commanderNames} as commander`;
  }

  // Add color identity
  if (colors.size > 0) {
    const colorNames = Array.from(colors).map(c => {
      const colorMap = { W: 'white', U: 'blue', B: 'black', R: 'red', G: 'green' };
      return colorMap[c] || c;
    });
    query += ` in ${colorNames.join(' and ')} colors`;
  }

  // Add tribal themes
  if (topTribes.length > 0) {
    const tribalDescriptions = topTribes.map(({ tribe, count }) => {
      const percentage = Math.round((count / allCards.length) * 100);
      return `${tribe} tribal (${count} cards, ${percentage}%)`;
    });
    query += `. The deck focuses on ${tribalDescriptions.join(' and ')} synergies`;
  }

  // Add primary themes
  if (topThemes.length > 0) {
    const themeDescriptions = topThemes.map(({ theme, count }) => {
      const percentage = Math.round((count / allCards.length) * 100);
      return `${theme} strategy (${percentage}% of deck)`;
    });
    query += `. Key themes include ${themeDescriptions.join(', ')}`;
  }

  // Add keyword focus
  if (topKeywords.length > 0) {
    query += `. Important abilities include ${topKeywords.join(', ')}`;
  }

  // Add mana curve considerations
  if (curveGaps.length > 0) {
    query += `. The deck needs more ${curveGaps.join(' and ')} mana cost options`;
  }

  // Add specific card examples for context
  if (keyCards.length > 0) {
    query += `. The deck includes key cards like ${keyCards.join(', ')}`;
  }

  // Add win condition context
  const winConditions = [];
  if (themes.get('aggro') > 2) winConditions.push('aggressive creature beats');
  if (themes.get('combo') > 2) winConditions.push('combo finish');
  if (themes.get('control') > 3) winConditions.push('control and card advantage');
  if (themes.get('tokens') > 2) winConditions.push('token swarm');

  if (winConditions.length > 0) {
    query += `. Win conditions focus on ${winConditions.join(' and ')}`;
  }

  query += '. Suggest cards that synergize well with this strategy and fill any gaps in the deck.';
  
  return query;
};

/**
 * Calculate mechanical synergy score between two cards based on their parsed patterns
 * @param {Object} card1Patterns - Parsed patterns from first card
 * @param {Object} card2Patterns - Parsed patterns from second card
 * @returns {number} - Synergy score
 */
const calculateMechanicalSynergy = (card1Patterns, card2Patterns) => {
  let synergy = 0;
  
  if (!card1Patterns || !card2Patterns) return 0;
  
  // 1. TRIGGER SYNERGIES
  // ETB triggers with token/creature generation
  const card1ETB = card1Patterns.triggers?.filter(t => t.type === 'enters_battlefield') || [];
  const card2ETB = card2Patterns.triggers?.filter(t => t.type === 'enters_battlefield') || [];
  
  if (card1ETB.length > 0 && card2ETB.length > 0) {
    synergy += 15; // Both have ETB triggers - good synergy
  }
  
  // 2. TYPE-BASED SYNERGIES
  // Tribal synergies
  if (card1Patterns.typeSynergies?.tribal && card2Patterns.typeSynergies?.tribal) {
    card1Patterns.typeSynergies.tribal.forEach(tribe1 => {
      card2Patterns.typeSynergies.tribal.forEach(tribe2 => {
        if (tribe1.type === tribe2.type) {
          synergy += tribe1.strength + tribe2.strength; // Matching tribal types
        }
      });
    });
  }
  
  // Equipment synergies
  if (card1Patterns.typeSynergies?.equipment && card2Patterns.typeSynergies?.equipment) {
    synergy += 10; // Both care about equipment
  }
  
  // Artifact synergies
  if (card1Patterns.typeSynergies?.artifacts && card2Patterns.typeSynergies?.artifacts) {
    synergy += 8; // Both care about artifacts
  }
  
  // 3. ENGINE SYNERGIES
  // Matching engine types
  if (card1Patterns.engines && card2Patterns.engines) {
    card1Patterns.engines.forEach(engine1 => {
      card2Patterns.engines.forEach(engine2 => {
        if (engine1.type === engine2.type) {
          synergy += 20; // Matching engine types
        }
        
        // Complementary engines (e.g., discard enabler + discard payoff)
        if (engine1.type === 'discard_draw' && engine2.type === 'sacrifice_engine') {
          synergy += 10; // Resource engines work well together
        }
      });
    });
  }
  
  // 4. RESOURCE SYNERGIES
  // Card draw engines with discard outlets
  if (card1Patterns.resources?.cardDraw && card2Patterns.resources?.discard) {
    synergy += 12;
  }
  if (card1Patterns.resources?.discard && card2Patterns.resources?.cardDraw) {
    synergy += 12;
  }
  
  // 5. KEYWORD SYNERGIES
  if (card1Patterns.keywords && card2Patterns.keywords) {
    const keywordSynergies = {
      'flying': ['flying', 'reach'], // Flying creatures work well together, reach stops flyers
      'trample': ['deathtouch'], // Trample + deathtouch combo
      'lifelink': ['lifegain'], // Lifelink with lifegain themes
      'first_strike': ['deathtouch'], // First strike + deathtouch combo
      'double_strike': ['deathtouch', 'lifelink'] // Double strike + damage multipliers
    };
    
    card1Patterns.keywords.forEach(keyword1 => {
      card2Patterns.keywords.forEach(keyword2 => {
        if (keyword1.keyword === keyword2.keyword) {
          synergy += 5; // Same keyword
        }
        
        const synergisticKeywords = keywordSynergies[keyword1.keyword] || [];
        if (synergisticKeywords.includes(keyword2.keyword)) {
          synergy += 8; // Synergistic keyword combination
        }
      });
    });
  }
  console.log("[DeckRecommendationEngine][MechanicalSynergy][Score: " + synergy + "]");
  return Math.min(synergy, 100); // Cap synergy score
};

/**
 * Enhanced function to find cards with strong mechanical synergy to existing deck
 * @param {Array} candidateCards - Cards to score for synergy
 * @param {Object} deck - The existing deck
 * @returns {Array} - Cards with synergy scores added
 */
const enhanceCardsWithMechanicalSynergy = (candidateCards, deck) => {
  if (!candidateCards || candidateCards.length === 0 || !deck) return candidateCards;
  
  // Parse patterns for all deck cards
  const allDeckCards = [...(deck.mainboard || []), ...(deck.commanders || [])];
  const deckPatterns = allDeckCards.map(card => ({
    card,
    patterns: parseOracleTextPatterns(card.oracle_text || card.text || '')
  }));
  
  return candidateCards.map(candidate => {
    const candidatePatterns = parseOracleTextPatterns(candidate.oracle_text || candidate.text || '');
    
    let totalSynergy = 0;
    let synergyCount = 0;
    
    // Calculate synergy with each deck card
    deckPatterns.forEach(deckCardData => {
      const synergy = calculateMechanicalSynergy(candidatePatterns, deckCardData.patterns);
      if (synergy > 0) {
        totalSynergy += synergy;
        synergyCount++;
      }
    });
    
    // Calculate average synergy score
    const mechanicalSynergyScore = synergyCount > 0 ? totalSynergy / synergyCount : 0;
    
    return {
      ...candidate,
      mechanical_synergy_score: mechanicalSynergyScore,
      synergy_count: synergyCount,
      parsed_patterns: candidatePatterns // Store for debugging
    };
  });
};

/**
 * Main function to get card recommendations for a deck
 * This wires up the semantic search with the synergy scoring system
 * @param {Object} deck - The deck object containing mainboard and commanders
 * @param {string} formatName - The format name (e.g., 'commander')
 * @param {Object} options - Search and scoring options
 * @returns {Array} - Array of recommended cards with synergy scores
 */
const getCardRecommendations = async (deck, formatName = 'commander', options = {}) => {
  const {
    limit = 50,
    useSemanticSearch = true,
    useHybridSearch = false,
    settings = null
  } = options;

  try {
    console.log('\n🎯 === STARTING CARD RECOMMENDATION PROCESS ===');
    
    // Step 1: Generate search query based on deck analysis
    const searchQuery = analyzeDeckForQuery(deck, formatName, settings);
    console.log(`🔍 Generated search query: "${searchQuery}"`);
    
    // Step 2: Get semantic search service
    const semanticSearchService = require('./semanticSearch.cjs');
    
    // Step 3: Perform semantic search to get candidate cards
    console.log('🔄 Performing semantic search...');
    const searchOptions = {
      limit: Math.min(limit * 4, 200), // Get more candidates for better filtering
      useSemanticSearch,
      useHybridSearch
    };
    
    const candidateCards = await semanticSearchService.search(searchQuery, searchOptions);
    console.log(`📋 Found ${candidateCards.length} candidate cards from search`);
    
    if (candidateCards.length === 0) {
      console.log('⚠️ No candidate cards found from search');
      return [];
    }
    
    // Step 4: Filter out cards already in the deck
    const deckCardNames = new Set([
      ...deck.mainboard.map(card => card.name.toLowerCase()),
      ...(deck.commanders || []).map(card => card.name.toLowerCase())
    ]);
    
    const filteredCandidates = candidateCards.filter(card => 
      !deckCardNames.has(card.name.toLowerCase())
    );
    console.log(`🔽 Filtered to ${filteredCandidates.length} cards not already in deck`);
    
    // Step 5: Filter by color identity if commanders exist
    let colorFilteredCandidates = filteredCandidates;
    if (deck.commanders && deck.commanders.length > 0) {
      const commanderColorIdentity = new Set();
      deck.commanders.forEach(commander => {
        (commander.color_identity || commander.colorIdentity || []).forEach(color => {
          commanderColorIdentity.add(color);
        });
      });
      
      if (commanderColorIdentity.size > 0) {
        colorFilteredCandidates = filteredCandidates.filter(card => 
          isCardInColorIdentity(card, commanderColorIdentity)
        );
        console.log(`🎨 Color identity filtered to ${colorFilteredCandidates.length} cards`);
      }
    }
    
    // Step 6: Parse commander patterns for enhanced synergy scoring
    const commanderPatterns = (deck.commanders || []).map(commander => 
      parseOracleTextPatterns(commander.oracle_text || commander.text || '')
    );
    
    // Step 7: Enhance cards with keyword similarity scores
    const enhancedCandidates = colorFilteredCandidates.map(card => {
      const keywordScore = calculateKeywordSimilarity(card, searchQuery, commanderPatterns);
      const semanticScore = card.hybrid_score || 0;
      const combinedScore = calculateSmartHybridScore(semanticScore, keywordScore, card, searchQuery);
      
      return {
        ...card,
        semantic_score: semanticScore,
        keyword_score: keywordScore,
        combined_score: combinedScore,
        score_source: 'combined'
      };
    });
    
    // Step 8: Add mechanical synergy scores
    const mechanicallyEnhancedCards = enhanceCardsWithMechanicalSynergy(enhancedCandidates, deck);
    
    // Step 9: Apply deck synergy scoring (this is your main scoring algorithm)
    console.log('🧮 Applying deck synergy scoring...');
    const scoredCards = rerankCardsByDeckSynergy(mechanicallyEnhancedCards, deck, formatName, settings);
    
    // Step 10: Return top recommendations
    const finalRecommendations = scoredCards.slice(0, limit);
    
    console.log(`✅ Returning ${finalRecommendations.length} final recommendations`);
    console.log('🎯 === CARD RECOMMENDATION PROCESS COMPLETE ===\n');
    
    return finalRecommendations;
    
  } catch (error) {
    console.error('❌ Error in getCardRecommendations:', error);
    console.error('Stack trace:', error.stack);
    return [];
  }
};

/**
 * Simplified function to get recommendations with just a deck object
 * @param {Object} deck - The deck object
 * @param {number} limit - Number of recommendations to return
 * @returns {Array} - Array of recommended cards
 */
const getQuickRecommendations = async (deck, limit = 20) => {
  return getCardRecommendations(deck, 'commander', { limit });
};

/**
 * Function to test the recommendation system with a sample deck
 * @param {Object} testDeck - A test deck object
 * @returns {Array} - Test results
 */
const testRecommendationSystem = async (testDeck = null) => {
  // Create a simple test deck if none provided
  const defaultTestDeck = {
    mainboard: [
      {
        name: "Sol Ring",
        type_line: "Artifact",
        oracle_text: "{T}: Add {C}{C}.",
        mana_value: 1,
        colors: [],
        color_identity: []
      },
      {
        name: "Lightning Bolt", 
        type_line: "Instant",
        oracle_text: "Lightning Bolt deals 3 damage to any target.",
        mana_value: 1,
        colors: ["R"],
        color_identity: ["R"]
      }
    ],
    commanders: [
      {
        name: "Krenko, Mob Boss",
        type_line: "Legendary Creature — Goblin Warrior",
        oracle_text: "{T}: Create X 1/1 red Goblin creature tokens, where X is the number of Goblins you control.",
        mana_value: 4,
        colors: ["R"],
        color_identity: ["R"]
      }
    ]
  };
  
  const deck = testDeck || defaultTestDeck;
  console.log('🧪 Testing recommendation system...');
  
  try {
    const recommendations = await getCardRecommendations(deck, 'commander', { limit: 10 });
    console.log(`✅ Test completed. Got ${recommendations.length} recommendations.`);
    
    if (recommendations.length > 0) {
      console.log('\n🏆 Top 3 recommendations:');
      recommendations.slice(0, 3).forEach((card, i) => {
        console.log(`${i + 1}. ${card.name} (Score: ${card.synergy_score})`);
        console.log(`   Type: ${card.type_line}`);
        console.log(`   Synergy breakdown: Semantic=${card.semantic_score?.toFixed(3)}, Keyword=${card.keyword_score?.toFixed(3)}`);
      });
    }
    
    return recommendations;
  } catch (error) {
    console.error('❌ Test failed:', error);
    return [];
  }
};

module.exports = { 
  isCardInColorIdentity, 
  rerankCardsByDeckSynergy, 
  calculateKeywordSimilarity, 
  calculateSmartHybridScore,
  normalizeStrategyScores,
  extractDeckInsights, 
  analyzeDeckForQuery,
  // 🔧 NEW: Export advanced pattern analysis functions
  parseOracleTextPatterns,
  calculateMechanicalSynergy,
  enhanceCardsWithMechanicalSynergy,
  // 🔧 NEW: Main recommendation functions
  getCardRecommendations,
  getQuickRecommendations,
  testRecommendationSystem
}; 