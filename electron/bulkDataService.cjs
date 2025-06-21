const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const https = require('https');
const { app } = require('electron');
const sqlite3 = require('sqlite3').verbose();
const { open } = require('sqlite');
const parser = require('stream-json');
const streamValues = require('stream-json/streamers/StreamValues');
const { chain } = require('stream-chain');
const { Worker } = require('worker_threads');

const semanticSearchService = require('./semanticSearch.cjs');

const SCRYFALL_BULK_API = 'https://api.scryfall.com/bulk-data';
const BULK_DATA_DIR = path.join(app.getPath('userData'), 'scryfall-data');
const CARDS_FILE = path.join(BULK_DATA_DIR, 'cards.json');
const DATABASE_FILE = path.join(BULK_DATA_DIR, 'cards.db');
const METADATA_FILE = path.join(BULK_DATA_DIR, 'metadata.json');

// Check every 7 days for updates
const UPDATE_INTERVAL = 7 * 24 * 60 * 60 * 1000; // 7 days in milliseconds

class BulkDataService {
  constructor() {
    this.db = null;
    this.metadata = null;
    this.initialized = false;
    this.cardCount = 0;
  }

  _broadcast(channel, payload) {
    try {
      const { BrowserWindow } = require('electron');
      BrowserWindow.getAllWindows().forEach((win) => {
        win.webContents.send(channel, payload);
      });
    } catch (e) {
      // Ignore if BrowserWindow not ready yet
    }
  }

  async initialize() {
    try {
      console.log('Initializing bulk data service with database...');
      
      // Ensure data directory exists
      await fs.mkdir(BULK_DATA_DIR, { recursive: true });
      
      // Initialize database
      await this.initializeDatabase();
      
      // Ensure collected column exists
      await this.addCollumnCollected();

      // Load metadata
      await this.loadMetadata();

      console.log('Added collected column to database');
      await this.transferCollectedCardsToDatabase();
      console.log(`Transferred collected cards to database${this.getCollectedCardCount()}`);
      
      // Initialize semantic search service
      await semanticSearchService.initialize();
      
      // Check if we need to download or update
      const needsUpdate = await this.shouldUpdate();
      if (needsUpdate) {
        console.log('Downloading bulk data...');
        await this.downloadBulkData();
        await this.importCardsToDatabase();
        await this.loadMetadata();
      }
      
      // Get card count from database
      this.cardCount = await this.getCardCount();
      
      this.initialized = true;
      console.log(`Bulk data initialized with ${this.cardCount} cards in database`);
      
    } catch (error) {
      console.error('Failed to initialize bulk data:', error);
      // Continue without bulk data - app can still work with file reading
    }
  }

  async initializeDatabase() {
    this.db = await open({
      filename: DATABASE_FILE,
      driver: sqlite3.Database
    });

    // Create cards table if it doesn't exist
    await this.db.exec(`
      CREATE TABLE IF NOT EXISTS cards (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        mana_cost TEXT,
        cmc REAL,
        type_line TEXT,
        oracle_text TEXT,
        power TEXT,
        toughness TEXT,
        colors TEXT,
        rarity TEXT,
        set_code TEXT,
        set_name TEXT,
        collector_number TEXT,
        released_at TEXT,
        image_uris TEXT,
        card_faces TEXT,
        data TEXT
      );
      
      CREATE INDEX IF NOT EXISTS idx_name ON cards(name);
      CREATE INDEX IF NOT EXISTS idx_name_lower ON cards(lower(name));
      CREATE INDEX IF NOT EXISTS idx_set ON cards(set_code);
      CREATE INDEX IF NOT EXISTS idx_type ON cards(type_line);
      CREATE INDEX IF NOT EXISTS idx_rarity ON cards(rarity);
      CREATE INDEX IF NOT EXISTS idx_colors ON cards(colors);
    `);

    console.log('Database initialized successfully');
  }

  async markCollected(cardId) {
    await this.db.exec(`
      UPDATE cards SET collected = 1 WHERE id = ?
    `, [cardId]);
  }

