const fs = require('fs');
const path = require('path');

/**
 * MTG Rules Engine - Handles format rules, deck construction, and card legality
 */
class MTGRulesEngine {
  constructor() {
    this.formatRules = new Map();
    this.bannedCards = new Map();
    this.restrictedCards = new Map();
    this.cardTypes = new Set();
    this.keywords = new Set();
    
    this.initializeRules();
  }

  /**
   * Initialize all format rules and banned/restricted lists
   */
  initializeRules() {
    this.setupFormatRules();
    this.setupBannedRestrictedLists();
    this.setupCardTypes();
    this.setupKeywords();
  }

  /**
   * Setup format-specific rules
   */
  setupFormatRules() {
    // Standard
    this.formatRules.set('standard', {
      minDeckSize: 60,
      maxDeckSize: null,
      maxCopiesPerCard: 4,
      basicLandLimit: null,
      sideboardSize: 15,
      allowedSets: this.getStandardLegalSets(),
      specialRules: {
        companionAllowed: true,
        planeswalkerRule: true
      }
    });

    // Commander/EDH
    this.formatRules.set('commander', {
      minDeckSize: 100,
      maxDeckSize: 100,
      maxCopiesPerCard: 1,
      basicLandLimit: null,
      sideboardSize: 0,
      requiresCommander: true,
      colorIdentityRestriction: true,
      specialRules: {
        companionAllowed: false,
        planeswalkerCommanderAllowed: true,
        partnerAllowed: true
      }
    });

    // Modern
    this.formatRules.set('modern', {
      minDeckSize: 60,
      maxDeckSize: null,
      maxCopiesPerCard: 4,
      basicLandLimit: null,
      sideboardSize: 15,
      allowedSets: this.getModernLegalSets(),
      specialRules: {
        companionAllowed: true,
        planeswalkerRule: true
      }
    });

    // Legacy
    this.formatRules.set('legacy', {
      minDeckSize: 60,
      maxDeckSize: null,
      maxCopiesPerCard: 4,
      basicLandLimit: null,
      sideboardSize: 15,
      allowedSets: 'all',
      specialRules: {
        companionAllowed: true,
        planeswalkerRule: true
      }
    });

    // Vintage
    this.formatRules.set('vintage', {
      minDeckSize: 60,
      maxDeckSize: null,
      maxCopiesPerCard: 4,
      basicLandLimit: null,
      sideboardSize: 15,
      allowedSets: 'all',
      specialRules: {
        companionAllowed: true,
        planeswalkerRule: true,
        restrictedListApplies: true
      }
    });

    // Pioneer
    this.formatRules.set('pioneer', {
      minDeckSize: 60,
      maxDeckSize: null,
      maxCopiesPerCard: 4,
      basicLandLimit: null,
      sideboardSize: 15,
      allowedSets: this.getPioneerLegalSets(),
      specialRules: {
        companionAllowed: true,
        planeswalkerRule: true
      }
    });

    // Pauper
    this.formatRules.set('pauper', {
      minDeckSize: 60,
      maxDeckSize: null,
      maxCopiesPerCard: 4,
      basicLandLimit: null,
      sideboardSize: 15,
      allowedSets: 'all',
      rarityRestriction: ['common'],
      specialRules: {
        companionAllowed: true,
        planeswalkerRule: true
      }
    });
  }

