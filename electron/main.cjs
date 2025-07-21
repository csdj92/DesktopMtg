const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs').promises;
const fsSync = require('fs');
const bulkDataService = require('./bulkDataService.cjs');
const collectionImporter = require('./collectionImporter.cjs');
const { spawnSync } = require('child_process');
const { autoUpdater } = require('electron-updater');
const log = require('electron-log');
const { buildGreedyCommanderDeck } = require('./reranker/deckGenerator.cjs');
const rulesEngine = require('./rulesEngine.cjs');
const { weights } = require('./reranker/weights.cjs');
const settingsManager = require('./settingsManager.cjs');
const { loadElectronLlm } = require('@electron/llm');
const {
  isCardInColorIdentity,
  rerankCardsByDeckSynergy,
  calculateKeywordSimilarity,
  calculateSmartHybridScore,
  normalizeStrategyScores,
  extractDeckInsights,
  analyzeDeckForQuery,
  // 🔧 NEW: Import advanced pattern analysis functions
  parseOracleTextPatterns,
  calculateMechanicalSynergy,
  enhanceCardsWithMechanicalSynergy
} = require('./deckRecommendationEngine.cjs');
// const { PythonShell } = require('python-shell'); // COMMENTED OUT: No longer using Python builder

// Configure app paths before ready event to avoid cache permission issues
const userDataPath = app.getPath('userData');
app.setPath('crashDumps', path.join(userDataPath, 'crashDumps'));

// Disable hardware acceleration before the app is ready.
app.disableHardwareAcceleration();

// Handle Squirrel startup events on Windows
if (require('electron-squirrel-startup')) {
  app.quit();
}

// Global error handling
process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
  log.error('Uncaught Exception:', error);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  log.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

// Settings Management
// =================================================================

// IPC Handlers for Settings
ipcMain.handle('get-settings', async () => {
  return settingsManager.getSettings();
});

ipcMain.handle('save-settings', async (event, newSettings) => {
  return await settingsManager.saveSettings(newSettings);
});

ipcMain.handle('reset-settings', async () => {
  return await settingsManager.resetSettings();
});

// 🧪 Strategy Testing IPC Handlers
ipcMain.handle('set-active-strategy', async (event, strategy) => {
  const settings = settingsManager.getSettings();
  settings.recommendations.activeStrategy = strategy;
  await settingsManager.saveSettings(settings);
  console.log(`🔄 Active strategy changed to: ${strategy}`);
  return { success: true, activeStrategy: strategy };
});

ipcMain.handle('get-available-strategies', () => {
  const strategies = [
    'primary_fallback', 'weighted_70_30', 'weighted_50_50', 'weighted_30_70',
    'max_score', 'average', 'multiplicative', 'additive', 'semantic_only', 'keyword_only'
  ];
  return { strategies, activeStrategy: settingsManager.getSettings().recommendations.activeStrategy };
});

// IPC Handlers
// =================================================================

// User Collections Operations
ipcMain.handle('get-user-collections', async () => {
  try {
    return await collectionImporter.getCollections();
  } catch (error) {
    console.error('Error getting user collections:', error);
    return [];
  }
});

ipcMain.handle('get-user-collection-cards', async (event, collectionName, options = {}) => {
  try {
    return await collectionImporter.getCollection(collectionName, options);
  } catch (error) {
    console.error('Error getting user collection cards:', error);
    return [];
  }
});

// Bulk Data Operations
ipcMain.handle('bulk-data-search', (event, searchParams, options) => {
  return bulkDataService.searchCards(searchParams, options);
});

ipcMain.handle('bulk-data-search-tokens', (event, searchParams, options) => {
  return bulkDataService.searchTokens(searchParams, options);
});

ipcMain.handle('bulk-data-find-card', (event, cardName) => {
  return bulkDataService.findCardByName(cardName);
});

ipcMain.handle('bulk-data-find-card-by-details', (event, name, setCode, collectorNumber) => {
  // Debug logging to trace calls with undefined names
  if (!name || name === 'undefined') {
    console.log('🐛 DEBUG: bulk-data-find-card-by-details called with undefined name');
    console.log('   setCode:', setCode);
    console.log('   collectorNumber:', collectorNumber);
    console.trace('Call stack trace');
  }
  return bulkDataService.findCardByDetails(name, setCode, collectorNumber);
});

ipcMain.handle('debug-card-lookup', (event, name, setCode) => {
  return bulkDataService.debugCardLookup(name, setCode);
});

ipcMain.handle('bulk-data-stats', () => {
  return bulkDataService.getStats();
});

ipcMain.handle('bulk-data-initialized', () => {
  return bulkDataService.initialized;
});

ipcMain.handle('bulk-data-force-import-related-links', async () => {
  return bulkDataService.forceImportRelatedLinks();
});

// Collection Management
ipcMain.handle('collection-import-csv', async (event, filePath, collectionName) => {
  return collectionImporter.importCSV(filePath, collectionName);
});

ipcMain.handle('collection-import-txt', async (event, filePath, collectionName, format) => {
  return collectionImporter.importTXT(filePath, collectionName, format);
});

// INSERT: bulk import all txt files from cards directory
ipcMain.handle('collection-import-all-txt', async (event, format = 'simple') => {
  try {
    // Locate the legacy cards directory (same as get-card-files)
    const cardsDir = path.join(__dirname, '..', 'cards');

    // Ensure the directory exists
    await fs.mkdir(cardsDir, { recursive: true });

    const files = await fs.readdir(cardsDir);
    const txtFiles = files.filter(file => file.toLowerCase().endsWith('.txt'));

    const results = [];

    for (const filename of txtFiles) {
      const filePath = path.join(cardsDir, filename);
      // Use the filename (without extension) as the collection name
      const collectionName = path.parse(filename).name;
      console.log(`\u{1F4C1} Bulk importing TXT file: ${filename} as collection "${collectionName}"`);
      const result = await collectionImporter.importTXT(filePath, collectionName, format);
      results.push({ filename, collectionName, ...result });
    }

    return { success: true, importedFiles: results.length, details: results };
  } catch (error) {
    console.error('Bulk TXT import failed:', error);
    return { success: false, error: error.message };
  }
});

// Collection APIs - using main database collected field
ipcMain.handle('collection-get-all', () => {
  // Return a single "My Collection" collection for the new system
  return [{ collection_name: 'My Collection', card_count: 0, created_at: new Date().toISOString() }];
});

ipcMain.handle('collection-get', async (event, collectionName, options) => {
  // Get collected cards from main database
  return await bulkDataService.getCollectedCards(options);
});

// NEW: Simple direct method to get collected cards without any complex logic
ipcMain.handle('collection-get-simple', async (event, options = {}) => {
  try {
    const cards = await bulkDataService.getCollectedCards(options);
    return cards;
  } catch (error) {
    console.error('Error getting collected cards:', error);
    return [];
  }
});

ipcMain.handle('collection-get-stats', async (event, collectionName) => {
  // Get collection stats from main database
  return await bulkDataService.getCollectionStats();
});

