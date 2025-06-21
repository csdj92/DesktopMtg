const { parentPort } = require('worker_threads');
const path = require('path');

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

      // Dynamically import ES modules required for the service
      const transformers = await import('@xenova/transformers');
      pipeline = transformers.pipeline;
      const lancedbModule = await import('@lancedb/lancedb');
      connect = lancedbModule.connect;

      // Load the model for generating query embeddings.
      this.embedder = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');

      // Connect to the LanceDB database directory
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