  /**
   * Setup banned and restricted card lists
   */
  setupBannedRestrictedLists() {
    // Standard banned cards
    this.bannedCards.set('standard', new Set([
      'Oko, Thief of Crowns',
      'Once Upon a Time',
      'Veil of Summer',
      'Teferi, Time Raveler',
      'Wilderness Reclamation',
      'Growth Spiral',
      'Cauldron Familiar',
      'Lucky Clover',
      'Escape to the Wilds',
      'Omnath, Locus of Creation'
    ]));

    // Commander banned cards
    this.bannedCards.set('commander', new Set([
      'Ancestral Recall',
      'Balance',
      'Biorhythm',
      'Black Lotus',
      'Braids, Cabal Minion',
      'Chaos Orb',
      'Coalition Victory',
      'Channel',
      'Emrakul, the Aeons Torn',
      'Erayo, Soratami Ascendant',
      'Fastbond',
      'Gifts Ungiven',
      'Griselbrand',
      'Hullbreacher',
      'Iona, Shield of Emeria',
      'Karakas',
      'Leovold, Emissary of Trest',
      'Library of Alexandria',
      'Limited Resources',
      'Lutri, the Spellchaser',
      'Mox Emerald',
      'Mox Jet',
      'Mox Pearl',
      'Mox Ruby',
      'Mox Sapphire',
      'Painter\'s Servant',
      'Panoptic Mirror',
      'Paradox Engine',
      'Primeval Titan',
      'Prophet of Kruphix',
      'Recurring Nightmare',
      'Rofellos, Llanowar Emissary',
      'Shahrazad',
      'Sundering Titan',
      'Sway of the Stars',
      'Sylvan Primordial',
      'Time Vault',
      'Time Walk',
      'Tinker',
      'Tolarian Academy',
      'Trade Secrets',
      'Upheaval',
      'Worldfire',
      'Yawgmoth\'s Bargain'
    ]));

    // Modern banned cards
    this.bannedCards.set('modern', new Set([
      'Ancient Den',
      'Arcum\'s Astrolabe',
      'Artifact Lands',
      'Blazing Shoal',
      'Bloodbraid Elf',
      'Bridge from Below',
      'Chrome Mox',
      'Cloudpost',
      'Dark Depths',
      'Deathrite Shaman',
      'Dig Through Time',
      'Dread Return',
      'Eye of Ugin',
      'Faithless Looting',
      'Gitaxian Probe',
      'Glimpse of Nature',
      'Golgari Grave-Troll',
      'Great Furnace',
      'Green Sun\'s Zenith',
      'Hogaak, Arisen Necropolis',
      'Hypergenesis',
      'Jace, the Mind Sculptor',
      'Mental Misstep',
      'Mox Opal',
      'Mycosynth Lattice',
      'Mystic Sanctuary',
      'Oko, Thief of Crowns',
      'Once Upon a Time',
      'Ponder',
      'Preordain',
      'Punishing Fire',
      'Rite of Flame',
      'Seat of the Synod',
      'Second Sunrise',
      'Seething Song',
      'Sensei\'s Divining Top',
      'Simian Spirit Guide',
      'Skullclamp',
      'Splinter Twin',
      'Stoneforge Mystic',
      'Summer Bloom',
      'Tibalt\'s Trickery',
      'Tree of Tales',
      'Treasure Cruise',
      'Umezawa\'s Jitte',
      'Uro, Titan of Nature\'s Wrath',
      'Vault of Whispers',
      'Wild Nacatl'
    ]));

    // Vintage restricted cards
    this.restrictedCards.set('vintage', new Set([
      'Ancestral Recall',
      'Balance',
      'Black Lotus',
      'Brainstorm',
      'Chalice of the Void',
      'Channel',
      'Demonic Consultation',
      'Demonic Tutor',
      'Dig Through Time',
      'Fastbond',
      'Gitaxian Probe',
      'Gush',
      'Imperial Seal',
      'Library of Alexandria',
      'Lotus Petal',
      'Mana Crypt',
      'Mana Vault',
      'Mental Misstep',
      'Merchant Scroll',
      'Mind\'s Desire',
      'Mox Emerald',
      'Mox Jet',
      'Mox Pearl',
      'Mox Ruby',
      'Mox Sapphire',
      'Mystical Tutor',
      'Necropotence',
      'Ponder',
      'Preordain',
      'Sol Ring',
      'Strip Mine',
      'Time Vault',
      'Time Walk',
      'Tinker',
      'Tolarian Academy',
      'Treasure Cruise',
      'Trinisphere',
      'Vampiric Tutor',
      'Wheel of Fortune',
      'Windfall',
      'Yawgmoth\'s Will'
    ]));
  }

