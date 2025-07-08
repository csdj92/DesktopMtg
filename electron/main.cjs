const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs').promises;
const fsSync = require('fs');
const bulkDataService = require('./bulkDataService.cjs');
const collectionImporter = require('./collectionImporter.cjs');
const { spawnSync } = require('child_process');
const { autoUpdater } = require('electron-updater');
const log = require('electron-log');
// const { PythonShell } = require('python-shell'); // COMMENTED OUT: No longer using Python builder

// Configure app paths before ready event to avoid cache permission issues
const userDataPath = path.join(require('os').homedir(), 'AppData', 'Local', 'DesktopMTG');
app.setPath('userData', userDataPath);
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

ipcMain.handle('collection-get-ruling', async (event, cardId) => {
  return await bulkDataService.getCardRuling(cardId);
});

ipcMain.handle('collection-delete', (event, collectionName) => {
  return collectionImporter.deleteCollection(collectionName);
});

ipcMain.handle('collection-add-card', async (event, collectionName, cardData) => {
  return collectionImporter.addCard(collectionName, cardData);
});

ipcMain.handle('collection-update-card-quantity', async (event, collectionName, cardKey, newQty) => {
  return collectionImporter.updateCardQuantity(collectionName, cardKey, newQty);
});

ipcMain.handle('collection-delete-card', async (event, collectionName, cardKey) => {
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

/// Helper function to check if a card's colors are within the commander's identity
const isCardInColorIdentity = (card, commanderId) => {
  if (!commanderId || commanderId.size === 0) return true;
  if (!card.color_identity || card.color_identity.length === 0) return true;
  return card.color_identity.every(color => commanderId.has(color));
};

// Helper function to rerank cards based on deck synergy
const rerankCardsByDeckSynergy = (cards, deck, formatName) => {
  if (!cards || cards.length === 0) return [];
  
  const allDeckCards = [...deck.mainboard, ...(deck.commanders || [])];
  const deckText = allDeckCards.map(card => `${card.oracle_text || card.text || ''} ${card.type_line || card.type || ''}`).join(' ').toLowerCase();
  
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
    // Ideal curve percentages (rough guidelines)
    const idealPercentages = { 0: 0.05, 1: 0.15, 2: 0.20, 3: 0.20, 4: 0.15, 5: 0.10, 6: 0.08, '7+': 0.07 };
    const ideal = idealPercentages[cost] || 0.05;
    curveNeeds[cost] = Math.max(0, ideal - percentage); // Higher need = bigger gap
  });
  
  // Score each card
  const scoredCards = cards.map(card => {
    let score = 0;
    const cardText = `${card.oracle_text || card.text || ''} ${card.type_line || card.type || ''}`.toLowerCase();
    const cardCMC = card.manaValue || card.cmc || card.mana_value || 0;
    const cmcKey = cardCMC >= 7 ? '7+' : cardCMC.toString();
    const cardName = (card.name || '').toLowerCase();
    
    // Add deterministic component based on card name for consistent ordering
    const nameHash = cardName.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
    score += (nameHash % 100) / 100; // Small consistent boost (0-1 range)
    
    // Base semantic similarity score (preserve original ranking)
    const semanticScore = card.semantic_score || (1 - (card._distance || card.distance || 0));
    score += semanticScore * 100;
    
    // Theme synergy bonuses (improved calculation)
    Object.entries(deckThemes).forEach(([theme, pattern]) => {
      if (deckThemeScores[theme] > 0) {
        const cardMatches = cardText.match(pattern);
        if (cardMatches) {
          // More sophisticated scoring based on theme prominence
          const themeStrength = Math.min(deckThemeScores[theme] / totalDeckCards, 0.6); // Cap at 60%
          const matchStrength = Math.min(cardMatches.length, 3); // Cap matches to prevent outliers
          score += themeStrength * matchStrength * 150; // Higher multiplier for better separation
        }
      }
    });
    
    // Mana curve filling bonus (improved)
    if (curveNeeds[cmcKey] > 0.05) { // Only bonus if significant gap
      score += curveNeeds[cmcKey] * 80; // Higher bonus for curve needs
    }
    
    // Card type synergy
    const cardTypeLine = card.type_line || card.type || '';
    if (cardTypeLine.toLowerCase().includes('creature')) {
      // Check for tribal synergies
      allDeckCards.forEach(deckCard => {
        const deckCardText = deckCard.oracle_text || deckCard.text || '';
        if (deckCardText.toLowerCase().includes('creature type') || 
            deckCardText.toLowerCase().includes('choose a creature type')) {
          score += 15; // Tribal deck bonus
        }
      });
    }
    
    // Keyword synergy bonuses
    const keywords = ['flying', 'trample', 'haste', 'vigilance', 'lifelink', 'deathtouch', 'first strike', 'double strike'];
    keywords.forEach(keyword => {
      if (cardText.includes(keyword) && deckText.includes(keyword)) {
        score += 10; // Keyword synergy bonus
      }
    });
    
    // Format-specific bonuses
    if (formatName === 'commander') {
      // Commander format prefers singleton effects and high impact
      if (cardText.includes('each opponent') || cardText.includes('each player')) {
        score += 20; // Multiplayer bonus
      }
      if (cardText.includes('legendary') && cardTypeLine.toLowerCase().includes('creature')) {
        score += 10; // Legendary creature bonus
      }
    }
    
    // Utility and staple bonuses
    if (cardText.includes('draw') && cardText.includes('card')) {
      score += 15; // Card draw is always valuable
    }
    if (cardText.includes('destroy') || cardText.includes('exile')) {
      score += 10; // Removal is valuable
    }
    if (cardText.includes('search') && cardText.includes('library')) {
      score += 12; // Tutoring effects
    }
    
    // Round to 2 decimal places for consistency
    const finalScore = Math.round(score * 100) / 100;
    
    return { ...card, synergy_score: finalScore };
  });
  
  // Sort by synergy score (highest first), then by name for consistent tie-breaking
  return scoredCards.sort((a, b) => {
    const scoreDiff = b.synergy_score - a.synergy_score;
    if (Math.abs(scoreDiff) < 0.01) { // Very close scores
      return a.name.localeCompare(b.name); // Alphabetical tie-breaker
    }
    return scoreDiff;
  });
};

