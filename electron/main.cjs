const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs').promises;
const bulkDataService = require('./bulkDataService.cjs');
const collectionImporter = require('./collectionImporter.cjs');
const fsSync = require('fs');
const { spawnSync } = require('child_process');
const { autoUpdater } = require('electron-updater');
const log = require('electron-log');
const { PythonShell } = require('python-shell');

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

ipcMain.handle('collection-get-all', () => {
  return collectionImporter.getCollections();
});

ipcMain.handle('collection-get', (event, collectionName, options) => {
  return collectionImporter.getCollection(collectionName, options);
});

ipcMain.handle('collection-get-stats', (event, collectionName) => {
  return collectionImporter.getCollectionStats(collectionName);
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

ipcMain.handle('collection-get-card-quantity', async (event, cardName, options) => {
  return collectionImporter.getCardTotalQuantity(cardName, options);
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

// Native dialog handlers for collection management
ipcMain.handle('show-collection-name-dialog', async (event, defaultName) => {
  const { BrowserWindow } = require('electron');
  
  // Create a new dialog window for text input
  const parent = BrowserWindow.getFocusedWindow();
  const inputWindow = new BrowserWindow({
    width: 400,
    height: 200,
    modal: true,
    parent: parent,
    show: false,
    resizable: false,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  // Create HTML content for the input dialog
  const htmlContent = `
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        body {
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
          margin: 0;
          padding: 20px;
          background: #f5f5f5;
        }
        .container {
          background: white;
          padding: 20px;
          border-radius: 8px;
          box-shadow: 0 2px 10px rgba(0,0,0,0.1);
        }
        h3 {
          margin: 0 0 15px 0;
          color: #333;
        }
        input {
          width: 100%;
          padding: 8px 12px;
          border: 1px solid #ddd;
          border-radius: 4px;
          font-size: 14px;
          margin-bottom: 15px;
          box-sizing: border-box;
        }
        .buttons {
          display: flex;
          gap: 10px;
          justify-content: flex-end;
        }
        button {
          padding: 8px 16px;
          border: none;
          border-radius: 4px;
          cursor: pointer;
          font-size: 14px;
        }
        .ok-btn {
          background: #007acc;
          color: white;
        }
        .ok-btn:hover {
          background: #005fa3;
        }
        .cancel-btn {
          background: #e0e0e0;
          color: #333;
        }
        .cancel-btn:hover {
          background: #d0d0d0;
        }
      </style>
    </head>
    <body>
      <div class="container">
        <h3>Collection Name</h3>
        <input type="text" id="collectionName" value="${defaultName}" placeholder="Enter collection name...">
        <div class="buttons">
          <button class="cancel-btn" onclick="cancel()">Cancel</button>
          <button class="ok-btn" onclick="confirm()">OK</button>
        </div>
      </div>
      <script>
        const { ipcRenderer } = require('electron');
        
        document.getElementById('collectionName').focus();
        document.getElementById('collectionName').select();
        
        document.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') {
            confirm();
          } else if (e.key === 'Escape') {
            cancel();
          }
        });
        
        function confirm() {
          const name = document.getElementById('collectionName').value.trim();
          if (name) {
            ipcRenderer.send('collection-name-result', { confirmed: true, name });
          } else {
            document.getElementById('collectionName').focus();
          }
        }
        
        function cancel() {
          ipcRenderer.send('collection-name-result', { confirmed: false, name: null });
        }
      </script>
    </body>
    </html>
  `;

  return new Promise((resolve) => {
    // Listen for the result
    const { ipcMain } = require('electron');
    const resultHandler = (event, result) => {
      inputWindow.close();
      ipcMain.removeListener('collection-name-result', resultHandler);
      resolve(result);
    };
    
    ipcMain.on('collection-name-result', resultHandler);
    
    // Handle window close
    inputWindow.on('closed', () => {
      ipcMain.removeListener('collection-name-result', resultHandler);
      resolve({ confirmed: false, name: null });
    });

    // Load the HTML content and show the window
    inputWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(htmlContent)}`);
    inputWindow.once('ready-to-show', () => {
      inputWindow.show();
    });
  });
});

ipcMain.handle('show-format-choice-dialog', async (event) => {
  const { dialog } = require('electron');
  const result = await dialog.showMessageBox({
    type: 'question',
    buttons: ['Simple', 'MTGO', 'Detailed', 'Deckbox', 'Cancel'],
    defaultId: 0,
    title: 'TXT Format',
    message: 'Choose the format of your TXT file:',
    detail: 'Simple: Just card names (one per line)\nMTGO: "4x Lightning Bolt" format\nDetailed: "4 Lightning Bolt (M10) 123 [foil]" format\nDeckbox: "1x Lightning Bolt [M10]" format'
  });
  
  const formats = ['simple', 'mtgo', 'detailed', 'deckbox'];
  if (result.response < 4) {
    return { confirmed: true, format: formats[result.response] };
  } else {
    return { confirmed: false, format: null };
  }
});

// Helper to ensure Python-built database is present before initializing bulk data service
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
          // Fix: Use the actual directory name that exists in the project
          const portableDir = path.join(process.resourcesPath, 'python-3.8.9-embed-amd64');
          if (process.platform === 'win32') {
            const exePath = path.join(portableDir, 'python.exe');
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

const createWindow = () => {
  const mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
    },
  });

  // Add error handling for window loading
  mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL) => {
    log.error('Failed to load page:', errorCode, errorDescription, validatedURL);
    console.error('Failed to load page:', errorCode, errorDescription, validatedURL);
  });

  // In development, load the Vite dev server URL.
  // In production, load the built HTML file.
  if (process.env.NODE_ENV === 'development') {
    mainWindow.loadURL('http://localhost:5173');
    // Open the DevTools.
    mainWindow.webContents.openDevTools();
  } else {
    // Fix: Use proper path resolution for packaged app
    const indexPath = app.isPackaged 
      ? path.join(process.resourcesPath, 'dist', 'index.html')
      : path.join(__dirname, '..', 'dist', 'index.html');
    
    log.info('Loading index.html from:', indexPath);
    console.log('Loading index.html from:', indexPath);
    
    // Check if the file exists before trying to load it
    if (fsSync.existsSync(indexPath)) {
      mainWindow.loadFile(indexPath);
    } else {
      log.error('index.html not found at:', indexPath);
      console.error('index.html not found at:', indexPath);
      // Try fallback path
      const fallbackPath = path.join(__dirname, '..', 'dist', 'index.html');
      if (fsSync.existsSync(fallbackPath)) {
        log.info('Using fallback path:', fallbackPath);
        mainWindow.loadFile(fallbackPath);
      } else {
        log.error('Fallback path also not found:', fallbackPath);
      }
    }
  }

  // No need to set up IPC handlers here - they're already set up above
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
  log.info('App is ready. Starting initialization...');

  try {
    const mainWindow = createWindow();

    // ---------------------------------------------------------------
    // STEP 1: Make sure the SQLite database is built via Python first
    // ---------------------------------------------------------------
    broadcast({ task: 'python-db', state: 'start' });
    try {
      await ensurePythonDatabase();
      broadcast({ task: 'python-db', state: 'done' });
    } catch (err) {
      log.error('Python database initialization failed:', err);
      broadcast({ task: 'python-db', state: 'fail' });
    }

    // Initialize bulk data service
    if (process.env.SKIP_BULK_DATA !== 'true') {
      try {
        console.log('Initializing bulk data service...');
        await bulkDataService.initialize();
        console.log('Bulk data service initialized successfully.');
      } catch (error) {
        console.error('Bulk data initialization failed:', error);
        log.error('Bulk data initialization failed:', error);
        // Decide if the app should continue without it. For now, we'll log and continue.
      }
    } else {
      console.log('Skipping bulk data initialization (SKIP_BULK_DATA=true)');
    }

    // Initialize collection importer
    try {
      console.log('Initializing collection importer...');
      await collectionImporter.initialize();
      console.log('Collection importer initialized successfully.');
    } catch (error) {
      console.error('Collection importer initialization failed:', error);
      log.error('Collection importer initialization failed:', error);
      // This is more critical, maybe we should not proceed. For now, log and continue.
    }

    // Auto-import text file collections
    try {
      console.log('Starting auto-import of .txt collections...');
      await autoImportTxtCollections();
      console.log('Auto-import finished.');
    } catch (error) {
      console.error('Auto-import of collections failed:', error);
      log.error('Auto-import of collections failed:', error);
    }

    console.log('All initializations complete. Creating main window...');
    log.info('All initializations complete.');

    // -------------------------------------------
    // Trigger auto-update after startup activities
    // -------------------------------------------
    if (app.isPackaged && !process.argv.includes('--squirrel-firstrun')) {
      // Delay check a bit so first-run tasks (DB build) don't block
      setTimeout(() => {
        try {
          autoUpdater.checkForUpdatesAndNotify();
        } catch (e) {
          log.error('Failed to start update check:', e);
        }
      }, 30000); // 30 seconds after launch
    }
  } catch (error) {
    console.error('Critical error during app initialization:', error);
    log.error('Critical error during app initialization:', error);
    // Show error dialog
    const { dialog } = require('electron');
    dialog.showErrorBox('Startup Error', `Failed to initialize application: ${error.message}`);
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