  /**
   * Setup card types
   */
  setupCardTypes() {
    this.cardTypes = new Set([
      'artifact', 'creature', 'enchantment', 'instant', 'land', 'planeswalker', 'sorcery', 'tribal',
      'conspiracy', 'phenomenon', 'plane', 'scheme', 'vanguard', 'emblem', 'dungeon'
    ]);
  }

  /**
   * Setup keywords
   */
  setupKeywords() {
    this.keywords = new Set([
      'deathtouch', 'defender', 'double strike', 'enchant', 'equip', 'first strike', 'flash',
      'flying', 'haste', 'hexproof', 'indestructible', 'lifelink', 'menace', 'protection',
      'reach', 'shroud', 'trample', 'vigilance', 'ward', 'prowess', 'scry', 'surveil',
      'adapt', 'addendum', 'afterlife', 'amass', 'ascend', 'assist', 'convoke', 'crew',
      'delve', 'emerge', 'escalate', 'escape', 'evoke', 'exploit', 'explore', 'fabricate',
      'forecast', 'jump-start', 'kicker', 'madness', 'morph', 'mutate', 'overload',
      'proliferate', 'rebound', 'riot', 'spectacle', 'surge', 'undergrowth', 'undying',
      'unearth', 'unleash'
    ]);
  }

  /**
   * Get Standard legal sets (last 2 years approximately)
   */
  getStandardLegalSets() {
    return new Set([
      'MID', 'VOW', 'NEO', 'SNC', 'DMU', 'BRO', 'ONE', 'MOM', 'WOE', 'LCI', 'MKM', 'OTJ', 'BLB', 'DSK'
    ]);
  }

  /**
   * Get Modern legal sets (8th Edition forward)
   */
  getModernLegalSets() {
    return new Set([
      '8ED', 'MRD', 'DST', '5DN', 'CHK', 'BOK', 'SOK', '9ED', 'RAV', 'GPT', 'DIS', 'CSP',
      'TSP', 'TSB', 'PLC', 'FUT', '10E', 'LRW', 'MOR', 'SHM', 'EVE', 'ALA', 'CON', 'ARB',
      'M10', 'ZEN', 'WWK', 'ROE', 'M11', 'SOM', 'MBS', 'NPH', 'M12', 'ISD', 'DKA', 'AVR',
      'M13', 'RTR', 'GTC', 'DGM', 'M14', 'THS', 'BNG', 'JOU', 'M15', 'KTK', 'FRF', 'DTK',
      'ORI', 'BFZ', 'OGW', 'SOI', 'EMN', 'KLD', 'AER', 'AKH', 'HOU', 'XLN', 'RIX', 'DOM',
      'M19', 'GRN', 'RNA', 'WAR', 'M20', 'ELD', 'THB', 'IKO', 'M21', 'ZNR', 'KHM', 'STX',
      'MH1', 'MH2', 'MID', 'VOW', 'NEO', 'SNC', 'DMU', 'BRO', 'ONE', 'MOM', 'WOE', 'LCI',
      'MKM', 'OTJ', 'BLB', 'DSK'
    ]);
  }

  /**
   * Get Pioneer legal sets (Return to Ravnica forward)
   */
  getPioneerLegalSets() {
    return new Set([
      'RTR', 'GTC', 'DGM', 'M14', 'THS', 'BNG', 'JOU', 'M15', 'KTK', 'FRF', 'DTK', 'ORI',
      'BFZ', 'OGW', 'SOI', 'EMN', 'KLD', 'AER', 'AKH', 'HOU', 'XLN', 'RIX', 'DOM', 'M19',
      'GRN', 'RNA', 'WAR', 'M20', 'ELD', 'THB', 'IKO', 'M21', 'ZNR', 'KHM', 'STX', 'MID',
      'VOW', 'NEO', 'SNC', 'DMU', 'BRO', 'ONE', 'MOM', 'WOE', 'LCI', 'MKM', 'OTJ', 'BLB', 'DSK'
    ]);
  }

