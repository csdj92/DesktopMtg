const { parentPort } = require('worker_threads');
const path = require('path');
const os = require('os');
const fs = require('fs');

// Add environment logging and set some potentially helpful variables
console.log('[Worker] Node.js version:', process.version);
console.log('[Worker] Platform:', process.platform);
console.log('[Worker] Architecture:', process.arch);
console.log('[Worker] Current working directory:', process.cwd());

// Set up proper cache directories for packaged apps
let appDataDir;
if (process.env.NODE_ENV === 'development') {
  appDataDir = path.join(os.homedir(), '.cache', 'desktopmtg');
} else {
  // In packaged apps, use a directory relative to the executable
  appDataDir = path.join(process.cwd(), '..', '..', 'cache');
}

// Create the cache directory if it doesn't exist
try {
  fs.mkdirSync(appDataDir, { recursive: true });
  console.log('[Worker] Created cache directory:', appDataDir);
} catch (error) {
  console.error('[Worker] Failed to create cache directory:', error);
}

// Set Hugging Face cache environment variables
process.env.HF_HOME = appDataDir;
process.env.TRANSFORMERS_CACHE = path.join(appDataDir, 'transformers');
process.env.HF_DATASETS_CACHE = path.join(appDataDir, 'datasets');

console.log('[Worker] Environment variables related to transformers:');
console.log('[Worker] TRANSFORMERS_CACHE:', process.env.TRANSFORMERS_CACHE);
console.log('[Worker] TRANSFORMERS_VERBOSITY:', process.env.TRANSFORMERS_VERBOSITY);
console.log('[Worker] HF_HOME:', process.env.HF_HOME);

// Set environment variables that might help with stability
process.env.TRANSFORMERS_VERBOSITY = 'error';  // Reduce transformers logging
process.env.TOKENIZERS_PARALLELISM = 'false';  // Disable tokenizer parallelism which can cause issues
process.env.OMP_NUM_THREADS = '1';  // Limit OpenMP threads
process.env.OPENBLAS_NUM_THREADS = '1';  // Limit OpenBLAS threads
process.env.MKL_NUM_THREADS = '1';  // Limit MKL threads