///window.electronAPI.testOraclePatternAnalysis 
ipcMain.handle('test-oracle-pattern-analysis', async (event, cardName) => {
  try {
    console.log(`🧪 Testing oracle text pattern analysis for: ${cardName}`);

    // Find the card in the database
    const card = await bulkDataService.findCardByName(cardName);
    if (!card) {
      return { error: `Card "${cardName}" not found`, success: false };
    }

    console.log(`📜 Oracle text: ${card.oracle_text || card.text || 'No oracle text'}`);

    // Parse the oracle text patterns using advanced analysis
    const patterns = parseOracleTextPatterns(card.oracle_text || card.text || '');

    console.log('🔍 Parsed patterns:', JSON.stringify(patterns, null, 2));

    return {
      cardName,
      oracleText: card.oracle_text || card.text || '',
      patterns,
      success: true
    };

  } catch (error) {
    console.error('❌ Oracle pattern analysis error:', error);
    return { error: error.message, success: false };
  }
});

ipcMain.handle('collection-get-ruling', async (event, cardId) => {
  return await bulkDataService.getCardRuling(cardId);
});

ipcMain.handle('collection-delete', (event, collectionName) => {
  return collectionImporter.deleteCollection(collectionName);
});

ipcMain.handle('collection-add-card', async (event, collectionName, cardData) => {
  if (!collectionImporter.db) {
    return { success: false, error: 'Collection database not ready. Please try again in a moment.' };
  }
  return collectionImporter.addCard(collectionName, cardData);
});

ipcMain.handle('collection-update-card-quantity', async (event, collectionName, cardKey, newQty) => {
  if (!collectionImporter.db) {
    return { success: false, error: 'Collection database not ready. Please try again in a moment.' };
  }
  return collectionImporter.updateCardQuantity(collectionName, cardKey, newQty);
});

ipcMain.handle('collection-delete-card', async (event, collectionName, cardKey) => {
  if (!collectionImporter.db) {
    return { success: false, error: 'Collection database not ready. Please try again in a moment.' };
  }
  return collectionImporter.deleteCard(collectionName, cardKey);
});

ipcMain.handle('collection-sync', async () => {
  return await collectionImporter.syncCollectionToMainDatabase();
});

ipcMain.handle('collection-get-card-quantity', async (event, cardName, options) => {
  // Return the total quantity of this card across all user collections (plus per-collection breakdown)
  return await collectionImporter.getCardTotalQuantity(cardName, options);
});

// New API to mark cards as collected/uncollected
ipcMain.handle('collection-mark-card', async (event, cardId, collected = true) => {
  return await bulkDataService.markCardCollected(cardId, collected);
});

// Clear all collections - reset collected field and clear user_collections table
ipcMain.handle('collection-clear-all', async () => {
  try {
    console.log('🗑️ Clearing all collections...');

    // Reset all collected cards to 0 in the main database
    await bulkDataService.clearAllCollected();

    // Clear the user_collections table
    await collectionImporter.clearAllCollections();

    console.log('✅ All collections cleared successfully');
    return { success: true };
  } catch (error) {
    console.error('❌ Error clearing collections:', error);
    return { success: false, error: error.message };
  }
});

// Deck Management
// =================================================================

// NEW: Expose Rules Engine
ipcMain.handle('deck-validate', (event, deck, format) => {
  if (!rulesEngine) {
    console.error('Rules engine is not initialized!');
    return { valid: false, errors: ['Rules engine not available.'] };
  }
  return rulesEngine.validateDeck(deck, format);
});

const decksDir = path.join(app.getPath('userData'), 'decks');

// Ensure decks directory exists
const ensureDecksDir = async () => {
  try {
    await fs.mkdir(decksDir, { recursive: true });
  } catch (error) {
    console.error('Error creating decks directory:', error);
  }
};

// Helper function to parse deck file content
const parseDeckFile = (content, format = 'auto') => {
  const lines = content.split('\n').map(line => line.trim()).filter(line => line);
  const deck = { mainboard: [], sideboard: [], commanders: [] };

  let currentSection = 'mainboard';
  let foundCommanderSection = false;

  for (const line of lines) {
    const lowerLine = line.toLowerCase();

    // Check for section headers - be more specific about what constitutes a section header
    if (line.startsWith('//') || line.startsWith('#')) {
      // This is a comment line, check if it's a section header
      if (lowerLine.includes('sideboard')) {
        currentSection = 'sideboard';
        continue;
      }
      if (lowerLine.includes('commander') || lowerLine.includes('command zone')) {
        currentSection = 'commanders';
        foundCommanderSection = true;
        continue;
      }
      if (lowerLine.includes('mainboard') || lowerLine.includes('main deck')) {
        currentSection = 'mainboard';
        continue;
      }
      // If it's just a regular comment, skip it
      continue;
    }

    // Check for standalone section headers (lines that are just section names)
    if (lowerLine === 'sideboard' || lowerLine === 'side board') {
      currentSection = 'sideboard';
      continue;
    }
    if (lowerLine === 'commander' || lowerLine === 'commanders' || lowerLine === 'command zone') {
      currentSection = 'commanders';
      foundCommanderSection = true;
      continue;
    }
    if (lowerLine === 'mainboard' || lowerLine === 'main deck' || lowerLine === 'deck') {
      currentSection = 'mainboard';
      continue;
    }

    // Parse card line
    const cardData = parseDeckLine(line, format);
    if (cardData && cardData.name) {
      if (currentSection === 'commanders') {
        deck.commanders.push({ name: cardData.name, id: cardData.name });
        // After adding a commander, switch back to mainboard for subsequent cards
        // unless we explicitly encounter another section header
        if (foundCommanderSection) {
          currentSection = 'mainboard';
        }
      } else {
        deck[currentSection].push({
          card: { name: cardData.name, id: cardData.name },
          quantity: cardData.quantity || 1
        });
      }
    }
  }

  return deck;
};

// Helper function to parse individual deck lines
const parseDeckLine = (line, format) => {
  // Strip comments from the end of the line
  const cleanedLine = line.split('//')[0].trim();
  if (!cleanedLine) {
    return null;
  }

  // Auto-detect format if not specified
  if (format === 'auto') {
    if (cleanedLine.match(/^\d+x?\s+/)) format = 'mtgo';
    else if (cleanedLine.match(/^\d+\s+.*\([^)]+\)/)) format = 'detailed';
    else if (cleanedLine.match(/^\d+x?\s+.*\[.*\]/)) format = 'deckbox';
    else format = 'simple';
  }

  switch (format) {
    case 'mtgo': // "4x Lightning Bolt"
      const mtgoMatch = cleanedLine.match(/^(\d+)x?\s+(.+)$/);
      if (mtgoMatch) {
        return {
          quantity: parseInt(mtgoMatch[1]),
          name: mtgoMatch[2].trim()
        };
      }
      break;

    case 'detailed': // "4 Lightning Bolt (M10) 123"
      const detailedMatch = cleanedLine.match(/^(\d+)\s+([^(]+?)(?:\s*\([^)]+\))?/);
      if (detailedMatch) {
        return {
          quantity: parseInt(detailedMatch[1]),
          name: detailedMatch[2].trim()
        };
      }
      break;

    case 'deckbox': // "1x Lightning Bolt [M10]"
      const deckboxMatch = cleanedLine.match(/^(\d+)x?\s+([^[]+?)(?:\s*\[.*\])?$/);
      if (deckboxMatch) {
        return {
          quantity: parseInt(deckboxMatch[1]),
          name: deckboxMatch[2].trim()
        };
      }
      break;

    default: // Simple format
      const simpleMatch = cleanedLine.match(/^(?:(\d+)x?\s+)?(.+)$/);
      if (simpleMatch) {
        return {
          quantity: parseInt(simpleMatch[1]) || 1,
          name: simpleMatch[2].trim()
        };
      }
  }

  return { name: cleanedLine.trim(), quantity: 1 };
};

