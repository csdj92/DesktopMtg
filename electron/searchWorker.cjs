const { parentPort } = require('worker_threads');
const fs = require('fs');
const path = require('path');

// --- Runtime tuning --------------------------------------------------------
process.env.TRANSFORMERS_VERBOSITY = 'error';
process.env.TOKENIZERS_PARALLELISM  = 'false';
process.env.OMP_NUM_THREADS         = '1';
process.env.OPENBLAS_NUM_THREADS    = '1';
process.env.MKL_NUM_THREADS         = '1';

// Dynamically‑loaded ESM deps
let pipeline;   // @xenova/transformers
let connect;    // @lancedb/lancedb

// ---------------------------------------------------------------------------
//  SearchWorkerService – focuses on the single vector column `keyword_vector`
// ---------------------------------------------------------------------------
class SearchWorkerService {
  db          = null;
  table       = null;
  embedder    = null;
  isInitialized = false;
  maxRetries  = 3;

  // ----------------------- init -------------------------------------------
  async initialize({ dbDirPath, cachePath }) {
    if (this.isInitialized) return;

    try {
      console.log('[Worker] Starting initialization...');
      
      // Ensure cache dir for HuggingFace files is writable
      fs.mkdirSync(cachePath, { recursive: true });
      process.env.TRANSFORMERS_CACHE = cachePath;

      // Lazy‑load heavy deps
      ({ pipeline } = await import('@xenova/transformers'));
      ({ connect  } = await import('@lancedb/lancedb'));

      // Load model with retry logic
      this.embedder = await this.loadModelWithRetry();

      // Connect to LanceDB
      console.log('[Worker] Attempting to connect to LanceDB at:', dbDirPath);
      console.log('[Worker] About to call connect()...');
      this.db = await connect(dbDirPath);
      console.log('[Worker] LanceDB connection successful');

      // Open the table
      console.log('[Worker] About to open table: magic_cards');
      this.table = await this.db.openTable('magic_cards');
      console.log('[Worker] Table opened successfully');

      // Get row count
      console.log('[Worker] About to count rows...');
      const rowCount = await this.table.countRows();
      console.log('[Worker] Row count:', rowCount);

      // Get schema info
      console.log('[Worker] About to get schema...');
      const schema = await this.table.schema();
      console.log('[Worker] Table schema fields:', schema.fields.map(f => f.name));
      
      // Detect vector columns
      const vectorColumns = schema.fields
        .filter(f => f.type.toString().includes('FixedSizeList'))
        .map(f => f.name);
      console.log('[Worker] Detected vector columns:', vectorColumns);

      
      this.isInitialized = true;
      console.log(`[Worker] Semantic Search Service Initialized. Connected to table: 'magic_cards' with ${rowCount} rows`);

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
   * Check if model is already cached locally
   */
  async isModelCached() {
    try {
      // Check if the model files exist in the cache directory
      const modelName = 'xenova/all-MiniLM-L6-v2';
      const cacheDir = process.env.TRANSFORMERS_CACHE;
      
      if (!cacheDir) {
        console.log('[Worker] No cache directory set, assuming model not cached');
        return false;
      }
      
      // The model files are typically stored in a subdirectory structure
      // Check for the main model file (config.json and model files)
      const modelDir = path.join(cacheDir, 'hub', 'models--xenova--all-MiniLM-L6-v2');
      const configFile = path.join(modelDir, 'config.json');
      const modelFiles = [
        path.join(modelDir, 'snapshots', 'main', 'config.json'),
        path.join(modelDir, 'snapshots', 'main', 'tokenizer.json'),
        path.join(modelDir, 'snapshots', 'main', 'model.safetensors')
      ];
      
      // Check if config file exists
      if (!fs.existsSync(configFile)) {
        console.log('[Worker] Model config not found in cache');
        return false;
      }
      
      // Check if main model files exist
      const missingFiles = modelFiles.filter(file => !fs.existsSync(file));
      if (missingFiles.length > 0) {
        console.log('[Worker] Some model files missing:', missingFiles);
        return false;
      }
      
      console.log('[Worker] Model found in cache, skipping download');
      return true;
    } catch (error) {
      console.error('[Worker] Error checking model cache:', error);
      return false;
    }
  }

  /**
   * Load model with retry logic for better reliability
   */
  async loadModelWithRetry() {
    // First check if model is already cached
    const isCached = await this.isModelCached();
    
    if (isCached) {
      console.log('[Worker] Model is already cached, loading from cache...');
      // Send progress update to indicate we're loading from cache
      parentPort.postMessage({ type: 'model-progress', payload: { progress: 0.1, message: 'Loading model from cache...' } });
      
      try {
        const model = await pipeline(
          'feature-extraction',
          'xenova/all-MiniLM-L6-v2',
          {
            progress_callback: ({ progress }) => {
              // For cached models, progress should be much faster
              const adjustedProgress = 0.1 + (progress * 0.8); // Start at 10%, use 80% of remaining progress
              parentPort.postMessage({ 
                type: 'model-progress', 
                payload: { 
                  progress: adjustedProgress,
                  message: `Loading model from cache: ${(adjustedProgress * 100).toFixed(1)}%`
                } 
              });
            }
          }
        );
        
        console.log('[Worker] Model loaded successfully from cache');
        parentPort.postMessage({ type: 'model-progress', payload: { progress: 1.0, message: 'Model loaded from cache' } });
        return model;
      } catch (error) {
        console.error('[Worker] Failed to load model from cache:', error);
        // Fall through to download if cache loading fails
      }
    }
    
    // Model not cached or cache loading failed, download it
    console.log('[Worker] Model not found in cache, downloading...');
    parentPort.postMessage({ type: 'model-progress', payload: { progress: 0, message: 'Downloading AI model...' } });
    
    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        console.log(`[Worker] Loading model (attempt ${attempt}/${this.maxRetries})...`);
        console.log(`[Worker] About to call pipeline() with feature-extraction`);
        
        const model = await pipeline(
          'feature-extraction',
          'xenova/all-MiniLM-L6-v2',
          {
            progress_callback: ({ progress }) => {
              // progress is 0-1 float; convert to percentage for convenience
              parentPort.postMessage({ 
                type: 'model-progress', 
                payload: { 
                  progress,
                  message: `Downloading AI model: ${(progress * 100).toFixed(1)}%`
                } 
              });
            }
          }
        );
        
        console.log(`[Worker] Model loaded successfully on attempt ${attempt}`);
        console.log(`[Worker] Model type:`, typeof model);
        console.log(`[Worker] Model keys:`, Object.keys(model || {}));
        
        parentPort.postMessage({ type: 'model-progress', payload: { progress: 1.0, message: 'Model downloaded successfully' } });
        return model;
      } catch (error) {
        console.error(`[Worker] Model load attempt ${attempt} failed:`, error);
        
        if (attempt === this.maxRetries) {
          throw new Error(`Failed to load model after ${this.maxRetries} attempts: ${error.message}`);
        }
        
        // Wait before retry (exponential backoff)
        await new Promise(resolve => setTimeout(resolve, 100000 * Math.pow(2, attempt - 1)));
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
   * Traditional text-based search fallback
   */
  async traditionalSearch(query, limit = 50, offset = 0) {
    try {
      console.log('[Worker] Performing traditional text search...');
      
      // Simple text matching fallback
      console.log('[Worker] TRADITIONAL SEARCH: About to call .search() with vector_column_name');
      console.log('[Worker] TRADITIONAL SEARCH params:', { query, vector_column_name: "keyword_vector" });
      const results = await this.table
        .search(query)
        .column('keyword_vector')
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
          'set_name'
        ])
        .limit(limit)
        .offset(offset)
        .toArray();

      const plainResults = results.map(card => ({
        ...card,
        hybrid_score: 0.5, // Default score for traditional search
        distance: null
      }));

      // Remove duplicates by card name for traditional search too
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
      
      console.log(`[Worker] Traditional search completed. Found ${plainResults.length} total results, ${uniqueResults.length} unique cards.`);
      return uniqueResults;
    } catch (error) {
      console.error('[Worker] Error during traditional search:', error);
      return [];
    }
  }

  /**
   * Performs a semantic search with unique name filtering and proper ranking.
   */
  async search(query, options = {}) {
    try {
      console.log('[Worker] Starting search with query:', query);
      const { 
        limit = 50, 
        offset = 0, 
        useSemanticSearch = true, 
        useHybridSearch = false,
        semanticWeight = 0.7
      } = options;

      console.log('[Worker] SEARCH OPTIONS:', { limit, offset, useSemanticSearch, useHybridSearch, semanticWeight });

      if (!this.isInitialized || !this.embedder || !this.table) {
        console.error('[Worker] Search service is not ready.');
        return [];
      }
      
      if (!query || query.trim().length === 0) {
        return [];
      }

      if (!useSemanticSearch) {
        // Traditional text-based search fallback
        console.log('[Worker] Using traditional search (semantic disabled)');
        const results = await this.traditionalSearch(query, limit, offset);
        return results;
      }

      console.log('[Worker] Using semantic search with useHybridSearch:', useHybridSearch);

      console.log('[Worker] Generating embedding for query...');
      console.log('[Worker] About to call this.embedder() with params:', { query, pooling: 'mean', normalize: true });
      console.log('[Worker] this.embedder type:', typeof this.embedder);
      console.log('[Worker] this.embedder is function:', typeof this.embedder === 'function');
      
      let queryEmbedding;
      try {
        console.log('[Worker] Calling this.embedder() now...');
        queryEmbedding = await this.embedder(query, { pooling: 'mean', normalize: true });
        console.log('[Worker] Embedding generated successfully.');
        console.log('[Worker] Embedding data length:', queryEmbedding?.data?.length);
        console.log('[Worker] Embedding type:', typeof queryEmbedding);
        console.log('[Worker] Embedding keys:', Object.keys(queryEmbedding || {}));
      } catch (embeddingError) {
        console.error('[Worker] Error during embedding generation:', embeddingError);
        console.error('[Worker] Embedding error stack:', embeddingError?.stack);
        console.error('[Worker] Embedding error message:', embeddingError?.message);
        throw embeddingError;
      }

      const searchLimit = Math.min(limit, 1000);
      let searchResults;

      if (useHybridSearch) {
        console.log('[Worker] Starting LanceDB HYBRID search...');
        console.log('[Worker] HYBRID SEARCH PATH SELECTED');
        try {
          // Try modern LanceDB hybrid search - different approaches
          try {
            // Method 1: Try with query_type parameter and vector column specification
            console.log('[Worker] HYBRID METHOD 1: About to call .search() with hybrid params');
            const hybridParams = { 
              query_type: "hybrid", 
              vector_column_name: "keyword_vector",
              fts_columns: "oracle_text",
              metric: "cosine" // Explicitly specify metric
            };
            console.log('[Worker] HYBRID METHOD 1 params:', { query, ...hybridParams });
            searchResults = await this.table
              .search(query, hybridParams)
              .column('keyword_vector')
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
                'set_name'
              ])
              .limit(searchLimit)
              .offset(offset)
              .toArray();
          } catch (method1Error) {
            console.warn('[Worker] Method 1 failed, trying method 2:', method1Error.message);
            // Method 2: Try with vector search + FTS combination
            console.log('[Worker] HYBRID METHOD 2: About to call .search() with vector data');
            console.log('[Worker] HYBRID METHOD 2 params:', { 
              embeddingLength: queryEmbedding.data.length, 
              ...vectorParams 
            });
            searchResults = await this.table
              .search(Array.from(queryEmbedding.data))
              .column('keyword_vector')
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
          }
          
          console.log('[Worker] Hybrid search completed.');
        } catch (hybridErr) {
          console.warn('[Worker] Hybrid search failed, falling back to vector search:', hybridErr?.message || hybridErr);
          // Fallback to vector search if hybrid fails
          console.log('[Worker] HYBRID FALLBACK: About to call .search() with vector data');
          console.log('[Worker] HYBRID FALLBACK params:', { 
            embeddingLength: queryEmbedding.data.length, 
            ...fallbackParams 
          });
          searchResults = await this.table
            .search(Array.from(queryEmbedding.data))
            .column('keyword_vector')
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
        }
      } else {
        console.log('[Worker] Starting LanceDB VECTOR search...');
        console.log('[Worker] VECTOR SEARCH PATH SELECTED');
        console.log('[Worker] VECTOR search parameters:', {
          column: 'keyword_vector',
          embeddingLength: queryEmbedding?.data?.length,
          useHybridSearch
        });
        console.log('[Worker] VECTOR SEARCH: About to call .search() with vector data');
       
        console.log('[Worker] VECTOR SEARCH params:', { 
          embeddingLength: queryEmbedding.data.length
        });
        searchResults = await this.table
          .search(Array.from(queryEmbedding.data))
          .column('keyword_vector')
          .select([
            'keyword_vector',
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
        console.log('[Worker] Vector search completed.');
      }

      // Helper function to safely convert arrays
      const arr = v =>
        v == null                       ? []  :
        Array.isArray(v)                ? v   :
        typeof v.toArray === 'function' ? v.toArray() : v;

      // Create plain serializable objects - don't try to modify the original objects
      const plainResults = searchResults.map(card => {
        // Calculate score based on available data
        let score = 0.5; // Default score
        
        if (card._distance !== undefined) {
          // For vector search, convert distance to score (higher score = better)
          score = Math.max(0, 1 - card._distance);
        } else if (card._score !== undefined) {
          // For hybrid search, use the provided score
          score = card._score;
        }

        return {
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
          distance: card._distance,
          hybrid_score: score
        };
      });

      // Sort by score (higher is better)
      const sortedResults = plainResults.sort((a, b) => b.hybrid_score - a.hybrid_score);
      
      // Remove duplicates by card name, keeping the highest scoring version of each card
      const uniqueResults = [];
      const seenNames = new Set();
      
      for (const card of sortedResults) {
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
      
      console.log(`[Worker] Search completed. Found ${sortedResults.length} total results, ${uniqueResults.length} unique cards.`);
      return uniqueResults;

    } catch (error) {
      console.error('[Worker] Error during semantic search:', error);
      console.error('[Worker] Error stack:', error?.stack);
      try {
        const idxInfo = typeof this.table?.listIndexes === 'function' ? await this.table.listIndexes() : 'N/A';
        console.error('[Worker] Table index info at error time:', idxInfo);
      } catch (idxErr) {
        console.warn('[Worker] Failed to log index info during error handling:', idxErr);
      }
      throw error;
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