console.log('[Worker] Set environment variables for stability');

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
  }

  /**
   * Initializes the embedding model and connects to the existing LanceDB database.
   */
  async initialize(dbDirPath) {
    if (this.isInitialized) return;

    try {
      console.log('[Worker] Initializing Semantic Search Service...');

      // Absolute path to the LanceDB directory provided by the main thread
      const LANCE_DB_DIR = dbDirPath;
      const TABLE_NAME = 'magic_cards';
      
      console.log(`[Worker] Database path: ${LANCE_DB_DIR}`);
      console.log(`[Worker] Path exists: ${require('fs').existsSync(LANCE_DB_DIR)}`);

      // Dynamically import ES modules required for the service
      console.log('[Worker] About to load transformers module...');
      console.log('[Worker] Adding process error handlers...');
      
      // Add process-level error handlers to catch low-level errors
      const originalUncaughtException = process.listeners('uncaughtException');
      const originalUnhandledRejection = process.listeners('unhandledRejection');
      
      process.on('uncaughtException', (error) => {
        console.error('[Worker] UNCAUGHT EXCEPTION during transformers import:', error);
        console.error('[Worker] Exception stack:', error.stack);
      });
      
      process.on('unhandledRejection', (reason, promise) => {
        console.error('[Worker] UNHANDLED REJECTION during transformers import:', reason);
        console.error('[Worker] Promise:', promise);
      });
      
      // Add a small delay before import
      console.log('[Worker] Waiting 100ms before import...');
      await new Promise(resolve => setTimeout(resolve, 100));
      
      console.log('[Worker] Loading transformers module...');
      try {
        const transformers = await import('@xenova/transformers');
        console.log('[Worker] Transformers loaded successfully');
        pipeline = transformers.pipeline;
        
        // Remove the temporary error handlers
        process.removeAllListeners('uncaughtException');
        process.removeAllListeners('unhandledRejection');
        originalUncaughtException.forEach(listener => process.on('uncaughtException', listener));
        originalUnhandledRejection.forEach(listener => process.on('unhandledRejection', listener));
        
      } catch (transformersError) {
        console.error('[Worker] CRITICAL ERROR loading transformers:', transformersError);
        console.error('[Worker] Transformers error stack:', transformersError.stack);
        console.error('[Worker] Transformers error message:', transformersError.message);
        console.error('[Worker] Transformers error name:', transformersError.name);
        
        // Remove the temporary error handlers
        process.removeAllListeners('uncaughtException');
        process.removeAllListeners('unhandledRejection');
        originalUncaughtException.forEach(listener => process.on('uncaughtException', listener));
        originalUnhandledRejection.forEach(listener => process.on('unhandledRejection', listener));
        
        throw new Error(`Failed to load transformers: ${transformersError.message}`);
      }
      
      console.log('[Worker] Loading LanceDB module...');
      try {
        const lancedbModule = await import('@lancedb/lancedb');
        console.log('[Worker] LanceDB loaded successfully');
        connect = lancedbModule.connect;
      } catch (lancedbError) {
        console.error('[Worker] CRITICAL ERROR loading LanceDB:', lancedbError);
        console.error('[Worker] LanceDB error stack:', lancedbError.stack);
        throw new Error(`Failed to load LanceDB: ${lancedbError.message}`);
      }

      // Load the model for generating query embeddings.
      console.log('[Worker] Loading embedding model...');
      try {
        this.embedder = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
        console.log('[Worker] Embedding model loaded successfully');
      } catch (modelError) {
        console.error('[Worker] CRITICAL ERROR loading embedding model:', modelError);
        console.error('[Worker] Model error stack:', modelError.stack);
        console.error('[Worker] Model error message:', modelError.message);
        throw new Error(`Failed to load embedding model: ${modelError.message}`);
      }

      // Connect to the LanceDB database directory
      console.log('[Worker] Connecting to database...');
      try {
        this.db = await connect(LANCE_DB_DIR);
        console.log('[Worker] Connected to database successfully');
      } catch (dbError) {
        if (dbError.message && dbError.message.includes('version')) {
          console.error('[Worker] Database version incompatibility:', dbError.message);
          console.log('[Worker] Attempting to skip vectordb initialization...');
          // Set a flag to indicate no database is available
          this.db = null;
          this.table = null;
          this.isInitialized = true;
          return; // Exit early without table operations
        }
        console.error('[Worker] CRITICAL ERROR connecting to database:', dbError);
        console.error('[Worker] Database error stack:', dbError.stack);
        throw dbError; // Re-throw if it's not a version error
      }

      const tableNames = await this.db.tableNames();
      console.log(`[Worker] Available tables: ${tableNames.join(', ')}`);
      if (!tableNames.includes(TABLE_NAME)) {
        throw new Error(`Table '${TABLE_NAME}' not found in database at ${LANCE_DB_DIR}`);
      }
      
      this.table = await this.db.openTable(TABLE_NAME);
      const rowCount = await this.table.countRows();
      
      this.isInitialized = true;
      console.log(`[Worker] Semantic Search Service Initialized. Connected to table: '${TABLE_NAME}' with ${rowCount} rows`);

    } catch (error) {
      console.error('[Worker] FATAL ERROR initializing Semantic Search Service:', error);
      console.error('[Worker] Fatal error stack:', error.stack);
      console.error('[Worker] Fatal error message:', error.message);
      console.error('[Worker] Fatal error name:', error.name);
      // Post error back to the main thread
      parentPort.postMessage({ type: 'error', payload: { message: error.message, stack: error.stack } });
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
      const searchLimit = Math.max(limit * 50, 10000); // Search through many more candidates

      // 1. Generate an embedding for the user's query
      const queryEmbedding = await this.embedder(query, { pooling: 'mean', normalize: true });

      // 2. Perform the similarity search in LanceDB with comprehensive limit
      const rawResults = await this.table
        .search(Array.from(queryEmbedding.data))
        .select([
          'name',
          'mana_cost',
          'type_line',
          'oracle_text',
          'image_uri',
          '_distance'
        ])
        .limit(searchLimit) // Use a much larger limit to get comprehensive candidates
        .offset(offset)
        .toArray();

      // 3. Ensure results are sorted by distance (best matches first)
      const sortedResults = rawResults.sort((a, b) => a._distance - b._distance);
        
      // Create plain serializable objects with proper score mapping
      const plainResults = sortedResults.map(r => ({ 
        ...r, 
        score: r._distance,
        distance: r._distance 
      }));

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

      console.log(`[Worker] Searched ${rawResults.length} candidates, found ${uniqueResults.length} unique cards ranked by relevance.`);
      return uniqueResults;

    } catch (error) {
      console.error('[Worker] Error during semantic search:', error);
      return [];
    }
  }
}

// --- Worker Message Handling ---

const service = new SearchWorkerService();

parentPort.on('message', async (message) => {
  const { type, payload, id } = message;

  try {
    switch (type) {
      case 'initialize':
        await service.initialize(payload.dbDirPath);
        if (service.isInitialized) {
            parentPort.postMessage({ type: 'initialized', id });
        }
        break;
      case 'search':
        const results = await service.search(payload.query, payload.options);
        parentPort.postMessage({ type: 'search-results', payload: results, id });
        break;
      default:
        console.warn(`[Worker] Unknown message type: ${type}`);
    }
  } catch (error) {
    parentPort.postMessage({ type: 'error', payload: { message: error.message, stack: error.stack }, id });
  }
}); 