  /**
   * Ensure the `collected` column exists. Older databases may not have it and
   * running `ALTER TABLE` repeatedly would crash with a duplicate-column error.
   */
  async addCollumnCollected() {
    try {
      const columns = await this.db.all('PRAGMA table_info(cards)');
      const hasCollected = columns.some((col) => col.name === 'collected');
      if (!hasCollected) {
        await this.db.exec('ALTER TABLE cards ADD COLUMN collected INTEGER DEFAULT 0');
        console.log('Added collected column to database');
      }
    } catch (err) {
      console.error('Failed checking/adding collected column:', err);
    }
  }

  async getCollectedCards() {
    const result = await this.db.all(`
      SELECT * FROM cards WHERE collected >= 1
    `);
    return result;
  }

  async transferCollectedCardsToDatabase() {
    const collectedCards = await this.getCollectedCards();
    for (const card of collectedCards) {
      await this.db.exec(`
        INSERT INTO cards (id, name, mana_cost, cmc, type_line, oracle_text, power, toughness, colors, rarity, set_code, set_name, collector_number, released_at, image_uris, card_faces, data)
      `, [card.id, card.name, card.mana_cost, card.cmc, card.type_line, card.oracle_text, card.power, card.toughness, card.colors, card.rarity, card.set_code, card.set_name, card.collector_number, card.released_at, card.image_uris, card.card_faces, card.data]);
    }
  }

  async loadMetadata() {
    try {
      const metadataExists = await this.fileExists(METADATA_FILE);
      if (metadataExists) {
        const metadataContent = await fs.readFile(METADATA_FILE, 'utf-8');
        this.metadata = JSON.parse(metadataContent);
      }
    } catch (error) {
      console.error('Error loading metadata:', error);
      this.metadata = null;
    }
  }

  async getCardCount() {
    if (!this.db) return 0;
    
    const result = await this.db.get('SELECT COUNT(*) as count FROM cards');
    return result.count;
  }

  async getCollectedCardCount() {
    if (!this.db) return 0;
    
    const result = await this.db.get('SELECT COUNT(*) as count FROM cards WHERE collected >= 1');
    return result.count;
  }

  async shouldUpdate() {
    const cardCount = await this.getCardCount();
    
    // If we have a database with cards, check if it was built with Python
    if (cardCount > 0) {
      try {
        const metadataExists = await this.fileExists(METADATA_FILE);
        if (metadataExists) {
          const metadataContent = await fs.readFile(METADATA_FILE, 'utf-8');
          const metadata = JSON.parse(metadataContent);
          
          // If built with Python, don't update (let Python handle updates)
          if (metadata.built_with && metadata.built_with.includes('Python')) {
            console.log('📦 Database was built with Python builder, skipping Node.js import');
            return false;
          }
        }
      } catch (error) {
        console.error('Error checking metadata:', error);
      }
    }
    
    if (!this.metadata || cardCount === 0) {
      return true; // No local data, need to download
    }

    // Force update if we're switching to all_cards from any other dataset
    if (this.metadata.type !== 'all_cards') {
      console.log(`Detected ${this.metadata.type} dataset, switching to all_cards for complete coverage...`);
      return true;
    }

    // Check if data is older than UPDATE_INTERVAL
    const lastUpdate = new Date(this.metadata.downloaded_at);
    const now = new Date();
    if (now - lastUpdate > UPDATE_INTERVAL) {
      console.log('Local data is older than 7 days, checking for updates...');
      
      try {
        const bulkInfo = await this.getBulkDataInfo();
        const latestUpdate = new Date(bulkInfo.updated_at);
        const localUpdate = new Date(this.metadata.updated_at);
        
        return latestUpdate > localUpdate;
      } catch (error) {
        console.error('Error checking for updates:', error);
        return false; // If we can't check, don't update
      }
    }

    return false;
  }

