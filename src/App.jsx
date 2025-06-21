import { useState, useEffect } from 'react'
import Card from './Card'
import SearchControls from './components/SearchControls';
import CollectionManager from './components/CollectionManager';
import SemanticSearchV2 from './components/SemanticSearchV2';
import DeckBuilder from './components/DeckBuilder';
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
  const [activeTab, setActiveTab] = useState('collections') // 'collections', 'search', 'semantic-search', 'deckbuilder', or 'import'
  const [selectedSet, setSelectedSet] = useState(null);
  const [isSetBrowserOpen, setIsSetBrowserOpen] = useState(false);

  useEffect(() => {
    loadCardFiles()
    loadBulkDataStats()
  }, [])

  const loadCardFiles = async () => {
    try {
      const files = await window.electronAPI.getCardFiles()
      setCardFiles(files)
    } catch (error) {
      console.error('Error loading card files:', error)
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

  const loadMyCollection = async () => {
    setIsViewingCollection(true)
    setSelectedFile(null) // Clear individual file selection
    
    // NEW: Attempt to load from database first
    try {
      const dbCollections = await window.electronAPI.collectionGetAll();
      if (dbCollections && dbCollections.length > 0) {
        console.log('Loading My Collection from database');

        const allCardsMap = new Map(); // Key: composite, Value: aggregated card data
        const sourceCollectionsMap = new Map(); // Track which collections each card appears in
        let totalValue = 0;

        for (const coll of dbCollections) {
          try {
            // Fetch up to 10k cards per collection (adjust if needed)
            const records = await window.electronAPI.collectionGet(coll.collection_name, { limit: 10000, offset: 0 });

            for (const record of records) {
              const parsedCard = {
                name: record.card_name,
                setCode: record.set_code || '',
                collectorNumber: record.collector_number || '',
                isFoil: record.foil === 'foil',
                quantity: record.quantity || 1
              };

              try {
                const scryfallCard = await window.electronAPI.bulkDataFindCardByDetails(
                  parsedCard.name,
                  parsedCard.setCode,
                  parsedCard.collectorNumber
                );

                if (scryfallCard) {
                  const cardKey = `${parsedCard.name}|${parsedCard.setCode}|${parsedCard.collectorNumber}|${parsedCard.isFoil}`;

                  if (allCardsMap.has(cardKey)) {
                    const existingCard = allCardsMap.get(cardKey);
                    existingCard.quantity += parsedCard.quantity;

                    const sources = sourceCollectionsMap.get(cardKey);
                    if (!sources.includes(coll.collection_name)) {
                      sources.push(coll.collection_name);
                    }
                  } else {
                    const aggregatedCard = {
                      ...parsedCard,
                      scryfallData: scryfallCard,
                      cardKey
                    };
                    allCardsMap.set(cardKey, aggregatedCard);
                    sourceCollectionsMap.set(cardKey, [coll.collection_name]);
                  }

                  if (scryfallCard.prices) {
                    const price = parsedCard.isFoil && scryfallCard.prices.usd_foil
                      ? parseFloat(scryfallCard.prices.usd_foil)
                      : parseFloat(scryfallCard.prices.usd);
                    if (price) {
                      totalValue += price * parsedCard.quantity;
                    }
                  }
                }
              } catch (innerErr) {
                console.error(`Error processing card ${parsedCard.name}:`, innerErr);
              }
            }
          } catch (collErr) {
            console.error(`Error loading collection ${coll.collection_name}:`, collErr);
          }
        }

        const aggregatedCards = Array.from(allCardsMap.values()).map(card => ({
          ...card,
          sourceFiles: sourceCollectionsMap.get(card.cardKey) // Re-use existing UI field
        }));

        const stats = generateCollectionStats(aggregatedCards, totalValue);

        setCollectionCards(aggregatedCards);
        setCollectionStats(stats);
        filterCollectionCards(aggregatedCards, {});
        return; // ✅ Finished loading from DB; skip legacy TXT logic
      }
    } catch (dbError) {
      console.warn('Database load failed or no collections present, falling back to TXT files:', dbError);
    }
    
    // ===============================
    // Legacy TXT-based implementation (unchanged)
    // ===============================
    
    // Check if we can use cached data
    const needsRefresh = await shouldRefreshCollection()
    
    if (!needsRefresh && collectionCache) {
      console.log('Using cached collection data')
      setCollectionCards(collectionCache.cards)
      setCollectionStats(collectionCache.stats)
      filterCollectionCards(collectionCache.cards, {})
      return
    }
    
    console.log('Refreshing collection data...')
    setCollectionLoading(true)
    
    try {
      // Load all card files
      const allCardsMap = new Map() // Key: cardId, Value: aggregated card data
      const sourceFilesMap = new Map() // Track which files each card comes from
      let totalValue = 0
      
      for (const filename of cardFiles) {
        try {
          const fileData = await window.electronAPI.readCardFile(filename)
          const lines = fileData.content.split('\n')
          const parsedCards = lines
            .map(parseCardLine)
            .filter(card => card !== null)
          
          // Process each card in this file
          for (const parsedCard of parsedCards) {
            try {
              const scryfallCard = await window.electronAPI.bulkDataFindCardByDetails(
                parsedCard.name, 
                parsedCard.setCode, 
                parsedCard.collectorNumber
              )
              
              if (scryfallCard) {
                // Create unique key for this card (name + set + collector number + foil status)
                const cardKey = `${parsedCard.name}|${parsedCard.setCode}|${parsedCard.collectorNumber}|${parsedCard.isFoil}`
                
                if (allCardsMap.has(cardKey)) {
                  // Card already exists, add to quantity
                  const existingCard = allCardsMap.get(cardKey)
                  existingCard.quantity += parsedCard.quantity
                  
                  // Add to source files
                  const sources = sourceFilesMap.get(cardKey)
                  if (!sources.includes(filename)) {
                    sources.push(filename)
                  }
                } else {
                  // New card, add to collection
                  const aggregatedCard = {
                    ...parsedCard,
                    scryfallData: scryfallCard,
                    cardKey
                  }
                  allCardsMap.set(cardKey, aggregatedCard)
                  sourceFilesMap.set(cardKey, [filename])
                }
                
                // Calculate value for stats
                if (scryfallCard.prices) {
                  const price = parsedCard.isFoil && scryfallCard.prices.usd_foil 
                    ? parseFloat(scryfallCard.prices.usd_foil) 
                    : parseFloat(scryfallCard.prices.usd)
                  if (price) {
                    totalValue += price * parsedCard.quantity
                  }
                }
              }
            } catch (error) {
              console.error(`Error processing card ${parsedCard.name}:`, error)
            }
          }
        } catch (error) {
          console.error(`Error reading file ${filename}:`, error)
        }
      }
      
      // Convert map to array and add source information
      const aggregatedCards = Array.from(allCardsMap.values()).map(card => ({
        ...card,
        sourceFiles: sourceFilesMap.get(card.cardKey)
      }))
      
      // Generate collection statistics
      const stats = generateCollectionStats(aggregatedCards, totalValue)
      
      // Cache the results
      const cacheData = {
        cards: aggregatedCards,
        stats: stats,
        timestamp: Date.now(),
        fileList: [...cardFiles] // Store current file list for comparison
      }
      setCollectionCache(cacheData)
      setLastFileCheck(Date.now())
      
      setCollectionCards(aggregatedCards)
      setCollectionStats(stats)
      filterCollectionCards(aggregatedCards, {})
      
    } catch (error) {
      console.error('Error loading collection:', error)
    } finally {
      setCollectionLoading(false)
    }
  }

  const shouldRefreshCollection = async () => {
    // No cache means we need to refresh
    if (!collectionCache) {
      return true
    }
    
    // Check if file list has changed
    if (collectionCache.fileList.length !== cardFiles.length ||
        !collectionCache.fileList.every(file => cardFiles.includes(file))) {
      console.log('File list changed, refreshing collection')
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
      
      // Color breakdown
      if (scryfallData.colors && scryfallData.colors.length > 0) {
        scryfallData.colors.forEach(color => {
          stats.colorBreakdown[color] = (stats.colorBreakdown[color] || 0) + quantity
        })
      } else {
        stats.colorBreakdown['Colorless'] = (stats.colorBreakdown['Colorless'] || 0) + quantity
      }
    })
    
    return stats
  }

  const selectFile = async (filename) => {
    setFileLoading(true)
    setIsViewingCollection(false) // Clear collection view
    setCollectionCards([]) // Clear collection data
    try {
      const fileData = await window.electronAPI.readCardFile(filename)
      setSelectedFile(filename)
      
      const lines = fileData.content.split('\n')
      const parsedCards = lines
        .map(parseCardLine)
        .filter(card => card !== null)
      
      // Get Scryfall data for each card
      const cardsWithData = await Promise.all(
        parsedCards.map(async (parsedCard) => {
          try {
            // Use the new precise matching function that considers name, set, and collector number
            const scryfallCard = await window.electronAPI.bulkDataFindCardByDetails(
              parsedCard.name, 
              parsedCard.setCode, 
              parsedCard.collectorNumber
            )
            return {
              ...parsedCard,
              scryfallData: scryfallCard
            }
          } catch (error) {
            console.error(`Error finding card ${parsedCard.name} (${parsedCard.setCode}) #${parsedCard.collectorNumber}:`, error)
            return {
              ...parsedCard,
              scryfallData: null
            }
          }
        })
      )
      
      setFileCards(cardsWithData)
    } catch (error) {
      console.error('Error reading file:', error)
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
            scryfallData.oracle_text || '',
            scryfallData.type_line || '',
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

    const { name, text, type, colors, manaCost, power, toughness, rarity } = searchParams;

    const filtered = cards.filter(card => {
      const scryfallData = card.scryfallData
      
      // Name search (case-insensitive)
      if (name && !card.name.toLowerCase().includes(name.toLowerCase())) {
        return false;
      }

      // Oracle text search (case-insensitive) - include card faces
      if (text) {
        let hasTextMatch = false;
        if (scryfallData.oracle_text && scryfallData.oracle_text.toLowerCase().includes(text.toLowerCase())) {
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
        if (scryfallData.type_line && scryfallData.type_line.toLowerCase().includes(type.toLowerCase())) {
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
        if (!scryfallData.colors || !colors.every(c => scryfallData.colors.includes(c))) {
          return false;
        }
      }

      // Mana cost (exact match, but flexible about brackets)
      if (manaCost) {
        const formattedManaCost = manaCost.replace(/\{/g, '').replace(/\}/g, '');
        const cardManaCost = (scryfallData.mana_cost || '').replace(/\{/g, '').replace(/\}/g, '');
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
      
      // Rarity (exact match, case-insensitive)
      if (rarity && scryfallData.rarity.toLowerCase() !== rarity.toLowerCase()) {
        return false;
      }

      return true;
    })
    
    setFilteredCollectionCards(filtered)
  }

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
    <div className="app">
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
            className={`tab-button ${activeTab === 'import' ? 'active' : ''}`}
            onClick={() => setActiveTab('import')}>
            Import from File
          </button>
        </div>
      </header>

      <div className="app-content">
        {activeTab === 'collections' ? (
          <div className="collections-view">
            <div className="sidebar">
              <h3>Collection Files</h3>
              
              {/* My Collection Aggregator */}
              <div className="collection-section">
                <div
                  className={`collection-item ${isViewingCollection ? 'selected' : ''}`}
                  onClick={loadMyCollection}
                >
                  📚 My Collection (All Files)
                </div>
              </div>
              
              {/* Individual Files */}
              <div className="file-list">
                {cardFiles.map((file) => (
                  <div
                    key={file}
                    className={`file-item ${selectedFile === file && !isViewingCollection ? 'selected' : ''}`}
                    onClick={() => selectFile(file)}
                  >
                    📄 {file}
                  </div>
                ))}
              </div>
              
              {cardFiles.length === 0 && (
                <div className="empty-state">
                  <p>No card files found</p>
                  <small>Add .txt files to the cards/ directory</small>
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
                      <button 
                        className="refresh-button"
                        onClick={refreshCollection}
                        title="Refresh collection data"
                      >
                        🔄 Refresh
                      </button>
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
                            isFoil={card.isFoil}
                            sourceFiles={card.sourceFiles}
                          />
                        ))
                      ) : (
                        filteredCollectionCards.map((card, index) => (
                          <Card
                            key={`${card.cardKey}-${index}`}
                            card={card.scryfallData}
                            quantity={card.quantity}
                            isFoil={card.isFoil}
                            sourceFiles={card.sourceFiles}
                          />
                        ))
                      )}
                    </div>
                  </div>
                </div>
              )}
              
              {/* Individual File View */}
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
                        isFoil={card.isFoil}
                      />
                    ))}
                  </div>
                </div>
              )}
              
              {/* Empty State */}
              {!selectedFile && !isViewingCollection && !fileLoading && !collectionLoading && (
                <div className="empty-state">
                  <h2>Select a collection</h2>
                  <p>Choose "My Collection" to view your entire collection, or select a specific file to view individual decks</p>
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
