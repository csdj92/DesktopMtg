const path = require('path');
// Electron's `app` is not available inside plain Node.js worker threads. Attempt
// to retrieve it, but fall back gracefully when running outside the Electron
// main process so this module can still be required by import workers.
let app;
try {
  const electron = require('electron');
  app = electron.app || (electron.remote && electron.remote.app);
} catch (_) {
  app = null; // Not running inside Electron
}
const { Worker } = require('worker_threads');

// --- FIX #1: Corrected the database directory name ---
// The Python script created 'mtg_db', so we need to point to that folder.
const { resolveVectorDbPath } = require('./vectordbResolver.cjs');
const { resolveCachePath } = require('./cacheResolver.cjs');

class SemanticSearchService {
  constructor() {
    this.worker = null;
    this.taskQueue = new Map();
    this.nextTaskId = 0;
    this.initializationPromise = null;
  }

  /**
   * Initializes the semantic search worker thread.
   * This should be called once when the application starts.
   */
  initialize() {
    // Prevent re-initialization
    if (this.initializationPromise) {
      return this.initializationPromise;
    }

    this.initializationPromise = new Promise((resolve, reject) => {
      console.log('Initializing Semantic Search Worker...');
      console.log('[SemanticSearch] Initializing worker...');
      this.worker = new Worker(path.join(__dirname, 'searchWorker.cjs'));

      const initTimeout = setTimeout(() => {
        reject(new Error('Semantic Search Worker initialization timed out.'));
        this.terminate();
      }, 300000); // 5-minute timeout for model download

      this.worker.on('message', (message) => {
        const { type, payload, id } = message;
        if (this.taskQueue.has(id)) {
          const { resolve, reject } = this.taskQueue.get(id);
          if (type.endsWith('-results') || type === 'initialized') {
            if (id === 0) clearTimeout(initTimeout); // Clear timeout on successful init
            resolve(payload);
          } else if (type === 'error') {
            if (id === 0) clearTimeout(initTimeout);
            console.error('Error from semantic search worker:', payload.message);
            reject(new Error(payload.message));
          }
          this.taskQueue.delete(id);
        }
        // Stream progress updates that don't belong to a specific task
        if (type === 'model-progress' && payload && typeof payload.progress === 'number') {
          console.log(`[SemanticSearch] Model download progress: ${(payload.progress * 100).toFixed(1)}%`);
          try {
            const { BrowserWindow } = require('electron');
            BrowserWindow.getAllWindows().forEach(w => {
              w.webContents.send('semantic-model-progress', payload.progress);
            });
          } catch {}
        }
      });

      this.worker.on('error', (err) => {
        console.error('Semantic Search Worker crashed:', err);
        clearTimeout(initTimeout);
        this.terminate();
        reject(err);
      });

      this.worker.on('exit', (code) => {
        if (code !== 0) console.error(`Search Worker stopped with exit code ${code}`);
        this.worker = null;
      });
      
      // Determine the absolute path to the bundled LanceDB database. When running in
      // development we assume the database lives at `<project root>/vectordb`. When the
      // app is packaged it will be copied into the resources path – we handle both
      // cases here.

      resolveVectorDbPath().then(dbDirPath => {
        resolveCachePath().then(cachePath => {
          // Check if vectordb exists before initializing
          const fs = require('fs');
          if (!fs.existsSync(dbDirPath)) {
            console.log('Vector database not found at:', dbDirPath);
            console.log('Semantic search will be disabled');
            this.isInitialized = false;
            resolve();
            return;
          }

          // Send the absolute paths to the worker so it can connect to the database and load the model.
          this.postMessage('initialize', { dbDirPath, cachePath }).then(resolve).catch(reject);
        }).catch(reject);
      }).catch(reject);
    }); 
  }

  /**
   * Posts a message to the worker and returns a promise that resolves with the result.
   */
  postMessage(type, payload) {
    return new Promise((resolve, reject) => {
      const id = this.nextTaskId++;
      this.taskQueue.set(id, { resolve, reject });
      this.worker.postMessage({ type, payload, id });
    });
  }

  /**
  * Performs a semantic search by sending the query to the worker.
  * Results are automatically filtered for unique card names and ranked by relevance.
  */
  async search(query, options = {}) {
    if (!this.worker) {
      console.error('Search worker is not initialized or has crashed.');
      return [];
    }

    try {
      // Ensure initialization is complete before searching
      await this.initializationPromise;
      console.log(`Sending semantic search to worker: "${query}"`);
      
      // Default to 200 results if not specified
      const searchOptions = {
        limit: 200,
        ...options
      };
      
      console.log(`[SemanticSearch] Sending search query to worker: "${query}"`);
      return await this.postMessage('search', { query, options: searchOptions });
    } catch (error) {
      console.error('Error during semantic search communication:', error);
      return [];
    }
  }

  /**
   * Terminates the worker thread.
   */
  terminate() {
    if (this.worker) {
      // Try graceful cleanup first
      this.postMessage('cleanup', {}).catch(() => {
        // If cleanup fails, force terminate
        console.log('Cleanup message failed, force terminating worker');
      }).finally(() => {
        // Always terminate after a brief delay
        setTimeout(() => {
          if (this.worker) {
            this.worker.terminate();
            this.worker = null;
            this.initializationPromise = null;
            console.log('Semantic Search Worker terminated.');
          }
        }, 1000);
      });
    }
  }

  async deleteIndex() {
    // Placeholder – full vector index management is not implemented yet.
    console.warn('[SemanticSearch] deleteIndex() called but not implemented – skipping');
    return Promise.resolve();
  }

  async indexCards(cards) {
    // Placeholder – vector indexing is not implemented. Accept call to avoid errors.
    console.warn(`[SemanticSearch] indexCards() received ${cards?.length || 0} cards – skipping (not implemented)`);
    return Promise.resolve();
  }
}

// Export a single instance of the service (Singleton pattern)
const service = new SemanticSearchService();

// Gracefully terminate the worker on app quit (only in Electron context)
if (app) {
  app.on('will-quit', () => {
    service.terminate();
  });
}

module.exports = service;