import React, { useState, useEffect } from 'react';
import './CollectionManager.css';

const safeConfirm = (message) => {
  try {
    if (typeof window !== 'undefined' && typeof window.confirm === 'function') {
      return window.confirm(message);
    }
  } catch (_) {
    /* ignored */
  }
  // Default to false (safer) if confirmation API unavailable
  return false;
};

const CollectionManager = () => {
  const [collections, setCollections] = useState([]);
  const [selectedCollection, setSelectedCollection] = useState(null);
  const [collectionCards, setCollectionCards] = useState([]);
  const [collectionStats, setCollectionStats] = useState(null);
  const [isImporting, setIsImporting] = useState(false);
  const [importProgress, setImportProgress] = useState('');
  const [searchTerm, setSearchTerm] = useState('');

  // Load collections on component mount
  useEffect(() => {
    loadCollections();
  }, []);

  // Load collection cards when selection changes
  useEffect(() => {
    if (selectedCollection) {
      loadCollectionCards(selectedCollection.collection_name);
      loadCollectionStats(selectedCollection.collection_name);
    }
  }, [selectedCollection]);

  const loadCollections = async () => {
    try {
      const data = await window.electronAPI.collectionGetAll();
      setCollections(data);
    } catch (error) {
      console.error('Error loading collections:', error);
    }
  };

  const loadCollectionCards = async (collectionName, search = '') => {
    try {
      const cards = await window.electronAPI.collectionGet(collectionName, {
        search,
        limit: 100
      });
      setCollectionCards(cards);
    } catch (error) {
      console.error('Error loading collection cards:', error);
    }
  };

  const loadCollectionStats = async (collectionName) => {
    try {
      const stats = await window.electronAPI.collectionGetStats(collectionName);
      setCollectionStats(stats);
    } catch (error) {
      console.error('Error loading collection stats:', error);
    }
  };

  const handleImportCSV = async () => {
    try {
      setIsImporting(true);
      setImportProgress('Opening file dialog...');

      // Show file dialog
      const result = await window.electronAPI.showOpenDialog({
        title: 'Import CSV Collection',
        filters: [
          { name: 'CSV Files', extensions: ['csv'] },
          { name: 'All Files', extensions: ['*'] }
        ],
        properties: ['openFile']
      });

      if (result.canceled || !result.filePaths || result.filePaths.length === 0) {
        setIsImporting(false);
        setImportProgress('');
        return;
      }

      const filePath = result.filePaths[0];
      const fileName = filePath.split(/[/\\]/).pop().replace('.csv', '');
      
      // Show native dialog to confirm collection name
      const nameResult = await window.electronAPI.showCollectionNameDialog(fileName);
      if (!nameResult.confirmed) {
        setIsImporting(false);
        setImportProgress('');
        return;
      }
      
      const collectionName = nameResult.name;
      
      if (!collectionName.trim()) {
        setIsImporting(false);
        setImportProgress('');
        return;
      }

      setImportProgress('Importing CSV file...');

      // Import the CSV
      const importResult = await window.electronAPI.collectionImportCSV(filePath, collectionName.trim());

      if (importResult.success) {
        setImportProgress(`✅ Import complete! ${importResult.imported} cards imported`);
        await loadCollections();
        setTimeout(() => {
          setImportProgress('');
        }, 3000);
      } else {
        setImportProgress(`❌ Import failed: ${importResult.error}`);
        setTimeout(() => {
          setImportProgress('');
        }, 5000);
      }

    } catch (error) {
      console.error('Import error:', error);
      setImportProgress(`❌ Import failed: ${error.message}`);
      setTimeout(() => {
        setImportProgress('');
      }, 5000);
    } finally {
      setIsImporting(false);
    }
  };

  const handleImportTXT = async () => {
    try {
      setIsImporting(true);
      setImportProgress('Opening file dialog...');

      // Show file dialog
      const result = await window.electronAPI.showOpenDialog({
        title: 'Import TXT Collection',
        filters: [
          { name: 'Text Files', extensions: ['txt'] },
          { name: 'All Files', extensions: ['*'] }
        ],
        properties: ['openFile']
      });

      if (result.canceled || !result.filePaths || result.filePaths.length === 0) {
        setIsImporting(false);
        setImportProgress('');
        return;
      }

      const filePath = result.filePaths[0];
      const fileName = filePath.split(/[/\\]/).pop().replace('.txt', '');
      
      // Show native dialog to confirm collection name
      const nameResult = await window.electronAPI.showCollectionNameDialog(fileName);
      if (!nameResult.confirmed) {
        setIsImporting(false);
        setImportProgress('');
        return;
      }
      
      const collectionName = nameResult.name;
      
      if (!collectionName.trim()) {
        setIsImporting(false);
        setImportProgress('');
        return;
      }

      // Show native dialog for format choice
      const formatResult = await window.electronAPI.showFormatChoiceDialog();
      if (!formatResult.confirmed) {
        setIsImporting(false);
        setImportProgress('');
        return;
      }
      
      const format = formatResult.format;

      setImportProgress('Importing TXT file...');

      // Import the TXT
      const importResult = await window.electronAPI.collectionImportTXT(filePath, collectionName.trim(), format);

      if (importResult.success) {
        setImportProgress(`✅ Import complete! ${importResult.imported} cards imported`);
        await loadCollections();
        setTimeout(() => {
          setImportProgress('');
        }, 3000);
      } else {
        setImportProgress(`❌ Import failed: ${importResult.error}`);
        setTimeout(() => {
          setImportProgress('');
        }, 5000);
      }

    } catch (error) {
      console.error('Import error:', error);
      setImportProgress(`❌ Import failed: ${error.message}`);
      setTimeout(() => {
        setImportProgress('');
      }, 5000);
    } finally {
      setIsImporting(false);
    }
  };

  // Bulk import all TXT files located in the legacy /cards directory
  const handleBulkImportTXT = async () => {
    try {
      setIsImporting(true);
      setImportProgress('Importing all TXT files from cards directory...');

      const result = await window.electronAPI.collectionImportAllTxt();

      if (result.success) {
        setImportProgress(`✅ Imported ${result.importedFiles} TXT files`);
        await loadCollections();
        setTimeout(() => setImportProgress(''), 4000);
      } else {
        setImportProgress(`❌ Bulk import failed: ${result.error}`);
        setTimeout(() => setImportProgress(''), 5000);
      }
    } catch (error) {
      console.error('Bulk import error:', error);
      setImportProgress(`❌ Bulk import failed: ${error.message}`);
      setTimeout(() => setImportProgress(''), 5000);
    } finally {
      setIsImporting(false);
    }
  };

  const handleDeleteCollection = async (collectionName) => {
    if (!safeConfirm(`Are you sure you want to delete the collection "${collectionName}"? This cannot be undone.`)) {
      return;
    }

    try {
      const success = await window.electronAPI.collectionDelete(collectionName);
      if (success) {
        await loadCollections();
        if (selectedCollection && selectedCollection.collection_name === collectionName) {
          setSelectedCollection(null);
          setCollectionCards([]);
          setCollectionStats(null);
        }
      }
    } catch (error) {
      console.error('Error deleting collection:', error);
      alert('Failed to delete collection');
    }
  };

  const handleSearch = (e) => {
    const term = e.target.value;
    setSearchTerm(term);
    
    if (selectedCollection) {
      loadCollectionCards(selectedCollection.collection_name, term);
    }
  };

  const formatPrice = (price, currency = 'USD') => {
    if (!price || price === 0) return '';
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currency || 'USD'
    }).format(price);
  };

  const formatDate = (dateString) => {
    if (!dateString) return '';
    return new Date(dateString).toLocaleDateString();
  };

  return (
    <div className="collection-manager">
      <div className="collection-sidebar">
        <div className="collection-header">
          <h2>My Collections</h2>
          <div className="import-buttons">
            <button 
              onClick={handleImportCSV} 
              disabled={isImporting}
              className="import-btn csv-btn"
            >
              📁 Import CSV
            </button>
            <button 
              onClick={handleImportTXT} 
              disabled={isImporting}
              className="import-btn txt-btn"
            >
              📄 Import TXT
            </button>
            <button
              onClick={handleBulkImportTXT}
              disabled={isImporting}
              className="import-btn bulk-txt-btn"
            >
              📂 Import All TXT
            </button>
          </div>
        </div>

        {importProgress && (
          <div className="import-progress">
            {importProgress}
          </div>
        )}

        <div className="collections-list">
          {collections.map((collection) => (
            <div
              key={collection.collection_name}
              className={`collection-item ${selectedCollection?.collection_name === collection.collection_name ? 'selected' : ''}`}
              onClick={() => setSelectedCollection(collection)}
            >
              <div className="collection-info">
                <h3>{collection.collection_name}</h3>
                <p>{collection.total_cards} cards ({collection.card_count} unique)</p>
                <small>Updated: {formatDate(collection.last_updated)}</small>
              </div>
              <button
                className="delete-btn"
                onClick={(e) => {
                  e.stopPropagation();
                  handleDeleteCollection(collection.collection_name);
                }}
                title="Delete collection"
              >
                🗑️
              </button>
            </div>
          ))}

          {collections.length === 0 && (
            <div className="no-collections">
              <p>No collections yet.</p>
              <p>Import a CSV or TXT file to get started!</p>
            </div>
          )}
        </div>
      </div>

      <div className="collection-content">
        {selectedCollection ? (
          <>
            <div className="collection-details-header">
              <h2>{selectedCollection.collection_name}</h2>
              
              {collectionStats && (
                <div className="collection-stats">
                  <div className="stat">
                    <strong>{collectionStats.total_cards}</strong>
                    <span>Total Cards</span>
                  </div>
                  <div className="stat">
                    <strong>{collectionStats.unique_cards}</strong>
                    <span>Unique Cards</span>
                  </div>
                  <div className="stat">
                    <strong>{collectionStats.foil_cards}</strong>
                    <span>Foil Cards</span>
                  </div>
                  <div className="stat">
                    <strong>{collectionStats.sets_count}</strong>
                    <span>Sets</span>
                  </div>
                  {collectionStats.total_value > 0 && (
                    <div className="stat">
                      <strong>{formatPrice(collectionStats.total_value)}</strong>
                      <span>Total Value</span>
                    </div>
                  )}
                </div>
              )}

              <div className="search-box">
                <input
                  type="text"
                  placeholder="Search cards..."
                  value={searchTerm}
                  onChange={handleSearch}
                />
              </div>
            </div>

            <div className="cards-grid">
              {collectionCards.map((card, index) => (
                <div key={index} className="collection-card">
                  <div className="card-info">
                    <h4>{card.card_name}</h4>
                    <div className="card-details">
                      {card.set_code && <span className="set-info">{card.set_code} #{card.collector_number}</span>}
                      {card.rarity && <span className={`rarity ${card.rarity}`}>{card.rarity}</span>}
                      {card.foil === 'foil' && <span className="foil">✨ Foil</span>}
                    </div>
                    <div className="card-meta">
                      <span className="quantity">Qty: {card.quantity}</span>
                      {card.condition && <span className="condition">{card.condition.replace('_', ' ')}</span>}
                      {card.purchase_price > 0 && (
                        <span className="price">{formatPrice(card.purchase_price, card.currency)}</span>
                      )}
                    </div>
                  </div>
                </div>
              ))}

              {collectionCards.length === 0 && selectedCollection && (
                <div className="no-cards">
                  <p>No cards found in this collection.</p>
                  {searchTerm && <p>Try adjusting your search term.</p>}
                </div>
              )}
            </div>
          </>
        ) : (
          <div className="no-selection">
            <h2>Select a Collection</h2>
            <p>Choose a collection from the sidebar to view its cards.</p>
            <div className="import-help">
              <h3>Supported File Formats:</h3>
              <div className="format-examples">
                <div className="format">
                  <h4>📁 CSV Files</h4>
                  <p>ManaBox exports, custom CSV files with headers like:</p>
                  <code>Name,Set code,Collector number,Quantity,Foil,Rarity</code>
                </div>
                <div className="format">
                  <h4>📄 TXT Files</h4>
                  <p>Multiple formats supported:</p>
                  <ul>
                    <li><strong>Simple:</strong> <code>Lightning Bolt</code></li>
                    <li><strong>MTGO:</strong> <code>4x Lightning Bolt</code></li>
                    <li><strong>Detailed:</strong> <code>4 Lightning Bolt (M10) 123 [foil]</code></li>
                    <li><strong>Deckbox:</strong> <code>1x Lightning Bolt [M10]</code></li>
                  </ul>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default CollectionManager; 