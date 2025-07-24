const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const https = require('https');
const { app } = require('electron');
const sqlite3 = require('sqlite3').verbose();
const { open } = require('sqlite');
const { parser } = require('stream-json');
const { streamValues } = require('stream-json/streamers/StreamValues');
const { chain } = require('stream-chain');
const { Worker } = require('worker_threads');
const { batch } = require('stream-json/utils/Batch');
const { resolveDatabasePath } = require('./dbPathResolver.cjs');

const semanticSearchService = require('./semanticSearch.cjs');

const SCRYFALL_BULK_API = 'https://api.scryfall.com/bulk-data';
const BULK_DATA_DIR = path.join(app.getPath('userData'), 'scryfall-data');
const CARDS_FILE = path.join(BULK_DATA_DIR, 'cards.json');
const DATABASE_FILE = resolveDatabasePath();
console.log('[bulkDataService] Using database at:', DATABASE_FILE);
const METADATA_FILE = path.join(BULK_DATA_DIR, 'metadata.json');

// Check every 7 days for updates
const UPDATE_INTERVAL = 7 * 24 * 60 * 60 * 1000; // 7 days in milliseconds

class BulkDataService {
  constructor() {
    this.db = null;
    this.metadata = null;
    this.initialized = false;
    this.cardCount = 0;
    this._invalidNameDebugCount = 0;
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
      console.log('Initializing bulk data service...');
      console.log(`[bulkDataService] Database will be located at: ${DATABASE_FILE}`);

      // Ensure data directory exists
      await fs.mkdir(BULK_DATA_DIR, { recursive: true });

      // Initialize database connection
      await this.initializeDatabase();

      // Ensure the 'collected' column exists for tracking user cards
      await this.addCollumnCollected();

      // Get card count from the existing database
      this.cardCount = await this.getCardCount();

      this.initialized = true;
      console.log(`Bulk data initialized with ${this.cardCount} cards from user database.`);

    } catch (error) {
      console.error('[bulkDataService] Failed to initialize bulk data service:', error);
      console.error('Database file path:', DATABASE_FILE);

      // Broadcast error to UI
      this._broadcast('bulk-data-error', {
        message: 'Failed to initialize database. Please restart the application.',
        error: error.message
      });
    }
  }

  async initializeDatabase() {
    // Check if database file exists
    if (!fsSync.existsSync(DATABASE_FILE)) {
      throw new Error(`Database file not found at: ${DATABASE_FILE}. Please ensure the database is properly bundled with the application.`);
    }

    console.log(`Opening database at: ${DATABASE_FILE}`);

    this.db = await open({
      filename: DATABASE_FILE,
      driver: sqlite3.Database
    });

    // Set PRAGMAs for performance and to prevent locking issues.
    // WAL mode allows for one writer and multiple readers, which is perfect for Electron.
    await this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA busy_timeout = 5000;
      PRAGMA synchronous = NORMAL;
    `);

    // Check if the cards table exists (it should already exist with the new database)
    const tables = await this.db.all("SELECT name FROM sqlite_master WHERE type='table' AND name='cards'");
    if (tables.length > 0) {
      console.log('Database initialized successfully - using existing cards table');

      // Ensure optimized indexes exist for fast card lookups
      await this.ensureOptimizedIndexes();
    } else {
      console.warn('No cards table found - this may be an empty database. Creating tables...');
      // Fallback: Create cards table if it doesn't exist (for backward compatibility)
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
      console.log('Database initialized successfully - created new cards table');
    }

    // Ensure cardRelatedLinks table exists (population is handled by _ensureRelatedLinksData)
    await this.db.exec(`
      CREATE TABLE IF NOT EXISTS cardRelatedLinks (
        uuid TEXT PRIMARY KEY,
        gatherer TEXT,
        edhrec TEXT
      )
    `);

    // Ensure cardRulings table exists
    await this.db.exec(`
      CREATE TABLE IF NOT EXISTS cardRulings (
        uuid TEXT NOT NULL,
        date TEXT,
        text TEXT,
        PRIMARY KEY (uuid, text)
      )
    `);
    await this.db.exec('CREATE INDEX IF NOT EXISTS idx_cardRulings_uuid ON cardRulings(uuid)');
  }

  async ensureOptimizedIndexes() {
    // Create optimized indexes for fast card lookups
    const indexes = [
      'CREATE INDEX IF NOT EXISTS idx_cards_name ON cards(name)',
      'CREATE INDEX IF NOT EXISTS idx_cards_name_lower ON cards(lower(name))',
      'CREATE INDEX IF NOT EXISTS idx_cards_setcode ON cards(setCode)',
      'CREATE INDEX IF NOT EXISTS idx_cards_setcode_lower ON cards(lower(setCode))',
      'CREATE INDEX IF NOT EXISTS idx_cards_number ON cards(number)',
      'CREATE INDEX IF NOT EXISTS idx_cards_language ON cards(language)',
      'CREATE INDEX IF NOT EXISTS idx_cards_name_set_num ON cards(name, setCode, number)',
      'CREATE INDEX IF NOT EXISTS idx_cards_name_set_lower ON cards(lower(name), lower(setCode))',
    ];

    for (const indexSql of indexes) {
      try {
        await this.db.exec(indexSql);
      } catch (error) {
        console.warn(`Warning: Could not create index: ${error.message}`);
      }
    }
    console.log('Optimized indexes ensured for fast card lookups');
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

  async getCollectedCards(options = {}) {
    const { search = '', limit = 1000, offset = 0 } = options;

    let query = `
        SELECT
          c.*,
          ci.scryfallId,
          cl.alchemy,    cl.brawl,       cl.commander,     cl.duel,
          cl.explorer,   cl.future,      cl.gladiator,     cl.historic,
          cl.legacy,     cl.modern,      cl.oathbreaker,   cl.oldschool,
          cl.pauper,     cl.paupercommander, cl.penny,     cl.pioneer,
          cl.predh,      cl.premodern,   cl.standard,      cl.standardbrawl,
          cl.timeless,   cl.vintage,
          s.name       AS setName,
          cpu.cardKingdom,
          cpu.cardmarket,
          cpu.tcgplayer,
          crl.gatherer,
          crl.edhrec,

          /* JSON array of all price records for this card */
          (
            SELECT json_group_array(
              json_object(
                'vendor',           dp2.vendor,
                'price',            dp2.price,
                'transaction_type', dp2.transaction_type,
                'card_type',        dp2.card_type,
                'date',             dp2.date,
                'currency',         dp2.currency
              )
            )
            FROM daily_prices AS dp2
            WHERE dp2.uuid = c.uuid
          ) AS prices_json,

          /* Aggregate quantities from user_collections */
          COALESCE(uc.foil_quantity, 0) as foil_quantity,
          COALESCE(uc.normal_quantity, 0) as normal_quantity,
          COALESCE(uc.total_quantity, 0) as total_quantity

        FROM cards AS c
        LEFT JOIN cardIdentifiers   AS ci  ON ci.uuid       = c.uuid
        LEFT JOIN cardLegalities    AS cl  ON cl.uuid       = c.uuid
        LEFT JOIN sets              AS s   ON s.code        = c.setCode
        LEFT JOIN cardPurchaseUrls  AS cpu ON cpu.uuid      = c.uuid
        LEFT JOIN cardRelatedLinks  AS crl ON crl.uuid      = c.uuid
        LEFT JOIN (
          SELECT 
            cardName,
            setCode,
            collectorNumber,
            SUM(CASE WHEN foil = 'foil' THEN quantity ELSE 0 END) as foil_quantity,
            SUM(CASE WHEN foil = 'normal' THEN quantity ELSE 0 END) as normal_quantity,
            SUM(quantity) as total_quantity
          FROM user_collections 
          GROUP BY cardName, setCode, collectorNumber
        ) uc ON lower(uc.cardName) = lower(c.name) 
           AND lower(uc.setCode) = lower(c.setCode) 
           AND uc.collectorNumber = c.number

        WHERE c.collected >= 1
        

    `;
    const params = [];

    if (search) {
      query += ' AND (lower(c.name) LIKE lower(?) OR lower(c.setCode) LIKE lower(?))';
      params.push(`%${search}%`, `%${search}%`);
    }

    query += ' ORDER BY c.name ASC LIMIT ? OFFSET ?';
    params.push(limit, offset);

    const result = await this.db.all(query, params);
    return Promise.all(result.map(row => this.convertDbRowToCard(row)));
  }

  async markCardCollected(cardId, collected = true) {
    if (!this.db || !this.initialized) {
      return false;
    }

    try {
      const result = await this.db.run(
        'UPDATE cards SET collected = ? WHERE uuid = ?',
        [collected ? 1 : 0, cardId]
      );
      console.log(`Updated ${result.changes} card(s) with UUID ${cardId} to collected=${collected}`);
      return result.changes > 0;
    } catch (error) {
      console.error('Error marking card as collected:', error);
      return false;
    }
  }

  async clearAllCollected() {
    if (!this.db || !this.initialized) {
      return false;
    }

    try {
      const result = await this.db.run('UPDATE cards SET collected = 0 WHERE collected > 0');
      console.log(`Cleared ${result.changes} collected card(s) from main database`);
      return result.changes > 0;
    } catch (error) {
      console.error('Error clearing all collected cards:', error);
      return false;
    }
  }

  async getCardRuling(cardId) {
    if (!this.db) return [];
    const results = await this.db.all('SELECT date, text FROM cardRulings WHERE uuid = ? ORDER BY date', [cardId]);
    return results || [];
  }

  async getCollectionStats() {
    if (!this.db || !this.initialized) {
      return null;
    }

    try {
      const totalCards = await this.db.get('SELECT COUNT(*) as count FROM cards');
      const collectedCards = await this.db.get('SELECT COUNT(*) as count FROM cards WHERE collected >= 1');

      // Get collected by rarity
      const rarityStats = await this.db.all(`
        SELECT rarity, COUNT(*) as count 
        FROM cards 
        WHERE collected >= 1 
        GROUP BY rarity
      `);

      // Get collected by set (top 10)
      const setStats = await this.db.all(`
        SELECT setCode, COUNT(*) as count 
        FROM cards 
        WHERE collected >= 1 
        GROUP BY setCode 
        ORDER BY count DESC 
        LIMIT 10
      `);

      return {
        total_cards: totalCards.count,
        collected_cards: collectedCards.count,
        collection_percentage: ((collectedCards.count / totalCards.count) * 100).toFixed(2),
        by_rarity: rarityStats,
        by_set: setStats
      };
    } catch (error) {
      console.error('Error getting collection stats:', error);
      return null;
    }
  }

  async transferCollectedCardsToDatabase() {
    const collectedCards = await this.getCollectedCards();
    for (const card of collectedCards) {
      await this.db.run(`
        INSERT INTO cards (id, name, mana_cost, cmc, type_line, oracle_text, power, toughness, colors, rarity, set_code, set_name, collector_number, released_at, image_uris, card_faces, data)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [card.id, card.name, card.mana_cost, card.cmc, card.type_line, card.oracle_text, card.power, card.toughness, card.colors, card.rarity, card.set_code, card.set_name, card.collector_number, card.released_at, card.image_uris, card.card_faces, card.data]);
    }
  }

  async loadMetadata() {
    try {
      // First try to load from database meta table
      const dbMetadata = await this.loadMetadataFromDatabase();
      if (dbMetadata) {
        this.metadata = dbMetadata;
        console.log('✅ Loaded metadata from database meta table');
        return;
      }

      // Fallback to JSON file if no database meta table exists
      const metadataExists = await this.fileExists(METADATA_FILE);
      if (metadataExists) {
        const metadataContent = await fs.readFile(METADATA_FILE, 'utf-8');
        this.metadata = JSON.parse(metadataContent);
        console.log('📄 Loaded metadata from JSON file (fallback)');
      }
    } catch (error) {
      console.error('Error loading metadata:', error);
      this.metadata = null;
    }
  }

  async loadMetadataFromDatabase() {
    if (!this.db) return null;

    try {
      // Check if meta table exists
      const tableExists = await this.db.get(`
        SELECT name FROM sqlite_master 
        WHERE type='table' AND name='meta'
      `);

      if (!tableExists) {
        console.log('📋 No meta table found in database');
        return null;
      }

      // Get the latest metadata row using the date column
      const metaRow = await this.db.get(`
        SELECT * FROM meta 
        ORDER BY date DESC 
        LIMIT 1
      `);

      if (!metaRow) {
        console.log('📋 No metadata rows found in meta table');
        return null;
      }

      console.log('📋 Found metadata from database:', metaRow);

      // Convert database row to metadata object format
      // Since your table only has date and version, we'll create a minimal metadata object
      return {
        id: 'database_meta',
        type: 'all_cards',
        name: 'MTG Database',
        description: 'Magic: The Gathering card database',
        updated_at: metaRow.date,
        version: metaRow.version,
        card_count: this.cardCount, // Use the actual card count from the database
        database_built_at: metaRow.date, // Use the date as build date
        built_with: `Database v${metaRow.version || '1.0'}`
      };
    } catch (error) {
      console.error('Error loading metadata from database:', error);
      return null;
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
        new StreamValues(),
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

  // Token search method
  async searchTokens(searchParams, options = {}) {
    if (!this.db || !this.initialized) {
      return [];
    }

    // Handle backward compatibility with old query string format
    if (typeof searchParams === 'string') {
      searchParams = { name: searchParams };
    }

    const { name, text, type } = searchParams;
    const { limit = 50 } = options;

    // Build query to search tokens table with cardIdentifiers join for image URLs
    let query = `
      SELECT t.*, 
             ci.scryfallId
      FROM tokens t
      LEFT JOIN cardIdentifiers ci ON t.uuid = ci.uuid
      WHERE 1=1
    `;
    const params = [];

    // Name search (case-insensitive)
    if (name) {
      query += ' AND lower(t.name) LIKE lower(?)';
      params.push(`%${name}%`);
    }

    // Oracle text search (case-insensitive)
    if (text) {
      query += ' AND (lower(t.text) LIKE lower(?) OR lower(t.originalText) LIKE lower(?))';
      params.push(`%${text}%`, `%${text}%`);
    }

    // Type line search (case-insensitive)
    if (type) {
      query += ' AND (lower(t.type) LIKE lower(?) OR lower(t.types) LIKE lower(?))';
      params.push(`%${type}%`, `%${type}%`);
    }

    // Add ordering and limit - prioritize English tokens
    query += ' ORDER BY CASE WHEN t.language = "English" OR t.language IS NULL THEN 0 ELSE 1 END, t.name';
    query += ` LIMIT ${limit}`;

    try {
      const rows = await this.db.all(query, params);

      // Debug token structure on first search only
      if (rows.length > 0 && name === 'warrior') { // Only log once
        console.log('🪙 Token structure analysis:');
        console.log('🪙 First token result keys:', Object.keys(rows[0]));
        console.log('🪙 Sample token data:', rows[0]);

        // Check if there are any cardIdentifiers entries for tokens  
        const sampleTokenUuid = rows[0].uuid;
        const idCheck = await this.db.get("SELECT scryfallId FROM cardIdentifiers WHERE uuid = ?", [sampleTokenUuid]);
        console.log(`🪙 CardIdentifiers lookup for ${sampleTokenUuid}:`, idCheck ? 'Found' : 'Not found');

        // Check if tokens have a direct scryfallId or imageUris column
        const tokenColumns = await this.db.all("PRAGMA table_info(tokens)");
        const hasDirectScryfallId = tokenColumns.some(c => c.name === 'scryfallId');
        const hasImageUris = tokenColumns.some(c => c.name.toLowerCase().includes('image'));
        console.log('🪙 Token table has direct scryfallId:', hasDirectScryfallId);
        console.log('🪙 Token table image columns:', tokenColumns.filter(c => c.name.toLowerCase().includes('image')).map(c => c.name));
      }

      // Convert database rows to card format expected by the UI
      return Promise.all(rows.map(row => this.convertDbRowToCard(row)));
    } catch (error) {
      console.error('Error searching tokens:', error);
      return [];
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

    const { name, text, type, colors, manaCost, manaValue, power, toughness, rarity, types, subTypes, superTypes, format } = searchParams;
    const { limit = 50 } = options;

    // Build query to return card data directly from columns, joining with related tables
    let query = `
      SELECT c.*, 
             ci.scryfallId,
             cl.alchemy, cl.brawl, cl.commander, cl.duel, cl.explorer, cl.future, cl.gladiator,
             cl.historic, cl.legacy, cl.modern, cl.oathbreaker, cl.oldschool, cl.pauper,
             cl.paupercommander, cl.penny, cl.pioneer, cl.predh, cl.premodern, cl.standard,
             cl.standardbrawl, cl.timeless, cl.vintage,
             s.name as setName,
             cpu.cardKingdom, cpu.cardmarket, cpu.tcgplayer,
             crl.gatherer, crl.edhrec,

             /* JSON array of all price records for this card */
             (
               SELECT json_group_array(
                 json_object(
                   'vendor',           dp2.vendor,
                   'price',            dp2.price,
                   'transaction_type', dp2.transaction_type,
                   'card_type',        dp2.card_type,
                   'date',             dp2.date,
                   'currency',         dp2.currency
                 )
               )
               FROM daily_prices AS dp2
               WHERE dp2.uuid = c.uuid
             ) AS prices_json
      FROM cards c
      LEFT JOIN cardIdentifiers ci ON c.uuid = ci.uuid
      LEFT JOIN cardLegalities cl ON c.uuid = cl.uuid
      LEFT JOIN sets s ON c.setCode = s.code
      LEFT JOIN cardPurchaseUrls cpu ON c.uuid = cpu.uuid
      LEFT JOIN cardRelatedLinks crl ON c.uuid = crl.uuid
      WHERE 1=1
    `;
    const params = [];

    // Name search (case-insensitive)
    if (name) {
      query += ' AND lower(c.name) LIKE lower(?)';
      params.push(`%${name}%`);
    }

    // Oracle text search (case-insensitive) - check if column exists
    if (text) {
      // Try different possible column names for oracle text
      query += ' AND (lower(c.text) LIKE lower(?) OR lower(c.originalText) LIKE lower(?))';
      params.push(`%${text}%`, `%${text}%`);
    }

    // Type line search (case-insensitive) - check if column exists
    if (type) {
      query += ' AND (lower(c.type) LIKE lower(?) OR lower(c.types) LIKE lower(?))';
      params.push(`%${type}%`, `%${type}%`);
    }

    // Colors (check if colors contains the required colors)
    if (colors && colors.length > 0) {
      for (const color of colors) {
        query += ' AND c.colors LIKE ?';
        params.push(`%${color}%`);
      }
    }

    // Mana cost (exact match, but flexible about brackets)
    if (manaCost) {
      const formattedManaCost = manaCost.replace(/\{/g, '').replace(/\}/g, '');
      query += ' AND replace(replace(c.manaCost, "{", ""), "}", "") = ?';
      params.push(formattedManaCost);
    }

    // Power
    if (power) {
      query += ' AND c.power = ?';
      params.push(power);
    }

    // Toughness
    if (toughness) {
      query += ' AND c.toughness = ?';
      params.push(toughness);
    }

    // Mana value (converted mana cost)
    if (manaValue) {
      query += ' AND c.convertedManaCost = ?';
      params.push(parseInt(manaValue));
    }

    // Types search (case-insensitive) - search in types column
    if (types) {
      query += ' AND lower(c.types) LIKE lower(?)';
      params.push(`%${types}%`);
    }

    // Subtypes search (case-insensitive) - search in subtypes column
    if (subTypes) {
      query += ' AND lower(c.subtypes) LIKE lower(?)';
      params.push(`%${subTypes}%`);
    }

    // Supertypes search (case-insensitive) - search in supertypes column
    if (superTypes) {
      query += ' AND lower(c.supertypes) LIKE lower(?)';
      params.push(`%${superTypes}%`);
    }

    // Rarity (exact match, case-insensitive)
    if (rarity) {
      query += ' AND lower(c.rarity) = lower(?)';
      params.push(rarity);
    }

    // Format legality filter
    if (format) {
      const formatColumn = format.toLowerCase();
      // Only include cards that are legal in the specified format
      // Use parameterized query to prevent SQL injection, but we need to build the column name dynamically
      const validFormats = ['standard', 'modern', 'legacy', 'vintage', 'commander', 'pauper', 'pioneer', 'historic', 'brawl', 'alchemy', 'explorer', 'timeless'];
      if (validFormats.includes(formatColumn)) {
        query += ` AND cl.${formatColumn} IN ('legal', 'restricted')`;
      }
    }

    // Add ordering and limit - prioritize English cards
    if (name) {
      // Sort by relevance (exact name matches first), then prioritize English language
      query += ' ORDER BY CASE WHEN lower(c.name) = lower(?) THEN 0 ELSE 1 END, CASE WHEN c.language = "English" OR c.language IS NULL THEN 0 ELSE 1 END, c.name';
      params.push(name);
    } else {
      // Prioritize English cards, then sort by name
      query += ' ORDER BY CASE WHEN c.language = "English" OR c.language IS NULL THEN 0 ELSE 1 END, c.name';
    }

    query += ` LIMIT ${limit}`;

    try {
      // Debug: Log the query and format filter
      if (format) {
        console.log(`🔍 Backend search with format filter: ${format}`);
        console.log(`🔍 Query includes format filter: ${query.includes('cl.' + format.toLowerCase())}`);
      }

      const rows = await this.db.all(query, params);

      // Debug: Log results count
      if (format && rows.length > 0) {
        console.log(`🔍 Backend returned ${rows.length} cards for format ${format}`);
        console.log(`🔍 First few results:`, rows.slice(0, 3).map(r => ({
          name: r.name,
          [format.toLowerCase()]: r[format.toLowerCase()]
        })));
      }

      // Convert database rows to card format expected by the UI
      return Promise.all(rows.map(row => this.convertDbRowToCard(row)));
    } catch (error) {
      console.error('Error searching cards:', error);
      return [];
    }
  }

  // Helper method to safely parse JSON fields that might be in different formats
  parseJsonSafely(value) {
    if (!value) return null;
    if (Array.isArray(value) || typeof value === 'object') return value;
    if (typeof value === 'string') {
      // If it starts with [ or {, try to parse as JSON
      if (value.startsWith('[') || value.startsWith('{')) {
        try {
          return JSON.parse(value);
        } catch (e) {
          console.warn('Failed to parse JSON:', value);
          return null;
        }
      }
      // If it's a short string (likely single color like "B", "R"), convert to array
      if (value.length <= 5 && /^[WUBRG]+$/.test(value)) {
        return value.split('');
      }
      // For longer strings, assume it's comma-separated
      return value.split(',').map(s => s.trim()).filter(s => s);
    }
    return null;
  }

  possibleLayouts = [
    'saga',
    'adventure',
    'class',
    'aftermath',
    'split',
    'flip',
    'transform',
    'prototype',
    'meld',
    'leveler',
    'mutate',
    'vanguard',
    'planar',
    'scheme',
    'modal_dfc',
    'case',
    'reversible_card',
    'augment',
    'host',
  ]

  // Helper method to get both faces of a double-faced card
  async getCardFaces(cardRow) {
    if (!cardRow.layout || !this.possibleLayouts.includes(cardRow.layout)) {
      return null;
    }

    // The scryfallId from the main row is the canonical ID for both faces' images.
    const canonicalScryfallId = cardRow.scryfallId;
    if (!canonicalScryfallId) {
      console.warn(`Cannot build image URLs for "${cardRow.name}" without a scryfallId on the main card row.`);
      return null;
    }

    // Special handling for reversible_card layouts
    if (cardRow.layout === 'reversible_card') {
      // For reversible cards, create both faces manually since they don't have separate database records
      const frontFace = {
        name: cardRow.name,
        mana_cost: cardRow.manaCost || '',
        type_line: cardRow.type || '',
        oracle_text: cardRow.text || '',
        power: cardRow.power,
        toughness: cardRow.toughness,
        loyalty: cardRow.loyalty,
        colors: this.parseJsonSafely(cardRow.colors) || [],
        image_uris: {
          small: `https://cards.scryfall.io/small/front/${canonicalScryfallId.charAt(0)}/${canonicalScryfallId.charAt(1)}/${canonicalScryfallId}.jpg`,
          normal: `https://cards.scryfall.io/normal/front/${canonicalScryfallId.charAt(0)}/${canonicalScryfallId.charAt(1)}/${canonicalScryfallId}.jpg`,
          large: `https://cards.scryfall.io/large/front/${canonicalScryfallId.charAt(0)}/${canonicalScryfallId.charAt(1)}/${canonicalScryfallId}.jpg`,
          png: `https://cards.scryfall.io/png/front/${canonicalScryfallId.charAt(0)}/${canonicalScryfallId.charAt(1)}/${canonicalScryfallId}.jpg`,
          art_crop: `https://cards.scryfall.io/art_crop/front/${canonicalScryfallId.charAt(0)}/${canonicalScryfallId.charAt(1)}/${canonicalScryfallId}.jpg`,
          border_crop: `https://cards.scryfall.io/border_crop/front/${canonicalScryfallId.charAt(0)}/${canonicalScryfallId.charAt(1)}/${canonicalScryfallId}.jpg`
        }
      };

      const backFace = {
        name: cardRow.name,
        mana_cost: cardRow.manaCost || '',
        type_line: cardRow.type || '',
        oracle_text: cardRow.text || '',
        power: cardRow.power,
        toughness: cardRow.toughness,
        loyalty: cardRow.loyalty,
        colors: this.parseJsonSafely(cardRow.colors) || [],
        image_uris: {
          small: `https://cards.scryfall.io/small/back/${canonicalScryfallId.charAt(0)}/${canonicalScryfallId.charAt(1)}/${canonicalScryfallId}.jpg`,
          normal: `https://cards.scryfall.io/normal/back/${canonicalScryfallId.charAt(0)}/${canonicalScryfallId.charAt(1)}/${canonicalScryfallId}.jpg`,
          large: `https://cards.scryfall.io/large/back/${canonicalScryfallId.charAt(0)}/${canonicalScryfallId.charAt(1)}/${canonicalScryfallId}.jpg`,
          png: `https://cards.scryfall.io/png/back/${canonicalScryfallId.charAt(0)}/${canonicalScryfallId.charAt(1)}/${canonicalScryfallId}.jpg`,
          art_crop: `https://cards.scryfall.io/art_crop/back/${canonicalScryfallId.charAt(0)}/${canonicalScryfallId.charAt(1)}/${canonicalScryfallId}.jpg`,
          border_crop: `https://cards.scryfall.io/border_crop/back/${canonicalScryfallId.charAt(0)}/${canonicalScryfallId.charAt(1)}/${canonicalScryfallId}.jpg`
        }
      };

      return [frontFace, backFace];
    }

    try {
      const faces = await this.db.all(`
        SELECT c.faceName, c.manaCost, c.type, c.text, c.power, c.toughness, c.loyalty, c.colors
        FROM cards c
        WHERE c.name = ? 
        AND (c.language = "English" OR c.language IS NULL)
        AND c.faceName IS NOT NULL
        ORDER BY c.faceName ASC
      `, [cardRow.name]);

      if (faces.length < 2) {
        // Fallback for when we can't find the other face.
        const frontFace = {
          name: cardRow.faceName || cardRow.name.split(' // ')[0],
          mana_cost: cardRow.manaCost || '',
          type_line: cardRow.type || '',
          oracle_text: cardRow.text || '',
          power: cardRow.power,
          toughness: cardRow.toughness,
          loyalty: cardRow.loyalty,
          colors: this.parseJsonSafely(cardRow.colors) || [],
          image_uris: {
            small: `https://cards.scryfall.io/small/front/${canonicalScryfallId.charAt(0)}/${canonicalScryfallId.charAt(1)}/${canonicalScryfallId}.jpg`,
            normal: `https://cards.scryfall.io/normal/front/${canonicalScryfallId.charAt(0)}/${canonicalScryfallId.charAt(1)}/${canonicalScryfallId}.jpg`,
            large: `https://cards.scryfall.io/large/front/${canonicalScryfallId.charAt(0)}/${canonicalScryfallId.charAt(1)}/${canonicalScryfallId}.jpg`,
            png: `https://cards.scryfall.io/png/front/${canonicalScryfallId.charAt(0)}/${canonicalScryfallId.charAt(1)}/${canonicalScryfallId}.jpg`,
            art_crop: `https://cards.scryfall.io/art_crop/front/${canonicalScryfallId.charAt(0)}/${canonicalScryfallId.charAt(1)}/${canonicalScryfallId}.jpg`,
            border_crop: `https://cards.scryfall.io/border_crop/front/${canonicalScryfallId.charAt(0)}/${canonicalScryfallId.charAt(1)}/${canonicalScryfallId}.jpg`
          }
        };
        return [frontFace];
      }

      // Deduplicate faces to prevent issues with multiple printings
      const uniqueFaces = [];
      const seenFaceNames = new Set();
      for (const face of faces) {
        if (!seenFaceNames.has(face.faceName)) {
          uniqueFaces.push(face);
          seenFaceNames.add(face.faceName);
        }
      }

      return uniqueFaces.map((face, index) => {
        const facePath = index === 1 ? 'back/' : 'front/';
        const idPath = `${canonicalScryfallId.charAt(0)}/${canonicalScryfallId.charAt(1)}/${canonicalScryfallId}.jpg`;

        return {
          name: face.faceName,
          mana_cost: face.manaCost || '',
          type_line: face.type || '',
          oracle_text: face.text || '',
          power: face.power,
          toughness: face.toughness,
          loyalty: face.loyalty,
          colors: this.parseJsonSafely(face.colors) || [],
          image_uris: {
            small: `https://cards.scryfall.io/small/${facePath}${idPath}`,
            normal: `https://cards.scryfall.io/normal/${facePath}${idPath}`,
            large: `https://cards.scryfall.io/large/${facePath}${idPath}`,
            png: `https://cards.scryfall.io/png/${facePath}${idPath}`,
            art_crop: `https://cards.scryfall.io/art_crop/${facePath}${idPath}`,
            border_crop: `https://cards.scryfall.io/border_crop/${facePath}${idPath}`
          }
        };
      });
    } catch (error) {
      console.error('Error fetching card faces:', error);
      return null;
    }
  }

  // Helper method to convert database row to expected card format
  async convertDbRowToCard(row) {
    // Construct image URLs from Scryfall ID if available
    let image_uris = null;
    if (row.scryfallId) {
      const id = row.scryfallId;
      image_uris = {
        small: `https://cards.scryfall.io/small/front/${id.charAt(0)}/${id.charAt(1)}/${id}.jpg`,
        normal: `https://cards.scryfall.io/normal/front/${id.charAt(0)}/${id.charAt(1)}/${id}.jpg`,
        large: `https://cards.scryfall.io/large/front/${id.charAt(0)}/${id.charAt(1)}/${id}.jpg`,
        png: `https://cards.scryfall.io/png/front/${id.charAt(0)}/${id.charAt(1)}/${id}.jpg`,
        art_crop: `https://cards.scryfall.io/art_crop/front/${id.charAt(0)}/${id.charAt(1)}/${id}.jpg`,
        border_crop: `https://cards.scryfall.io/border_crop/front/${id.charAt(0)}/${id.charAt(1)}/${id}.jpg`
      };
    } else {
      console.warn(`No scryfallId found for card "${row.name}" - no image URLs will be generated`);
    }

    // Process purchase URLs
    const purchase_uris = {};
    if (row.tcgplayer) purchase_uris.tcgplayer = row.tcgplayer;
    if (row.cardmarket) purchase_uris.cardmarket = row.cardmarket;
    if (row.cardKingdom) purchase_uris.cardkingdom = row.cardKingdom;

    // Process related URLs
    const related_uris = {};
    if (row.gatherer) related_uris.gatherer = row.gatherer;
    if (row.edhrec) related_uris.edhrec = row.edhrec;

    // Build legalities object solely from individual columns provided by the `cardLegalities` table join
    let legalities = {};
    const legalityFields = [
      'alchemy', 'brawl', 'commander', 'duel', 'explorer', 'future', 'gladiator',
      'historic', 'legacy', 'modern', 'oathbreaker', 'oldschool', 'pauper',
      'paupercommander', 'penny', 'pioneer', 'predh', 'premodern', 'standard',
      'standardbrawl', 'timeless', 'vintage'
    ];

    legalityFields.forEach(field => {
      // If the DB field is explicitly 'legal', mark it as such. Otherwise, default to 'not_legal'.
      const dbValue = row[field];
      if (dbValue && typeof dbValue === 'string') {
        legalities[field] = dbValue.toLowerCase();
      } else {
        legalities[field] = 'not_legal';
      }
    });

    const rulings = row.uuid ? await this.db.all('SELECT date, text FROM cardRulings WHERE uuid = ? ORDER BY date', [row.uuid]) : [];

    // Handle double-faced cards: construct card_faces array if this is a transform/modal_dfc card
    const card_faces = await this.getCardFaces(row);

    //
    // ── NEW: parse the aggregated prices_json into foil and regular prices ───────
    //
    let prices = { usd: 0, usd_foil: 0, usd_regular: 0 };
    if (row.prices_json) {
      try {
        // 1) parse the JSON array
        const priceArray = JSON.parse(row.prices_json);

        // 2) sort descending by date so the first USD is the newest
        priceArray.sort((a, b) => new Date(b.date) - new Date(a.date));

        // 3) find USD entries for different card types
        const validVendors = ['tcgplayer', 'cardmarket', 'cardkingdom'];

        // Find foil price
        const foilEntry = priceArray.find(
          p =>
            p.currency === 'USD' &&
            validVendors.includes(p.vendor.toLowerCase()) &&
            p.card_type === 'foil'
        );
        if (foilEntry && typeof foilEntry.price === 'number') {
          prices.usd_foil = foilEntry.price;
        }

        // Find regular (non-foil) price
        const regularEntry = priceArray.find(
          p =>
            p.currency === 'USD' &&
            validVendors.includes(p.vendor.toLowerCase()) &&
            p.card_type === 'normal'
        );
        if (regularEntry && typeof regularEntry.price === 'number') {
          prices.usd_regular = regularEntry.price;
        }

        // Set the main USD price to the regular price (for backwards compatibility)
        if (prices.usd_regular > 0) {
          prices.usd = prices.usd_regular;
        } else if (prices.usd_foil > 0) {
          prices.usd = prices.usd_foil;
        }
      } catch (e) {
        console.warn(`Failed parsing prices_json for ${row.uuid}:`, e);
      }
    }

    const formattedPrices = {
      usd: prices.usd.toFixed(2) || 0,
      usd_foil: prices.usd_foil.toFixed(2) || 0,
      usd_regular: prices.usd_regular.toFixed(2) || 0
    };
    //
    // ── END NEW PRICING LOGIC ───────────────────────────────────────────────────
    //

    return {
      id: row.uuid || row.id || `${row.setCode}-${row.number}`,
      uuid: row.uuid,
      name: row.name,

      // New schema properties (camelCase)
      manaCost: row.manaCost,
      manaValue: row.manaValue,
      type: row.type_line || row.type || row.types,
      text: row.text,
      setCode: row.setCode,
      setName: row.setName,
      number: row.number,
      supertypes: row.supertypes,

      // Legacy properties (snake_case) for backwards compatibility
      mana_cost: row.manaCost,
      cmc: row.manaValue || row.cmc,
      type_line: row.type_line || row.type || row.types,
      oracle_text: row.text || row.originalText,
      set: row.setName,
      set_code: row.setCode,
      set_name: row.setName,
      collector_number: row.number,

      // Other properties
      power: row.power,
      toughness: row.toughness,
      colors: this.parseJsonSafely(row.colors) || [],
      color_identity: this.parseJsonSafely(row.colorIdentity) || [],
      rarity: row.rarity,
      released_at: row.releaseDate,
      image_uris: image_uris,
      purchase_uris: purchase_uris,
      related_uris: related_uris,
      legalities: legalities,
      rulings: rulings,
      card_faces: card_faces,
      prices: formattedPrices,
      lang: row.language === 'English' ? 'en' : row.language,
      artist: row.artist,
      layout: row.layout,

      // Additional properties that are safe to serialize
      keywords: this.parseJsonSafely(row.keywords) || [],
      produced_mana: this.parseJsonSafely(row.producedMana) || [],
      color_indicator: this.parseJsonSafely(row.colorIndicator) || [],
      frame: row.frame,
      frame_effects: this.parseJsonSafely(row.frameEffects) || [],
      border_color: row.borderColor,
      promo_types: this.parseJsonSafely(row.promoTypes) || [],
      watermark: row.watermark,
      story_spotlight: row.storySpotlight,
      textless: row.textless,
      booster: row.booster,
      loyalty: row.loyalty,
      hand_modifier: row.handModifier,
      life_modifier: row.lifeModifier,
      reserved: row.reserved,
      foil: row.foil,
      nonfoil: row.nonfoil,
      oversized: row.oversized,
      promo: row.promo,
      reprint: row.reprint,
      variation: row.variation,
      set_id: row.setId,
      set_uri: row.setUri,
      set_search_uri: row.setSearchUri,
      scryfall_uri: row.scryfallUri,
      uri: row.uri,
      scryfall_id: row.scryfallId,
      mtgo_id: row.mtgoId,
      mtgo_foil_id: row.mtgoFoilId,
      tcgplayer_id: row.tcgplayerId,
      cardmarket_id: row.cardmarketId,
      object: 'card',

      // Collection-related fields
      collected: row.collected || 0,
      foil_quantity: parseInt(row.foil_quantity || 0),
      normal_quantity: parseInt(row.normal_quantity || 0),
      total_quantity: parseInt(row.total_quantity || 0),

      // Ensure numeric fields are properly typed
      cmc: parseFloat(row.manaValue || row.cmc || 0),
      mana_value: parseFloat(row.manaValue || row.cmc || 0),
      edhrec_rank: row.edhrecRank ? parseInt(row.edhrecRank) : null,
      penny_rank: row.pennyRank ? parseInt(row.pennyRank) : null
    };
  }

  async findCardByName(name) {
    if (!this.db || !this.initialized) {
      return null;
    }

    // Validate that name is provided and not undefined
    if (!name || name === 'undefined' || typeof name !== 'string' || name.trim() === '') {
      console.warn(`⚠️ findCardByName called with invalid name: "${name}"`);
      return null;
    }

    try {
      // First try exact case match (fastest with index)
      let exactMatch = await this.db.get(`
        SELECT c.*, 
               ci.scryfallId,
               cl.alchemy, cl.brawl, cl.commander, cl.duel, cl.explorer, cl.future, cl.gladiator,
               cl.historic, cl.legacy, cl.modern, cl.oathbreaker, cl.oldschool, cl.pauper,
               cl.paupercommander, cl.penny, cl.pioneer, cl.predh, cl.premodern, cl.standard,
               cl.standardbrawl, cl.timeless, cl.vintage,
               s.name as setName,
               cpu.cardKingdom, cpu.cardmarket, cpu.tcgplayer,
               crl.gatherer, crl.edhrec
        FROM cards c
        LEFT JOIN cardIdentifiers ci ON c.uuid = ci.uuid
        LEFT JOIN cardLegalities cl ON c.uuid = cl.uuid
        LEFT JOIN sets s ON c.setCode = s.code
        LEFT JOIN cardPurchaseUrls cpu ON c.uuid = cpu.uuid
        LEFT JOIN cardRelatedLinks crl ON c.uuid = crl.uuid
        WHERE c.name = ? AND (c.language = "English" OR c.language IS NULL) 
        LIMIT 1
      `, [name]);

      if (exactMatch) {
        return await this.convertDbRowToCard(exactMatch);
      }

      // Fallback to case-insensitive exact match
      exactMatch = await this.db.get(`
        SELECT c.*, 
               ci.scryfallId,
               cl.alchemy, cl.brawl, cl.commander, cl.duel, cl.explorer, cl.future, cl.gladiator,
               cl.historic, cl.legacy, cl.modern, cl.oathbreaker, cl.oldschool, cl.pauper,
               cl.paupercommander, cl.penny, cl.pioneer, cl.predh, cl.premodern, cl.standard,
               cl.standardbrawl, cl.timeless, cl.vintage,
               s.name as setName,
               cpu.cardKingdom, cpu.cardmarket, cpu.tcgplayer,
               crl.gatherer, crl.edhrec
        FROM cards c
        LEFT JOIN cardIdentifiers ci ON c.uuid = ci.uuid
        LEFT JOIN cardLegalities cl ON c.uuid = cl.uuid
        LEFT JOIN sets s ON c.setCode = s.code
        LEFT JOIN cardPurchaseUrls cpu ON c.uuid = cpu.uuid
        LEFT JOIN cardRelatedLinks crl ON c.uuid = crl.uuid
        WHERE lower(c.name) = lower(?) AND (c.language = "English" OR c.language IS NULL) 
        LIMIT 1
      `, [name]);

      if (exactMatch) {
        return await this.convertDbRowToCard(exactMatch);
      }

      // Fuzzy match as last resort
      const fuzzyMatch = await this.db.get(`
        SELECT c.*, 
               ci.scryfallId,
               cl.alchemy, cl.brawl, cl.commander, cl.duel, cl.explorer, cl.future, cl.gladiator,
               cl.historic, cl.legacy, cl.modern, cl.oathbreaker, cl.oldschool, cl.pauper,
               cl.paupercommander, cl.penny, cl.pioneer, cl.predh, cl.premodern, cl.standard,
               cl.standardbrawl, cl.timeless, cl.vintage,
               s.name as setName,
               cpu.cardKingdom, cpu.cardmarket, cpu.tcgplayer,
               crl.gatherer, crl.edhrec
        FROM cards c
        LEFT JOIN cardIdentifiers ci ON c.uuid = ci.uuid
        LEFT JOIN cardLegalities cl ON c.uuid = cl.uuid
        LEFT JOIN sets s ON c.setCode = s.code
        LEFT JOIN cardPurchaseUrls cpu ON c.uuid = cpu.uuid
        LEFT JOIN cardRelatedLinks crl ON c.uuid = crl.uuid
        WHERE lower(c.name) LIKE lower(?) AND (c.language = "English" OR c.language IS NULL) 
        LIMIT 1
      `, [`%${name}%`]);

      return fuzzyMatch ? await this.convertDbRowToCard(fuzzyMatch) : null;
    } catch (error) {
      console.error('Error finding card by name:', error);
      return null;
    }
  }

  // Optimized function to find cards by name, set, and collector number for precise artwork matching
  async findCardByDetails(name, setCode, collectorNumber) {
    if (!this.db || !this.initialized) {
      return null;
    }

    // Validate that name is provided and not undefined
    if (!name || name === 'undefined' || typeof name !== 'string' || name.trim() === '') {
      // Enhanced debugging: log additional context and stack trace once per session
      if (!this._invalidNameDebugCount) this._invalidNameDebugCount = 0;
      this._invalidNameDebugCount++;

      console.warn(`⚠️ findCardByDetails called with invalid name: "${name}" | setCode: "${setCode}", collectorNumber: "${collectorNumber}" (occurrence #${this._invalidNameDebugCount})`);
      if (this._invalidNameDebugCount <= 10) {
        // Print stack trace for the first few occurrences to locate the caller
        console.trace('findCardByDetails invalid name stack trace');
      }
      return null;
    }

    try {
      // First try exact case match (fastest with composite index)
      let exactMatch = await this.db.get(`
        SELECT c.*, 
               ci.scryfallId,
               cl.alchemy, cl.brawl, cl.commander, cl.duel, cl.explorer, cl.future, cl.gladiator,
               cl.historic, cl.legacy, cl.modern, cl.oathbreaker, cl.oldschool, cl.pauper,
               cl.paupercommander, cl.penny, cl.pioneer, cl.predh, cl.premodern, cl.standard,
               cl.standardbrawl, cl.timeless, cl.vintage,
               s.name as setName,
               cpu.cardKingdom, cpu.cardmarket, cpu.tcgplayer,
               crl.gatherer, crl.edhrec,

               /* JSON array of all price records for this card */
          (
            SELECT json_group_array(
              json_object(
                'vendor',           dp2.vendor,
                'price',            dp2.price,
                'transaction_type', dp2.transaction_type,
                'card_type',        dp2.card_type,
                'date',             dp2.date,
                'currency',         dp2.currency
              )
            )
            FROM daily_prices AS dp2
            WHERE dp2.uuid = c.uuid
          ) AS prices_json

        FROM cards c
        LEFT JOIN cardIdentifiers ci ON c.uuid = ci.uuid
        LEFT JOIN cardLegalities cl ON c.uuid = cl.uuid
        LEFT JOIN sets s ON c.setCode = s.code
        LEFT JOIN cardPurchaseUrls cpu ON c.uuid = cpu.uuid
        LEFT JOIN cardRelatedLinks crl ON c.uuid = crl.uuid
        WHERE c.name = ? 
          AND c.setCode = ? 
          AND c.number = ? 
          AND (c.language = "English" OR c.language IS NULL)
        LIMIT 1
      `, [name, setCode, collectorNumber]);
      if (exactMatch) {
        const cardData = await this.convertDbRowToCard(exactMatch);
        // console.log(`Found exact match for ${name} (${setCode}) #${collectorNumber} - Language: ${cardData.lang || 'en'}`);
        return cardData;
      }

      // Try case-insensitive match with English preference
      exactMatch = await this.db.get(`
        SELECT c.*, 
               ci.scryfallId,
               cl.alchemy, cl.brawl, cl.commander, cl.duel, cl.explorer, cl.future, cl.gladiator,
               cl.historic, cl.legacy, cl.modern, cl.oathbreaker, cl.oldschool, cl.pauper,
               cl.paupercommander, cl.penny, cl.pioneer, cl.predh, cl.premodern, cl.standard,
               cl.standardbrawl, cl.timeless, cl.vintage,
               s.name as setName,
               cpu.cardKingdom, cpu.cardmarket, cpu.tcgplayer,
               crl.gatherer, crl.edhrec,

               /* JSON array of all price records for this card */
          (
            SELECT json_group_array(
              json_object(
                'vendor',           dp2.vendor,
                'price',            dp2.price,
                'transaction_type', dp2.transaction_type,
                'card_type',        dp2.card_type,
                'date',             dp2.date,
                'currency',         dp2.currency
              )
            )
            FROM daily_prices AS dp2
            WHERE dp2.uuid = c.uuid
          ) AS prices_json

        FROM cards c
        LEFT JOIN cardIdentifiers ci ON c.uuid = ci.uuid
        LEFT JOIN cardLegalities cl ON c.uuid = cl.uuid
        LEFT JOIN sets s ON c.setCode = s.code
        LEFT JOIN cardPurchaseUrls cpu ON c.uuid = cpu.uuid
        LEFT JOIN cardRelatedLinks crl ON c.uuid = crl.uuid
        WHERE lower(c.name) = lower(?) 
          AND lower(c.setCode) = lower(?) 
          AND c.number = ? 
          AND (c.language = "English" OR c.language IS NULL)
        LIMIT 1
      `, [name, setCode, collectorNumber]);

      if (exactMatch) {
        const cardData = await this.convertDbRowToCard(exactMatch);
        // console.log(`Found exact match for ${name} (${setCode}) #${collectorNumber} - Language: ${cardData.lang || 'en'}`);
        return cardData;
      }

      // Try match without collector number (in case it's formatted differently)
      const setMatch = await this.db.get(`
        SELECT c.*, 
               ci.scryfallId,
               cl.alchemy, cl.brawl, cl.commander, cl.duel, cl.explorer, cl.future, cl.gladiator,
               cl.historic, cl.legacy, cl.modern, cl.oathbreaker, cl.oldschool, cl.pauper,
               cl.paupercommander, cl.penny, cl.pioneer, cl.predh, cl.premodern, cl.standard,
               cl.standardbrawl, cl.timeless, cl.vintage,
               s.name as setName,
               cpu.cardKingdom, cpu.cardmarket, cpu.tcgplayer,
               crl.gatherer, crl.edhrec,

               /* JSON array of all price records for this card */
          (
            SELECT json_group_array(
              json_object(
                'vendor',           dp2.vendor,
                'price',            dp2.price,
                'transaction_type', dp2.transaction_type,
                'card_type',        dp2.card_type,
                'date',             dp2.date,
                'currency',         dp2.currency
              )
            )
            FROM daily_prices AS dp2
            WHERE dp2.uuid = c.uuid
          ) AS prices_json

        FROM cards c
        LEFT JOIN cardIdentifiers ci ON c.uuid = ci.uuid
        LEFT JOIN cardLegalities cl ON c.uuid = cl.uuid
        LEFT JOIN sets s ON c.setCode = s.code
        LEFT JOIN cardPurchaseUrls cpu ON c.uuid = cpu.uuid
        LEFT JOIN cardRelatedLinks crl ON c.uuid = crl.uuid
        WHERE lower(c.name) = lower(?) 
          AND lower(c.setCode) = lower(?) 
          AND (c.language = "English" OR c.language IS NULL) 
        LIMIT 1
      `, [name, setCode]);

      if (setMatch) {
        const card = await this.convertDbRowToCard(setMatch);
        console.log(`Found set match for ${name} (${setCode}), but collector number ${collectorNumber} didn't match ${card.collector_number} - Language: ${card.lang || 'en'}`);
        return card;
      }

      // Fallback to name-only search
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
      databaseBuiltAt: this.metadata?.database_built_at,
      builtWith: this.metadata?.built_with,
      version: this.metadata?.version,
      initialized: this.initialized,
      databaseFile: DATABASE_FILE
    };
  }

  async close() {
    if (this.db) {
      await this.db.close();
      console.log('Bulk data database connection closed.');
    }
  }

  async searchCardsSemantic(query, options = {}) {
    if (!this.initialized) {
      console.warn('Bulk data service not ready for semantic search.');
      return [];
    }

    // Enhance the query for better MTG-specific results
    const enhancedQuery = this.enhanceSemanticQuery(query);
    console.log(`🔍 Enhanced query: "${query}" → "${enhancedQuery}"`);

    return await semanticSearchService.search(enhancedQuery, options);
  }

  enhanceSemanticQuery(query) {
    if (!query || typeof query !== 'string') return query;

    let enhanced = query.toLowerCase();

    // MTG-specific term expansions
    const termExpansions = {
      // Creature types and tribal
      'elves': 'elf elves tribal',
      'goblins': 'goblin goblins tribal',
      'zombies': 'zombie zombies tribal',
      'dragons': 'dragon dragons tribal',
      'angels': 'angel angels tribal',
      'vampires': 'vampire vampires tribal',
      'humans': 'human humans tribal',
      'artifacts': 'artifact artifacts metalcraft affinity',

      // Mechanics and strategies
      'counterspells': 'counter target spell instant',
      'card draw': 'draw cards card advantage',
      'ramp': 'search basic land mana acceleration',
      'removal': 'destroy target exile target creature removal',
      'board wipe': 'destroy all creatures mass removal',
      'lifegain': 'gain life lifelink life total',
      'tokens': 'create token creature tokens populate',
      'graveyard': 'graveyard flashback unearth dredge recursion',
      'combo': 'infinite combo tutor search library',
      'protection': 'hexproof shroud indestructible protection',

      // Card types
      'instants': 'instant spells flash speed',
      'sorceries': 'sorcery spells main phase',
      'enchantments': 'enchantment permanent aura',
      'planeswalkers': 'planeswalker loyalty ultimate',
      'lands': 'land mana base fixing',

      // Power/toughness patterns
      'big creatures': 'high power large toughness',
      'small creatures': 'low mana cost efficient creatures',
      'flying creatures': 'flying creature evasion',
      'trample creatures': 'trample creature damage',

      // Format-specific
      'commander': 'legendary creature command zone',
      'edh': 'commander multiplayer legendary',
      'multiplayer': 'each opponent all opponents',

      // Colors and identity
      'white cards': 'white mana cost plains',
      'blue cards': 'blue mana cost island',
      'black cards': 'black mana cost swamp',
      'red cards': 'red mana cost mountain',
      'green cards': 'green mana cost forest',
      'multicolor': 'multicolored hybrid mana',
      'colorless': 'colorless artifact eldrazi'
    };

    // Apply term expansions
    Object.entries(termExpansions).forEach(([term, expansion]) => {
      if (enhanced.includes(term)) {
        enhanced = enhanced.replace(new RegExp(term, 'g'), expansion);
      }
    });

    // Handle specific patterns

    // Power/toughness queries
    const powerMatch = enhanced.match(/(\d+)\s*power/);
    const toughnessMatch = enhanced.match(/(\d+)\s*toughness/);
    if (powerMatch) {
      enhanced += ` ${powerMatch[1]}/${powerMatch[1]} power toughness creature`;
    }
    if (toughnessMatch) {
      enhanced += ` ${toughnessMatch[1]}/${toughnessMatch[1]} power toughness creature`;
    }

    // Mana cost queries
    const manaMatch = enhanced.match(/(\d+)\s*mana(?:\s+cost)?/);
    if (manaMatch) {
      enhanced += ` converted mana cost ${manaMatch[1]} cmc`;
    }

    // Color combination queries
    const colorCombos = {
      'azorius': 'white blue',
      'dimir': 'blue black',
      'rakdos': 'black red',
      'gruul': 'red green',
      'selesnya': 'green white',
      'orzhov': 'white black',
      'izzet': 'blue red',
      'golgari': 'black green',
      'boros': 'red white',
      'simic': 'green blue'
    };

    Object.entries(colorCombos).forEach(([guild, colors]) => {
      if (enhanced.includes(guild)) {
        enhanced = enhanced.replace(new RegExp(guild, 'g'), colors);
      }
    });

    // Add context for better semantic understanding
    if (!enhanced.includes('magic') && !enhanced.includes('mtg')) {
      enhanced = `${enhanced}`;
    }

    return enhanced.trim();
  }

  async getCardsByIds(ids) {
    if (!this.db || !ids || ids.length === 0) {
      return [];
    }

    const placeholders = ids.map(() => '?').join(',');
    const sql = `
      SELECT * FROM cards WHERE uuid IN (${placeholders}) OR id IN (${placeholders})
    `;

    try {
      const rows = await this.db.all(sql, [...ids, ...ids]);
      return Promise.all(rows.map(row => this.convertDbRowToCard(row)));
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
      // Check if we have a dedicated sets table, otherwise aggregate from cards
      const setsTable = await this.db.all("SELECT name FROM sqlite_master WHERE type='table' AND name='sets'");

      if (setsTable.length > 0) {
        // Use dedicated sets table if available - optimized with LEFT JOIN
        const rows = await this.db.all(
          `SELECT s.code, s.name, s.releaseDate as released_at, 
           s.totalSetSize as total_set_size,
           COALESCE(c.card_count, 0) as card_count,
           s.type, s.block
           FROM sets s
           LEFT JOIN (
             SELECT setCode, COUNT(*) as card_count 
             FROM cards 
             GROUP BY setCode
           ) c ON s.code = c.setCode
           ORDER BY s.releaseDate DESC`
        );
        return rows;
      } else {
        // Fallback: aggregate from cards table
        const rows = await this.db.all(
          `SELECT setCode AS code, 
           MIN(setName) AS name, 
           MIN(releaseDate) AS released_at, 
           COUNT(*) AS card_count
           FROM cards
           WHERE setCode IS NOT NULL
           GROUP BY setCode
           ORDER BY MIN(releaseDate) DESC`
        );
        return rows;
      }
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
        `SELECT c.*, 
               ci.scryfallId,
               cl.alchemy, cl.brawl, cl.commander, cl.duel, cl.explorer, cl.future, cl.gladiator,
               cl.historic, cl.legacy, cl.modern, cl.oathbreaker, cl.oldschool, cl.pauper,
               cl.paupercommander, cl.penny, cl.pioneer, cl.predh, cl.premodern, cl.standard,
               cl.standardbrawl, cl.timeless, cl.vintage,
               s.name as setName,
               cpu.cardKingdom, cpu.cardmarket, cpu.tcgplayer,
               crl.gatherer, crl.edhrec,

               /* JSON array of all price records for this card */
          (
            SELECT json_group_array(
              json_object(
                'vendor',           dp2.vendor,
                'price',            dp2.price,
                'transaction_type', dp2.transaction_type,
                'card_type',        dp2.card_type,
                'date',             dp2.date,
                'currency',         dp2.currency
              )
            )
            FROM daily_prices AS dp2
            WHERE dp2.uuid = c.uuid
          ) AS prices_json
        FROM cards c
        LEFT JOIN cardIdentifiers ci ON c.uuid = ci.uuid
        LEFT JOIN cardLegalities cl ON c.uuid = cl.uuid
        LEFT JOIN sets s ON c.setCode = s.code
        LEFT JOIN cardPurchaseUrls cpu ON c.uuid = cpu.uuid
        LEFT JOIN cardRelatedLinks crl ON c.uuid = crl.uuid
        WHERE lower(c.setCode) = lower(?) 
        ORDER BY CAST(c.number AS INTEGER) ASC 
        LIMIT ?`,
        [setCode, limit]
      );
      return Promise.all(rows.map(row => this.convertDbRowToCard(row)));
    } catch (error) {
      console.error(`Error fetching cards for set ${setCode}:`, error);
      return [];
    }
  }

  ensureSemanticSearchInitialized() {
    // This is designed to be called multiple times, but the underlying
    // service will only initialize once.
    return semanticSearchService.initialize();
  }

  async importCSV(filePath, collectionName) {
    try {
      console.log(`📥 Importing CSV collection: ${collectionName} from ${filePath}`);

      // ... existing code ...
    } catch (error) {
      console.error(`Error importing CSV collection: ${collectionName}:`, error);
    }
  }

  async _ensureRelatedLinksData() {
    console.log('Ensuring related links data is populated...');
    // 1. Create table if it doesn't exist
    await this.db.exec(`
      CREATE TABLE IF NOT EXISTS cardRelatedLinks (
        uuid TEXT PRIMARY KEY,
        gatherer TEXT,
        edhrec TEXT
      )
    `);

    // 2. Check if table is already populated
    const check = await this.db.get('SELECT COUNT(*) as count FROM cardRelatedLinks');
    if (check && check.count > 0) {
      console.log(`Related links table is already populated with ${check.count} entries.`);
      return;
    }

    console.log('Related links table is empty, proceeding with import...');

    // 3. Check if the bulk JSON file exists
    const cardsFileExists = fsSync.existsSync(CARDS_FILE);
    if (!cardsFileExists) {
      console.warn(`Could not find cards.json at ${CARDS_FILE}. Cannot populate related links.`);
      return;
    }

    console.log(`Populating related links from ${CARDS_FILE}. This is a one-time operation and may take a moment...`);
    this._broadcast('task-progress', { task: 'import', state: 'start', percent: 0 });

    let stmt;
    let transactionStarted = false;
    try {
      // The database is already in WAL mode from initializeDatabase()

      // 1. Use a prepared statement for efficient inserts
      stmt = await this.db.prepare(
        'INSERT OR IGNORE INTO cardRelatedLinks (uuid, gatherer, edhrec) VALUES (?, ?, ?)'
      );

      // 2. Manually handle the transaction
      await this.db.exec('BEGIN IMMEDIATE');
      transactionStarted = true;

      // 3. Create a back-pressure aware stream pipeline
      const readStream = fsSync.createReadStream(CARDS_FILE, { highWaterMark: 1 << 16 });
      const pipeline = chain([
        readStream,
        parser(),
        streamValues(),
        (data) => data.value, // unwrap the card object
        batch({ batchSize: 1000 }), // batch 1000 cards at a time
      ]);

      // Get total file size to estimate progress
      const stats = fsSync.statSync(CARDS_FILE);
      const totalSize = stats.size;
      let processed = 0;

      for await (const cards of pipeline) {
        // Run insertions for the batch
        for (const c of cards) {
          // Scryfall bulk data objects use the property `id` as the unique UUID. Previous versions of
          // this importer expected a `uuid` property, which resulted in zero rows being inserted.
          // Gracefully handle both to maintain backward compatibility.
          const uuid = c.uuid || c.id;
          if (uuid && c.related_uris) {
            await stmt.run(uuid, c.related_uris.gatherer ?? null, c.related_uris.edhrec ?? null);
          }
        }

        processed += cards.length;
        const processedBytes = readStream.bytesRead;
        const percent = Math.round((processedBytes / totalSize) * 100);

        if (processed % 25000 < 1000) {
          console.log(`[Link Importer] ${processed} cards done (${percent}%)`);
          this._broadcast('task-progress', { task: 'import', state: 'progress', percent });
        }
      }

      // 4. Finalize the transaction
      await this.db.exec('COMMIT');
      transactionStarted = false;

      // 5. Force a checkpoint with proper error handling
      try {
        console.log('Checkpointing WAL to main database...');
        const result = await this.db.get('PRAGMA wal_checkpoint(TRUNCATE)');
        console.log('WAL checkpoint result:', result);

        // Verify data was written
        const count = await this.db.get('SELECT COUNT(*) as count FROM cardRelatedLinks');
        console.log(`Verification: ${count.count} related links in database`);
      } catch (checkpointErr) {
        console.warn('WAL checkpoint failed, but transaction was committed:', checkpointErr);
        // Data should still be available, just not immediately visible in other connections
      }

      console.log(`Finished populating related links. Total cards processed: ${processed}`);
      this._broadcast('task-progress', { task: 'import', state: 'done' });
    } catch (err) {
      console.error('Fatal error during related links import:', err);
      // Attempt to rollback transaction on error
      if (transactionStarted) {
        try {
          await this.db.exec('ROLLBACK');
        } catch (rollbackErr) {
          console.error('Failed to rollback transaction:', rollbackErr);
        }
      }
      this._broadcast('task-progress', { task: 'import', state: 'fail', error: 'Failed to populate related links.' });
      throw err;
    } finally {
      // 6. Finalize the statement to release its resources
      if (stmt) {
        try {
          await stmt.finalize();
        } catch (finalizeErr) {
          console.error('Failed to finalize statement:', finalizeErr);
        }
      }
    }
  }

  async forceImportRelatedLinks() {
    console.log('Force importing related links data...');

    // Clear existing data
    await this.db.exec('DELETE FROM cardRelatedLinks');
    console.log('Cleared existing related links data');

    // Re-run the import
    await this._ensureRelatedLinksData();
  }

  async testOraclePatternAnalysis(cardName) {
    console.log('[DEBUG] testOraclePatternAnalysis called with:', cardName);
    if (!this.db || !this.initialized) {
      console.log('[DEBUG] Database not initialized:', { db: !!this.db, initialized: !!this.initialized });
      return { error: 'Database not initialized' };
    }

    try {
      // Find the card by name
      const card = await this.findCardByName(cardName);
      console.log('[DEBUG] Card lookup result:', card);
      if (!card) {
        return { error: `Card not found: ${cardName}` };
      }

      // Get oracle text
      const oracleText = card.oracle_text || card.text || '';
      console.log('[DEBUG] Oracle text:', oracleText);
      if (!oracleText) {
        return { error: 'No oracle text available for this card' };
      }

      // Basic pattern analysis
      const patterns = {
        cardName: cardName,
        oracleText: oracleText,
        wordCount: oracleText.split(/\s+/).length,
        sentenceCount: oracleText.split(/[.!?]+/).filter(s => s.trim()).length,
        hasDraw: /draw\s+\d+\s+card/i.test(oracleText),
        hasDestroy: /destroy\s+target/i.test(oracleText),
        hasExile: /exile\s+target/i.test(oracleText),
        hasCounter: /counter\s+target\s+spell/i.test(oracleText),
        hasFlying: /\bflying\b/i.test(oracleText),
        hasTrample: /\btrample\b/i.test(oracleText),
        hasFirstStrike: /\bfirst\s+strike\b/i.test(oracleText),
        hasDeathtouch: /\bdeathtouch\b/i.test(oracleText),
        hasLifelink: /\blifelink\b/i.test(oracleText),
        hasVigilance: /\bvigilance\b/i.test(oracleText),
        hasHaste: /\bhaste\b/i.test(oracleText),
        hasHexproof: /\bhexproof\b/i.test(oracleText),
        hasShroud: /\bshroud\b/i.test(oracleText),
        hasIndestructible: /\bindestructible\b/i.test(oracleText),
        manaCost: card.mana_cost || card.manaCost || '',
        manaValue: card.mana_value || card.cmc || 0,
        power: card.power,
        toughness: card.toughness,
        type: card.type_line || card.type || '',
        rarity: card.rarity,
        colors: card.colors || [],
        keywords: card.keywords || []
      };

      return {
        success: true,
        card: card,
        patterns: patterns
      };
    } catch (error) {
      console.error('Error in testOraclePatternAnalysis:', error);
      return { error: error.message };
    }
  }
}

// Export singleton instance
const bulkDataService = new BulkDataService();

module.exports = bulkDataService; 