  /**
   * Check if a card is legal in a format
   */
  isCardLegal(card, format) {
    const formatRules = this.formatRules.get(format.toLowerCase());
    if (!formatRules) {
      return { legal: false, reason: 'Unknown format' };
    }

    const cardName = card.name || card;

    // Check banned list
    if (this.bannedCards.has(format.toLowerCase()) && 
        this.bannedCards.get(format.toLowerCase()).has(cardName)) {
      return { legal: false, reason: 'Banned in format' };
    }

    // Check set legality
    if (formatRules.allowedSets && formatRules.allowedSets !== 'all') {
      const cardSet = card.set || card.set_code;
      if (cardSet && !formatRules.allowedSets.has(cardSet.toUpperCase())) {
        return { legal: false, reason: 'Set not legal in format' };
      }
    }

    // Check rarity restrictions (e.g., Pauper)
    if (formatRules.rarityRestriction) {
      const cardRarity = card.rarity?.toLowerCase();
      if (cardRarity && !formatRules.rarityRestriction.includes(cardRarity)) {
        return { legal: false, reason: `Only ${formatRules.rarityRestriction.join(', ')} cards allowed` };
      }
    }

    // Check if card is restricted
    if (this.restrictedCards.has(format.toLowerCase()) && 
        this.restrictedCards.get(format.toLowerCase()).has(cardName)) {
      return { legal: true, restricted: true, reason: 'Restricted to 1 copy' };
    }

    return { legal: true };
  }

