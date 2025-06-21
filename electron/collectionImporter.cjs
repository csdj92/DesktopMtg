const fs = require('fs').promises;
const path = require('path');
const { parse } = require('csv-parse/sync');
const sqlite3 = require('sqlite3').verbose();
const { open } = require('sqlite');
const { app } = require('electron');

const BULK_DATA_DIR = path.join(app.getPath('userData'), 'scryfall-data');
const DATABASE_FILE = path.join(BULK_DATA_DIR, 'cards.db');

class CollectionImporter {
  constructor() {
    this.db = null;
  }

  async initialize() {
    try {
      await fs.mkdir(BULK_DATA_DIR, { recursive: true });
      
      this.db = await open({
        filename: DATABASE_FILE,
        driver: sqlite3.Database
      });

      // Improve concurrency: allow reads & writes simultaneously and wait a bit on busy locks
      await this.db.exec('PRAGMA journal_mode = WAL');
      await this.db.exec('PRAGMA busy_timeout = 5000');

      // Create collections table if it doesn't exist
      await this.db.exec(`
        CREATE TABLE IF NOT EXISTS user_collections (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          collection_name TEXT NOT NULL,
          card_name TEXT NOT NULL,
          set_code TEXT,
          set_name TEXT,
          collector_number TEXT,
          foil TEXT DEFAULT 'normal',
          rarity TEXT,
          quantity INTEGER DEFAULT 1,
          condition TEXT DEFAULT 'near_mint',
          language TEXT DEFAULT 'en',
          purchase_price REAL,
          currency TEXT DEFAULT 'USD',
          binder_name TEXT,
          binder_type TEXT,
          manabox_id TEXT,
          scryfall_id TEXT,
          misprint BOOLEAN DEFAULT 0,
          altered BOOLEAN DEFAULT 0,
          notes TEXT,
          imported_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(collection_name, card_name, set_code, collector_number, foil)
        );
        
        CREATE INDEX IF NOT EXISTS idx_collection_name ON user_collections(collection_name);
        CREATE INDEX IF NOT EXISTS idx_card_name ON user_collections(card_name);
        CREATE INDEX IF NOT EXISTS idx_set_code ON user_collections(set_code);
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

      // Begin transaction for better performance
      await this.db.exec('BEGIN TRANSACTION');

      const insertStmt = await this.db.prepare(`
        INSERT OR REPLACE INTO user_collections 
        (collection_name, card_name, set_code, set_name, collector_number, foil, rarity, 
         quantity, condition, language, purchase_price, currency, binder_name, binder_type,
         manabox_id, scryfall_id, misprint, altered)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      for (const record of records) {
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

          // Progress update every 100 cards
          if (imported % 100 === 0) {
            console.log(`🚀 Progress: ${imported} cards imported...`);
          }

        } catch (error) {
          console.error('Error importing card:', record, error);
          errors++;
        }
      }

      await insertStmt.finalize();
      await this.db.exec('COMMIT');

      console.log(`✅ CSV import complete for "${collectionName}"`);
      console.log(`📊 Results: ${imported} imported, ${skipped} skipped, ${errors} errors`);

      return {
        success: true,
        imported,
        skipped,
        errors,
        total: records.length
      };

    } catch (error) {
      await this.db.exec('ROLLBACK');
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

      await this.db.exec('BEGIN TRANSACTION');

      const insertStmt = await this.db.prepare(`
        INSERT OR REPLACE INTO user_collections 
        (collection_name, card_name, set_code, collector_number, quantity, foil)
        VALUES (?, ?, ?, ?, ?, ?)
      `);

      for (const line of lines) {
        try {
          // Skip comments and empty lines
          if (line.startsWith('#') || line.startsWith('//') || !line) {
            continue;
          }

          const cardData = this.parseTXTLine(line, format);
          
          if (!cardData.name) {
            console.warn('⚠️ Skipping line with no card name:', line);
            skipped++;
            continue;
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

          if (imported % 50 === 0) {
            console.log(`🚀 Progress: ${imported} cards imported...`);
          }

        } catch (error) {
          console.error('Error importing line:', line, error);
          errors++;
        }
      }

      await insertStmt.finalize();
      await this.db.exec('COMMIT');

      console.log(`✅ TXT import complete for "${collectionName}"`);
      console.log(`📊 Results: ${imported} imported, ${skipped} skipped, ${errors} errors`);

      return {
        success: true,
        imported,
        skipped,
        errors,
        total: lines.length
      };

    } catch (error) {
      await this.db.exec('ROLLBACK');
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
          collection_name,
          COUNT(*) as card_count,
          SUM(quantity) as total_cards,
          MAX(imported_at) as last_updated
        FROM user_collections 
        GROUP BY collection_name 
        ORDER BY collection_name
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
        WHERE collection_name = ?
      `;
      const params = [collectionName];

      if (search) {
        query += ` AND card_name LIKE ?`;
        params.push(`%${search}%`);
      }

      query += ` ORDER BY card_name LIMIT ? OFFSET ?`;
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

  async close() {
    if (this.db) {
      await this.db.close();
    }
  }

  async findBestCardMatch(cardName, setCode = null, collectorNumber = null) {
    if (!this.bulkDataService) {
      throw new Error('Bulk data service not available');
    }

    try {
      let card = null;

      // First try exact match with set and collector number if provided, prioritizing English
      if (setCode && collectorNumber) {
        card = await this.bulkDataService.findCardByDetails(cardName, setCode, collectorNumber);
        if (card) {
          console.log(`✓ Found exact match for "${cardName}" (${setCode}) #${collectorNumber} - Language: ${card.lang || 'en'}`);
          return card;
        }
      }

      // Try exact match with set only, prioritizing English
      if (setCode) {
        try {
          const rows = await this.db.all(
            'SELECT data FROM cards WHERE lower(name) = lower(?) AND lower(set_code) = lower(?) ORDER BY CASE WHEN JSON_EXTRACT(data, "$.lang") = "en" OR JSON_EXTRACT(data, "$.lang") IS NULL THEN 0 ELSE 1 END LIMIT 1',
            [cardName, setCode]
          );
          
          if (rows.length > 0) {
            card = JSON.parse(rows[0].data);
            console.log(`✓ Found set match for "${cardName}" (${setCode}) - Language: ${card.lang || 'en'}`);
            return card;
          }
        } catch (dbError) {
          console.warn('Direct database query failed, using bulk service:', dbError.message);
        }
      }

      // Fallback to name-only search (already prioritizes English in bulkDataService)
      card = await this.bulkDataService.findCardByName(cardName);
      if (card) {
        const langNote = card.lang && card.lang !== 'en' ? ` (${card.lang})` : ' (en)';
        console.log(`✓ Found name match for "${cardName}"${langNote}`);
        return card;
      }

      console.warn(`✗ No match found for "${cardName}"`);
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

      // Use UPSERT to merge quantities if the card already exists in this collection
      const sql = `
        INSERT INTO user_collections (
          collection_name, card_name, set_code, set_name, collector_number, foil, rarity,
          quantity, condition, language, purchase_price, currency, binder_name, binder_type,
          manabox_id, scryfall_id, misprint, altered
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
        ON CONFLICT(collection_name, card_name, set_code, collector_number, foil)
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

      console.log(`➕ Added ${quantity} x "${card_name}" to collection "${collectionName}"`);
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
        `UPDATE user_collections SET quantity = ? WHERE collection_name = ? AND lower(card_name) = lower(?) AND set_code = ? AND collector_number = ? AND foil = ?`,
        [qty, collectionName, card_name, set_code, collector_number, this.normalizeFoil(foil)]
      );

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
        `DELETE FROM user_collections WHERE collection_name = ? AND lower(card_name) = lower(?) AND set_code = ? AND collector_number = ? AND foil = ?`,
        [collectionName, card_name, set_code, collector_number, this.normalizeFoil(foil)]
      );

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

      let query = `SELECT collection_name, SUM(quantity) as qty FROM user_collections WHERE lower(card_name) = lower(?)`;
      const params = [cardName];
      if (set_code) { query += ' AND set_code = ?'; params.push(set_code); }
      if (collector_number) { query += ' AND collector_number = ?'; params.push(collector_number); }
      if (foil) { query += ' AND foil = ?'; params.push(this.normalizeFoil(foil)); }
      query += ' GROUP BY collection_name';

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