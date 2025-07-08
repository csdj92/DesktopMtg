const fs = require('fs').promises;
const path = require('path');
const { parse } = require('csv-parse/sync');
const sqlite3 = require('sqlite3').verbose();
const { open } = require('sqlite');
const { app } = require('electron');
const { resolveDatabasePath } = require('./dbPathResolver.cjs');

// Use the same database as the bulk data service
const DATABASE_FILE = resolveDatabasePath();

class CollectionImporter {
  constructor() {
    this.db = null;
    this.isSyncing = false;
  }

  // Retry mechanism for database operations
  async retryOperation(operation, maxRetries = 5, baseDelay = 100) {
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        return await operation();
      } catch (error) {
        if (error.code === 'SQLITE_BUSY' && attempt < maxRetries - 1) {
          const delay = baseDelay * Math.pow(2, attempt) + Math.random() * 100;
          console.log(`⏳ Database busy, retrying in ${delay}ms (attempt ${attempt + 1}/${maxRetries})`);
          await new Promise(resolve => setTimeout(resolve, delay));
          continue;
        }
        throw error;
      }
    }
  }

  async initialize() {
    try {
      this.db = await open({
        filename: DATABASE_FILE,
        driver: sqlite3.Database
      });

      // Improve concurrency: allow reads & writes simultaneously and wait a bit on busy locks
      await this.db.exec('PRAGMA journal_mode = WAL');
      await this.db.exec('PRAGMA busy_timeout = 30000'); // Increased from 5000 to 30000ms
      await this.db.exec('PRAGMA synchronous = NORMAL'); // Faster writes
      await this.db.exec('PRAGMA cache_size = 10000'); // Better performance
      await this.db.exec('PRAGMA temp_store = memory'); // Use memory for temp tables

      // Create collections table with camelCase column names if it doesn't exist
      await this.db.exec(`
        CREATE TABLE IF NOT EXISTS user_collections (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          collectionName TEXT NOT NULL,
          cardName TEXT NOT NULL,
          setCode TEXT,
          setName TEXT,
          collectorNumber TEXT,
          foil TEXT DEFAULT 'normal',
          rarity TEXT,
          quantity INTEGER DEFAULT 1,
          condition TEXT DEFAULT 'near_mint',
          language TEXT DEFAULT 'en',
          purchasePrice REAL,
          currency TEXT DEFAULT 'USD',
          binderName TEXT,
          binderType TEXT,
          manaboxId TEXT,
          scryfallId TEXT,
          misprint BOOLEAN DEFAULT 0,
          altered BOOLEAN DEFAULT 0,
          notes TEXT,
          importedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(collectionName, cardName, setCode, collectorNumber, foil)
        );
        
        CREATE INDEX IF NOT EXISTS idx_collection_name ON user_collections(collectionName);
        CREATE INDEX IF NOT EXISTS idx_card_name ON user_collections(cardName);
        CREATE INDEX IF NOT EXISTS idx_set_code ON user_collections(setCode);
      `);

      console.log('Collection database initialized');
      return true;
    } catch (error) {
      console.error('Failed to initialize collection database:', error);
      return false;
    }
  }

  async importCSV(filePath, collectionName) {
    try {
      console.log(`📥 Importing CSV collection: ${collectionName} from ${filePath}`);

      const fileContent = await fs.readFile(filePath, 'utf-8');

      // Parse CSV with headers
      const records = parse(fileContent, {
        columns: true,
        skip_empty_lines: true,
        trim: true
      });

      console.log(`📊 Found ${records.length} cards in CSV`);

      let imported = 0;
      let skipped = 0;
      let errors = 0;
      const batchSize = 50; // Process in smaller batches to reduce lock time

      // Process records in batches
      for (let i = 0; i < records.length; i += batchSize) {
        const batch = records.slice(i, i + batchSize);

        await this.retryOperation(async () => {
          await this.db.exec('BEGIN IMMEDIATE TRANSACTION');

          const insertStmt = await this.db.prepare(`
            INSERT OR REPLACE INTO user_collections 
            (collectionName, cardName, setCode, setName, collectorNumber, foil, rarity, 
             quantity, condition, language, purchasePrice, currency, binderName, binderType,
             manaboxId, scryfallId, misprint, altered)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `);

          try {
            for (const record of batch) {
              try {
                // Handle different CSV formats
                const cardName = record.Name || record['Card Name'] || record.name;
                const setCode = record['Set code'] || record['Set Code'] || record.set_code || record.set;
                const setName = record['Set name'] || record['Set Name'] || record.set_name;
                const collectorNumber = record['Collector number'] || record['Collector Number'] || record.collector_number;
                const foil = this.normalizeFoil(record.Foil || record.foil || 'normal');
                const rarity = record.Rarity || record.rarity || '';
                const quantity = parseInt(record.Quantity || record.quantity || '1');
                const condition = this.normalizeCondition(record.Condition || record.condition || 'near_mint');
                const language = record.Language || record.language || 'en';
                const purchasePrice = parseFloat(record['Purchase price'] || record.price || '0') || 0;
                const currency = record['Purchase price currency'] || record.currency || 'USD';
                const binderName = record['Binder Name'] || record.binder || '';
                const binderType = record['Binder Type'] || record.type || '';
                const manaboxId = record['ManaBox ID'] || record.manabox_id || '';
                const scryfallId = record['Scryfall ID'] || record.scryfall_id || '';
                const misprint = this.parseBoolean(record.Misprint || record.misprint);
                const altered = this.parseBoolean(record.Altered || record.altered);

                if (!cardName) {
                  console.warn('⚠️ Skipping row with missing card name:', record);
                  skipped++;
                  continue;
                }

                await insertStmt.run([
                  collectionName,
                  cardName,
                  setCode || '',
                  setName || '',
                  collectorNumber || '',
                  foil,
                  rarity,
                  quantity,
                  condition,
                  language,
                  purchasePrice,
                  currency,
                  binderName,
                  binderType,
                  manaboxId,
                  scryfallId,
                  misprint ? 1 : 0,
                  altered ? 1 : 0
                ]);

                imported++;

              } catch (error) {
                console.error('Error importing card:', record, error);
                errors++;
              }
            }
          } finally {
            await insertStmt.finalize();
          }

          await this.db.exec('COMMIT');
        });

        // Progress update every 100 cards
        if (imported % 100 === 0) {
          console.log(`🚀 Progress: ${imported} cards imported...`);
        }
      }

      console.log(`✅ CSV import complete for "${collectionName}"`);
      console.log(`📊 Results: ${imported} imported, ${skipped} skipped, ${errors} errors`);

      // Sync collection to main database
      const syncResult = await this.syncCollectionToMainDatabase();

      return {
        success: true,
        imported,
        skipped,
        errors,
        total: records.length,
        syncResult
      };

    } catch (error) {
      try {
        await this.db.exec('ROLLBACK');
      } catch (rollbackError) {
        console.error('Error during rollback:', rollbackError);
      }
      console.error('CSV import failed:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  async importTXT(filePath, collectionName, format = 'simple') {
    try {
      console.log(`📥 Importing TXT collection: ${collectionName} from ${filePath}`);

      const fileContent = await fs.readFile(filePath, 'utf-8');
      const lines = fileContent.split('\n').map(line => line.trim()).filter(line => line);

      console.log(`📊 Found ${lines.length} lines in TXT file`);

      let imported = 0;
      let skipped = 0;
      let errors = 0;
      const batchSize = 50; // Process in smaller batches to reduce lock time

      // Process lines in batches
      for (let i = 0; i < lines.length; i += batchSize) {
        const batch = lines.slice(i, i + batchSize);

        await this.retryOperation(async () => {
          await this.db.exec('BEGIN IMMEDIATE TRANSACTION');

          const insertStmt = await this.db.prepare(`
            INSERT OR REPLACE INTO user_collections 
            (collectionName, cardName, setCode, collectorNumber, quantity, foil)
            VALUES (?, ?, ?, ?, ?, ?)
          `);

          try {
            for (const line of batch) {
              try {
                // Skip comments and empty lines
                if (line.startsWith('#') || line.startsWith('//') || !line) {
                  continue;
                }

                const cardData = this.parseTXTLine(line, format);

                if (!cardData.name || cardData.name.trim() === '') {
                  console.warn('⚠️ Skipping line with no card name:', line, 'Parsed data:', cardData);
                  skipped++;
                  continue;
                }

                // Debug logging for the first few cards
                if (imported < 3) {
                  console.log(`🔍 Debug: Line "${line}" parsed as:`, cardData);
                }

                await insertStmt.run([
                  collectionName,
                  cardData.name,
                  cardData.setCode || '',
                  cardData.collectorNumber || '',
                  cardData.quantity || 1,
                  cardData.foil || 'normal'
                ]);

                imported++;

              } catch (error) {
                console.error('Error importing line:', line, error);
                errors++;
              }
            }
          } finally {
            await insertStmt.finalize();
          }

          await this.db.exec('COMMIT');
        });

        // Progress update
        if (imported % 100 === 0) {
          console.log(`🚀 Progress: ${imported} cards imported...`);
        }
      }

      console.log(`✅ TXT import complete for "${collectionName}"`);
      console.log(`📊 Results: ${imported} imported, ${skipped} skipped, ${errors} errors`);

      // Sync collection to main database
      console.log('🔄 Starting collection sync to main database...');
      const syncResult = await this.syncCollectionToMainDatabase();
      console.log('✅ Collection sync completed, import process finished!');

      return {
        success: true,
        imported,
        skipped,
        errors,
        total: lines.length,
        syncResult
      };

    } catch (error) {
      try {
        await this.db.exec('ROLLBACK');
      } catch (rollbackError) {
        console.error('Error during rollback:', rollbackError);
      }
      console.error('TXT import failed:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  parseTXTLine(line, format) {
    // Support multiple TXT formats
    switch (format) {
      case 'mtgo': // MTGO format: "4x Lightning Bolt"
        const mtgoMatch = line.match(/^(\d+)x?\s+(.+)$/);
        if (mtgoMatch) {
          return {
            quantity: parseInt(mtgoMatch[1]),
            name: mtgoMatch[2].trim()
          };
        }
        break;

      case 'detailed': // "4 Lightning Bolt (M10) 123 [foil]"
        const detailedMatch = line.match(/^(\d+)\s+([^(]+?)(?:\s*\(([^)]+)\))?(?:\s+(\d+[a-z]?))?(?:\s*\[(foil|nonfoil)\])?$/i);
        if (detailedMatch) {
          return {
            quantity: parseInt(detailedMatch[1]),
            name: detailedMatch[2].trim(),
            setCode: detailedMatch[3] || '',
            collectorNumber: detailedMatch[4] || '',
            foil: detailedMatch[5] ? (detailedMatch[5].toLowerCase() === 'foil' ? 'foil' : 'normal') : 'normal'
          };
        }
        break;

      case 'deckbox': // "1x Lightning Bolt [M10]"
        const deckboxMatch = line.match(/^(\d+)x?\s+([^[]+?)(?:\s*\[([^\]]+)\])?$/);
        if (deckboxMatch) {
          return {
            quantity: parseInt(deckboxMatch[1]),
            name: deckboxMatch[2].trim(),
            setCode: deckboxMatch[3] || ''
          };
        }
        break;

      default: // Simple format: just card names, one per line, with optional quantity
        const simpleMatch = line.match(/^(?:(\d+)x?\s+)?(.+)$/);
        if (simpleMatch) {
          const quantity = parseInt(simpleMatch[1]) || 1;
          let rawName = simpleMatch[2].trim();

          // Auto-detect pattern: "Card Name (SET) 123" (optional foil marker *F*)
          const detailedLike = rawName.match(/^(.+?)\s*\(([^)]+)\)\s+(\S+)(?:\s+\*F\*)?$/i);
          if (detailedLike) {
            return {
              quantity,
              name: detailedLike[1].trim(),
              setCode: detailedLike[2].trim(),
              collectorNumber: detailedLike[3].trim(),
              foil: /\*F\*/i.test(rawName) ? 'foil' : 'normal'
            };
          }

          // Fallback – treat entire remainder as card name only
          return {
            quantity,
            name: rawName
          };
        }
    }

    // Fallback: treat entire line as card name
    return { name: line, quantity: 1 };
  }

  normalizeFoil(foil) {
    if (!foil) return 'normal';
    const normalized = foil.toString().toLowerCase();
    if (normalized === 'foil' || normalized === 'true' || normalized === '1') return 'foil';
    return 'normal';
  }

  normalizeCondition(condition) {
    if (!condition) return 'near_mint';
    const normalized = condition.toString().toLowerCase().replace(/[^a-z]/g, '');

    const conditionMap = {
      'nearmint': 'near_mint',
      'nm': 'near_mint',
      'mint': 'mint',
      'm': 'mint',
      'lightlyplayed': 'lightly_played',
      'lp': 'lightly_played',
      'moderatelyplayed': 'moderately_played',
      'mp': 'moderately_played',
      'heavilyplayed': 'heavily_played',
      'hp': 'heavily_played',
      'damaged': 'damaged',
      'dmg': 'damaged'
    };

    return conditionMap[normalized] || 'near_mint';
  }

  parseBoolean(value) {
    if (!value) return false;
    const str = value.toString().toLowerCase();
    return str === 'true' || str === '1' || str === 'yes';
  }

  async getCollections() {
    if (!this.db) return [];

    try {
      const collections = await this.db.all(`
        SELECT 
          collectionName,
          COUNT(*) as card_count,
          SUM(quantity) as total_cards,
          MAX(importedAt) as last_updated
        FROM user_collections 
        GROUP BY collectionName 
        ORDER BY collectionName
      `);

      return collections;
    } catch (error) {
      console.error('Error getting collections:', error);
      return [];
    }
  }

  async getCollection(collectionName, options = {}) {
    if (!this.db) return [];

    const { limit = 100, offset = 0, search = '' } = options;

    try {
      let query = `
        SELECT * FROM user_collections 
        WHERE collectionName = ?
      `;
      const params = [collectionName];

      if (search) {
        query += ` AND cardName LIKE ?`;
        params.push(`%${search}%`);
      }

      query += ` ORDER BY cardName LIMIT ? OFFSET ?`;
      params.push(limit, offset);

      const cards = await this.db.all(query, params);
      return cards;
    } catch (error) {
      console.error('Error getting collection:', error);
      return [];
    }
  }

  async deleteCollection(collectionName) {
    if (!this.db) return false;

    try {
      const result = await this.db.run(
        'DELETE FROM user_collections WHERE collection_name = ?',
        [collectionName]
      );

      console.log(`🗑️ Deleted collection "${collectionName}" (${result.changes} cards removed)`);
      return result.changes > 0;
    } catch (error) {
      console.error('Error deleting collection:', error);
      return false;
    }
  }

  async clearAllCollections() {
    if (!this.db) return false;

    try {
      const result = await this.db.run('DELETE FROM user_collections');
      console.log(`🗑️ Cleared all collections (${result.changes} records removed)`);
      return result.changes >= 0; // 0 changes is still success (table was already empty)
    } catch (error) {
      console.error('Error clearing all collections:', error);
      return false;
    }
  }

  async getCollectionStats(collectionName) {
    if (!this.db) return null;

    try {
      const stats = await this.db.get(`
        SELECT 
          COUNT(*) as unique_cards,
          SUM(quantity) as total_cards,
          COUNT(CASE WHEN foil = 'foil' THEN 1 END) as foil_cards,
          COUNT(DISTINCT set_code) as sets_count,
          AVG(CASE WHEN purchase_price > 0 THEN purchase_price END) as avg_price,
          SUM(CASE WHEN purchase_price > 0 THEN purchase_price * quantity END) as total_value
        FROM user_collections 
        WHERE collection_name = ?
      `, [collectionName]);

      return stats;
    } catch (error) {
      console.error('Error getting collection stats:', error);
      return null;
    }
  }

  async syncCollectionToMainDatabase() {
    if (!this.bulkDataService || !this.db) {
      console.warn('Cannot sync collection - bulk data service or database not available');
      return { success: false, error: 'Services not available' };
    }

    if (this.isSyncing) {
      console.log('🔄 Sync already in progress, skipping...');
      return { success: false, error: 'Sync already in progress' };
    }

    this.isSyncing = true;
    try {
      console.log('🔄 Syncing collection data to main database (Optimized with Token Support)...');
      const startTime = Date.now();

      // Step 1: Get all unique cards from user collections with their total quantities
      const collectedCardsSummary = await this.db.all(`
        SELECT 
          cardName        AS name,
          setCode         AS setCode,
          collectorNumber AS collectorNumber,
          SUM(quantity)    AS total_quantity
        FROM user_collections
        WHERE cardName IS NOT NULL AND trim(cardName) != ''
        GROUP BY lower(cardName), lower(setCode), collectorNumber
      `);

      if (collectedCardsSummary.length === 0) {
        console.log('No user collection cards to sync.');
        this.isSyncing = false;
        return { success: true, synced: 0, notFound: 0, total: 0 };
      }

      // Step 2: Get all unique card names and fetch all their printings at once from both cards and tokens.
      const uniqueNames = [...new Set(collectedCardsSummary.map(c => c.name.toLowerCase()))];
      const placeholders = uniqueNames.map(() => '?').join(',');

      // Search both cards and tokens tables
      const [allPrintings, allTokens] = await Promise.all([
        this.bulkDataService.db.all(
          `SELECT uuid, name, setCode, number, language, 'card' as type FROM cards WHERE lower(name) IN (${placeholders})`,
          uniqueNames
        ),
        this.bulkDataService.db.all(
          `SELECT uuid, name, setCode, number, language, 'token' as type FROM tokens WHERE lower(name) IN (${placeholders})`,
          uniqueNames
        )
      ]);

      // Step 3: Build a lookup map for fast access combining both cards and tokens.
      const printingsMap = new Map();
      const allResults = [...allPrintings, ...allTokens];

      for (const p of allResults) {
        const nameKey = p.name.toLowerCase();
        if (!printingsMap.has(nameKey)) {
          printingsMap.set(nameKey, []);
        }
        printingsMap.get(nameKey).push(p);
      }

      // Step 4: Get current collected state from database to minimize updates
      const [currentCards, currentTokens] = await Promise.all([
        this.bulkDataService.db.all('SELECT uuid, collected FROM cards WHERE collected > 0'),
        this.bulkDataService.db.all('SELECT uuid, collected FROM tokens WHERE collected > 0')
      ]);

      const currentCollectedMap = new Map();
      [...currentCards, ...currentTokens].forEach(item => {
        currentCollectedMap.set(item.uuid, item.collected);
      });

      const updates = [];
      const resets = []; // Cards/tokens that need to be reset to 0
      let notFound = 0;
      let tokensFound = 0;

      // Step 5: Loop through the summary and find matches IN MEMORY.
      const foundUuids = new Set();

      for (const collectedCard of collectedCardsSummary) {
        const potentialPrintings = printingsMap.get(collectedCard.name.toLowerCase());
        let bestMatch = null;

        if (potentialPrintings) {
          const lowerSetCode = collectedCard.setCode?.toLowerCase();

          // Prioritize cards over tokens, but still search tokens
          const cards = potentialPrintings.filter(p => p.type === 'card');
          const tokens = potentialPrintings.filter(p => p.type === 'token');

          // 1. Exact match in cards (name, set, number)
          bestMatch = cards.find(p =>
            lowerSetCode && collectedCard.collectorNumber &&
            p.setCode.toLowerCase() === lowerSetCode &&
            p.number === collectedCard.collectorNumber
          );

          // 2. Set match in cards (name, set) - prefer English for tie-breaking
          if (!bestMatch && lowerSetCode) {
            bestMatch = cards.find(p => p.setCode.toLowerCase() === lowerSetCode && p.language === 'en')
              || cards.find(p => p.setCode.toLowerCase() === lowerSetCode);
          }

          // 3. Name match in cards (any printing) - prefer English for tie-breaking
          if (!bestMatch && cards.length > 0) {
            bestMatch = cards.find(p => p.language === 'en') || cards[0];
          }

          // 4. If no card found, try tokens with same logic
          if (!bestMatch && tokens.length > 0) {
            // Exact match in tokens (name, set, number)
            bestMatch = tokens.find(p =>
              lowerSetCode && collectedCard.collectorNumber &&
              p.setCode.toLowerCase() === lowerSetCode &&
              p.number === collectedCard.collectorNumber
            );

            // Set match in tokens (name, set) - prefer English for tie-breaking
            if (!bestMatch && lowerSetCode) {
              bestMatch = tokens.find(p => p.setCode.toLowerCase() === lowerSetCode && p.language === 'en')
                || tokens.find(p => p.setCode.toLowerCase() === lowerSetCode);
            }

            // Name match in tokens (any printing) - prefer English for tie-breaking
            if (!bestMatch) {
              bestMatch = tokens.find(p => p.language === 'en') || tokens[0];
            }

            if (bestMatch) {
              tokensFound++;
              console.log(`🪙 Found token match for "${collectedCard.name}" (${bestMatch.setCode})`);
            }
          }
        }

        if (bestMatch) {
          foundUuids.add(bestMatch.uuid);
          const currentQuantity = currentCollectedMap.get(bestMatch.uuid) || 0;

          // Only update if quantity changed
          if (currentQuantity !== collectedCard.total_quantity) {
            updates.push({
              uuid: bestMatch.uuid,
              quantity: collectedCard.total_quantity,
              type: bestMatch.type
            });
          }
        } else {
          notFound++;
          console.warn(`⚠️ Could not find card or token in database: "${collectedCard.name}" (${collectedCard.setCode})`);
        }
      }

      // Step 6: Find cards/tokens that are currently collected but no longer in collections (need reset to 0)
      for (const [uuid, currentQuantity] of currentCollectedMap) {
        if (!foundUuids.has(uuid) && currentQuantity > 0) {
          resets.push(uuid);
        }
      }

      // Step 7: Perform optimized updates - only what changed
      const cardUpdates = updates.filter(u => u.type === 'card');
      const tokenUpdates = updates.filter(u => u.type === 'token');

      await this.retryOperation(async () => {
        await this.bulkDataService.db.exec('BEGIN IMMEDIATE TRANSACTION');
        console.log(`🔄 Optimized updates: ${cardUpdates.length} cards, ${tokenUpdates.length} tokens, ${resets.length} resets`);

        try {
          // Update cards table for regular cards
          if (cardUpdates.length > 0) {
            console.log(`📝 Updating ${cardUpdates.length} cards in cards table...`);
            const cardStmt = await this.bulkDataService.db.prepare(
              'UPDATE cards SET collected = ? WHERE uuid = ?'
            );
            for (const update of cardUpdates) {
              await cardStmt.run([update.quantity, update.uuid]);
            }
            await cardStmt.finalize();
            console.log(`✅ Cards table updated successfully`);
          }

          // Ensure tokens table has a collected column
          try {
            await this.bulkDataService.db.exec('ALTER TABLE tokens ADD COLUMN collected INTEGER DEFAULT 0');
            console.log('✅ Added collected column to tokens table');
          } catch (e) {
            // Column might already exist, that's okay
            console.log('📝 Tokens table already has collected column');
          }

          if (tokenUpdates.length > 0) {
            console.log(`📝 Updating ${tokenUpdates.length} tokens in tokens table...`);
            const tokenStmt = await this.bulkDataService.db.prepare(
              'UPDATE tokens SET collected = ? WHERE uuid = ?'
            );
            for (const update of tokenUpdates) {
              await tokenStmt.run([update.quantity, update.uuid]);
            }
            await tokenStmt.finalize();
            console.log(`✅ Tokens table updated successfully`);
          }

          // Reset cards/tokens no longer in collections
          if (resets.length > 0) {
            console.log(`🔄 Resetting ${resets.length} cards/tokens no longer in collections...`);
            const resetStmt = await this.bulkDataService.db.prepare(
              'UPDATE cards SET collected = 0 WHERE uuid = ?'
            );
            const tokenResetStmt = await this.bulkDataService.db.prepare(
              'UPDATE tokens SET collected = 0 WHERE uuid = ?'
            );

            for (const uuid of resets) {
              // Try both tables since we don't know which one this UUID belongs to
              await resetStmt.run([uuid]);
              await tokenResetStmt.run([uuid]);
            }
            await resetStmt.finalize();
            await tokenResetStmt.finalize();
            console.log(`✅ Reset completed`);
          }

        } finally {
          console.log('🔄 Committing transaction...');
          await this.bulkDataService.db.exec('COMMIT');
          console.log('✅ Transaction committed successfully');
        }
      });

      const duration = Date.now() - startTime;
      const totalUpdates = cardUpdates.length + tokenUpdates.length + resets.length;
      console.log(`✅ Collection sync complete in ${duration}ms: ${totalUpdates} items updated (${tokensFound} tokens), ${notFound} not found`);
      console.log(`📈 Sync details: ${cardUpdates.length} cards updated, ${tokenUpdates.length} tokens updated, ${resets.length} reset`);

      return {
        success: true,
        synced: totalUpdates,
        cardsSynced: cardUpdates.length,
        tokensSynced: tokenUpdates.length,
        resetsPerformed: resets.length,
        notFound,
        tokensFound,
        total: collectedCardsSummary.length
      };

    } catch (error) {
      console.error('Error syncing collection to main database:', error);
      // Attempt to rollback if a transaction was started
      try {
        await this.bulkDataService.db.exec('ROLLBACK');
      } catch (rollbackError) {
        console.error('Error during sync rollback:', rollbackError);
      }
      return {
        success: false,
        error: error.message
      };
    } finally {
      this.isSyncing = false;
    }
  }

  async close() {
    if (this.db) {
      await this.db.close();
    }
  }

  async findBestCardMatch(cardName, setCode = null, collectorNumber = null) {
    if (!this.bulkDataService) {
      throw new Error('Bulk data service not available');
    }

    // Handle undefined, "undefined", or empty card names
    if (!cardName || cardName.trim() === '' || cardName.trim().toLowerCase() === 'undefined') {
      console.warn(`⚠️ Skipping card lookup with invalid name: "${cardName}"`);
      return null;
    }

    try {
      let card = null;

      // First try exact match with set and collector number if provided, prioritizing English
      if (setCode && collectorNumber && cardName) {
        card = await this.bulkDataService.findCardByDetails(cardName, setCode, collectorNumber);
        if (card) {
          console.log(`✓ Found exact match for "${cardName}" (${setCode}) #${collectorNumber} - Language: ${card.language || 'en'}`);
          return card;
        }
      }

      // Try exact match with set only, prioritizing English
      if (setCode && cardName) {
        card = await this.bulkDataService.findCardByName(cardName);
        if (card && card.setCode && card.setCode.toLowerCase() === setCode.toLowerCase()) {
          console.log(`✓ Found set match for "${cardName}" (${setCode}) - Language: ${card.language || 'en'}`);
          return card;
        }
      }

      // Fallback to name-only search (already prioritizes English in bulkDataService)
      if (cardName) {
        card = await this.bulkDataService.findCardByName(cardName);
        if (card) {
          const langNote = card.language && card.language !== 'English' ? ` (${card.language})` : ' (English)';
          console.log(`✓ Found name match for "${cardName}"${langNote}`);
          return card;
        }
      }

      // If no card found, try searching tokens table
      console.log(`🔍 Card not found, searching tokens for "${cardName}"`);

      try {
        let tokenQuery = `SELECT * FROM tokens WHERE lower(name) = lower(?)`;
        let params = [cardName];

        // If we have set code, try to match it too
        if (setCode) {
          tokenQuery += ` AND lower(setCode) = lower(?)`;
          params.push(setCode);
        }

        // If we have collector number, try to match it too
        if (collectorNumber) {
          tokenQuery += ` AND number = ?`;
          params.push(collectorNumber);
        }

        // Prefer English language
        tokenQuery += ` ORDER BY CASE WHEN language = 'en' THEN 0 ELSE 1 END LIMIT 1`;

        const token = await this.bulkDataService.db.get(tokenQuery, params);

        if (token) {
          console.log(`🪙 Found token match for "${cardName}" (${token.setCode || 'unknown set'})`);
          return token;
        }

        // Fallback: try name-only token search
        if (!token && (setCode || collectorNumber)) {
          const nameOnlyToken = await this.bulkDataService.db.get(
            `SELECT * FROM tokens WHERE lower(name) = lower(?) ORDER BY CASE WHEN language = 'en' THEN 0 ELSE 1 END LIMIT 1`,
            [cardName]
          );

          if (nameOnlyToken) {
            console.log(`🪙 Found token name match for "${cardName}" (${nameOnlyToken.setCode || 'unknown set'})`);
            return nameOnlyToken;
          }
        }
      } catch (tokenError) {
        console.error(`Error searching tokens for "${cardName}":`, tokenError);
      }

      console.warn(`✗ No match found for "${cardName}" in cards or tokens`);
      return null;
    } catch (error) {
      console.error(`Error finding card match for "${cardName}":`, error);
      return null;
    }
  }

  async addCard(collectionName, cardData = {}) {
    if (!this.db) {
      console.error('Collection database not initialized');
      return { success: false, error: 'Database not initialized' };
    }

    try {
      const {
        card_name,
        set_code = '',
        set_name = '',
        collector_number = '',
        foil = 'normal',
        rarity = '',
        quantity = 1,
        condition = 'near_mint',
        language = 'en',
        purchase_price = 0,
        currency = 'USD',
        binder_name = '',
        binder_type = '',
        manabox_id = '',
        scryfall_id = '',
        misprint = false,
        altered = false
      } = cardData;

      if (!card_name) {
        return { success: false, error: 'card_name is required' };
      }

      // Use retry mechanism for database operation
      await this.retryOperation(async () => {
        // Use UPSERT to merge quantities if the card already exists in this collection
        const sql = `
          INSERT INTO user_collections (
            collectionName, cardName, setCode, setName, collectorNumber, foil, rarity,
            quantity, condition, language, purchasePrice, currency, binderName, binderType,
            manaboxId, scryfallId, misprint, altered
          ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
          ON CONFLICT(collectionName, cardName, setCode, collectorNumber, foil)
          DO UPDATE SET quantity = quantity + excluded.quantity
        `;

        await this.db.run(sql, [
          collectionName,
          card_name,
          set_code,
          set_name,
          collector_number,
          this.normalizeFoil(foil),
          rarity,
          quantity,
          this.normalizeCondition(condition),
          language,
          purchase_price,
          currency,
          binder_name,
          binder_type,
          manabox_id,
          scryfall_id,
          misprint ? 1 : 0,
          altered ? 1 : 0
        ]);
      });

      console.log(`➕ Added ${quantity} x "${card_name}" to collection "${collectionName}"`);
      
      // Sync to main database so the collection view is updated immediately
      console.log('🔄 Syncing to main database after card addition...');
      try {
        await this.syncCollectionToMainDatabase();
        console.log('✅ Sync completed successfully');
      } catch (syncError) {
        console.warn('⚠️ Sync failed after card addition:', syncError);
        // Don't fail the add operation if sync fails
      }
      
      return { success: true };
    } catch (error) {
      console.error('Error adding card to collection:', error);
      return { success: false, error: error.message };
    }
  }

  async updateCardQuantity(collectionName, cardKey = {}, newQuantity = 1) {
    if (!this.db) {
      return { success: false, error: 'Database not initialized' };
    }
    try {
      const {
        card_name,
        set_code = '',
        collector_number = '',
        foil = 'normal'
      } = cardKey;

      if (!card_name) {
        return { success: false, error: 'card_name is required' };
      }

      const qty = parseInt(newQuantity, 10);
      if (isNaN(qty) || qty < 0) {
        return { success: false, error: 'newQuantity must be a non-negative integer' };
      }

      if (qty === 0) {
        // If quantity is zero, delete the card entry
        return await this.deleteCard(collectionName, cardKey);
      }

      const result = await this.db.run(
        `UPDATE user_collections SET quantity = ? WHERE collectionName = ? AND lower(cardName) = lower(?) AND setCode = ? AND collectorNumber = ? AND foil = ?`,
        [qty, collectionName, card_name, set_code, collector_number, this.normalizeFoil(foil)]
      );

      if (result.changes > 0) {
        // Sync to main database so the collection view is updated immediately
        console.log('🔄 Syncing to main database after quantity update...');
        try {
          await this.syncCollectionToMainDatabase();
          console.log('✅ Sync completed successfully');
        } catch (syncError) {
          console.warn('⚠️ Sync failed after quantity update:', syncError);
          // Don't fail the update operation if sync fails
        }
      }

      return { success: result.changes > 0 };
    } catch (error) {
      console.error('Error updating card quantity:', error);
      return { success: false, error: error.message };
    }
  }

  async deleteCard(collectionName, cardKey = {}) {
    if (!this.db) {
      return { success: false, error: 'Database not initialized' };
    }
    try {
      const {
        card_name,
        set_code = '',
        collector_number = '',
        foil = 'normal'
      } = cardKey;

      if (!card_name) {
        return { success: false, error: 'card_name is required' };
      }

      const result = await this.db.run(
        `DELETE FROM user_collections WHERE collectionName = ? AND lower(cardName) = lower(?) AND setCode = ? AND collectorNumber = ? AND foil = ?`,
        [collectionName, card_name, set_code, collector_number, this.normalizeFoil(foil)]
      );

      if (result.changes > 0) {
        // Sync to main database so the collection view is updated immediately
        console.log('🔄 Syncing to main database after card deletion...');
        try {
          await this.syncCollectionToMainDatabase();
          console.log('✅ Sync completed successfully');
        } catch (syncError) {
          console.warn('⚠️ Sync failed after card deletion:', syncError);
          // Don't fail the delete operation if sync fails
        }
      }

      return { success: result.changes > 0 };
    } catch (error) {
      console.error('Error deleting card from collection:', error);
      return { success: false, error: error.message };
    }
  }

  async getCardTotalQuantity(cardName, options = {}) {
    if (!this.db) return { total: 0, breakdown: [] };

    try {
      const { set_code = '', collector_number = '', foil = '' } = options;

      let query = `SELECT collectionName, SUM(quantity) as qty FROM user_collections WHERE lower(cardName) = lower(?)`;
      const params = [cardName];
      if (set_code) { query += ' AND setCode = ?'; params.push(set_code); }
      if (collector_number) { query += ' AND collectorNumber = ?'; params.push(collector_number); }
      if (foil) { query += ' AND foil = ?'; params.push(this.normalizeFoil(foil)); }
      query += ' GROUP BY collectionName';

      const rows = await this.db.all(query, params);
      const total = rows.reduce((sum, r) => sum + (r.qty || 0), 0);
      return { total, breakdown: rows };
    } catch (error) {
      console.error('Error getting card total quantity:', error);
      return { total: 0, breakdown: [], error: error.message };
    }
  }
}

// Export singleton instance
const collectionImporter = new CollectionImporter();

module.exports = collectionImporter; 