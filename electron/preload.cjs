const { contextBridge, ipcRenderer } = require('electron');

// The preload script runs before the renderer process is loaded.
// It has access to both DOM APIs and Node.js environment.
// We can expose privileged APIs to the renderer process here.

console.log('Preload script loaded.');

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('electronAPI', {
  // File operations
  getCardFiles: () => ipcRenderer.invoke('get-card-files'),
  readCardFile: (filename) => ipcRenderer.invoke('read-card-file', filename),
  
  // Bulk data operations
  bulkDataSearch: (query, options) => ipcRenderer.invoke('bulk-data-search', query, options),
  bulkDataFindCard: (cardName) => ipcRenderer.invoke('bulk-data-find-card', cardName),
  bulkDataFindCardByDetails: (name, setCode, collectorNumber) => ipcRenderer.invoke('bulk-data-find-card-by-details', name, setCode, collectorNumber),
  debugCardLookup: (name, setCode) => ipcRenderer.invoke('debug-card-lookup', name, setCode),
  bulkDataStats: () => ipcRenderer.invoke('bulk-data-stats'),
  bulkDataInitialized: () => ipcRenderer.invoke('bulk-data-initialized'),
  
  // Collection management
  collectionImportCSV: (filePath, collectionName) => ipcRenderer.invoke('collection-import-csv', filePath, collectionName),
  collectionImportTXT: (filePath, collectionName, format) => ipcRenderer.invoke('collection-import-txt', filePath, collectionName, format),
  collectionImportAllTxt: (format = 'simple') => ipcRenderer.invoke('collection-import-all-txt', format),
  collectionGetAll: () => ipcRenderer.invoke('collection-get-all'),
  collectionGet: (collectionName, options) => ipcRenderer.invoke('collection-get', collectionName, options),
  collectionGetStats: (collectionName) => ipcRenderer.invoke('collection-get-stats', collectionName),
  collectionDelete: (collectionName) => ipcRenderer.invoke('collection-delete', collectionName),
  collectionAddCard: (collectionName, cardData) => ipcRenderer.invoke('collection-add-card', collectionName, cardData),
  collectionUpdateCardQuantity: (collectionName, cardKey, newQty) => ipcRenderer.invoke('collection-update-card-quantity', collectionName, cardKey, newQty),
  collectionDeleteCard: (collectionName, cardKey) => ipcRenderer.invoke('collection-delete-card', collectionName, cardKey),
  collectionGetCardQuantity: (cardName, options) => ipcRenderer.invoke('collection-get-card-quantity', cardName, options),
  
  // Deck Management
  deckSave: (filename, deckData) => ipcRenderer.invoke('deck-save', filename, deckData),
  deckList: () => ipcRenderer.invoke('deck-list'),
  deckLoad: (filename) => ipcRenderer.invoke('deck-load', filename),
  deckDelete: (filename) => ipcRenderer.invoke('deck-delete', filename),
  
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
  getCardsByIds: (ids) => ipcRenderer.invoke('get-cards-by-ids', ids),
  importCollection: (filePath) => ipcRenderer.invoke('import-collection', filePath),
  onImportProgress: (callback) => ipcRenderer.on('import-progress', (event, ...args) => callback(...args)),
  removeImportProgressListener: (callback) => ipcRenderer.removeListener('import-progress', callback),
  getSettings: () => ipcRenderer.invoke('get-settings'),
  saveSettings: (settings) => ipcRenderer.invoke('save-settings', settings),
  getDeckRecommendations: (deck) => ipcRenderer.invoke('get-deck-recommendations', deck),

  // Set browsing
  listSets: () => ipcRenderer.invoke('list-sets'),
  getCardsBySet: (setCode, options) => ipcRenderer.invoke('get-cards-by-set', setCode, options),
  onTaskProgress: (callback) => ipcRenderer.on('task-progress', (event, ...args) => callback(...args)),
}); 