  /**
   * Validate deck construction for a format
   */
  validateDeck(deck, format) {
    const formatRules = this.formatRules.get(format.toLowerCase());
    if (!formatRules) {
      return { valid: false, errors: ['Unknown format'] };
    }

    const errors = [];
    const warnings = [];

    // Check deck size
    const totalCards = (deck.mainboard || []).reduce((sum, entry) => sum + (entry.quantity || 1), 0);
    if (totalCards < formatRules.minDeckSize) {
      errors.push(`Deck too small: ${totalCards} cards (minimum ${formatRules.minDeckSize})`);
    }
    if (formatRules.maxDeckSize && totalCards > formatRules.maxDeckSize) {
      errors.push(`Deck too large: ${totalCards} cards (maximum ${formatRules.maxDeckSize})`);
    }

    // Check sideboard size
    if (deck.sideboard && formatRules.sideboardSize !== null) {
      const sideboardSize = deck.sideboard.reduce((sum, entry) => sum + (entry.quantity || 1), 0);
      if (sideboardSize > formatRules.sideboardSize) {
        errors.push(`Sideboard too large: ${sideboardSize} cards (maximum ${formatRules.sideboardSize})`);
      }
    }

    // Check commander requirements
    if (formatRules.requiresCommander) {
      if (!deck.commanders || deck.commanders.length === 0) {
        errors.push('Commander format requires a commander');
      } else if (deck.commanders.length > 2) {
        errors.push('Too many commanders (maximum 2 with Partner)');
      } else if (deck.commanders.length === 2) {
        // Check if both commanders have Partner
        const hasPartner = deck.commanders.every(cmd => 
          this.hasKeyword(cmd, 'partner') || this.hasKeyword(cmd, 'partner with')
        );
        if (!hasPartner) {
          errors.push('Two commanders require Partner ability');
        }
      }
    }

    // Check color identity restrictions
    if (formatRules.colorIdentityRestriction && deck.commanders) {
      const commanderIdentity = this.getColorIdentity(deck.commanders);
      const invalidCards = [];
      
      (deck.mainboard || []).forEach(entry => {
        const cardIdentity = this.getColorIdentity([entry.card]);
        if (!this.isWithinColorIdentity(cardIdentity, commanderIdentity)) {
          invalidCards.push(entry.card.name);
        }
      });

      if (invalidCards.length > 0) {
        errors.push(`Cards outside commander color identity: ${invalidCards.join(', ')}`);
      }
    }

    // Check card copy limits
    const cardCounts = new Map();
    (deck.mainboard || []).forEach(entry => {
      const cardName = entry.card.name;
      const quantity = entry.quantity || 1;
      cardCounts.set(cardName, (cardCounts.get(cardName) || 0) + quantity);
    });

    cardCounts.forEach((count, cardName) => {
      // Basic lands are unlimited unless specified
      if (this.isBasicLand(cardName) && formatRules.basicLandLimit === null) {
        return;
      }

      const maxCopies = formatRules.maxCopiesPerCard;
      
      // Check if card is restricted
      if (this.restrictedCards.has(format.toLowerCase()) && 
          this.restrictedCards.get(format.toLowerCase()).has(cardName)) {
        if (count > 1) {
          errors.push(`${cardName} is restricted to 1 copy`);
        }
      } else if (count > maxCopies) {
        errors.push(`Too many copies of ${cardName}: ${count} (maximum ${maxCopies})`);
      }
    });

    // Check individual card legality
    const allCards = [
      ...(deck.mainboard || []).map(entry => entry.card),
      ...(deck.sideboard || []).map(entry => entry.card),
      ...(deck.commanders || [])
    ];

    allCards.forEach(card => {
      const legality = this.isCardLegal(card, format);
      if (!legality.legal) {
        errors.push(`${card.name}: ${legality.reason}`);
      } else if (legality.restricted) {
        warnings.push(`${card.name}: ${legality.reason}`);
      }
    });

    return {
      valid: errors.length === 0,
      errors,
      warnings,
      stats: {
        totalCards,
        sideboardSize: deck.sideboard ? deck.sideboard.reduce((sum, entry) => sum + (entry.quantity || 1), 0) : 0,
        commanderCount: deck.commanders ? deck.commanders.length : 0
      }
    };
  }

  /**
   * Get color identity from cards
   */
  getColorIdentity(cards) {
    const identity = new Set();
    
    cards.forEach(card => {
      const cardIdentity = card.color_identity || card.colorIdentity || [];
      cardIdentity.forEach(color => identity.add(color));
      
      // Also check mana cost for hybrid/phyrexian symbols
      const manaCost = card.mana_cost || card.manaCost || '';
      const colorMatches = manaCost.match(/[WUBRG]/g) || [];
      colorMatches.forEach(color => identity.add(color));
    });

    return identity;
  }

  /**
   * Check if colors are within commander color identity
   */
  isWithinColorIdentity(cardColors, commanderIdentity) {
    for (const color of cardColors) {
      if (!commanderIdentity.has(color)) {
        return false;
      }
    }
    return true;
  }

  /**
   * Check if a card has a specific keyword
   */
  hasKeyword(card, keyword) {
    const text = (card.oracle_text || card.text || '').toLowerCase();
    const keywords = card.keywords || [];
    
    return keywords.some(k => k.toLowerCase().includes(keyword.toLowerCase())) ||
           text.includes(keyword.toLowerCase());
  }

  /**
   * Check if a card is a basic land
   */
  isBasicLand(cardName) {
    const basicLands = ['Plains', 'Island', 'Swamp', 'Mountain', 'Forest', 'Wastes'];
    return basicLands.includes(cardName);
  }