// Helper function to calculate keyword-based similarity when semantic search isn't available
const calculateKeywordSimilarity = (card, query) => {
  if (!card || !query) return 0;
  
  const cardText = `${card.name || ''} ${card.type_line || card.type || ''} ${card.oracle_text || card.text || ''} ${card.mana_cost || ''}`.toLowerCase();
  const queryLower = query.toLowerCase();
  
  let score = 0;
  
  // Extract key themes from query and score matches
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
    'white': /white/g,
    'midrange': /midrange/g
  };
  
  // Score based on theme presence
  Object.entries(themes).forEach(([theme, pattern]) => {
    if (queryLower.includes(theme)) {
      const matches = cardText.match(pattern);
      if (matches) {
        score += matches.length * 10; // Base theme match
      }
    }
  });
  
  // Score based on card type relevance
  const cardTypes = ['creature', 'instant', 'sorcery', 'artifact', 'enchantment', 'planeswalker', 'land'];
  cardTypes.forEach(type => {
    if (queryLower.includes(type) && cardText.includes(type)) {
      score += 5;
    }
  });
  
  // Score based on mana cost (prefer cards that fill curve gaps)
  const curveMatches = queryLower.match(/needs more (\d+)/);
  if (curveMatches) {
    const neededCost = parseInt(curveMatches[1]);
    const cardCost = card.manaValue || card.cmc || card.mana_value || 0;
    if (Math.abs(cardCost - neededCost) <= 1) {
      score += 15; // Bonus for filling curve gaps
    }
  }
  
  // Score based on keyword abilities mentioned in query
  const keywords = ['flying', 'vigilance', 'lifelink', 'first strike', 'double strike', 'trample', 'haste', 'deathtouch', 'menace', 'reach'];
  keywords.forEach(keyword => {
    if (queryLower.includes(keyword) && cardText.includes(keyword)) {
      score += 8;
    }
  });
  
  // Normalize score to 0-1 range similar to semantic search
  return Math.min(score / 100, 1);
};

// Helper function to extract key strategic insights from the deck analysis query
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

