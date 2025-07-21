const { contextBridge, ipcRenderer } = require('electron');

// The preload script runs before the renderer process is loaded.
// It has access to both DOM APIs and Node.js environment.
// We can expose privileged APIs to the renderer process here.

console.log('Preload script loaded.');

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('electronAPI', {
  // User Collections operations
  getUserCollections: () => ipcRenderer.invoke('get-user-collections'),
  getUserCollectionCards: (collectionName, options) => ipcRenderer.invoke('get-user-collection-cards', collectionName, options),

  // Bulk data operations
  bulkDataSearch: (query, options) => ipcRenderer.invoke('bulk-data-search', query, options),
  bulkDataSearchTokens: (query, options) => ipcRenderer.invoke('bulk-data-search-tokens', query, options),
  bulkDataFindCard: (cardName) => ipcRenderer.invoke('bulk-data-find-card', cardName),
  bulkDataFindCardByDetails: (name, setCode, collectorNumber) => ipcRenderer.invoke('bulk-data-find-card-by-details', name, setCode, collectorNumber),
  debugCardLookup: (name, setCode) => ipcRenderer.invoke('debug-card-lookup', name, setCode),
  bulkDataStats: () => ipcRenderer.invoke('bulk-data-stats'),
  bulkDataInitialized: () => ipcRenderer.invoke('bulk-data-initialized'),
  bulkDataForceImportRelatedLinks: () => ipcRenderer.invoke('bulk-data-force-import-related-links'),

  // Collection management
  collectionImportCSV: (filePath, collectionName) => ipcRenderer.invoke('collection-import-csv', filePath, collectionName),
  collectionImportTXT: (filePath, collectionName, format) => ipcRenderer.invoke('collection-import-txt', filePath, collectionName, format),
  collectionImportAllTxt: (format = 'simple') => ipcRenderer.invoke('collection-import-all-txt', format),
  collectionGetAll: () => ipcRenderer.invoke('collection-get-all'),
  collectionGet: (collectionName, options) => ipcRenderer.invoke('collection-get', collectionName, options),
  collectionGetSimple: (options) => ipcRenderer.invoke('collection-get-simple', options),
  collectionGetStats: (collectionName) => ipcRenderer.invoke('collection-get-stats', collectionName),
  collectionDelete: (collectionName) => ipcRenderer.invoke('collection-delete', collectionName),
  collectionAddCard: (collectionName, cardData) => ipcRenderer.invoke('collection-add-card', collectionName, cardData),
  collectionUpdateCardQuantity: (collectionName, cardKey, newQty) => ipcRenderer.invoke('collection-update-card-quantity', collectionName, cardKey, newQty),
  collectionDeleteCard: (collectionName, cardKey) => ipcRenderer.invoke('collection-delete-card', collectionName, cardKey),
  collectionGetCardQuantity: (cardName, options) => ipcRenderer.invoke('collection-get-card-quantity', cardName, options),
  collectionMarkCard: (cardId, collected) => ipcRenderer.invoke('collection-mark-card', cardId, collected),
  collectionClearAll: () => ipcRenderer.invoke('collection-clear-all'),
  collectionSync: () => ipcRenderer.invoke('collection-sync'),
  getDailyPrices: () => ipcRenderer.invoke('get-daily-prices'),

  // Deck Management
  deckSave: (filename, deckData) => ipcRenderer.invoke('deck-save', filename, deckData),
  deckList: () => ipcRenderer.invoke('deck-list'),
  deckLoad: (filename) => ipcRenderer.invoke('deck-load', filename),
  deckDelete: (filename) => ipcRenderer.invoke('deck-delete', filename),
  deckImport: (filePath, deckName, format) => ipcRenderer.invoke('deck-import', filePath, deckName, format),
  deckValidate: (deck, format) => ipcRenderer.invoke('deck-validate', deck, format),

  // File dialogs
  showOpenDialog: (options) => ipcRenderer.invoke('show-open-dialog', options),

  // Collection dialogs
  showCollectionNameDialog: (defaultName) => ipcRenderer.invoke('show-collection-name-dialog', defaultName),
  showFormatChoiceDialog: () => ipcRenderer.invoke('show-format-choice-dialog'),

  // Version info (from the original preload)
  getVersions: () => process.versions,

  getCardCount: () => ipcRenderer.invoke('get-card-count'),
  searchCards: (searchTerm) => ipcRenderer.invoke('search-cards', searchTerm),
  searchCardsSemantic: (query, options) => ipcRenderer.invoke('search-cards-semantic', query, options),
  onSemanticModelProgress: (callback) => ipcRenderer.on('semantic-model-progress', (e, progress) => callback(progress)),
  testSemanticSearch: (query) => ipcRenderer.invoke('test-semantic-search', query),
  getCardsByIds: (ids) => ipcRenderer.invoke('get-cards-by-ids', ids),
  importCollection: (filePath) => ipcRenderer.invoke('import-collection', filePath),
  onImportProgress: (callback) => ipcRenderer.on('import-progress', (event, ...args) => callback(...args)),
  removeImportProgressListener: (callback) => ipcRenderer.removeListener('import-progress', callback),
  getSettings: () => ipcRenderer.invoke('get-settings'),
  saveSettings: (settings) => ipcRenderer.invoke('save-settings', settings),
  resetSettings: () => ipcRenderer.invoke('reset-settings'),
  getDeckRecommendations: (deck) => ipcRenderer.invoke('get-deck-recommendations', deck),
  autoBuildCommanderDeck: () => ipcRenderer.invoke('auto-build-commander-deck'),

  // 🧪 Strategy Testing
  setActiveStrategy: (strategy) => ipcRenderer.invoke('set-active-strategy', strategy),
  getAvailableStrategies: () => ipcRenderer.invoke('get-available-strategies'),



  // Set browsing
  listSets: () => ipcRenderer.invoke('list-sets'),
  getCardsBySet: (setCode, options) => ipcRenderer.invoke('get-cards-by-set', setCode, options),
  onTaskProgress: (callback) => ipcRenderer.on('task-progress', (event, ...args) => callback(...args)),

  // Pattern Analysis
  testOraclePatternAnalysis: (cardName) => ipcRenderer.invoke('test-oracle-pattern-analysis', cardName),
}); 