  async getBulkDataInfo() {
    return new Promise((resolve, reject) => {
      const request = https.get(SCRYFALL_BULK_API, {
        headers: {
          'User-Agent': 'MTGDesktopApp/1.0',
          'Accept': 'application/json'
        }
      }, (response) => {
        let data = '';
        
        response.on('data', (chunk) => {
          data += chunk;
        });
        
        response.on('end', () => {
          try {
            const bulkData = JSON.parse(data);
            // Find the "all_cards" bulk data - this contains every card variant and collector number
            const allCards = bulkData.data.find(item => item.type === 'all_cards');
            if (allCards) {
              resolve(allCards);
            } else {
              reject(new Error('All cards bulk data not found'));
            }
          } catch (error) {
            reject(error);
          }
        });
      });
      
      request.on('error', reject);
      request.setTimeout(10000, () => {
        request.destroy();
        reject(new Error('Request timeout'));
      });
    });
  }

  async downloadBulkData() {
    // Notify renderer we are starting download
    this._broadcast('task-progress', { task: 'download', state: 'start', percent: 0 });

    const bulkInfo = await this.getBulkDataInfo();
    
    // Check if file already exists
    const fileExists = await this.fileExists(CARDS_FILE);
    if (fileExists) {
      console.log('Cards file already exists, skipping download');
      this._broadcast('task-progress', { task: 'download', state: 'done', percent: 100 });
      return;
    }
    
    console.log(`Downloading bulk data: ${bulkInfo.name} (${Math.round(bulkInfo.size / 1024 / 1024)}MB)`);
    
    return new Promise((resolve, reject) => {
      const request = https.get(bulkInfo.download_uri, {
        headers: {
          'User-Agent': 'MTGDesktopApp/1.0'
        }
      }, (response) => {
        if (response.statusCode !== 200) {
          reject(new Error(`HTTP ${response.statusCode}: ${response.statusMessage}`));
          return;
        }
        
        // Stream directly to file instead of concatenating to string
        const writeStream = fsSync.createWriteStream(CARDS_FILE);
        let downloadedBytes = 0;
        const totalBytes = bulkInfo.size;
        
        response.on('data', (chunk) => {
          downloadedBytes += chunk.length;
          
          const percent = Math.round((downloadedBytes / totalBytes) * 100);
          this._broadcast('task-progress', { task: 'download', percent });
          
          // Log progress every 10MB
          if (downloadedBytes % (10 * 1024 * 1024) < chunk.length) {
            console.log(`Download progress: ${percent}%`);
          }
        });
        
        response.on('end', async () => {
          try {
            console.log('Download complete, saved to file');
            
            // Save metadata
            const metadata = {
              ...bulkInfo,
              downloaded_at: new Date().toISOString()
            };
            await fs.writeFile(METADATA_FILE, JSON.stringify(metadata, null, 2));
            
            console.log(`Successfully downloaded and saved bulk data to ${CARDS_FILE}`);
            this._broadcast('task-progress', { task: 'download', state: 'done', percent: 100 });
            resolve();
          } catch (error) {
            this._broadcast('task-progress', { task: 'download', state: 'fail' });
            reject(error);
          }
        });
        
        response.on('error', (error) => {
          writeStream.destroy();
          this._broadcast('task-progress', { task: 'download', state: 'fail' });
          reject(error);
        });
        
        // Pipe the response to the file
        response.pipe(writeStream);
        
        writeStream.on('error', (error) => {
          response.destroy();
          this._broadcast('task-progress', { task: 'download', state: 'fail' });
          reject(error);
        });
        
        writeStream.on('finish', () => {
          console.log('File write completed');
        });
      });
      
      request.on('error', (err) => {
        this._broadcast('task-progress', { task: 'download', state: 'fail' });
        reject(err);
      });
      request.setTimeout(300000, () => { // 5 minute timeout
        request.destroy();
        this._broadcast('task-progress', { task: 'download', state: 'fail' });
        reject(new Error('Download timeout'));
      });
    });
  }