// Helper function to analyze the deck and create a rich search query
const analyzeDeckForQuery = (deck, formatName) => {
  if (!deck || !deck.mainboard || deck.mainboard.length === 0) {
    return `Suggest cards for a ${formatName} deck.`;
  }

  const allCards = [...deck.mainboard, ...(deck.commanders || [])];
  
  // Analyze deck composition
  const cardTypes = { creature: 0, instant: 0, sorcery: 0, enchantment: 0, artifact: 0, land: 0, planeswalker: 0 };
  const manaCurve = { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0, '7+': 0 };
  const colors = new Set();
  const themes = new Map();
  const keywords = new Map();
  const tribes = new Map();
  
  // Common MTG themes and synergies
  const themePatterns = {
    'graveyard': /graveyard|flashback|unearth|dredge|delve|escape|disturb/i,
    'counters': /\+1\/\+1|counter|proliferate|evolve|adapt|monstrosity/i,
    'tokens': /token|populate|convoke|create.*creature/i,
    'artifacts': /artifact|metalcraft|affinity|improvise/i,
    'spells': /instant|sorcery|storm|prowess|magecraft/i,
    'lifegain': /gain.*life|lifegain|lifelink/i,
    'sacrifice': /sacrifice|devour|exploit|emerge/i,
    'card_draw': /draw.*card|card.*draw/i,
    'ramp': /search.*land|ramp|mana.*dork/i,
    'control': /counter.*spell|destroy.*target|exile.*target/i,
    'aggro': /haste|first strike|double strike|menace/i,
    'combo': /tutor|search.*library|infinite|combo/i
  };

  allCards.forEach(card => {
    // Analyze card types
    const typeLine = (card.type_line || card.type || '').toLowerCase();
    Object.keys(cardTypes).forEach(type => {
      if (typeLine.includes(type)) cardTypes[type]++;
    });

    // Analyze mana curve
    const cmc = card.manaValue || card.cmc || card.mana_value || 0;
    if (cmc >= 7) manaCurve['7+']++;
    else manaCurve[cmc]++;

    // Analyze colors
    (card.color_identity || card.colors || []).forEach(color => colors.add(color));

    // Analyze themes
    const cardText = `${card.oracle_text || card.text || ''} ${typeLine}`;
    Object.entries(themePatterns).forEach(([theme, pattern]) => {
      if (pattern.test(cardText)) {
        themes.set(theme, (themes.get(theme) || 0) + 1);
      }
    });

    // Extract creature types for tribal themes
    if (typeLine.includes('creature')) {
      const typeMatch = typeLine.match(/creature\s+—\s+(.+)/);
      if (typeMatch) {
        typeMatch[1].split(' ').forEach(tribe => {
          if (tribe.length > 2) {
            tribes.set(tribe, (tribes.get(tribe) || 0) + 1);
          }
        });
      }
    }

    // Extract keywords
    const keywordPattern = /\b(flying|trample|haste|vigilance|lifelink|deathtouch|first strike|double strike|menace|reach|hexproof|indestructible|flash|defender)\b/gi;
    const keywordMatches = cardText.match(keywordPattern) || [];
    keywordMatches.forEach(keyword => {
      keywords.set(keyword.toLowerCase(), (keywords.get(keyword.toLowerCase()) || 0) + 1);
    });
  });

  // Determine deck archetype
  const totalCards = allCards.length;
  const creatureRatio = cardTypes.creature / totalCards;
  const instantSorceryRatio = (cardTypes.instant + cardTypes.sorcery) / totalCards;
  const lowCMC = (manaCurve[0] + manaCurve[1] + manaCurve[2]) / totalCards;
  
  let archetype = 'midrange';
  if (creatureRatio > 0.6 && lowCMC > 0.5) archetype = 'aggro';
  else if (instantSorceryRatio > 0.4) archetype = 'control';
  else if (themes.has('combo') && themes.get('combo') > 2) archetype = 'combo';

  // Get top themes
  const topThemes = [...themes.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([theme, count]) => ({ theme, count }));

  // Get top tribes
  const topTribes = [...tribes.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 2)
    .filter(([tribe, count]) => count >= 3)
    .map(([tribe]) => tribe);

  // Get top keywords
  const topKeywords = [...keywords.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([keyword]) => keyword);

  // Find mana curve gaps
  const curveGaps = [];
  Object.entries(manaCurve).forEach(([cost, count]) => {
    if (count === 0 && cost !== '7+' && parseInt(cost) <= 4) {
      curveGaps.push(cost);
    }
  });

  // Build sophisticated query
  let query = `Suggest cards for a ${formatName} ${archetype} deck`;
  
  // Add commander context
  if (formatName === 'commander' && deck.commanders && deck.commanders.length > 0) {
    const commanderNames = deck.commanders.map(c => c.name).join(' and ');
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
    query += `. The deck focuses on ${topTribes.join(' and ')} tribal synergies`;
  }

  // Add primary themes
  if (topThemes.length > 0) {
    const themeDescriptions = topThemes.map(({ theme, count }) => {
      const percentage = Math.round((count / totalCards) * 100);
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
  const keyCards = allCards
    .filter(card => {
      // Prioritize cards that represent the deck's strategy
      const cardText = (card.oracle_text || card.text || '').toLowerCase();
      return topThemes.some(({ theme }) => themePatterns[theme]?.test(cardText));
    })
    .slice(0, 3)
    .map(card => card.name);

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
}

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

  // 3. Generate a rich, descriptive query from the deck's contents
  const query = analyzeDeckForQuery(deck, formatName);

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

    // 5. Filter owned cards by commander color identity and exclude cards already in deck
    console.log('🎯 Pre-filtering owned cards...');
    const eligibleCards = ownedCards.filter(card => {
      const isCommanderFormat = formatName === 'commander';
      const cardIsInIdentity = !isCommanderFormat || isCardInColorIdentity(card, commanderColorIdentity);
      const cardIsNotInDeck = !existingCardNames.has(card.name);
      
      return cardIsInIdentity && cardIsNotInDeck;
    });
    console.log('Eligible owned cards:', eligibleCards.length);

    if (eligibleCards.length === 0) {
      console.log('❌ No eligible owned cards after filtering');
      return { archetype: 'No Eligible Cards', recommendations: [] };
    }

    // 6. Create a text corpus from eligible cards for semantic search
    console.log('🔍 Creating search corpus from owned cards...');
    const cardTexts = eligibleCards.map(card => {
      const name = card.name || '';
      const type = card.type_line || card.type || '';
      const text = card.oracle_text || card.text || '';
      const manaCost = card.mana_cost || '';
      return `${name} ${type} ${text} ${manaCost}`.toLowerCase();
    });

    // 7. Check if semantic search is available
    const semanticSearchInitialized = await bulkDataService.ensureSemanticSearchInitialized();
    console.log('Semantic search initialized:', semanticSearchInitialized);

    let scoredCards = [];

    if (semanticSearchInitialized) {
      // 8. Use semantic search to score the eligible cards
      console.log('📡 Performing semantic search on owned cards...');
      
      // We'll use a different approach: search the full database but then map results to owned cards
      const allSemanticResults = await bulkDataService.searchCardsSemantic(query, { limit: 90000 });
      console.log('Full semantic search results:', allSemanticResults.length);

      // Create a map of semantic scores by card name
      const semanticScores = new Map();
      allSemanticResults.forEach(result => {
        const score = 1 - (result._distance || result.distance || 0);
        semanticScores.set(result.name, score);
      });

      // Score eligible cards based on semantic similarity
      scoredCards = eligibleCards.map(card => ({
        ...card,
        semantic_score: semanticScores.get(card.name) || 0
      }));

      // Sort by semantic score (highest first)
      scoredCards.sort((a, b) => b.semantic_score - a.semantic_score);
      
      console.log('Cards with semantic scores:', scoredCards.filter(c => c.semantic_score > 0).length);
    } else {
      console.log('⚠️ Semantic search not available, using keyword-based scoring');
      // Use deterministic keyword-based scoring instead of random
      scoredCards = eligibleCards.map(card => ({
        ...card,
        semantic_score: calculateKeywordSimilarity(card, query)
      }));
      scoredCards.sort((a, b) => b.semantic_score - a.semantic_score);
    }

    // 9. Apply MTG-specific reranking based on deck synergy
    console.log('🎯 Applying MTG-specific reranking...');
    const rerankedResults = rerankCardsByDeckSynergy(scoredCards.slice(0, 200), deck, formatName);
    console.log('Reranked results count:', rerankedResults.length);
    
    if (rerankedResults.length > 0) {
      console.log('Top 3 reranked results:', rerankedResults.slice(0, 3).map(r => ({ 
        name: r.name, 
        synergy_score: r.synergy_score,
        semantic_score: r.semantic_score 
      })));
    }

    // 10. Get final recommendations
    const finalRecommendations = rerankedResults.slice(0, 50);
    console.log('Final recommendations count:', finalRecommendations.length);

    const archetype = 'Collection-Based Recommendations v4';
    console.log('✅ Recommendations complete:', { archetype, count: finalRecommendations.length });

    // Extract key strategic insights from the query
    const deckInsights = extractDeckInsights(query);
    
    return { archetype, recommendations: finalRecommendations, deckAnalysis: deckInsights };
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
  return await bulkDataService.getCardsBySet(setCode, options);
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

app.on('ready', async () => {
  console.log('App is ready. Starting initialization...');

  const mainWindow = createWindow();

  try {
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

    // -------------------------------------------
    // Trigger auto-update after startup activities
    // -------------------------------------------
    if (app.isPackaged && !process.argv.includes('--squirrel-firstrun')) {
      // Delay check a bit so first-run tasks (DB build) don't block
      setTimeout(() => {
        try {
          // Only check for updates if running from a published distribution
          const fs = require('fs');
          const updateConfigPath = path.join(process.resourcesPath, 'app-update.yml');

          if (fs.existsSync(updateConfigPath)) {
            log.info('🔄 Starting update check...');
            autoUpdater.checkForUpdatesAndNotify();
          } else {
            log.info('ℹ️  Update config not found, skipping update check (development/local build)');
          }
        } catch (e) {
          log.error('Failed to start update check:', e);
        }
      }, 30000); // 30 seconds after launch
    }
  } catch (error) {
    console.error('💥 A critical error occurred during application startup:', error);
    log.error('💥 A critical error occurred during application startup:', error);
    const { dialog } = require('electron');
    dialog.showErrorBox(
      'Application Startup Error',
      'A critical error occurred while starting the application. Please check the logs for more details.'
    );
    app.quit();
  }
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