// Deck Import Handler
ipcMain.handle('deck-import', async (event, filePath, deckName, format = 'auto') => {
  try {
    console.log(`📥 Importing deck: ${deckName} from ${filePath}`);

    // Read and parse the deck file
    const fileContent = await fs.readFile(filePath, 'utf-8');
    const deckData = parseDeckFile(fileContent, format);

    // Transform deck data to match expected structure by looking up cards in database
    const transformedDeck = {
      mainboard: [],
      sideboard: [],
      commanders: [],
      formatName: 'commander'
    };

    // Helper function to find card data from database
    const findCardData = async (cardName) => {
      try {
        // Try to find card in the main database
        const card = await bulkDataService.findCardByName(cardName);
        if (card) {
          return {
            id: card.uuid || card.id || cardName,
            uuid: card.uuid || card.id || cardName,
            name: card.name,
            manaCost: card.manaCost || '',
            manaValue: card.manaValue || card.cmc || 0,
            type: card.type_line || card.type || '',
            text: card.oracle_text || card.text || '',
            colors: card.colors || [],
            color_identity: card.color_identity || card.colorIdentity || [],
            power: card.power,
            toughness: card.toughness,
            rarity: card.rarity || '',
            set: card.setCode || card.set || '',
            image_uris: card.image_uris || {}
          };
        }
      } catch (error) {
        console.warn(`Could not find card data for "${cardName}":`, error);
      }

      // Fallback to basic structure if card not found in database
      return {
        id: cardName,
        uuid: cardName,
        name: cardName,
        manaCost: '',
        manaValue: 0,
        type: '',
        text: '',
        colors: [],
        color_identity: [],
        rarity: '',
        set: '',
        image_uris: {}
      };
    };

    // Transform mainboard
    for (const entry of deckData.mainboard) {
      const cardData = await findCardData(entry.card.name);
      transformedDeck.mainboard.push({
        card: cardData,
        quantity: entry.quantity
      });
    }

    // Transform sideboard
    for (const entry of deckData.sideboard) {
      const cardData = await findCardData(entry.card.name);
      transformedDeck.sideboard.push({
        card: cardData,
        quantity: entry.quantity
      });
    }

    // Transform commanders
    for (const commander of deckData.commanders) {
      const cardData = await findCardData(commander.name);
      transformedDeck.commanders.push(cardData);
    }

    // Save the transformed deck
    await ensureDecksDir();
    const safeFilename = path.basename(deckName).replace(/[^a-z0-9\s-]/gi, '_');
    const deckFilePath = path.join(decksDir, `${safeFilename}.json`);

    await fs.writeFile(deckFilePath, JSON.stringify(transformedDeck, null, 2), 'utf-8');

    // Also add cards to collection
    const collectionName = `Deck: ${deckName}`;
    let totalCards = 0;

    // Add mainboard cards to collection
    for (const entry of transformedDeck.mainboard) {
      await collectionImporter.addCard(collectionName, {
        card_name: entry.card.name,
        quantity: entry.quantity,
        set_code: '',
        collector_number: '',
        foil: 'normal'
      });
      totalCards += entry.quantity;
    }

    // Add sideboard cards to collection
    for (const entry of transformedDeck.sideboard) {
      await collectionImporter.addCard(collectionName, {
        card_name: entry.card.name,
        quantity: entry.quantity,
        set_code: '',
        collector_number: '',
        foil: 'normal'
      });
      totalCards += entry.quantity;
    }

    // Add commanders to collection
    for (const commander of transformedDeck.commanders) {
      await collectionImporter.addCard(collectionName, {
        card_name: commander.name,
        quantity: 1,
        set_code: '',
        collector_number: '',
        foil: 'normal'
      });
      totalCards += 1;
    }

    // Sync collection to main database
    await collectionImporter.syncCollectionToMainDatabase();

    console.log(`✅ Deck import complete: ${deckName} (${totalCards} cards)`);

    return {
      success: true,
      deckName: safeFilename,
      totalCards,
      mainboardCount: transformedDeck.mainboard.length,
      sideboardCount: transformedDeck.sideboard.length,
      commanderCount: transformedDeck.commanders.length,
      collectionName
    };

  } catch (error) {
    console.error('Deck import failed:', error);
    return {
      success: false,
      error: error.message
    };
  }
});