    async importCardsToDatabase() {
    this._broadcast('task-progress', { task: 'import', state: 'start' });
    console.log('Importing cards to database...');
    
    // Option to use worker thread for memory isolation
    const useWorkerThread = process.env.USE_WORKER_THREAD !== 'false'; // Changed to use worker by default
    
    if (useWorkerThread) {
      return this.importCardsWithWorker();
    }
    
    // Clear existing data first
    await this.db.exec('DELETE FROM cards');
    
    return new Promise((resolve, reject) => {
      const { Writable } = require('stream');
      const { pipeline } = require('stream');
      
      let cardCount = 0;
      let batch = [];
      const BATCH_SIZE = 5; // Ultra-small batches for maximum memory efficiency
      
      // Create a processing stream with proper backpressure handling
      const processingStream = new Writable({
        objectMode: true,
        highWaterMark: 1, // Reduce internal buffer to minimize memory usage
        write(chunk, encoding, callback) {
          // Add card to batch
          batch.push(chunk.value);
          
          // Process batch when it reaches BATCH_SIZE
          if (batch.length >= BATCH_SIZE) {
            this.processBatch(batch.slice())
              .then(() => {
                cardCount += batch.length;
                if (cardCount % 1000 === 0) {
                  this._broadcast('task-progress', { task: 'import', count: cardCount });
                }
                
                // Enhanced memory monitoring
                const memUsage = process.memoryUsage();
                const memoryMB = Math.round(memUsage.heapUsed / 1024 / 1024);
                const memoryTotalMB = Math.round(memUsage.heapTotal / 1024 / 1024);
                
                console.log(`Imported ${cardCount} cards... Memory: ${memoryMB}MB/${memoryTotalMB}MB (RSS: ${Math.round(memUsage.rss / 1024 / 1024)}MB)`);
                
                // Memory leak detection - warn if memory usage is growing too fast
                if (cardCount > 0 && memoryMB > (cardCount / 1000) * 100) {
                  console.warn(`⚠️ Potential memory leak detected. Memory usage (${memoryMB}MB) seems high for ${cardCount} cards processed.`);
                }
                
                batch = []; // Clear the batch to free memory
                
                // Force garbage collection every 1000 cards if available
                if (cardCount % 1000 === 0 && global.gc) {
                  global.gc();
                  console.log(`🧹 Garbage collection triggered at ${cardCount} cards`);
                }
                
                // Use setImmediate to yield control back to event loop
                setImmediate(() => {
                  callback(); // Signal ready for next chunk
                });
              })
              .catch(callback); // Pass error to callback
          } else {
            callback(); // Ready for next chunk
          }
        },
        
        final(callback) {
          // Process remaining cards in batch
          if (batch.length > 0) {
            this.processBatch(batch)
              .then(() => {
                cardCount += batch.length;
                this._broadcast('task-progress', { task: 'import', state: 'done', count: cardCount });
                callback();
              })
              .catch(callback);
          } else {
            callback();
          }
        }
      });
      
      // Bind the processBatch method to the stream context
      processingStream.processBatch = async (cards) => {
        if (cards.length === 0) return;
        
        try {
          await this.db.exec('BEGIN TRANSACTION');
          
          const stmt = await this.db.prepare(`
            INSERT OR REPLACE INTO cards 
            (id, name, mana_cost, cmc, type_line, oracle_text, power, toughness, colors, rarity, set_code, set_name, collector_number, released_at, image_uris, card_faces, data)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `);

          for (const card of cards) {
            await stmt.run([
              card.id,
              card.name,
              card.mana_cost || '',
              card.cmc || 0,
              card.type_line || '',
              card.oracle_text || '',
              card.power || '',
              card.toughness || '',
              JSON.stringify(card.colors || []),
              card.rarity || '',
              card.set || '',
              card.set_name || '',
              card.collector_number || '',
              card.released_at || '',
              JSON.stringify(card.image_uris || {}),
              JSON.stringify(card.card_faces || []),
              JSON.stringify(card)
            ]);
            
            // Nullify card reference to help GC
            card = null;
          }

          await stmt.finalize();
          await this.db.exec('COMMIT');
          
          // Clear cards array to help garbage collection
          cards.length = 0;
          
        } catch (error) {
          console.error('Error processing batch:', error);
          await this.db.exec('ROLLBACK');
          throw error;
        }
      };
      
      // Bind the method to the correct context
      processingStream.processBatch = processingStream.processBatch.bind(this);
      
      // Use pipeline for proper error handling and automatic backpressure
      pipeline(
        fsSync.createReadStream(CARDS_FILE),
        parser(),
        new streamValues(),
        processingStream,
        async (error) => {
          if (error) {
            console.error('Pipeline error:', error);
            reject(error);
          } else {
            console.log(`Finished importing ${cardCount} cards to database`);
            
            try {
              // Update metadata with card count
              if (this.metadata) {
                this.metadata.card_count = cardCount;
                await fs.writeFile(METADATA_FILE, JSON.stringify(this.metadata, null, 2));
              }
              
              resolve();
            } catch (metadataError) {
              console.error('Error updating metadata:', metadataError);
              reject(metadataError);
            }
          }
        }
      );
    });
  }

