// DailyPrices.js
const https = require('https');
const unzipper = require('unzipper');
const sqlite3 = require('sqlite3').verbose();
const { open } = require('sqlite');
const { resolveDatabasePath } = require('../dbPathResolver.cjs');

class DailyPrices {
  static PRICE_URL = 'https://mtgjson.com/api/v5/AllPricesToday.json.zip';
  static MAX_DOWNLOAD_ATTEMPTS = 3;
  static _instance = null;

  constructor(db) {
    this.db = db;
  }

  /** factory to initialize the DB connection and tables */
  static async create() {
    console.log('💰 DailyPrices.create() called');
    const dbPath = resolveDatabasePath();
    console.log('💰 Database path resolved:', dbPath);

    const db = await open({
      filename: dbPath,
      driver: sqlite3.Database,
    });
    console.log('💰 Database connection opened');

    // Speed optimizations
    await db.exec('PRAGMA journal_mode = WAL;');
    await db.exec('PRAGMA synchronous = OFF;');
    console.log('💰 Database optimizations applied');

    // Ensure our tables exist
    await DailyPrices._setupTables(db);
    console.log('💰 Tables setup completed');

    return new DailyPrices(db);
  }

  /** Static method to get or create instance and update prices if needed */
  static async getDailyPrices() {
    console.log('💰 DailyPrices.getDailyPrices() called');
    if (!DailyPrices._instance) {
      console.log('💰 Creating new DailyPrices instance…');
      DailyPrices._instance = await DailyPrices.create();
      console.log('💰 DailyPrices instance created successfully');
    }
    console.log('💰 Updating daily prices if needed…');
    await DailyPrices._instance.updateDailyPricesIfNeeded();
    console.log('💰 Daily prices update completed');
    return { success: true, message: 'Daily prices updated successfully' };
  }

  /** one‑time table & index setup */
  static async _setupTables(db) {
    await db.exec(`
      CREATE TABLE IF NOT EXISTS daily_prices (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        uuid TEXT NOT NULL,
        format TEXT NOT NULL,
        vendor TEXT NOT NULL,
        transaction_type TEXT NOT NULL,
        card_type TEXT NOT NULL,
        date DATE NOT NULL,
        price REAL NOT NULL,
        currency TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(uuid, format, vendor, transaction_type, card_type, date)
      );
    `);
    await db.exec(`CREATE INDEX IF NOT EXISTS idx_daily_prices_uuid ON daily_prices(uuid);`);
    await db.exec(`CREATE INDEX IF NOT EXISTS idx_daily_prices_date ON daily_prices(date);`);
    await db.exec(`
      CREATE TABLE IF NOT EXISTS daily_prices_meta (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        date DATE UNIQUE NOT NULL,
        version TEXT NOT NULL,
        downloaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
  }

  /** Public: check & update if today’s data is missing */
  async updateDailyPricesIfNeeded() {
    if (await this._needsDownload()) {
      console.log('Downloading latest daily prices…');
      await this.downloadDailyPrices();
    } else {
      console.log('Daily prices are up to date.');
    }
  }

  /** Determine if we already have today’s date in meta */
  async _needsDownload() {
    const row = await this.db.get(
      `SELECT date FROM daily_prices_meta ORDER BY date DESC LIMIT 1`
    );
    const today = new Date().toISOString().slice(0, 10);
    return !row || row.date < today;
  }

  /** Download + save, with retry on transient errors */
  async downloadDailyPrices() {
    let lastErr;
    for (let attempt = 1; attempt <= DailyPrices.MAX_DOWNLOAD_ATTEMPTS; attempt++) {
      try {
        const json = await this._fetchAndUnzip();
        await this._saveDailyPrices(json);
        console.log(`✅ Saved prices for ${json.meta.date}`);
        return;
      } catch (err) {
        lastErr = err;
        console.error(`Attempt ${attempt} failed:`, err);
      }
    }
    throw new Error(`All ${DailyPrices.MAX_DOWNLOAD_ATTEMPTS} download attempts failed: ${lastErr}`);
  }

  /**
   * Fetch ZIP via native https, pipe through unzipper.Parse(),
   * grab the JSON entry and buffer it fully before parsing.
   */
  _fetchAndUnzip() {
    return new Promise((resolve, reject) => {
      https.get(DailyPrices.PRICE_URL, (res) => {
        if (res.statusCode !== 200) {
          return reject(new Error(`HTTP ${res.statusCode}`));
        }

        res
          .pipe(unzipper.Parse())
          .on('entry', async (entry) => {
            if (entry.path.endsWith('.json')) {
              try {
                const buffer = await entry.buffer();
                const json = JSON.parse(buffer);
                resolve(json);
              } catch (e) {
                reject(new Error('Invalid JSON in ZIP: ' + e.message));
              }
            } else {
              entry.autodrain();
            }
          })
          .on('error', reject)
          .on('close', () => {
            // if no JSON entry was found
            reject(new Error('No .json entry found in ZIP'));
          });
      }).on('error', reject);
    });
  }

  /** Save parsed JSON into our tables */
  async _saveDailyPrices({ meta, data }) {
    if (await this._alreadyDownloaded(meta.date)) {
      console.log(`Prices for ${meta.date} already imported.`);
      return;
    }

    const entries = DailyPrices._buildEntries(data);

    await this.db.exec('BEGIN TRANSACTION;');
    const stmt = await this.db.prepare(`
      INSERT OR REPLACE INTO daily_prices
        (uuid, format, vendor, transaction_type, card_type, date, price, currency)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const e of entries) {
      await stmt.run([
        e.uuid,
        e.format,
        e.vendor,
        e.transaction_type,
        e.card_type,
        e.date,
        e.price,
        e.currency,
      ]);
    }
    await stmt.finalize();
    await this.db.exec('COMMIT;');

    await this.db.run(
      `INSERT INTO daily_prices_meta (date, version) VALUES (?, ?)`,
      [meta.date, meta.version]
    );
  }

  /** Check if we’ve already stored prices for this date */
  async _alreadyDownloaded(date) {
    const row = await this.db.get(
      `SELECT 1 FROM daily_prices_meta WHERE date = ?`,
      [date]
    );
    return !!row;
  }

  /** Flatten MTGO & paper structures into a flat array of rows */
  static _buildEntries(data) {
    const out = [];
    for (const [uuid, cardData] of Object.entries(data)) {
      for (const fmt of ['mtgo', 'paper']) {
        const fmtData = cardData[fmt];
        if (!fmtData) continue;
        for (const [vendor, vendorData] of Object.entries(fmtData)) {
          for (const txType of ['buylist', 'retail']) {
            const typeData = vendorData[txType];
            if (!typeData) continue;
            for (const [cardType, dates] of Object.entries(typeData)) {
              for (const [date, price] of Object.entries(dates)) {
                out.push({
                  uuid,
                  format: fmt,
                  vendor,
                  transaction_type: txType,
                  card_type: cardType,
                  date,
                  price,
                  currency: vendorData.currency,
                });
              }
            }
          }
        }
      }
    }
    return out;
  }

  /** Gracefully close the database */
  async close() {
    await this.db.close();
  }
}

module.exports = DailyPrices;