ipcMain.handle('deck-save', async (event, filename, deckData) => {
  await ensureDecksDir();
  const safeFilename = path.basename(filename).replace(/[^a-z0-9\s-]/gi, '_');
  if (!safeFilename) {
    return { success: false, error: 'Invalid filename provided.' };
  }
  const filePath = path.join(decksDir, `${safeFilename}.json`);

  try {
    await fs.writeFile(filePath, JSON.stringify(deckData, null, 2), 'utf-8');
    return { success: true, filename: safeFilename };
  } catch (error) {
    console.error(`Error saving deck ${safeFilename}:`, error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('deck-list', async () => {
  await ensureDecksDir();
  try {
    const files = await fs.readdir(decksDir);
    const deckFiles = files
      .filter(file => file.toLowerCase().endsWith('.json'))
      .map(file => path.parse(file).name);
    return { success: true, decks: deckFiles };
  } catch (error) {
    console.error('Error listing decks:', error);
    return { success: false, error: error.message, decks: [] };
  }
});

ipcMain.handle('deck-load', async (event, filename) => {
  const safeFilename = path.basename(filename).replace(/[^a-z0-9\s-]/gi, '_');
  if (!safeFilename) {
    return { success: false, error: 'Invalid filename provided.' };
  }
  const filePath = path.join(decksDir, `${safeFilename}.json`);

  try {
    const fileContent = await fs.readFile(filePath, 'utf-8');
    const deckData = JSON.parse(fileContent);
    return { success: true, deck: deckData };
  } catch (error) {
    console.error(`Error loading deck ${safeFilename}:`, error);
    if (error.code === 'ENOENT') {
      return { success: false, error: 'Deck not found.' };
    }
    return { success: false, error: error.message };
  }
});

ipcMain.handle('deck-delete', async (event, filename) => {
  const safeFilename = path.basename(filename).replace(/[^a-z0-9\s-]/gi, '_');
  if (!safeFilename) {
    return { success: false, error: 'Invalid filename provided.' };
  }
  const filePath = path.join(decksDir, `${safeFilename}.json`);

  try {
    await fs.unlink(filePath);
    return { success: true };
  } catch (error) {
    console.error(`Error deleting deck ${safeFilename}:`, error);
    if (error.code === 'ENOENT') {
      return { success: false, error: 'Deck not found.' };
    }
    return { success: false, error: error.message };
  }
});

// Enhanced deck validation using rules engine
const validateDeckWithRules = (deck, format) => {
  return rulesEngine.validateDeck(deck, format);
};

// IPC handler for the new auto-build feature
ipcMain.handle('auto-build-commander-deck', async () => {
  try {
    console.log('🤖 Starting Auto-Build Commander Deck process...');

    // 1. Get the user's full collection to serve as the card pool
    const cardPool = await bulkDataService.getCollectedCards({ limit: 20000 });
    if (!cardPool || cardPool.length < 101) {
      throw new Error('Could not load a large enough card pool from the collection.');
    }
    console.log(`🤖 Loaded ${cardPool.length} cards from collection.`);

    // 2. The deck building logic requires semantic scores. We'll generate them on the fly.
    // To do this, we first need a "concept" which we'll derive from a randomly chosen commander.
    const cmdrPool = cardPool.filter(c => {
      const type = (c.type_line || c.type || '').toLowerCase();
      const isLegendary = type.includes('legendary') && (type.includes('creature') || type.includes('background'));

      // Commander legality might be "legal", "Legal", or undefined. Treat undefined or any case-insensitive
      // "legal" / "restricted" as allowable.
      const legalStatus = c.legalities?.commander;
      const notBanned = !legalStatus || ["legal", "restricted"].includes(String(legalStatus).toLowerCase());

      return isLegendary && notBanned;
    });
    if (cmdrPool.length === 0) throw new Error("No valid commanders found in collection.");
    const commanderForQuery = cmdrPool[Math.floor(Math.random() * cmdrPool.length)];

    // 3. Generate a query and get semantic scores for the whole pool based on that commander
    const query = analyzeDeckForQuery({ commanders: [commanderForQuery], mainboard: [] }, 'commander');
    const allSemanticResults = await bulkDataService.searchCardsSemantic(query, { limit: 90000 });

    const semanticScoreMap = new Map();
    allSemanticResults.forEach(result => {
      const distance = result._distance || result.distance || 1.0;

      // Use the same configurable distance conversion as main recommendations
      const settings = settingsManager.getSettings();
      const conversionType = settings.recommendations?.scoring?.distanceConversion || 'sqrt';

      let score;
      switch (conversionType) {
        case 'linear':
          score = Math.max(0, 1 - distance);
          break;
        case 'sqrt':
          score = Math.max(0, 1 - Math.sqrt(distance));
          break;
        case 'exponential':
          score = Math.max(0, Math.exp(-distance));
          break;
        case 'aggressive_exp':
          score = Math.max(0, Math.exp(-distance * 2));
          break;
        default:
          score = Math.max(0, 1 - Math.sqrt(distance));
      }

      semanticScoreMap.set(result.name, score);
    });

    // 4. Enrich the entire card pool with these scores.
    const enrichedCardPool = cardPool.map(card => ({
      ...card,
      semantic_score: semanticScoreMap.get(card.name) || 0,
    }));
    console.log(`🤖 Enriched card pool with ${semanticScoreMap.size} semantic scores.`);

    // 5. Run the greedy builder with the enriched pool
    const { deck, synergy } = buildGreedyCommanderDeck(enrichedCardPool, 5);

    console.log(`🤖 Auto-Build complete. Best synergy score: ${synergy}`);
    return { success: true, deck, synergy };

  } catch (error) {
    console.error('❌ Error in auto-build-commander-deck:', error);
    return { success: false, error: error.message, deck: null };
  }
});

// Deck Recommendations
ipcMain.handle('get-deck-recommendations', async (event, { deck, formatName }) => {
  console.log('🎯 Starting deck recommendations...');
  console.log('Deck mainboard length:', deck?.mainboard?.length || 0);
  console.log('Deck commanders length:', deck?.commanders?.length || 0);
  console.log('Format:', formatName);

  if (!deck || !deck.mainboard || deck.mainboard.length === 0) {
    console.log('❌ No deck or empty mainboard');
    return { archetype: 'Unknown', recommendations: [] };
  }

  // 1. Determine the commander's color identity for filtering
  const commanderColorIdentity = new Set();
  if (formatName === 'commander' && deck.commanders && deck.commanders.length > 0) {
    deck.commanders.forEach(c => {
      (c.color_identity || []).forEach(color => commanderColorIdentity.add(color));
    });
  }
  console.log('Commander color identity:', Array.from(commanderColorIdentity));

  // 2. Create a set of existing card names to avoid recommending duplicates
  const existingCardNames = new Set(deck.mainboard.map(card => card.name));
  (deck.commanders || []).forEach(c => existingCardNames.add(c.name));
  console.log('Existing card names count:', existingCardNames.size);

  // 3. Generate a search query from the deck's contents (using configurable approach)
  const settings = settingsManager.getSettings();
  const query = analyzeDeckForQuery(deck, formatName, settings);

  try {
    console.log('🔍 Generated deck analysis query:', query);

    // 4. Get the user's owned cards first
    console.log('📚 Getting user\'s owned cards...');
    const ownedCards = await bulkDataService.getCollectedCards({ limit: 10000 });
    console.log('Found owned cards:', ownedCards.length);

    if (ownedCards.length === 0) {
      console.log('❌ No owned cards found');
      return { archetype: 'No Collection', recommendations: [] };
    }

    // 🔧 NEW IMPROVED ALGORITHM - Deduplication and Better Score Preservation

    // 5A. FIRST: Deduplicate owned cards by name, keeping the most complete version
    console.log('🔄 Deduplicating owned cards by name...');
    const ownedCardsByName = new Map();
    ownedCards.forEach(card => {
      const name = card.name;
      if (!ownedCardsByName.has(name)) {
        ownedCardsByName.set(name, card);
      } else {
        // Keep the card with more complete information (prefer non-null oracle_text)
        const existing = ownedCardsByName.get(name);
        if ((card.oracle_text && !existing.oracle_text) ||
          (card.oracle_text && card.oracle_text.length > (existing.oracle_text || '').length)) {
          ownedCardsByName.set(name, card);
        }
      }
    });
    console.log(`Deduplicated to ${ownedCardsByName.size} unique owned cards`);

    // 5B. Filter by commander color identity and exclude cards already in deck
    console.log('🎯 Filtering by color identity and deck exclusions...');
    const eligibleCardsByName = new Map();
    ownedCardsByName.forEach((card, name) => {
      const isCommanderFormat = formatName === 'commander';
      const cardIsInIdentity = !isCommanderFormat || isCardInColorIdentity(card, commanderColorIdentity);
      const cardIsNotInDeck = !existingCardNames.has(name);

      if (cardIsInIdentity && cardIsNotInDeck) {
        eligibleCardsByName.set(name, card);
      }
    });
    console.log('Eligible unique owned cards:', eligibleCardsByName.size);

    if (eligibleCardsByName.size === 0) {
      console.log('❌ No eligible owned cards after filtering');
      return { archetype: 'No Eligible Cards', recommendations: [] };
    }

    // Convert back to array for processing
    const eligibleCards = Array.from(eligibleCardsByName.values());

    // 6. Use configurable search limits
    const settings = settingsManager.getSettings();
    const semanticLimit = settings.recommendations.search.semanticLimit;
    const resultLimit = settings.recommendations.search.resultLimit;
    const finalLimit = settings.recommendations.search.finalLimit;

    // 7A. SEMANTIC SEARCH - Get comprehensive results with smart caching
    let semanticScores = new Map();
    const semanticSearchInitialized = true;

    if (semanticSearchInitialized) {
      try {
        console.log('📡 Running semantic search with smart caching...');

        // Check cache first
        const cacheKey = `semantic_${query.substring(0, 100)}`; // Use first 100 chars as cache key
        const cached = global.semanticCache?.get(cacheKey);

        let allSemanticResults;
        if (cached && (Date.now() - cached.timestamp) < 300000) { // 5 minute cache
          console.log('💾 Using cached semantic results');
          allSemanticResults = cached.results;
        } else {
          console.log('🔍 Performing fresh semantic search...');
          allSemanticResults = await bulkDataService.searchCardsSemantic(query, { limit: semanticLimit });

          // Cache the results
          if (!global.semanticCache) {
            global.semanticCache = new Map();
          }
          global.semanticCache.set(cacheKey, {
            results: allSemanticResults,
            timestamp: Date.now()
          });

          // Keep cache size reasonable (max 10 entries)
          if (global.semanticCache.size > 10) {
            const oldestKey = global.semanticCache.keys().next().value;
            global.semanticCache.delete(oldestKey);
          }
        }

        console.log('Semantic search results:', allSemanticResults.length);

        // 🔧 IMPROVED: Better distance-to-score conversion and deduplication
        const semanticResultsByName = new Map();
        allSemanticResults.forEach(result => {
          const name = result.name;
          // Improved distance-to-score conversion: use configurable approach for better scores
          const distance = result._distance || result.distance || 1.0;

          // Multiple conversion options - use square root for better separation while keeping higher scores
          const settings = settingsManager.getSettings();
          const conversionType = settings.recommendations?.scoring?.distanceConversion || 'sqrt';

          let score;
          switch (conversionType) {
            case 'linear':
              score = Math.max(0, 1 - distance);
              break;
            case 'sqrt':
              score = Math.max(0, 1 - Math.sqrt(distance));
              break;
            case 'exponential':
              score = Math.max(0, Math.exp(-distance));
              break;
            case 'aggressive_exp':
              score = Math.max(0, Math.exp(-distance * 2));
              break;
            default:
              score = Math.max(0, 1 - Math.sqrt(distance)); // Default to sqrt
          }

          // Keep the best score for each card name (in case of duplicates)
          if (!semanticResultsByName.has(name) || score > semanticResultsByName.get(name)) {
            semanticResultsByName.set(name, score);
          }
        });

        semanticScores = semanticResultsByName;
        console.log('Cards with semantic scores (deduplicated):', semanticScores.size);

        // Show some sample semantic scores for debugging
        const topSemanticScores = Array.from(semanticScores.entries())
          .sort((a, b) => b[1] - a[1])
          .slice(0, 5);
        console.log('Top 5 semantic scores:', topSemanticScores.map(([name, score]) =>
          `${name}: ${score.toFixed(3)}`).join(', '));

      } catch (error) {
        console.error('❌ Semantic search failed:', error);
        semanticScores = new Map();
      }
    }

    // 7B. KEYWORD-BASED SCORING - Only for eligible cards
    console.log('🔤 Running keyword-based scoring approach...');
    const keywordScores = new Map();
    eligibleCards.forEach(card => {
      const keywordScore = calculateKeywordSimilarity(card, query);
      keywordScores.set(card.name, keywordScore);
    });
    console.log('Cards with keyword scores:', keywordScores.size);

    // 8. SCORING STRATEGY CALCULATION - Apply all strategies with improved scores
    console.log('🧮 Calculating all scoring strategies...');
    const scoredCards = eligibleCards.map(card => {
      const semanticScore = semanticScores.get(card.name) || 0;
      const keywordScore = keywordScores.get(card.name) || 0;

      // Calculate ALL strategies simultaneously for comparison
      const strategies = {
        primary_fallback: semanticScore > 0.01 ? semanticScore : keywordScore, // Increased threshold
        weighted_70_30: (semanticScore * 0.7) + (keywordScore * 0.3),
        weighted_50_50: (semanticScore * 0.5) + (keywordScore * 0.5),
        weighted_30_70: (semanticScore * 0.3) + (keywordScore * 0.7),
        max_score: Math.max(semanticScore, keywordScore),
        average: (semanticScore + keywordScore) / 2,
        multiplicative: semanticScore * keywordScore,
        additive: semanticScore + keywordScore,
        semantic_only: semanticScore,
        keyword_only: keywordScore,
        // New intelligent hybrid approach
        smart_hybrid: calculateSmartHybridScore(semanticScore, keywordScore, card, query)
      };

      // Use the configurable active strategy (default to primary_fallback)
      const activeStrategy = settings.recommendations?.activeStrategy || 'primary_fallback';
      const combinedScore = strategies[activeStrategy];

      return {
        ...card,
        semantic_score: semanticScore,
        keyword_score: keywordScore,
        combined_score: combinedScore,
        // Store ALL strategy scores for comparison
        strategy_scores: strategies,
        active_strategy: activeStrategy,
        score_source: semanticScore > 0.01 ? 'semantic' : 'keyword' // Increased threshold
      };
    });

    // Apply score normalization for better strategy comparison
    const normalizedCards = normalizeStrategyScores(scoredCards);

    // Sort by combined score (highest first)
    normalizedCards.sort((a, b) => b.combined_score - a.combined_score);

    console.log('📊 Improved scoring comparison:');
    console.log(`  - Cards with semantic scores > 0.01: ${normalizedCards.filter(c => c.semantic_score > 0.01).length}`);
    console.log(`  - Cards with keyword scores > 0: ${normalizedCards.filter(c => c.keyword_score > 0).length}`);
    console.log(`  - Using semantic as primary: ${normalizedCards.filter(c => c.score_source === 'semantic').length}`);
    console.log(`  - Using keyword as fallback: ${normalizedCards.filter(c => c.score_source === 'keyword').length}`);
    console.log(`  - Active strategy: ${settings.recommendations.activeStrategy}`);

    // 🧪 STRATEGY COMPARISON - Show top 3 cards from each strategy
    const strategies = ['primary_fallback', 'weighted_70_30', 'weighted_50_50', 'max_score', 'average', 'multiplicative', 'semantic_only', 'keyword_only', 'smart_hybrid'];
    console.log('\n🧪 Strategy Comparison (Top 3 cards each):');

    strategies.forEach(strategy => {
      const strategySorted = [...normalizedCards].sort((a, b) =>
        (b.strategy_scores[strategy] || 0) - (a.strategy_scores[strategy] || 0)
      );
      const top3 = strategySorted.slice(0, 3);
      console.log(`\n  ${strategy}:`);
      top3.forEach((card, i) => {
        const score = (card.strategy_scores[strategy] || 0).toFixed(3);
        const normalizedScore = (card.strategy_scores_normalized?.[strategy] || 0).toFixed(3);
        const sem = card.semantic_score.toFixed(3);
        const key = card.keyword_score.toFixed(3);
        console.log(`    ${i + 1}. ${card.name} (${score}|norm:${normalizedScore}) [sem:${sem}, key:${key}]`);
      });
    });

    // 9. Apply MTG-specific reranking based on deck synergy with configurable settings
    console.log('🎯 Applying MTG-specific reranking...');
    const rerankedResults = rerankCardsByDeckSynergy(normalizedCards.slice(0, resultLimit), deck, formatName, settings);
    console.log('Reranked results count:', rerankedResults.length);

    // 🔧 FINAL DEDUPLICATION: Ensure no duplicate card names in final results
    console.log('🔄 Final deduplication check...');
    const finalResultsByName = new Map();
    rerankedResults.forEach(card => {
      const name = card.name;
      if (!finalResultsByName.has(name)) {
        finalResultsByName.set(name, card);
      } else {
        // Keep the card with higher synergy score
        const existing = finalResultsByName.get(name);
        if (card.synergy_score > existing.synergy_score) {
          finalResultsByName.set(name, card);
        }
      }
    });
    const deduplicatedResults = Array.from(finalResultsByName.values())
      .sort((a, b) => b.synergy_score - a.synergy_score);

    console.log(`Final deduplication: ${rerankedResults.length} → ${deduplicatedResults.length} unique cards`);

    // Show scoring method distribution after reranking
    if (deduplicatedResults.length > 0) {
      const methodCounts = {};
      deduplicatedResults.forEach(card => {
        const method = card._scoring_method || 'unknown';
        methodCounts[method] = (methodCounts[method] || 0) + 1;
      });
      console.log('📊 Reranked results by scoring method:', methodCounts);
    }

    // 10. Filter recommendations based on format legality using the rules engine
    const legalRecommendations = deduplicatedResults.filter(card => {
      const legality = rulesEngine.isCardLegal(card, formatName);
      return legality.legal;
    });
    console.log(`⚖️ Filtered for legality. Kept ${legalRecommendations.length} of ${deduplicatedResults.length} recommendations.`);

    if (legalRecommendations.length > 0) {
      console.log('Top 3 final results:', legalRecommendations.slice(0, 3).map(r => ({
        name: r.name,
        synergy_score: r.synergy_score,
        semantic_score: r.semantic_score
      })));
    }

    // Extract deck analysis insights to send back to the UI
    const deckAnalysis = extractDeckInsights(query);

    // 🧪 STRATEGY TESTING - Return comparison data for all strategies (using deduplicated results)
    const strategyComparison = {};
    strategies.forEach(strategy => {
      const strategySorted = [...legalRecommendations].sort((a, b) => {
        const aScore = a.strategy_scores?.[strategy] || 0;
        const bScore = b.strategy_scores?.[strategy] || 0;
        return bScore - aScore;
      });
      strategyComparison[strategy] = strategySorted.slice(0, 10).map(card => ({
        name: card.name,
        score: (card.strategy_scores?.[strategy] || 0).toFixed(3),
        normalizedScore: (card.strategy_scores_normalized?.[strategy] || 0).toFixed(3),
        semantic: card.semantic_score?.toFixed(3) || '0.000',
        keyword: card.keyword_score?.toFixed(3) || '0.000'
      }));
    });

    return {
      archetype: 'Analysis Complete',
      recommendations: legalRecommendations.slice(0, finalLimit), // Use configurable final limit
      deckAnalysis,
      settings: settings.recommendations, // Include current settings in response
      // 🧪 NEW: Include strategy comparison data for testing
      strategyComparison,
      availableStrategies: strategies,
      activeStrategy: settings.recommendations.activeStrategy
    };
  } catch (error) {
    console.error('❌ Error getting deck recommendations:', error);
    console.error('Error stack:', error.stack);
    return { archetype: 'Error', recommendations: [] };
  }
});

async function autoImportTxtCollections(format = 'simple') {
  try {
    const cardsDir = path.join(__dirname, '..', 'cards');
    await fs.mkdir(cardsDir, { recursive: true });
    const files = await fs.readdir(cardsDir);
    const txtFiles = files.filter(file => file.toLowerCase().endsWith('.txt'));

    if (txtFiles.length === 0) {
      console.log('No .txt files found in the cards directory to auto-import.');
      return { success: true, importedFiles: 0, details: [] };
    }

    console.log(`Found ${txtFiles.length} .txt files to auto-import.`);

    const results = [];
    for (const filename of txtFiles) {
      const filePath = path.join(cardsDir, filename);
      const collectionName = path.parse(filename).name;
      console.log(`\u{1F4C1} Auto-importing TXT file: ${filename} as collection "${collectionName}"`);
      // We assume the import should not fail on duplicates and just skip them, so we check first.
      const existingCollection = await collectionImporter.getCollection(collectionName, { limit: 1 });
      if (existingCollection && existingCollection.length > 0) {
        console.log(`Collection "${collectionName}" already exists. Skipping auto-import.`);
        results.push({ filename, collectionName, status: 'skipped', reason: 'already exists' });
        continue;
      }
      const result = await collectionImporter.importTXT(filePath, collectionName, format);
      results.push({ filename, collectionName, ...result });
    }
    console.log('Auto-import of TXT collections completed.');
    return { success: true, importedFiles: results.filter(r => r.success).length, details: results };
  } catch (error) {
    console.error('Auto TXT import failed:', error);
    return { success: false, error: error.message };
  }
}

// Semantic Search and Card Lookup
ipcMain.handle('search-cards-semantic', async (event, query, options) => {
  return await bulkDataService.searchCardsSemantic(query, options);
});

ipcMain.handle('get-cards-by-ids', async (event, ids) => {
  return await bulkDataService.getCardsByIds(ids);
});

// General Card Search
ipcMain.handle('search-cards', async (event, searchTerm) => {
  return await bulkDataService.searchCards(searchTerm);
});

// Card Count
ipcMain.handle('get-card-count', async () => {
  return bulkDataService.getCardCount();
});

// Set browsing
ipcMain.handle('list-sets', async () => {
  return await bulkDataService.listSets();
});

ipcMain.handle('get-cards-by-set', async (event, setCode, options) => {
  try {
    const cards = await bulkDataService.getCardsBySet(setCode, options);

    // Ensure all cards are serializable by doing a test JSON serialization
    try {
      const testSerialization = JSON.stringify(cards);
    } catch (serializationError) {
      console.error('Serialization test failed:', serializationError);
      throw new Error('An object could not be cloned.');
    }

    return cards;
  } catch (error) {
    console.error('Error in get-cards-by-set:', error);

    // If it's a serialization error, try to return a simplified version
    if (error.message && (error.message.includes('could not be cloned') || error.message.includes('circular'))) {
      console.warn('Serialization error detected, attempting to return basic card data');
      try {
        const basicCards = await bulkDataService.getCardsBySet(setCode, options);
        // Return only essential properties to avoid serialization issues
        const sanitizedCards = basicCards.map(card => {
          try {
            return {
              id: card.id,
              uuid: card.uuid,
              name: card.name,
              mana_cost: card.mana_cost,
              cmc: card.cmc,
              type_line: card.type_line,
              oracle_text: card.oracle_text,
              power: card.power,
              toughness: card.toughness,
              colors: card.colors,
              color_identity: card.color_identity,
              rarity: card.rarity,
              set: card.set,
              collector_number: card.collector_number,
              image_uris: card.image_uris,
              legalities: card.legalities,
              card_faces: card.card_faces
            };
          } catch (cardError) {
            console.error(`Error sanitizing card ${card.name}:`, cardError);
            return {
              id: card.id || 'unknown',
              name: card.name || 'Unknown Card',
              error: 'Serialization failed'
            };
          }
        });

        // Test serialization of sanitized cards
        JSON.stringify(sanitizedCards);
        return sanitizedCards;
      } catch (fallbackError) {
        console.error('Fallback serialization also failed:', fallbackError);
        return [];
      }
    }

    return [];
  }
});

// File Dialog
ipcMain.handle('show-open-dialog', async (event, options) => {
  const { dialog } = require('electron');
  const result = await dialog.showOpenDialog(options);
  return result;
});

// Helper to ensure Python-built database is present before initializing bulk data service
// COMMENTED OUT: We already have the database file in Database/database.sqlite
/*
const ensurePythonDatabase = () => {
  const localBroadcast = (p) => {
    try {
      const { BrowserWindow } = require('electron');
      BrowserWindow.getAllWindows().forEach((w) => w.webContents.send('task-progress', p));
    } catch {}
  };
  return new Promise((resolve, reject) => {
    try {
      const dataDir = path.join(app.getPath('userData'), 'scryfall-data');
      const dbPath = path.join(dataDir, 'cards.db');

      if (fsSync.existsSync(dbPath)) {
        console.log('📂 SQLite database already present. Skipping Python build step.');
        localBroadcast({ task: 'python-db', state: 'done' });
        return resolve();
      }

      console.log('🛠️  SQLite database not found. Launching Python builder...');

      fsSync.mkdirSync(dataDir, { recursive: true });

      const pythonScript = app.isPackaged
        ? path.join(process.resourcesPath, 'app.asar.unpacked', 'scripts', 'build_card_database.py')
        : path.join(__dirname, '..', 'scripts', 'build_card_database.py');

      const resolvePythonExecutable = () => {
        if (app.isPackaged) {
          const portableDir = path.join(process.resourcesPath, 'python-3.8.9-embed-amd64');
          if (process.platform === 'win32') {
            const exePath = path.join(portableDir, 'python.exe');
            console.log(`Checking for Python at: ${exePath}`);
            if (fsSync.existsSync(exePath)) return exePath;
          } else {
            const exePath = path.join(portableDir, 'bin', 'python3');
            if (fsSync.existsSync(exePath)) return exePath;
          }
        }
        return 'python';
      };

      const pythonExec = resolvePythonExecutable();

      // use python-shell
      const options = {
        mode: 'text',
        pythonPath: pythonExec,
        pythonOptions: ['-u'], // unbuffered
        scriptPath: path.dirname(pythonScript),
        args: [],
        env: { ...process.env, PYTHONIOENCODING: 'utf-8', DESKTOPMTG_DATA_DIR: dataDir },
      };

      const pyshell = new PythonShell(path.basename(pythonScript), options);

      pyshell.on('message', (msg) => {
        console.log(`[PY] ${msg}`);
        localBroadcast({ task: 'python-db', message: msg });
      });

      pyshell.on('stderr', (stderr) => {
        console.error(`[PY STDERR] ${stderr}`);
        localBroadcast({ task: 'python-db', message: stderr, level: 'stderr' });
      });

      pyshell.end((err, code, signal) => {
        if (err) {
          console.error('❌ Python builder error:', err);
          localBroadcast({ task: 'python-db', state: 'fail' });
          reject(err);
        } else if (code !== 0) {
          console.error(`❌ Python builder exited with code ${code}`);
          localBroadcast({ task: 'python-db', state: 'fail' });
          reject(new Error(`Python exited with code ${code}`));
        } else {
          console.log('✅ Python database build completed.');
          localBroadcast({ task: 'python-db', state: 'done' });
          resolve();
        }
      });
    } catch (err) {
      console.error('❌ Error while ensuring Python database:', err);
      localBroadcast({ task: 'python-db', state: 'fail' });
      reject(err);
    }
  });
};
*/

const createWindow = () => {
  console.log('Creating main window...');
  const mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true
    },
  });

  mainWindow.once('ready-to-show', () => {
    console.log('Window ready to show');
    log.info('Window ready to show');
    mainWindow.show();
  });

  // In development, load the Vite dev server URL.
  // In production, load the built HTML file.
  if (process.env.NODE_ENV === 'development') {
    mainWindow.loadURL('http://localhost:5173');
    // Open the DevTools.
    mainWindow.webContents.openDevTools();
  } else {
    // Fix: The dist folder should be in the extraResource, not inside app directory
    const indexPath = app.isPackaged
      ? path.join(process.resourcesPath, 'dist', 'index.html')
      : path.join(__dirname, '..', 'dist', 'index.html');

    console.log('Loading index.html from:', indexPath);
    log.info('Loading index.html from:', indexPath);

    // Check if file exists before trying to load it
    if (fsSync.existsSync(indexPath)) {
      mainWindow.loadFile(indexPath).catch(err => {
        console.error('Error loading file:', err);
        log.error('Error loading file:', err);
      });
    } else {
      console.error('Index file does not exist at:', indexPath);
      log.error('Index file does not exist at:', indexPath);

      // Try alternative paths for troubleshooting
      const alternatives = [
        path.join(process.resourcesPath, 'app', 'dist', 'index.html'),
        path.join(__dirname, '..', 'dist', 'index.html'),
        path.join(app.getAppPath(), 'dist', 'index.html')
      ];

      for (const altPath of alternatives) {
        if (fsSync.existsSync(altPath)) {
          console.log('Found index.html at alternative path:', altPath);
          log.info('Found index.html at alternative path:', altPath);
          mainWindow.loadFile(altPath).catch(err => {
            console.error('Error loading alternative file:', err);
            log.error('Error loading alternative file:', err);
          });
          return;
        }
      }

      // If no file found, show error
      const { dialog } = require('electron');
      dialog.showErrorBox('File Not Found', `Could not find index.html at expected location: ${indexPath}`);
    }
  }

  return mainWindow;
};

// -----------------------------------------------------------
// Auto-update configuration (uses electron-builder + Squirrel)
// -----------------------------------------------------------

autoUpdater.logger = log;
log.transports.file.level = 'info';

autoUpdater.on('checking-for-update', () => log.info('🔍 Checking for update...'));
autoUpdater.on('update-available', info => log.info('⬇️  Update available:', info.version));
autoUpdater.on('update-not-available', () => log.info('✅ No update available'));
autoUpdater.on('error', err => log.error('🚨 Update error:', err));
autoUpdater.on('download-progress', progress => {
  log.info(`📶 Download speed: ${progress.bytesPerSecond} - Downloaded ${progress.percent.toFixed(1)}%`);
});
autoUpdater.on('update-downloaded', () => {
  log.info('🎉 Update downloaded; will install on quit');
  const { dialog } = require('electron');
  dialog.showMessageBox({
    type: 'info',
    buttons: ['Restart', 'Later'],
    defaultId: 0,
    title: 'Update Available',
    message: 'A new version has been downloaded. Restart the application to apply the update.'
  }).then(result => {
    if (result.response === 0) autoUpdater.quitAndInstall();
  });
});

const broadcast = (payload) => {
  try {
    BrowserWindow.getAllWindows().forEach((win) => win.webContents.send('task-progress', payload));
  } catch (e) { }
};

app.whenReady().then(async () => {
  await createWindow();

  // Initialize settings
  await settingsManager.initialize();

  // 🤖 Load @electron/llm for AI features
  try {
    console.log('🤖 Loading @electron/llm...');
    await loadElectronLlm({
      // Map the model alias used in renderers to the actual GGUF file we
      // ship inside the electron/AI folder. Returning `null` will make
      // @electron/llm fall back to its default logic, so we only override
      // when the file exists.
      getModelPath: (modelAlias) => {
        const resolved = path.resolve(__dirname, 'AI', modelAlias);
        return fsSync.existsSync(resolved) ? resolved : null;
      }
    });
    console.log('✅ @electron/llm loaded successfully');
  } catch (error) {
    console.error('❌ Failed to load @electron/llm:', error);
  }

  // Auto-updater setup
  if (process.env.NODE_ENV === 'production') {
    // Only check for updates if running from a published distribution
    const fs = require('fs');
    const updateConfigPath = path.join(process.resourcesPath, 'app-update.yml');

    if (fs.existsSync(updateConfigPath)) {
      log.info('🔄 Starting update check...');
      autoUpdater.checkForUpdatesAndNotify();
    } else {
      log.info('ℹ️  Update config not found, skipping update check (development/local build)');
    }
  }

  // ---------------------------------------------------------------
  // STEP 1: Make sure the SQLite database is built via Python first
  // ---------------------------------------------------------------
  // COMMENTED OUT: We already have the database file in Database/database.sqlite
  // broadcast({ task: 'python-db', state: 'start' });
  // try {
  //   await ensurePythonDatabase();
  //   broadcast({ task: 'python-db', state: 'done' });
  // } catch (err) {
  //   broadcast({ task: 'python-db', state: 'fail' });
  //   // Re-throw to be caught by the outer block
  //   throw err;
  // }

  // Initialize bulk data service
  if (process.env.SKIP_BULK_DATA !== 'true') {
    console.log('Initializing bulk data service...');
    await bulkDataService.initialize();
    console.log('Bulk data service initialized successfully.');
  } else {
    console.log('Skipping bulk data initialization (SKIP_BULK_DATA=true)');
  }

  // Initialize semantic search service during startup
  console.log('Initializing semantic search service...');
  try {
    await bulkDataService.ensureSemanticSearchInitialized();
    console.log('Semantic search service initialized successfully.');
  } catch (error) {
    console.error('Semantic search initialization failed:', error);
    // Continue without semantic search - don't fail the entire app
  }

  // Initialize collection importer
  console.log('Initializing collection importer...');
  await collectionImporter.initialize();

  // Connect bulk data service to collection importer for card lookups
  collectionImporter.bulkDataService = bulkDataService;

  console.log('Collection importer initialized successfully.');

  // Auto-import text file collections (DISABLED to prevent undefined name errors)
  // console.log('Starting auto-import of .txt collections...');
  // await autoImportTxtCollections();
  // console.log('Auto-import finished.');

  console.log('All initializations complete.');
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

// Test semantic search functionality
ipcMain.handle('test-semantic-search', async (event, query = 'lightning bolt') => {
  console.log('🧪 Testing semantic search with query:', query);

  try {
    // Check if semantic search is initialized
    const initialized = await bulkDataService.ensureSemanticSearchInitialized();
    console.log('Semantic search initialized:', initialized);

    if (!initialized) {
      return { error: 'Semantic search not initialized', results: [] };
    }

    // Perform a simple search
    const results = await bulkDataService.searchCardsSemantic(query, { limit: 10 });
    console.log('Test search results:', results.length);

    if (results.length > 0) {
      console.log('Sample results:', results.slice(0, 3).map(r => ({
        name: r.name,
        distance: r._distance || r.distance,
        type: r.type_line || r.type
      })));
    }

    return { results, count: results.length };
  } catch (error) {
    console.error('❌ Test semantic search error:', error);
    return { error: error.message, results: [] };
  }
});

// Debug path resolution
ipcMain.handle('debug-semantic-paths', async () => {
  console.log('🔍 Debugging semantic search paths...');

  try {
    const { resolveVectorDbPath } = require('./vectordbResolver.cjs');
    const { resolveCachePath } = require('./cacheResolver.cjs');

    const vectorDbPath = await resolveVectorDbPath();
    const cachePath = await resolveCachePath();

    console.log('Vector DB path:', vectorDbPath);
    console.log('Cache path:', cachePath);

    const fs = require('fs');
    const vectorDbExists = fs.existsSync(vectorDbPath);
    const cacheExists = fs.existsSync(cachePath);

    console.log('Vector DB exists:', vectorDbExists);
    console.log('Cache exists:', cacheExists);

    let vectorDbContents = [];
    if (vectorDbExists) {
      try {
        vectorDbContents = fs.readdirSync(vectorDbPath);
        console.log('Vector DB contents:', vectorDbContents);
      } catch (error) {
        console.error('Error reading vector DB contents:', error);
      }
    }

    return {
      vectorDbPath,
      cachePath,
      vectorDbExists,
      cacheExists,
      vectorDbContents
    };
  } catch (error) {
    console.error('❌ Debug paths error:', error);
    return { error: error.message };
  }
});

// Debug worker initialization
ipcMain.handle('debug-worker-init', async () => {
  console.log('🔍 Debugging worker initialization...');

  try {
    const semanticSearchService = require('./semanticSearch.cjs');

    // Try to initialize the service
    await semanticSearchService.initialize();

    return {
      initialized: true,
      message: 'Worker initialized successfully'
    };
  } catch (error) {
    console.error('❌ Worker initialization error:', error);
    return {
      initialized: false,
      error: error.message,
      stack: error.stack
    };
  }
});

// Rules Engine IPC Handlers
// =================================================================

// Check card legality in format
ipcMain.handle('rules-check-card-legal', (event, card, format) => {
  return rulesEngine.isCardLegal(card, format);
});

// Validate deck construction
ipcMain.handle('rules-validate-deck', (event, deck, format) => {
  return rulesEngine.validateDeck(deck, format);
});

// Get format information
ipcMain.handle('rules-get-format-info', (event, format) => {
  return rulesEngine.getFormatInfo(format);
});

// Get all supported formats
ipcMain.handle('rules-get-supported-formats', () => {
  return rulesEngine.getSupportedFormats();
});

// Get deck building suggestions
ipcMain.handle('rules-get-deck-suggestions', (event, deck, format) => {
  return rulesEngine.getDeckBuildingSuggestions(deck, format);
});

// Update banned/restricted lists
ipcMain.handle('rules-update-banned-list', (event, format, cardName, action) => {
  return rulesEngine.updateBannedList(format, cardName, action);
});

// Get color identity for cards
ipcMain.handle('rules-get-color-identity', (event, cards) => {
  const identity = rulesEngine.getColorIdentity(cards);
  return Array.from(identity);
});

// Check if cards are within color identity
ipcMain.handle('rules-check-color-identity', (event, cardColors, commanderIdentity) => {
  const cardColorSet = new Set(cardColors);
  const commanderColorSet = new Set(commanderIdentity);
  return rulesEngine.isWithinColorIdentity(cardColorSet, commanderColorSet);
});

// Check if card has keyword
ipcMain.handle('rules-check-keyword', (event, card, keyword) => {
  return rulesEngine.hasKeyword(card, keyword);
});

// Check if card is basic land
ipcMain.handle('rules-is-basic-land', (event, cardName) => {
  return rulesEngine.isBasicLand(cardName);
});

// Analyze mana curve
ipcMain.handle('rules-analyze-mana-curve', (event, cards) => {
  return rulesEngine.analyzeManaCarve(cards);
});

// Analyze color balance
ipcMain.handle('rules-analyze-color-balance', (event, cards) => {
  return rulesEngine.analyzeColorBalance(cards);
});



// 🤖 LLM availability check
// Note: @electron/llm automatically injects window.electronAi into renderer
// These handlers are kept for backwards compatibility but could be removed
ipcMain.handle('llm-initialize', async () => {
  // @electron/llm is already loaded in app.ready
  return { success: true };
});

// Simple handler to check if LLM is available
ipcMain.handle('llm-check-availability', async () => {
  return {
    success: true,
    available: true,
    modelPath: path.join(__dirname, 'AI', 'Meta-Llama-3-8B-Instruct.Q4_K_M.gguf')
  };
});

app.on('before-quit', async () => {
  // Clean up resources
  // Note: @electron/llm cleanup is handled automatically
  console.log('🔄 App shutting down...');
}); 