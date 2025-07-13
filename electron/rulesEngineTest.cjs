const rulesEngine = require('./rulesEngine.cjs');

/**
 * Test the MTG Rules Engine functionality
 */
function testRulesEngine() {
  console.log('🧪 Testing MTG Rules Engine...\n');

  // Test 1: Check supported formats
  console.log('1. Supported Formats:');
  const formats = rulesEngine.getSupportedFormats();
  console.log(formats.join(', '));
  console.log('');

  // Test 2: Check card legality
  console.log('2. Card Legality Tests:');
  
  // Test a banned card in Commander
  const blackLotus = { name: 'Black Lotus', set: 'LEA', rarity: 'rare' };
  const commanderLegality = rulesEngine.isCardLegal(blackLotus, 'commander');
  console.log(`Black Lotus in Commander: ${commanderLegality.legal ? 'Legal' : 'Illegal'} - ${commanderLegality.reason || 'OK'}`);
  
  // Test a legal card
  const lightningBolt = { name: 'Lightning Bolt', set: 'M11', rarity: 'common' };
  const modernLegality = rulesEngine.isCardLegal(lightningBolt, 'modern');
  console.log(`Lightning Bolt in Modern: ${modernLegality.legal ? 'Legal' : 'Illegal'} - ${modernLegality.reason || 'OK'}`);
  
  // Test Pauper rarity restriction
  const jace = { name: 'Jace, the Mind Sculptor', set: 'WWK', rarity: 'mythic' };
  const pauperLegality = rulesEngine.isCardLegal(jace, 'pauper');
  console.log(`Jace in Pauper: ${pauperLegality.legal ? 'Legal' : 'Illegal'} - ${pauperLegality.reason || 'OK'}`);
  console.log('');

  // Test 3: Format information
  console.log('3. Format Information:');
  const commanderRules = rulesEngine.getFormatInfo('commander');
  console.log(`Commander deck size: ${commanderRules.minDeckSize}-${commanderRules.maxDeckSize || 'unlimited'}`);
  console.log(`Commander max copies: ${commanderRules.maxCopiesPerCard}`);
  console.log(`Commander requires commander: ${commanderRules.requiresCommander}`);
  console.log('');

  // Test 4: Color identity
  console.log('4. Color Identity Tests:');
  const commanders = [
    { name: 'Atraxa, Praetors\' Voice', color_identity: ['W', 'U', 'B', 'G'] },
    { name: 'Breya, Etherium Shaper', color_identity: ['W', 'U', 'B', 'R'] }
  ];
  const colorIdentity = rulesEngine.getColorIdentity(commanders);
  console.log(`Color identity: ${Array.from(colorIdentity).join(', ')}`);
  
  // Test if a card is within color identity
  const testCard = { color_identity: ['U', 'B'] };
  const cardIdentity = rulesEngine.getColorIdentity([testCard]);
  const isValid = rulesEngine.isWithinColorIdentity(cardIdentity, colorIdentity);
  console.log(`Card with UB is valid in WUBG identity: ${isValid}`);
  console.log('');

  // Test 5: Deck validation
  console.log('5. Deck Validation:');
  const testDeck = {
    commanders: [{ name: 'Atraxa, Praetors\' Voice', color_identity: ['W', 'U', 'B', 'G'] }],
    mainboard: [
      { card: { name: 'Lightning Bolt', color_identity: ['R'] }, quantity: 1 },
      { card: { name: 'Counterspell', color_identity: ['U'] }, quantity: 1 },
      { card: { name: 'Swords to Plowshares', color_identity: ['W'] }, quantity: 1 }
    ],
    sideboard: []
  };
  
  const validation = rulesEngine.validateDeck(testDeck, 'commander');
  console.log(`Deck valid: ${validation.valid}`);
  if (validation.errors.length > 0) {
    console.log('Errors:');
    validation.errors.forEach(error => console.log(`  - ${error}`));
  }
  if (validation.warnings.length > 0) {
    console.log('Warnings:');
    validation.warnings.forEach(warning => console.log(`  - ${warning}`));
  }
  console.log('');

  // Test 6: Deck building suggestions
  console.log('6. Deck Building Suggestions:');
  const suggestions = rulesEngine.getDeckBuildingSuggestions(testDeck, 'commander');
  suggestions.forEach(suggestion => {
    console.log(`  [${suggestion.priority.toUpperCase()}] ${suggestion.message}`);
  });
  console.log('');

  // Test 7: Keyword detection
  console.log('7. Keyword Detection:');
  const flyingCard = { 
    name: 'Serra Angel', 
    oracle_text: 'Flying, vigilance',
    keywords: ['Flying', 'Vigilance']
  };
  const hasFlying = rulesEngine.hasKeyword(flyingCard, 'flying');
  const hasVigilance = rulesEngine.hasKeyword(flyingCard, 'vigilance');
  const hasHaste = rulesEngine.hasKeyword(flyingCard, 'haste');
  console.log(`Serra Angel has flying: ${hasFlying}`);
  console.log(`Serra Angel has vigilance: ${hasVigilance}`);
  console.log(`Serra Angel has haste: ${hasHaste}`);
  console.log('');

  // Test 8: Mana curve analysis
  console.log('8. Mana Curve Analysis:');
  const deckCards = [
    { card: { mana_value: 1 }, quantity: 4 },
    { card: { mana_value: 2 }, quantity: 8 },
    { card: { mana_value: 3 }, quantity: 6 },
    { card: { mana_value: 4 }, quantity: 4 },
    { card: { mana_value: 5 }, quantity: 2 },
    { card: { mana_value: 6 }, quantity: 1 }
  ];
  const manaCurve = rulesEngine.analyzeManaCarve(deckCards);
  console.log(`Average mana value: ${manaCurve.average.toFixed(2)}`);
  console.log('Curve distribution:', manaCurve.curve);
  console.log('');

  console.log('✅ Rules Engine test completed!');
}

// Run the test
if (require.main === module) {
  testRulesEngine();
}

module.exports = { testRulesEngine }; 