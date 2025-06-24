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

// File Operations
ipcMain.handle('get-card-files', async () => {
  try {
    const cardsDir = path.join(__dirname, '..', 'cards');
    const files = await fs.readdir(cardsDir);
    // Filter for .txt files only
    return files.filter(file => file.endsWith('.txt'));
  } catch (error) {
    console.error('Error reading cards directory:', error);
    return [];
  }
});

ipcMain.handle('read-card-file', async (event, filename) => {
  try {
    const cardsDir = path.join(__dirname, '..', 'cards');
    const filePath = path.join(cardsDir, filename);

    // Security check: ensure the file is in the cards directory
    if (!filePath.startsWith(cardsDir)) {
      throw new Error('Invalid file path');
    }

    const content = await fs.readFile(filePath, 'utf-8');
    return { filename, content };
  } catch (error) {
    console.error('Error reading card file:', error);
    throw error;
  }
});

// Bulk Data Operations
ipcMain.handle('bulk-data-search', (event, searchParams, options) => {
  return bulkDataService.searchCards(searchParams, options);
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
    console.log('🎯 Using getCollectedCards helper');
    const cards = await bulkDataService.getCollectedCards(options);
    console.log(`📚 Found ${cards.length} collected cards from helper`);
    return cards;
  } catch (error) {
    console.error('Error in simple collection get:', error);
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

// Helper function to analyze the deck and create a rich search query
const analyzeDeckForQuery = (deck, formatName) => {
  if (!deck || !deck.mainboard || deck.mainboard.length === 0) {
    return `Suggest cards for a ${formatName} deck.`;
  }

  const allCards = [...deck.mainboard, ...(deck.commanders || [])];
  const cardNames = allCards.map(card => card.name).slice(0, 5);
  const allText = allCards.map(card => `${card.type_line || ''} ${card.oracle_text || ''}`).join(' ');

  const typeCounts = {};
  const keywordCounts = {};

  const commonKeywords = ['flying', 'trample', 'haste', 'lifelink', 'deathtouch', 'first strike', 'vigilance', 'menace', 'draw a card', 'counter target', 'destroy target', 'return target', 'token', 'graveyard'];

  // Extract creature types
  allCards.forEach(card => {
    const types = (card.type_line || '').split(' — ');
    if (types.length > 1) {
      types[1].split(' ').forEach(type => {
        if (type.length > 2) {
          typeCounts[type] = (typeCounts[type] || 0) + 1;
        }
      });
    }
  });

  // Extract keywords from oracle text
  commonKeywords.forEach(keyword => {
    const matches = allText.match(new RegExp(keyword, 'gi'));
    if (matches) {
      keywordCounts[keyword] = (keywordCounts[keyword] || 0) + matches.length;
    }
  });

  const topTypes = Object.entries(typeCounts).sort((a, b) => b[1] - a[1]).slice(0, 2).map(e => e[0]);
  const topKeywords = Object.entries(keywordCounts).sort((a, b) => b[1] - a[1]).slice(0, 3).map(e => e[0]);

  let query = `Suggest cards for a deck.`;
  if (topTypes.length > 0) query += ` The deck focuses on ${topTypes.join(' and ')} creatures.`;
  if (topKeywords.length > 0) query += ` Key abilities include ${topKeywords.join(', ')}.`;
  query += ` It includes cards like: ${cardNames.join(', ')}.`

  return query;
}

// Deck Recommendations
ipcMain.handle('get-deck-recommendations', async (event, { deck, formatName }) => {
  if (!deck || !deck.mainboard || deck.mainboard.length === 0) {
    return { archetype: 'Unknown', recommendations: [] };
  }

  // 1. Determine the commander's color identity for filtering
  const commanderColorIdentity = new Set();
  if (formatName === 'commander' && deck.commanders && deck.commanders.length > 0) {
    deck.commanders.forEach(c => {
      (c.color_identity || []).forEach(color => commanderColorIdentity.add(color));
    });
  }

  // 2. Create a set of existing card names to avoid recommending duplicates
  const existingCardNames = new Set(deck.mainboard.map(card => card.name));
  (deck.commanders || []).forEach(c => existingCardNames.add(c.name));

  // 3. Generate a rich, descriptive query from the deck's contents
  const query = analyzeDeckForQuery(deck, formatName);

  try {
    // 4. Fetch a larger pool of potential recommendations
    const partialResults = await bulkDataService.searchCardsSemantic(query, { limit: 100 });

    // 5. Filter the results on the backend for relevance and validity
    const filteredResults = partialResults.filter(card => {
      const isCommanderFormat = formatName === 'commander';
      const cardIsInIdentity = !isCommanderFormat || isCardInColorIdentity(card, commanderColorIdentity);
      const cardIsNotInDeck = !existingCardNames.has(card.name);
      return cardIsInIdentity && cardIsNotInDeck;
    });

    const uniqueRecommendationNames = [...new Set(filteredResults.map(card => card.name))];

    if (uniqueRecommendationNames.length === 0) {
      return { archetype: 'Recommendation Engine v2', recommendations: [] };
    }

    // 6. Get full card data for the final, filtered list
    const recommendationPromises = uniqueRecommendationNames
      .slice(0, 20) // Limit to the top 20 final recommendations
      .map(name => bulkDataService.findCardByName(name));

    const recommendations = (await Promise.all(recommendationPromises)).filter(Boolean);

    const archetype = 'Recommendation Engine v2';

    return { archetype, recommendations };
  } catch (error) {
    console.error('Error getting deck recommendations:', error);
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
  } catch (e) {}
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