  async importCardsWithWorker() {
    console.log('🧵 Using worker thread for memory-isolated import...');
    
    return new Promise((resolve, reject) => {
      const workerPath = path.join(__dirname, 'importWorker.cjs');
      const worker = new Worker(workerPath, {
        workerData: {
          databaseFile: DATABASE_FILE,
          cardsFile: CARDS_FILE
        }
      });

      let startTime = Date.now();

      worker.on('message', (message) => {
        switch (message.type) {
          case 'memory_update':
            console.log(`📊 Worker Memory: ${message.memory.heapUsed}MB/${message.memory.heapTotal}MB (RSS: ${message.memory.rss}MB) | Cards: ${message.cardCount}`);
            
            // Memory leak detection
            if (message.cardCount > 0 && message.memory.heapUsed > (message.cardCount / 1000) * 50) {
              console.warn(`⚠️ Worker memory usage seems high: ${message.memory.heapUsed}MB for ${message.cardCount} cards`);
            }
            break;
            
          case 'progress':
            console.log(`🚀 Progress: ${message.cardCount} cards imported (${message.rate})`);
            break;
            
          case 'gc_triggered':
            console.log(`🧹 Worker GC triggered at ${message.cardCount} cards`);
            break;
            
          case 'completed':
            const elapsed = Date.now() - startTime;
            console.log(`✅ Worker completed: ${message.cardCount} cards in ${Math.round(elapsed / 1000)}s`);
            break;
            
          case 'error':
            console.error('❌ Worker error:', message.error);
            break;
            
          case 'success':
            console.log(`🎉 Import successful! ${message.cardCount} cards imported`);
            this.updateMetadataAfterImport(message.cardCount)
              .then(() => resolve())
              .catch(reject);
            break;
        }
      });

      worker.on('error', (error) => {
        console.error('Worker thread error:', error);
        reject(error);
      });

      worker.on('exit', (code) => {
        if (code !== 0) {
          reject(new Error(`Worker stopped with exit code ${code}`));
        }
      });
    });
  }

  async updateMetadataAfterImport(cardCount) {
    if (this.metadata) {
      this.metadata.card_count = cardCount;
      await fs.writeFile(METADATA_FILE, JSON.stringify(this.metadata, null, 2));
    }
  }

