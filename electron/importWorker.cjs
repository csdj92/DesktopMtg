const { parentPort, workerData } = require('worker_threads');
const fs = require('fs');
const sqlite3 = require('sqlite3').verbose();
const { open } = require('sqlite');
const parser = require('stream-json');
const streamValues = require('stream-json/streamers/StreamValues');
const { pipeline } = require('stream');
const { Writable } = require('stream');

const semanticSearchService = require('./semanticSearch.cjs');

async function importCardsInWorker() {
  const { databaseFile, cardsFile } = workerData;
  
  // Initialize Semantic Search Service
  let semanticSearchEnabled = false;
  try {
    await semanticSearchService.initialize();
    // Clear any existing vector index
    await semanticSearchService.deleteIndex();
    semanticSearchEnabled = true;
  } catch (error) {
    console.error('[Worker] Semantic search initialization failed:', error);
    // Continue without semantic search
  }

  let db;
  try {
    // Open database connection
    db = await open({
      filename: databaseFile,
      driver: sqlite3.Database
    });

    // Clear existing data first
    await db.exec('DELETE FROM cards');
    
    let cardCount = 0;
    let batch = [];
          const BATCH_SIZE = 5; // Ultra-small batches for maximum memory efficiency
    let startTime = Date.now();
    let lastMemoryCheck = Date.now();

    // Enhanced memory monitoring function
    const checkMemory = () => {
      const now = Date.now();
      if (now - lastMemoryCheck > 5000) { // Check every 5 seconds
        const memUsage = process.memoryUsage();
        const memoryMB = Math.round(memUsage.heapUsed / 1024 / 1024);
        const memoryTotalMB = Math.round(memUsage.heapTotal / 1024 / 1024);
        
        parentPort.postMessage({
          type: 'memory_update',
          cardCount,
          memory: {
            heapUsed: memoryMB,
            heapTotal: memoryTotalMB,
            rss: Math.round(memUsage.rss / 1024 / 1024)
          }
        });
        
        lastMemoryCheck = now;
      }
    };

    const processBatch = async (cards) => {
      if (cards.length === 0) return;
      
      try {
        await db.exec('BEGIN TRANSACTION');
        
        const stmt = await db.prepare(`
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
        }

        await stmt.finalize();
        await db.exec('COMMIT');
        
        // Index the batch for semantic search if enabled
        if (semanticSearchEnabled) {
          try {
            await semanticSearchService.indexCards(cards);
          } catch (error) {
            console.error('[Worker] Failed to index cards:', error);
            // Continue without indexing
          }
        }

        // Clear references for GC
        cards.length = 0;
        
      } catch (error) {
        await db.exec('ROLLBACK');
        // We don't index cards on failure
        throw error;
      }
    };

    return new Promise((resolve, reject) => {
      const processingStream = new Writable({
        objectMode: true,
        highWaterMark: 1,
        write(chunk, encoding, callback) {
          batch.push(chunk.value);
          
          if (batch.length >= BATCH_SIZE) {
            processBatch(batch.slice())
              .then(() => {
                cardCount += batch.length;
                batch = [];
                
                // Check memory and send updates
                checkMemory();
                
                                 // Force GC every 100 cards (more aggressive)
                 if (cardCount % 100 === 0 && global.gc) {
                   global.gc();
                   parentPort.postMessage({
                     type: 'gc_triggered',
                     cardCount
                   });
                 }
                 
                 // Emergency GC if memory gets too high
                 const memUsage = process.memoryUsage();
                 if (memUsage.heapUsed > 1024 * 1024 * 1024) { // 1GB threshold
                   if (global.gc) {
                     global.gc();
                     parentPort.postMessage({
                       type: 'emergency_gc',
                       memory: Math.round(memUsage.heapUsed / 1024 / 1024),
                       cardCount
                     });
                   }
                 }

                // Send progress update every 5000 cards
                if (cardCount % 5000 === 0) {
                  const elapsed = Date.now() - startTime;
                  const rate = Math.round(cardCount / (elapsed / 1000));
                  
                  parentPort.postMessage({
                    type: 'progress',
                    cardCount,
                    rate: `${rate} cards/sec`
                  });
                }
                
                // Use setImmediate to yield to event loop
                setImmediate(() => {
                  callback();
                });
              })
              .catch(callback);
          } else {
            callback();
          }
        },
        
        final(callback) {
          if (batch.length > 0) {
            processBatch(batch)
              .then(() => {
                cardCount += batch.length;
                callback();
              })
              .catch(callback);
          } else {
            callback();
          }
        }
      });

      pipeline(
        fs.createReadStream(cardsFile),
        parser(),
        new streamValues(),
        processingStream,
        async (error) => {
          if (error) {
            parentPort.postMessage({
              type: 'error',
              error: error.message
            });
            reject(error);
          } else {
            const elapsed = Date.now() - startTime;
            parentPort.postMessage({
              type: 'completed',
              cardCount,
              elapsed: Math.round(elapsed / 1000)
            });
            resolve(cardCount);
          }
        }
      );
    });
    
  } catch (error) {
    parentPort.postMessage({
      type: 'error',
      error: error.message
    });
    throw error;
  } finally {
    if (db) {
      await db.close();
    }
  }
}

// Start the import process
importCardsInWorker()
  .then(cardCount => {
    parentPort.postMessage({
      type: 'success',
      cardCount
    });
  })
  .catch(error => {
    parentPort.postMessage({
      type: 'error',
      error: error.message
    });
  }); 