  /**
   * Get format-specific deck building suggestions
   */
  getDeckBuildingSuggestions(deck, format) {
    const formatRules = this.formatRules.get(format.toLowerCase());
    if (!formatRules) {
      return [];
    }

    const suggestions = [];
    const totalCards = (deck.mainboard || []).reduce((sum, entry) => sum + (entry.quantity || 1), 0);

    // Deck size suggestions
    if (totalCards < formatRules.minDeckSize) {
      const needed = formatRules.minDeckSize - totalCards;
      suggestions.push({
        type: 'deck_size',
        priority: 'high',
        message: `Add ${needed} more cards to reach minimum deck size of ${formatRules.minDeckSize}`
      });
    }

    // Mana curve suggestions
    const manaCurve = this.analyzeManaCarve(deck.mainboard || []);
    if (manaCurve.average > 4) {
      suggestions.push({
        type: 'mana_curve',
        priority: 'medium',
        message: 'Consider adding lower mana cost cards to improve curve'
      });
    }

    // Color balance suggestions
    if (format.toLowerCase() === 'commander') {
      const colorBalance = this.analyzeColorBalance(deck.mainboard || []);
      if (colorBalance.imbalance > 0.3) {
        suggestions.push({
          type: 'color_balance',
          priority: 'medium',
          message: 'Consider balancing colors more evenly'
        });
      }
    }

    return suggestions;
  }

  /**
   * Analyze mana curve of a deck
   */
  analyzeManaCarve(cards) {
    const costs = cards.map(entry => entry.card.mana_value || entry.card.cmc || 0);
    const total = costs.reduce((sum, cost) => sum + cost, 0);
    const average = total / costs.length || 0;
    
    const curve = {};
    costs.forEach(cost => {
      const bucket = cost >= 7 ? '7+' : cost.toString();
      curve[bucket] = (curve[bucket] || 0) + 1;
    });

    return { average, curve, total };
  }

  /**
   * Analyze color balance of a deck
   */
  analyzeColorBalance(cards) {
    const colorCounts = { W: 0, U: 0, B: 0, R: 0, G: 0 };
    let totalSymbols = 0;

    cards.forEach(entry => {
      const manaCost = entry.card.mana_cost || entry.card.manaCost || '';
      const symbols = manaCost.match(/[WUBRG]/g) || [];
      symbols.forEach(symbol => {
        colorCounts[symbol]++;
        totalSymbols++;
      });
    });

    // Calculate imbalance (standard deviation)
    const counts = Object.values(colorCounts);
    const mean = totalSymbols / 5;
    const variance = counts.reduce((sum, count) => sum + Math.pow(count - mean, 2), 0) / 5;
    const imbalance = Math.sqrt(variance) / mean;

    return { colorCounts, totalSymbols, imbalance };
  }

  /**
   * Get format information
   */
  getFormatInfo(format) {
    return this.formatRules.get(format.toLowerCase());
  }

  /**
   * Get all supported formats
   */
  getSupportedFormats() {
    return Array.from(this.formatRules.keys());
  }

  /**
   * Update banned/restricted lists (for future updates)
   */
  updateBannedList(format, cardName, action = 'ban') {
    const formatKey = format.toLowerCase();
    
    if (action === 'ban') {
      if (!this.bannedCards.has(formatKey)) {
        this.bannedCards.set(formatKey, new Set());
      }
      this.bannedCards.get(formatKey).add(cardName);
    } else if (action === 'unban') {
      if (this.bannedCards.has(formatKey)) {
        this.bannedCards.get(formatKey).delete(cardName);
      }
    } else if (action === 'restrict') {
      if (!this.restrictedCards.has(formatKey)) {
        this.restrictedCards.set(formatKey, new Set());
      }
      this.restrictedCards.get(formatKey).add(cardName);
    } else if (action === 'unrestrict') {
      if (this.restrictedCards.has(formatKey)) {
        this.restrictedCards.get(formatKey).delete(cardName);
      }
    }
  }
}

// Export singleton instance
const rulesEngine = new MTGRulesEngine();
module.exports = rulesEngine; 