const { parentPort } = require('worker_threads');
const path = require('path');
const os = require('os');
const fs = require('fs');

// Set environment variables for stability
process.env.TRANSFORMERS_VERBOSITY = 'error';
process.env.TOKENIZERS_PARALLELISM = 'false';
process.env.OMP_NUM_THREADS = '1';
process.env.OPENBLAS_NUM_THREADS = '1';
process.env.MKL_NUM_THREADS = '1';

// We will use dynamic imports for the ES Modules
let pipeline;
let connect;

// A standalone class to handle search operations inside the worker
class SearchWorkerService {
  constructor() {
    this.db = null;
    this.table = null;
    this.embedder = null;
    this.isInitialized = false;
    this.modelLoadAttempts = 0; // Track retry attempts
    this.maxRetries = 3;
  }

  /**
   * Initializes the embedding model and connects to the existing LanceDB database.
   */
  async initialize({ dbDirPath, cachePath }) {
    if (this.isInitialized) return;

    try {
      console.log('[Worker] Initializing Semantic Search Service...');

      // Set up the model cache directory in a writable location
      console.log(`[Worker] Setting model cache directory to: ${cachePath}`);
      console.log(`[Worker] Cache directory exists: ${fs.existsSync(cachePath)}`);
      fs.mkdirSync(cachePath, { recursive: true });
      console.log(`[Worker] Cache directory created/verified: ${fs.existsSync(cachePath)}`);
      process.env.TRANSFORMERS_CACHE = cachePath;

      // Absolute path to the LanceDB directory provided by the main thread
      const LANCE_DB_DIR = dbDirPath;
      const TABLE_NAME = 'magic_cards';
      console.log(`[Worker] Vector DB directory: ${LANCE_DB_DIR}`);
      console.log(`[Worker] Vector DB directory exists: ${fs.existsSync(LANCE_DB_DIR)}`);
      if (fs.existsSync(LANCE_DB_DIR)) {
        const dbContents = fs.readdirSync(LANCE_DB_DIR);
        console.log(`[Worker] Vector DB contents: ${dbContents.join(', ')}`);
      }
      
      // Dynamically import ES modules required for the service
      const transformers = await import('@xenova/transformers');
      pipeline = transformers.pipeline;
      
      const lancedbModule = await import('@lancedb/lancedb');
      connect = lancedbModule.connect;

      // Load the model for generating query embeddings with retry logic
      this.embedder = await this.loadModelWithRetry();

      // Connect to the LanceDB database directory
      console.log(`[Worker] Attempting to connect to LanceDB at: ${LANCE_DB_DIR}`);
      this.db = await connect(LANCE_DB_DIR);

      const tableNames = await this.db.tableNames();
      if (!tableNames.includes(TABLE_NAME)) {
        throw new Error(`Table '${TABLE_NAME}' not found in database at ${LANCE_DB_DIR}`);
      }
      
      this.table = await this.db.openTable(TABLE_NAME);
      const rowCount = await this.table.countRows();
      
      this.isInitialized = true;
      console.log(`[Worker] Semantic Search Service Initialized. Connected to table: '${TABLE_NAME}' with ${rowCount} rows`);

    } catch (error) {
      console.error('[Worker] Error initializing Semantic Search Service:', error);
      console.error('[Worker] Error stack:', error.stack);
      console.error('[Worker] Error details:', {
        message: error.message,
        code: error.code,
        errno: error.errno,
        syscall: error.syscall,
        path: error.path
      });
      
      // Set initialization to false so we can report the error properly
      this.isInitialized = false;
      
      // Don't post error here - let the message handler do it
      // Just throw the error so it can be caught by the caller
      throw error;
    }
  }

