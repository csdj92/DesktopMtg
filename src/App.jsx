import { useState, useEffect, useCallback } from 'react'
import Card from './Card'
import SearchControls from './components/SearchControls';
import CollectionManager from './components/CollectionManager';
import SemanticSearchV2 from './components/SemanticSearchV2';
import DeckBuilder from './components/DeckBuilder';
import HandSimulator from './components/HandSimulator';
import './App.css'
import './components/SearchControls.css';
import SetBrowser from './components/SetBrowser';
import TaskProgressOverlay from './components/TaskProgressOverlay';

function App() {
  // File-based state
  const [cardFiles, setCardFiles] = useState([])
  const [selectedFile, setSelectedFile] = useState(null)
  const [fileCards, setFileCards] = useState([])
  const [fileLoading, setFileLoading] = useState(false)
  
  // Collection aggregator state
  const [collectionCards, setCollectionCards] = useState([])
  const [collectionLoading, setCollectionLoading] = useState(false)
  const [collectionStats, setCollectionStats] = useState(null)
  const [isViewingCollection, setIsViewingCollection] = useState(false)
  const [collectionCache, setCollectionCache] = useState(null) // Cache for collection data
  const [lastFileCheck, setLastFileCheck] = useState(null) // Track when we last checked files
  const [collectionSearchQuery, setCollectionSearchQuery] = useState('') // Search within collection
  const [filteredCollectionCards, setFilteredCollectionCards] = useState([]) // Filtered cards
  
  // Bulk data state
  const [bulkDataStats, setBulkDataStats] = useState(null)
  const [searchResults, setSearchResults] = useState([])
  const [searchLoading, setSearchLoading] = useState(false)
  const [currentSearchParams, setCurrentSearchParams] = useState(null)
  const [currentLimit, setCurrentLimit] = useState(100)
  

  
  // Collection Semantic Search State
  const [collectionSemanticQuery, setCollectionSemanticQuery] = useState('');
  const [collectionSemanticResults, setCollectionSemanticResults] = useState([]);
  const [collectionSemanticLoading, setCollectionSemanticLoading] = useState(false);
  const [collectionSearchMode, setCollectionSearchMode] = useState('regular'); // 'regular' or 'semantic'
  
  // UI state
  const [activeTab, setActiveTab] = useState('collections') // 'collections', 'search', 'semantic-search', 'deckbuilder', 'hand-simulator', 'import', or 'synergy'
  const [selectedSet, setSelectedSet] = useState(null);
  const [isSetBrowserOpen, setIsSetBrowserOpen] = useState(false);

  useEffect(() => {
    loadUserCollections()
    loadBulkDataStats()
  }, [])

  const loadUserCollections = async () => {
    try {
      const collections = await window.electronAPI.getUserCollections()
      setCardFiles(collections.map(c => c.collectionName)) // Map collection names to file names for compatibility
    } catch (error) {
      console.error('Error loading user collections:', error)
    }
  }

  const loadBulkDataStats = async () => {
    try {
      const stats = await window.electronAPI.bulkDataStats()
      setBulkDataStats(stats)
    } catch (error) {
      console.error('Error loading bulk data stats:', error)
    }
  }



  const parseCardLine = (line) => {
    const trimmed = line.trim()
    if (!trimmed) return null
    
    // Match pattern: [quantity] [card name] ([set code]) [collector number] [*F* for foil]
    const match = trimmed.match(/^(\d+)\s+(.+?)\s+\(([^)]+)\)\s+(.+?)(\s+\*F\*)?$/)
    
    if (match) {
      const [, quantity, name, setCode, collectorInfo, foilMarker] = match
      const isFoil = Boolean(foilMarker)
      
      return {
        quantity: parseInt(quantity, 10),
        name: name.trim(),
        setCode: setCode.trim(),
        collectorNumber: collectorInfo.trim(),
        isFoil,
        originalLine: trimmed
      }
    }
    
    return null
  }



  const shouldRefreshCollection = async () => {
    // No cache means we need to refresh
    if (!collectionCache) {
      return true
    }
    
    // Check if collection list has changed
    if (collectionCache.collectionList.length !== cardFiles.length ||
        !collectionCache.collectionList.every(collection => cardFiles.includes(collection))) {
      console.log('Collection list changed, refreshing collection')
      return true
    }
    
    // Check if any files have been modified (simplified check)
    // In a more robust implementation, you'd check file modification times
    const timeSinceLastCheck = Date.now() - (lastFileCheck || 0)
    if (timeSinceLastCheck > 5 * 60 * 1000) { // Refresh every 5 minutes at most
      console.log('Cache expired (5 minutes), refreshing collection')
      return true
    }
    
    return false
  }

  const refreshCollection = async () => {
    console.log('Forcing collection refresh...')
    setCollectionCache(null) // Clear cache to force refresh
    await loadMyCollection()
  }

  const syncCollection = async () => {
    console.log('Syncing collections to main database...')
    setCollectionLoading(true)
    try {
      const result = await window.electronAPI.collectionSync()
      if (result.success) {
        console.log('✅ Collection sync completed successfully')
        // Refresh the collection view after successful sync
        await loadMyCollection()
      } else {
        console.error('❌ Collection sync failed:', result.error)
        alert('Collection sync failed: ' + (result.error || 'Unknown error'))
      }
    } catch (error) {
      console.error('❌ Collection sync error:', error)
      alert('Collection sync error: ' + error.message)
    } finally {
      setCollectionLoading(false)
    }
  }

  const generateCollectionStats = (cards, totalValue) => {
    const stats = {
      totalCards: cards.reduce((sum, card) => sum + card.quantity, 0),
      uniqueCards: cards.length,
      totalValue: totalValue,
      rarityBreakdown: {},
      setBreakdown: {},
      colorBreakdown: {}
    }
    
    // Calculate breakdowns
    cards.forEach(card => {
      const quantity = card.quantity
      const scryfallData = card.scryfallData
      
      // Rarity breakdown
      if (scryfallData.rarity) {
        stats.rarityBreakdown[scryfallData.rarity] = (stats.rarityBreakdown[scryfallData.rarity] || 0) + quantity
      }
      
      // Set breakdown
      if (scryfallData.set_name) {
        stats.setBreakdown[scryfallData.set_name] = (stats.setBreakdown[scryfallData.set_name] || 0) + quantity
      }
      
      // Color breakdown (defensive: always treat as array)
      let colorsArr = Array.isArray(scryfallData.colors) ? scryfallData.colors : (typeof scryfallData.colors === 'string' && scryfallData.colors.length > 0 ? [scryfallData.colors] : []);
      if (colorsArr.length > 0) {
        colorsArr.forEach(color => {
          stats.colorBreakdown[color] = (stats.colorBreakdown[color] || 0) + quantity
        })
      } else {
        stats.colorBreakdown['Colorless'] = (stats.colorBreakdown['Colorless'] || 0) + quantity
      }
    })
    
    return stats
  }

  const selectCollection = async (collectionName) => {
    setFileLoading(true)
    setIsViewingCollection(false) // Clear collection view
    setCollectionCards([]) // Clear collection data
    try {
      const collectionCards = await window.electronAPI.getUserCollectionCards(collectionName, { limit: 10000 })
      setSelectedFile(collectionName)
      
      // Get Scryfall data for each card
      const cardsWithData = await Promise.all(
        collectionCards.map(async (collectionCard) => {
          try {
            // Use the new precise matching function that considers name, set, and collector number
            const scryfallCard = await window.electronAPI.bulkDataFindCardByDetails(
              collectionCard.cardName, 
              collectionCard.setCode, 
              collectionCard.collectorNumber
            )
            return {
              name: collectionCard.cardName,
              setCode: collectionCard.setCode || '',
              collectorNumber: collectionCard.collectorNumber || '',
              quantity: collectionCard.quantity || 1,
              isFoil: collectionCard.foil === 'foil',
              scryfallData: scryfallCard
            }
          } catch (error) {
            console.error(`Error finding card ${collectionCard.cardName} (${collectionCard.setCode}) #${collectionCard.collectorNumber}:`, error)
            return {
              name: collectionCard.cardName,
              setCode: collectionCard.setCode || '',
              collectorNumber: collectionCard.collectorNumber || '',
              quantity: collectionCard.quantity || 1,
              isFoil: collectionCard.foil === 'foil',
              scryfallData: null
            }
          }
        })
      )
      
      setFileCards(cardsWithData)
    } catch (error) {
      console.error('Error reading collection:', error)
    } finally {
      setFileLoading(false)
    }
  }

  const handleSearch = async (params, isLoadMore = false) => {
    const hasSearchParams = Object.values(params).some(value => {
      if (Array.isArray(value)) {
        return value.length > 0;
      }
      return value && value.trim() !== '';
    });

    if (!hasSearchParams) {
      setSearchResults([])
      setCurrentSearchParams(null)
      setCurrentLimit(100)
      return
    }
    
    // Reset limit if it's a new search
    let limitToUse = currentLimit
    if (!isLoadMore) {
      limitToUse = 100
      setCurrentLimit(100)
      setCurrentSearchParams(params)
    }
    
    setSearchLoading(true)
    try {
      const results = await window.electronAPI.bulkDataSearch(params, {
        limit: limitToUse
      })
      setSearchResults(results || [])
    } catch (error) {
      console.error('Error searching cards:', error)
      setSearchResults([])
    } finally {
      setSearchLoading(false)
    }
  }

  const loadMoreResults = async () => {
    if (!currentSearchParams) return
    
    const newLimit = currentLimit + 100
    setCurrentLimit(newLimit)
    
    setSearchLoading(true)
    try {
      const results = await window.electronAPI.bulkDataSearch(currentSearchParams, {
        limit: newLimit
      })
      setSearchResults(results || [])
    } catch (error) {
      console.error('Error loading more cards:', error)
    } finally {
      setSearchLoading(false)
    }
  }

  const handleCollectionSearch = (searchParams) => {
    filterCollectionCards(collectionCards, searchParams)
  }
  

  const handleCollectionSemanticSearch = async (query) => {
    if (!query) {
      setCollectionSemanticResults([]);
      return;
    }

    setCollectionSemanticLoading(true);
    try {
      // Check if the query is asking for specific power/toughness values
      const powerMatch = query.match(/(\d+)\s*power/i);
      const toughnessMatch = query.match(/(\d+)\s*toughness/i);
      
      let results = [];
      
      if (powerMatch || toughnessMatch) {
        // For power/toughness queries, use regular filtering on collection
        console.log('Detected power/toughness query, using regular filtering');
        
        results = collectionCards.filter(card => {
          const scryfallData = card.scryfallData;
          
          // Check power
          if (powerMatch) {
            const requestedPower = powerMatch[1];
            if (!scryfallData.power || scryfallData.power !== requestedPower) {
              return false;
            }
          }
          
          // Check toughness
          if (toughnessMatch) {
            const requestedToughness = toughnessMatch[1];
            if (!scryfallData.toughness || scryfallData.toughness !== requestedToughness) {
              return false;
            }
          }
          
          return true;
        });
        
        console.log(`Found ${results.length} cards with specified power/toughness in collection`);
      } else {
        // Hybrid approach: Combine semantic search with text search
        console.log('Using hybrid search for query:', query);
        
        // Step 1: Get semantic search results
        let semanticMatches = [];
        try {
          const semanticResults = await window.electronAPI.searchCardsSemantic(query);
          const cardIds = semanticResults.map(r => r.id);
          
          semanticMatches = collectionCards.filter(collectionCard => 
            cardIds.includes(collectionCard.scryfallData.id)
          );
          
          console.log(`Semantic search found ${semanticMatches.length} matches in collection`);
        } catch (error) {
          console.error('Semantic search failed:', error);
        }
        
        // Step 2: Perform text-based search on collection for better coverage
        const textMatches = collectionCards.filter(card => {
          const scryfallData = card.scryfallData;
          const searchText = query.toLowerCase();
          
          // Search in multiple fields
          const searchFields = [
            scryfallData.name || '',
            scryfallData.text || scryfallData.oracle_text || '',
            scryfallData.type || scryfallData.type_line || '',
            // Also search card faces for double-faced cards
            ...(scryfallData.card_faces || []).map(face => face.oracle_text || ''),
            ...(scryfallData.card_faces || []).map(face => face.name || ''),
            ...(scryfallData.card_faces || []).map(face => face.type_line || '')
          ];
          
          // Check if any field contains relevant keywords
          return searchFields.some(field => 
            field.toLowerCase().includes(searchText) ||
            // Handle common semantic search terms
            (searchText.includes('counter') && (
              field.toLowerCase().includes('counter') ||
              field.toLowerCase().includes('+1/+1') ||
              field.toLowerCase().includes('-1/-1') ||
              field.toLowerCase().includes('charge') ||
              field.toLowerCase().includes('loyalty')
            )) ||
            (searchText.includes('draw') && field.toLowerCase().includes('draw')) ||
            (searchText.includes('life') && (
              field.toLowerCase().includes('life') ||
              field.toLowerCase().includes('gain') ||
              field.toLowerCase().includes('lose')
            )) ||
            (searchText.includes('damage') && field.toLowerCase().includes('damage')) ||
            (searchText.includes('destroy') && field.toLowerCase().includes('destroy')) ||
            (searchText.includes('exile') && field.toLowerCase().includes('exile')) ||
            (searchText.includes('token') && field.toLowerCase().includes('token'))
          );
        });
        
        console.log(`Text search found ${textMatches.length} matches in collection`);
        
        // Step 3: Combine and deduplicate results
        const combinedResults = new Map();
        
        // Add semantic matches first (higher priority)
        semanticMatches.forEach((card, index) => {
          combinedResults.set(card.cardKey, { card, priority: 1, semanticIndex: index });
        });
        
        // Add text matches
        textMatches.forEach(card => {
          if (!combinedResults.has(card.cardKey)) {
            combinedResults.set(card.cardKey, { card, priority: 2 });
          }
        });
        
        // Sort by priority (semantic first) then by name
        results = Array.from(combinedResults.values())
          .sort((a, b) => {
            if (a.priority !== b.priority) {
              return a.priority - b.priority;
            }
            if (a.priority === 1 && b.priority === 1) {
              return (a.semanticIndex || 0) - (b.semanticIndex || 0);
            }
            return a.card.name.localeCompare(b.card.name);
          })
          .map(item => item.card);
        
        console.log(`Combined search found ${results.length} total matches`);
      }

      console.log('Final results:', results.length);
      setCollectionSemanticResults(results);
    } catch (error) {
      console.error('Error during collection semantic search:', error);
      setCollectionSemanticResults([]);
    } finally {
      setCollectionSemanticLoading(false);
    }
  };

  const filterCollectionCards = (cards, searchParams) => {
    if (!searchParams || Object.values(searchParams).every(value => {
      if (Array.isArray(value)) {
        return value.length === 0;
      }
      return !value || value.trim() === '';
    })) {
      setFilteredCollectionCards(cards)
      return
    }

    const { name, text, type, colors, manaCost, manaValue, power, toughness, rarity, types, subTypes, superTypes } = searchParams;

    const filtered = cards.filter(card => {
      const scryfallData = card.scryfallData
      
      // Name search (case-insensitive)
      if (name && !card.name.toLowerCase().includes(name.toLowerCase())) {
        return false;
      }

      // Oracle text search (case-insensitive) - include card faces
      if (text) {
        let hasTextMatch = false;
        const oracleText = scryfallData.text || scryfallData.oracle_text || '';
        if (oracleText && oracleText.toLowerCase().includes(text.toLowerCase())) {
          hasTextMatch = true;
        }
        // Check card faces for double-faced cards
        if (!hasTextMatch && scryfallData.card_faces) {
          hasTextMatch = scryfallData.card_faces.some(face => 
            face.oracle_text && face.oracle_text.toLowerCase().includes(text.toLowerCase())
          );
        }
        if (!hasTextMatch) {
          return false;
        }
      }

      // Type line search (case-insensitive) - include card faces
      if (type) {
        let hasTypeMatch = false;
        const typeLine = scryfallData.type || scryfallData.type_line || '';
        if (typeLine && typeLine.toLowerCase().includes(type.toLowerCase())) {
          hasTypeMatch = true;
        }
        // Check card faces for double-faced cards
        if (!hasTypeMatch && scryfallData.card_faces) {
          hasTypeMatch = scryfallData.card_faces.some(face => 
            face.type_line && face.type_line.toLowerCase().includes(type.toLowerCase())
          );
        }
        if (!hasTypeMatch) {
          return false;
        }
      }
      
      // Colors (must include all selected colors)
      if (colors && colors.length > 0) {
        let cardColors = Array.isArray(scryfallData.colors) ? scryfallData.colors : (typeof scryfallData.colors === 'string' && scryfallData.colors.length > 0 ? [scryfallData.colors] : []);
        if (!cardColors.length || !colors.every(c => cardColors.includes(c))) {
          return false;
        }
      }

      // Mana cost (exact match, but flexible about brackets)
      if (manaCost) {
        const formattedManaCost = manaCost.replace(/\{/g, '').replace(/\}/g, '');
        const cardManaCost = (scryfallData.manaCost || scryfallData.mana_cost || '').replace(/\{/g, '').replace(/\}/g, '');
        if (cardManaCost !== formattedManaCost) {
          return false;
        }
      }
      
      // Power
      if (power && (!scryfallData.power || scryfallData.power !== power)) {
        return false;
      }

      // Toughness
      if (toughness && (!scryfallData.toughness || scryfallData.toughness !== toughness)) {
        return false;
      }
      
      // Mana value (converted mana cost)
      if (manaValue) {
        const cardManaValue = scryfallData.cmc || scryfallData.convertedManaCost || scryfallData.mana_value;
        if (!cardManaValue || parseInt(cardManaValue) !== parseInt(manaValue)) {
          return false;
        }
      }

      // Types search (case-insensitive)
      if (types) {
        const cardTypes = scryfallData.types || scryfallData.type_line || '';
        if (!cardTypes.toLowerCase().includes(types.toLowerCase())) {
          return false;
        }
      }

      // Subtypes search (case-insensitive)
      if (subTypes) {
        const cardSubtypes = scryfallData.subtypes || scryfallData.type_line || '';
        if (!cardSubtypes.toLowerCase().includes(subTypes.toLowerCase())) {
          return false;
        }
      }

      // Supertypes search (case-insensitive)
      if (superTypes) {
        const cardSupertypes = scryfallData.supertypes || scryfallData.type_line || '';
        if (!cardSupertypes.toLowerCase().includes(superTypes.toLowerCase())) {
          return false;
        }
      }

      // Rarity (exact match, case-insensitive)
      if (rarity && scryfallData.rarity.toLowerCase() !== rarity.toLowerCase()) {
        return false;
      }

      return true;
    })
    
    setFilteredCollectionCards(filtered)
  }

  const loadMyCollection = useCallback(async () => {
    setIsViewingCollection(true);
    setSelectedFile(null); // Clear individual file selection
    setCollectionLoading(true);
    
    try {
      // Check if we have valid cached data (cache for 5 minutes)
      const cacheValidDuration = 5 * 60 * 1000; // 5 minutes
      const now = Date.now();
      
      if (collectionCache && 
          collectionCache.timestamp && 
          (now - collectionCache.timestamp) < cacheValidDuration) {
        setCollectionCards(collectionCache.cards);
        setCollectionStats(collectionCache.stats);
        filterCollectionCards(collectionCache.cards, {});
        return;
      }
      
      // Use the new simple method that directly queries collected cards
      const collectedCards = await window.electronAPI.collectionGetSimple({ limit: 10000, offset: 0 });
      
      if (collectedCards.length === 0) {
        setCollectionCards([]);
        setCollectionStats({ totalCards: 0, totalValue: 0, byRarity: {} });
        filterCollectionCards([], {});
        return;
      }
      
      let totalValue = 0;

      // Single pass: map each card and track total price
      const processedCards = collectedCards.map((card) => {
        let priceUsd = 0;
        if (card.prices?.usd) {
          priceUsd = parseFloat(card.prices.usd) || 0;
          totalValue += priceUsd;
        }
        return {
          name: card.name,
          setCode: card.setCode || card.set_code || card.set || '',
          collectorNumber: card.number || card.collector_number || '',
          isFoil: false,
          quantity: card.quantity || 1,
          scryfallData: card,
          cardKey: `${card.name}|${card.setCode || card.set_code || ''}|${
            card.number || card.collector_number || ''
          }|false`,
          sourceFiles: ['Database Collection'],
        };
      });
      
      const stats = generateCollectionStats(processedCards, totalValue);
      
      // Cache the results
      const cacheData = {
        cards: processedCards,
        stats: stats,
        timestamp: now
      };
      setCollectionCache(cacheData);
      
      setCollectionCards(processedCards);
      setCollectionStats(stats);
      filterCollectionCards(processedCards, {});
      
      return;
      
    } catch (error) {
      console.error('Error loading collection with simple method:', error);
      setCollectionCards([]);
      setCollectionStats({ totalCards: 0, totalValue: 0, byRarity: {} });
      filterCollectionCards([], {});
    } finally {
      setCollectionLoading(false);
    }
  }, [
    collectionCache,
    setIsViewingCollection,
    setSelectedFile,
    setCollectionLoading,
    setCollectionCards,
    setCollectionStats,
    setCollectionCache,
    filterCollectionCards,
  ]);

  const handleSetClick = async (set) => {
    try {
      setSearchLoading(true);
      setSelectedSet(set);
      const cards = await window.electronAPI.getCardsBySet(set.code, { limit: 5000 });
      setSearchResults(cards);
      setCurrentLimit(cards.length);
      setCurrentSearchParams({ setCode: set.code });
    } catch (e) {
      console.error('Error loading set cards', e);
      setSearchResults([]);
    } finally {
      setSearchLoading(false);
    }
  };

  return (
    <div className={`app ${activeTab === 'deckbuilder' ? 'deckbuilder-active' : ''} ${activeTab === 'hand-simulator' ? 'simulator-active' : ''}`}>
      <header className="app-header">
        <h1>🃏 MTG Desktop Collection</h1>
        <div className="tab-controls">
          <button 
            className={`tab-button ${activeTab === 'collections' ? 'active' : ''}`} 
            onClick={() => setActiveTab('collections')}>
            My Collection
          </button>
          <button 
            className={`tab-button ${activeTab === 'search' ? 'active' : ''}`}
            onClick={() => setActiveTab('search')}>
            Card Search
          </button>
          <button 
            className={`tab-button ${activeTab === 'semantic-search' ? 'active' : ''}`}
            onClick={() => setActiveTab('semantic-search')}>
            Semantic Search
          </button>
          <button 
            className={`tab-button ${activeTab === 'deckbuilder' ? 'active' : ''}`}
            onClick={() => setActiveTab('deckbuilder')}>
            Deck Builder
          </button>
          <button 
            className={`tab-button ${activeTab === 'hand-simulator' ? 'active' : ''}`}
            onClick={() => setActiveTab('hand-simulator')}>
            Draw Simulator
          </button>
          <button 
            className={`tab-button ${activeTab === 'import' ? 'active' : ''}`}
            onClick={() => setActiveTab('import')}>
            Import from File
          </button>
        </div>
      </header>

      <div className={`app-content ${activeTab === 'deckbuilder' ? 'deckbuilder-mode' : ''} ${activeTab === 'hand-simulator' ? 'simulator-mode' : ''}`}>
        {activeTab === 'collections' ? (
          <div className="collections-view">
            <div className="sidebar">
              <h3>Collections</h3>
              
              {/* My Collection Aggregator */}
              <div className="collection-section">
                <div
                  className={`collection-item ${isViewingCollection ? 'selected' : ''}`}
                  onClick={loadMyCollection}
                >
                  📚 My Collection (All Collections)
                </div>
              </div>
              
              {/* Individual Collections */}
              <div className="file-list">
                {cardFiles.map((file) => (
                  <div
                    key={file}
                    className={`file-item ${selectedFile === file && !isViewingCollection ? 'selected' : ''}`}
                    onClick={() => selectCollection(file)}
                  >
                    📄 {file}
                  </div>
                ))}
              </div>
              
              {cardFiles.length === 0 && (
                <div className="empty-state">
                  <p>No collections found</p>
                  <small>Import collections using the Collection Manager</small>
                </div>
              )}
            </div>

            <div className="main-content">
              {(fileLoading || collectionLoading) && (
                <div className="loading-state">
                  <div className="spinner"></div>
                  <p>{fileLoading ? 'Loading cards...' : 'Loading collection...'}</p>
                </div>
              )}
              
              {/* My Collection View */}
              {isViewingCollection && !collectionLoading && (
                <div className="collection-content">
                  <div className="collection-header">
                    <div className="collection-title-row">
                      <h2>📚 My Collection</h2>
                      <div className="collection-buttons">
                        <button 
                          className="refresh-button"
                          onClick={syncCollection}
                          title="Sync collections to main database"
                          disabled={collectionLoading}
                        >
                          🔄 Sync
                        </button>
                        <button 
                          className="refresh-button"
                          onClick={refreshCollection}
                          title="Refresh collection data"
                          disabled={collectionLoading}
                        >
                          🔄 Refresh
                        </button>
                      </div>
                    </div>
                    {collectionStats && (
                      <div className="collection-stats">
                        <div className="stat-item">
                          <span className="stat-value">{collectionStats.totalCards}</span>
                          <span className="stat-label">Total Cards</span>
                        </div>
                        <div className="stat-item">
                          <span className="stat-value">{collectionStats.uniqueCards}</span>
                          <span className="stat-label">Unique Cards</span>
                        </div>
                        <div className="stat-item">
                          <span className="stat-value">${collectionStats.totalValue.toFixed(2)}</span>
                          <span className="stat-label">Est. Value</span>
                        </div>
                        <div className="stat-item">
                          <span className="stat-value">{Object.keys(collectionStats.setBreakdown).length}</span>
                          <span className="stat-label">Sets</span>
                        </div>
                      </div>
                    )}
                  </div>
                  
                  <div className="collection-search">
                    <div className="search-mode-toggle">
                      <button 
                        className={`mode-button ${collectionSearchMode === 'regular' ? 'active' : ''}`}
                        onClick={() => setCollectionSearchMode('regular')}
                      >
                        🔍 Regular Search
                      </button>
                      <button 
                        className={`mode-button ${collectionSearchMode === 'semantic' ? 'active' : ''}`}
                        onClick={() => setCollectionSearchMode('semantic')}
                      >
                        🧠 Semantic Search
                      </button>
                    </div>
                    
                    {collectionSearchMode === 'regular' ? (
                      <SearchControls 
                        onSearch={handleCollectionSearch} 
                        bulkDataStats={{
                          cardCount: filteredCollectionCards.length,
                          totalCards: collectionStats?.totalCards
                        }}
                      />
                    ) : (
                      <SemanticSearchV2 
                        collectionCards={collectionCards}
                        displayResults={false}
                        onResults={setCollectionSemanticResults}
                      />
                    )}
                  </div>
                  
                  <div className="collection-results">
                    <div className="results-header">
                      <h3>Your Cards</h3>
                      <span className="result-count">
                        {collectionSearchMode === 'semantic' ? (
                          `Showing ${collectionSemanticResults.length} matching cards from your collection`
                        ) : (
                          `Showing ${filteredCollectionCards.length} of ${collectionStats?.totalCards || 0} cards`
                        )}
                      </span>
                    </div>
                    
                    {collectionSemanticLoading && (
                      <div className="loading-state">
                        <div className="spinner"></div>
                        <p>Searching your collection...</p>
                      </div>
                    )}
                    
                    <div className="cards-grid">
                      {collectionSearchMode === 'semantic' ? (
                        collectionSemanticResults.map((card, index) => (
                          <Card
                            key={`${card.cardKey}-${index}`}
                            card={card.scryfallData}
                            quantity={card.quantity}
                          />
                        ))
                      ) : (
                        filteredCollectionCards.map((card, index) => (
                          <Card
                            key={`${card.cardKey}-${index}`}
                            card={card.scryfallData}
                            quantity={card.quantity}
                          />
                        ))
                      )}
                    </div>
                  </div>
                </div>
              )}
              
              {/* Individual Collection View */}
              {selectedFile && !fileLoading && !isViewingCollection && (
                <div className="file-content">
                  <div className="file-header">
                    <h2>{selectedFile}</h2>
                    <span className="card-count">{fileCards.length} cards</span>
                  </div>
                  
                  <div className="cards-grid">
                    {fileCards.map((card, index) => (
                      <Card
                        key={`${card.name}-${index}`}
                        card={card.scryfallData}
                        quantity={card.quantity}
                      />
                    ))}
                  </div>
                </div>
              )}
              
              {/* Empty State */}
              {!selectedFile && !isViewingCollection && !fileLoading && !collectionLoading && (
                <div className="empty-state">
                  <h2>Select a collection</h2>
                  <p>Choose "My Collection" to view your entire collection, or select a specific collection to view individual collections</p>
                </div>
              )}
            </div>
          </div>
        ) : activeTab === 'search' ? (
          <div className="search-view">
            <div className="search-header">
              <SearchControls onSearch={handleSearch} bulkDataStats={bulkDataStats} />
              {/* Set Browser */}
              <div className="set-browser-wrapper">
                <button className="set-browser-toggle" onClick={() => setIsSetBrowserOpen((prev) => !prev)}>
                  {isSetBrowserOpen ? 'Hide Sets ▲' : 'Browse by Set ▼'}
                </button>
                {isSetBrowserOpen && (
                  <SetBrowser onSelect={handleSetClick} />
                )}
              </div>
            </div>
            
            <div className="search-content">
              {searchLoading && (
                <div className="loading-state">
                  <div className="spinner"></div>
                  <p>Searching cards...</p>
                </div>
              )}
              
              {!searchLoading && searchResults.length > 0 && (
                <div className="search-results">
                  <div className="results-header">
                    <h3>Search Results</h3>
                    <span className="result-count">Showing {searchResults.length} cards</span>
                  </div>
                  
                  <div className="cards-grid">
                    {searchResults.map((card) => (
                      <Card
                        key={card.id}
                        card={card}
                      />
                    ))}
                  </div>
                  
                  {searchResults.length >= currentLimit && (
                    <div className="load-more-section">
                      <button 
                        className="load-more-button"
                        onClick={loadMoreResults}
                        disabled={searchLoading}
                      >
                        Load More Cards
                      </button>
                    </div>
                  )}
                </div>
              )}
              
              {!searchLoading && searchResults.length === 0 && (
                <div className="empty-state">
                  <h2>🔍 Search the Magic Database</h2>
                  <p>Search through {bulkDataStats?.cardCount?.toLocaleString() || 'thousands of'} Magic cards</p>
                  <small>Try searching for card names, types, or rules text</small>
                </div>
              )}
            </div>
          </div>
        ) : activeTab === 'semantic-search' ? (
          <div className='view-pane' id='semantic-search-pane'>
            <SemanticSearchV2 />
          </div>
        ) : activeTab === 'deckbuilder' ? (
          <DeckBuilder />
        ) : activeTab === 'hand-simulator' ? (
          <HandSimulator />
        ) : activeTab === 'synergy' ? (
          <RerankerDemo />
        ) : (
          <div className="import-view">
            <CollectionManager />
          </div>
        )}
      </div>
      
      {bulkDataStats && (
        <footer className="app-footer">
          <small>
            Database: {bulkDataStats.cardCount?.toLocaleString()} cards • 
            Last updated: {new Date(bulkDataStats.lastUpdate).toLocaleDateString()}
          </small>
        </footer>
      )}
      <TaskProgressOverlay />
    </div>
  )
}

export default App