  async fileExists(filePath) {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  // Search methods
  async searchCards(searchParams, options = {}) {
    if (!this.db || !this.initialized) {
      return [];
    }

    // Handle backward compatibility with old query string format
    if (typeof searchParams === 'string') {
      searchParams = { name: searchParams };
    }

    const { name, text, type, colors, manaCost, power, toughness, rarity } = searchParams;
    const { limit = 50 } = options;

    let query = 'SELECT data FROM cards WHERE 1=1';
    const params = [];

    // Name search (case-insensitive)
    if (name) {
      query += ' AND lower(name) LIKE lower(?)';
      params.push(`%${name}%`);
    }

    // Oracle text search (case-insensitive)
    if (text) {
      query += ' AND lower(oracle_text) LIKE lower(?)';
      params.push(`%${text}%`);
    }

    // Type line search (case-insensitive)
    if (type) {
      query += ' AND lower(type_line) LIKE lower(?)';
      params.push(`%${type}%`);
    }

    // Colors (check if colors JSON contains the required colors)
    if (colors && colors.length > 0) {
      for (const color of colors) {
        query += ' AND colors LIKE ?';
        params.push(`%"${color}"%`);
      }
    }

    // Mana cost (exact match, but flexible about brackets)
    if (manaCost) {
      const formattedManaCost = manaCost.replace(/\{/g, '').replace(/\}/g, '');
      query += ' AND replace(replace(mana_cost, "{", ""), "}", "") = ?';
      params.push(formattedManaCost);
    }

    // Power
    if (power) {
      query += ' AND power = ?';
      params.push(power);
    }

    // Toughness
    if (toughness) {
      query += ' AND toughness = ?';
      params.push(toughness);
    }

    // Rarity (exact match, case-insensitive)
    if (rarity) {
      query += ' AND lower(rarity) = lower(?)';
      params.push(rarity);
    }

    // Add ordering and limit - prioritize English cards
    if (name) {
      // Sort by relevance (exact name matches first), then prioritize English language
      query += ' ORDER BY CASE WHEN lower(name) = lower(?) THEN 0 ELSE 1 END, CASE WHEN JSON_EXTRACT(data, "$.lang") = "en" OR JSON_EXTRACT(data, "$.lang") IS NULL THEN 0 ELSE 1 END, name';
      params.push(name);
    } else {
      // Prioritize English cards, then sort by name
      query += ' ORDER BY CASE WHEN JSON_EXTRACT(data, "$.lang") = "en" OR JSON_EXTRACT(data, "$.lang") IS NULL THEN 0 ELSE 1 END, name';
    }
    
    query += ` LIMIT ${limit}`;

    try {
      const rows = await this.db.all(query, params);
      return rows.map(row => {
        const cardData = JSON.parse(row.data);
        // Ensure we're returning English cards when possible
        if (cardData.lang && cardData.lang !== 'en') {
          console.log(`Non-English card found: ${cardData.name} (${cardData.lang})`);
        }
        return cardData;
      });
    } catch (error) {
      console.error('Error searching cards:', error);
      return [];
    }
  }

  async findCardByName(name) {
    if (!this.db || !this.initialized) {
      return null;
    }

    try {
      // First try exact match with English preference
      const exactMatch = await this.db.get(
        'SELECT data FROM cards WHERE lower(name) = lower(?) ORDER BY CASE WHEN JSON_EXTRACT(data, "$.lang") = "en" OR JSON_EXTRACT(data, "$.lang") IS NULL THEN 0 ELSE 1 END LIMIT 1',
        [name]
      );
      
      if (exactMatch) {
        return JSON.parse(exactMatch.data);
      }

      // Fuzzy match with English preference
      const fuzzyMatch = await this.db.get(
        'SELECT data FROM cards WHERE lower(name) LIKE lower(?) ORDER BY CASE WHEN JSON_EXTRACT(data, "$.lang") = "en" OR JSON_EXTRACT(data, "$.lang") IS NULL THEN 0 ELSE 1 END LIMIT 1',
        [`%${name}%`]
      );

      return fuzzyMatch ? JSON.parse(fuzzyMatch.data) : null;
    } catch (error) {
      console.error('Error finding card by name:', error);
      return null;
    }
  }

  // New function to find cards by name, set, and collector number for precise artwork matching
  async findCardByDetails(name, setCode, collectorNumber) {
    if (!this.db || !this.initialized) {
      return null;
    }

    try {
      // First try exact match with all details, preferring English
      const exactMatch = await this.db.get(
        'SELECT data FROM cards WHERE lower(name) = lower(?) AND lower(set_code) = lower(?) AND collector_number = ? ORDER BY CASE WHEN JSON_EXTRACT(data, "$.lang") = "en" OR JSON_EXTRACT(data, "$.lang") IS NULL THEN 0 ELSE 1 END LIMIT 1',
        [name, setCode, collectorNumber]
      );
      
      if (exactMatch) {
        const cardData = JSON.parse(exactMatch.data);
        console.log(`Found exact match for ${name} (${setCode}) #${collectorNumber} - Language: ${cardData.lang || 'en'}`);
        return cardData;
      }

      // Try match without collector number (in case it's formatted differently), preferring English
      const setMatch = await this.db.get(
        'SELECT data FROM cards WHERE lower(name) = lower(?) AND lower(set_code) = lower(?) ORDER BY CASE WHEN JSON_EXTRACT(data, "$.lang") = "en" OR JSON_EXTRACT(data, "$.lang") IS NULL THEN 0 ELSE 1 END LIMIT 1',
        [name, setCode]
      );
      
      if (setMatch) {
        const card = JSON.parse(setMatch.data);
        console.log(`Found set match for ${name} (${setCode}), but collector number ${collectorNumber} didn't match ${card.collector_number} - Language: ${card.lang || 'en'}`);
        return card;
      }

      // Fallback to name-only search (already prioritizes English)
      console.log(`No precise match found for ${name} (${setCode}) #${collectorNumber}, falling back to name search`);
      return await this.findCardByName(name);
    } catch (error) {
      console.error('Error finding card by details:', error);
      return null;
    }
  }

  // Debug function to help investigate card matching issues
  async debugCardLookup(name, setCode = null) {
    if (!this.db || !this.initialized) {
      return { error: 'Database not initialized' };
    }

    try {
      // Find all cards with this name
      const nameMatches = await this.db.all(
        'SELECT name, set_code, set_name, collector_number, id FROM cards WHERE lower(name) = lower(?)',
        [name]
      );

      if (nameMatches.length === 0) {
        return { 
          error: 'No cards found with this name',
          suggestion: 'Try searching for partial matches'
        };
      }

      const result = {
        totalMatches: nameMatches.length,
        cards: nameMatches
      };

      if (setCode) {
        const setMatches = nameMatches.filter(card => 
          card.set_code.toLowerCase() === setCode.toLowerCase()
        );
        result.setMatches = setMatches.length;
        result.availableInSet = setMatches;
      }

      return result;
    } catch (error) {
      console.error('Error in debug card lookup:', error);
      return { error: error.message };
    }
  }

  getStats() {
    if (!this.initialized) {
      return null;
    }

    return {
      cardCount: this.cardCount,
      lastUpdate: this.metadata?.updated_at,
      downloadedAt: this.metadata?.downloaded_at,
      dataSize: this.metadata?.size,
      initialized: this.initialized,
      databaseFile: DATABASE_FILE
    };
  }

  async close() {
    if (this.db) {
      await this.db.close();
    }
  }

  async searchCardsSemantic(query, options = {}) {
    if (!this.initialized) {
        console.warn('Bulk data service not ready for semantic search.');
        return [];
    }
    return await semanticSearchService.search(query, options);
  }

  async getCardsByIds(ids) {
    if (!this.db || !ids || ids.length === 0) {
      return [];
    }

    const placeholders = ids.map(() => '?').join(',');
    const sql = `
      SELECT data FROM cards WHERE id IN (${placeholders})
    `;

    try {
      const rows = await this.db.all(sql, ids);
      return rows.map(row => JSON.parse(row.data));
    } catch (error) {
      console.error('Error fetching cards by IDs:', error);
      return [];
    }
  }

  async listSets() {
    // Returns a list of available sets with basic info (code, name, release date, card count)
    if (!this.db || !this.initialized) {
      return [];
    }

    try {
      // Aggregate basic information about each set. We group by set_code/name and take the earliest release date.
      const rows = await this.db.all(
        `SELECT set_code AS code, set_name AS name, MIN(released_at) AS released_at, COUNT(*) AS card_count
         FROM cards
         GROUP BY set_code, set_name
         ORDER BY released_at DESC`
      );
      return rows;
    } catch (error) {
      console.error('Error listing sets:', error);
      return [];
    }
  }

  async getCardsBySet(setCode, options = {}) {
    // Fetches all cards from a specific set (identified by setCode)
    if (!this.db || !this.initialized || !setCode) {
      return [];
    }

    const { limit = 5000 } = options; // Default high limit – UI can paginate further if needed

    try {
      const rows = await this.db.all(
        `SELECT data FROM cards WHERE lower(set_code) = lower(?) ORDER BY CAST(collector_number AS INTEGER) ASC LIMIT ?`,
        [setCode, limit]
      );
      return rows.map(row => JSON.parse(row.data));
    } catch (error) {
      console.error(`Error fetching cards for set ${setCode}:`, error);
      return [];
    }
  }
}

// Export singleton instance
const bulkDataService = new BulkDataService();

module.exports = bulkDataService; 