  /**
   * Load model with retry logic for better reliability
   */
  async loadModelWithRetry() {
    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        console.log(`[Worker] Loading model (attempt ${attempt}/${this.maxRetries})...`);
        
        return await pipeline(
          'feature-extraction',
          'Xenova/all-mpnet-base-v2',
          {
            progress_callback: ({ progress }) => {
              // progress is 0-1 float; convert to percentage for convenience
              parentPort.postMessage({ type: 'model-progress', payload: { progress } });
            }
          }
        );
      } catch (error) {
        console.error(`[Worker] Model load attempt ${attempt} failed:`, error);
        
        if (attempt === this.maxRetries) {
          throw new Error(`Failed to load model after ${this.maxRetries} attempts: ${error.message}`);
        }
        
        // Wait before retry (exponential backoff)
        await new Promise(resolve => setTimeout(resolve, 1000 * Math.pow(2, attempt - 1)));
      }
    }
  }

  /**
   * Cleanup resources when terminating
   */
  async cleanup() {
    try {
      if (this.db) {
        await this.db.close();
        this.db = null;
      }
      this.table = null;
      this.embedder = null;
      this.isInitialized = false;
      console.log('[Worker] Resources cleaned up');
    } catch (error) {
      console.error('[Worker] Error during cleanup:', error);
    }
  }

  /**
   * Performs a semantic search with unique name filtering and proper ranking.
   */
  async search(query, options = {}) {
    const { limit = 200, offset = 0 } = options;

    if (!this.isInitialized || !this.embedder || !this.table) {
      console.error('[Worker] Search service is not ready.');
      return [];
    }
    if (!query || query.trim().length === 0) {
      return [];
    }

    try {
      console.log(`[Worker] Performing semantic search for: "${query}"`);

      // Search through a large number of cards to get comprehensive results
      // Using a high limit to ensure we have enough candidates for unique filtering
      const searchLimit = Math.max(limit * 50, 10000);

      // 1. Generate an embedding for the user's query
      console.log('[Worker] Generating embedding for query...');
      const queryEmbedding = await this.embedder(query, { pooling: 'mean', normalize: true });
      console.log('[Worker] Embedding generated successfully.');

      // 2. Perform the similarity search in LanceDB with comprehensive limit
      console.log('[Worker] Starting LanceDB search...');
      const rawResults = await this.table
        .search(Array.from(queryEmbedding.data))
        .select([
          'name',
          'mana_cost',
          'mana_value',
          'type_line',
          'oracle_text',
          'keywords',
          'colors',
          'color_identity',
          'power',
          'toughness',
          'loyalty',
          'rarity',
          'legalities',
          'set_name',
          '_distance'
        ])
        .limit(searchLimit)
        .offset(offset)
        .toArray();
      console.log('[Worker] LanceDB search completed.');

      // 3. Ensure results are sorted by distance (best matches first)
      const sortedResults = rawResults.sort((a, b) => a._distance - b._distance);
        
      // Helper function to safely convert arrays
      const arr = v =>
        v == null                       ? []  :
        Array.isArray(v)                ? v   :
        typeof v.toArray === 'function' ? v.toArray() : v;

      // Create plain serializable objects with proper score mapping
      const plainResults = sortedResults.map(card => ({
        name: card.name,
        mana_cost: card.mana_cost,
        mana_value: card.mana_value,
        type_line: card.type_line,
        oracle_text: card.oracle_text,
        keywords: arr(card.keywords),
        colors: arr(card.colors),
        color_identity: arr(card.color_identity),
        power: card.power,
        toughness: card.toughness,
        loyalty: card.loyalty,
        rarity: card.rarity,
        legalities: card.legalities,
        set_name: card.set_name,
        distance: card._distance
      }));
      
      console.log(`[Worker] Search successful. Found ${rawResults.length} raw results before unique filtering.`);

      // 4. Filter for unique card names, keeping the best match for each name
      const uniqueResults = [];
      const seenNames = new Set();
      
      for (const card of plainResults) {
        const cardName = card.name;
        if (!seenNames.has(cardName)) {
          seenNames.add(cardName);
          uniqueResults.push(card);
          
          // Stop once we have enough unique results
          if (uniqueResults.length >= limit) {
            break;
          }
        }
      }

      console.log(`[Worker] Found ${uniqueResults.length} unique cards ranked by relevance.`);
      return uniqueResults;

    } catch (error) {
      console.error('[Worker] Error during semantic search:', error);
      return [];
    }
  }
}

// --- Worker Message Handling ---

const service = new SearchWorkerService();

// Handle graceful shutdown
process.on('SIGTERM', async () => {
  console.log('[Worker] Received SIGTERM, cleaning up...');
  await service.cleanup();
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('[Worker] Received SIGINT, cleaning up...');
  await service.cleanup();
  process.exit(0);
});

parentPort.on('message', async (message) => {
  const { type, payload, id } = message;

  try {
    switch (type) {
      case 'initialize':
        try {
          await service.initialize(payload);
          if (service.isInitialized) {
              parentPort.postMessage({ type: 'initialized', id });
          } else {
              parentPort.postMessage({ type: 'error', payload: { message: 'Worker initialization failed - service not initialized' }, id });
          }
        } catch (initError) {
          console.error('[Worker] Initialization error:', initError);
          parentPort.postMessage({ type: 'error', payload: { message: `Worker initialization failed: ${initError.message}`, stack: initError.stack }, id });
        }
        break;
      case 'search':
        const results = await service.search(payload.query, payload.options);
        parentPort.postMessage({ type: 'search-results', payload: results, id });
        break;
      case 'cleanup':
        await service.cleanup();
        parentPort.postMessage({ type: 'cleanup-complete', id });
        break;
      default:
        console.warn(`[Worker] Unknown message type: ${type}`);
    }
  } catch (error) {
    parentPort.postMessage({ type: 'error', payload: { message: error.message, stack: error.stack }, id });
  }
}); 