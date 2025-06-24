import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import './DeckBuilder.css';
import CardDetailModal from './CardDetailModal';
import DeckStatistics from './DeckStatistics';
import SearchControls from './SearchControls';
import SearchFunctions from './search';


// --- Placeholder: Card Component ---
// In a real app, this would be in its own file (e.g., '../Card.js')
const Card = ({ card, quantity, onCardClick }) => {
  // CORRECTED LOGIC: Handle single-faced and double-faced cards
  const getImageUrl = (cardData) => {
    if (!cardData) return 'https://placehold.co/600x800/1a1a1a/e0e0e0?text=No+Image';
    // Check for double-faced cards, which have a `card_faces` array
    if (cardData.card_faces && cardData.card_faces.length > 0 && cardData.card_faces[0].image_uris) {
      return cardData.card_faces[0].image_uris.normal;
    }
    // Fallback for single-faced cards
    if (cardData.image_uris) {
      return cardData.image_uris.normal;
    }
    // Final fallback if no image is found
    return 'https://placehold.co/600x800/1a1a1a/e0e0e0?text=No+Image';
  };

  const imageUrl = getImageUrl(card);

  return (
    <div className="card-component" onClick={() => onCardClick(card)}>
      <img src={imageUrl} alt={card?.name || 'Card Image'} loading="lazy" />
      {quantity && <div className="card-quantity-badge">{quantity}</div>}
    </div>
  );
};

// --- DeckManager Component ---
const DeckManager = ({ deck, format, currentDeckName, onSave, onLoad, onDelete, onNew }) => {
  const [savedDecks, setSavedDecks] = useState([]);
  const [deckFilename, setDeckFilename] = useState('');

  const fetchSavedDecks = useCallback(async () => {
    const result = await window.electronAPI.deckList();
    if (result.success) {
      setSavedDecks(result.decks.sort());
    } else {
      console.error("Failed to fetch saved decks:", result.error);
    }
  }, []);

  useEffect(() => {
    fetchSavedDecks();
  }, [fetchSavedDecks]);

  useEffect(() => {
    setDeckFilename(currentDeckName);
  }, [currentDeckName]);

  const handleSaveDeck = async () => {
    if (!deckFilename.trim()) {
      alert('Please enter a name for the deck.');
      return;
    }
    await onSave(deckFilename);
    fetchSavedDecks();
  };

  const handleDeleteDeck = async (filename) => {
    if (window.confirm(`Are you sure you want to delete the deck "${filename}"?`)) {
      await onDelete(filename);
      if (currentDeckName === filename) {
        onNew();
      }
      fetchSavedDecks();
    }
  };

  return (
    <div className="deck-manager widget">
      <h3>Deck Manager</h3>
      <div className="deck-save-controls">
        <input
          type="text"
          value={deckFilename}
          onChange={(e) => setDeckFilename(e.target.value)}
          placeholder="Deck Name"
        />
        <div className="button-group">
          <button onClick={handleSaveDeck}>Save</button>
          <button onClick={onNew}>New</button>
        </div>
      </div>
      <div className="saved-decks-list">
        <h4>Saved Decks</h4>
        {savedDecks.length === 0 ? (
          <p className="no-decks-message">No saved decks found.</p>
        ) : (
          <ul>
            {savedDecks.map(name => (
              <li key={name} className={name === currentDeckName ? 'active-deck' : ''}>
                <span>{name}</span>
                <div className="deck-actions">
                  <button onClick={() => onLoad(name)}>Load</button>
                  <button className="delete" onClick={() => handleDeleteDeck(name)}>Delete</button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
};


// --- Main DeckBuilder Component ---
const DeckBuilder = () => {
  const [bulkDataStats, setBulkDataStats] = useState(null);
  const [searchResults, setSearchResults] = useState([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [deck, setDeck] = useState({ mainboard: [], sideboard: [], commanders: [] });
  const [collectionCounts, setCollectionCounts] = useState(new Map());
  const [ownedCards, setOwnedCards] = useState([]);
  const [ownedLoading, setOwnedLoading] = useState(false);
  const [leftPanelView, setLeftPanelView] = useState('collection'); // 'collection' | 'search'
  const [rightPanelView, setRightPanelView] = useState('deck'); // 'deck' | 'recommendations'

  // New state for recommendations
  const [recommendations, setRecommendations] = useState([]);
  const [deckArchetype, setDeckArchetype] = useState(null);
  const [recoLoading, setRecoLoading] = useState(false);
  const [format, setFormat] = useState('commander'); // 'commander' | 'standard'
  const [selectedCard, setSelectedCard] = useState(null); // For modal
  const [currentDeckName, setCurrentDeckName] = useState('');

  // NEW: controls for inline collection search and sorting
  const [collectionSearch, setCollectionSearch] = useState('');
  const [collectionSort, setCollectionSort] = useState('name'); // 'name' | 'quantity' | 'cmc'

  // Hold results returned by advanced search controls
  const [collectionSearchResults, setCollectionSearchResults] = useState(null); // null means no search yet

  // --- Auto-save draft deck to localStorage ---
  // 1) Restore any previous draft on first mount
  useEffect(() => {
    try {
      const raw = localStorage.getItem('deckBuilderAutosave');
      if (!raw) return;
      const data = JSON.parse(raw);
      if (data && data.deck) {
        // Only restore if the current builder is empty to avoid clobbering an already loaded deck
        if (deck.mainboard.length === 0 && deck.commanders.length === 0) {
          setDeck(data.deck);
          if (data.format) setFormat(data.format);
          if (data.currentDeckName) setCurrentDeckName(data.currentDeckName);
          console.log('💾 Restored autosaved deck draft.');
        }
      }
    } catch (err) {
      console.error('Failed to restore autosaved deck', err);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 2) Persist changes (debounced) whenever the deck, format, or name changes
  useEffect(() => {
    // Debounce to avoid excessive writes while user is actively editing
    const handle = setTimeout(() => {
      try {
        const payload = {
          deck,
          format,
          currentDeckName,
          timestamp: Date.now(),
        };
        localStorage.setItem('deckBuilderAutosave', JSON.stringify(payload));
      } catch (err) {
        console.error('Failed to autosave deck', err);
      }
    }, 750); // ¾ second debounce

    return () => clearTimeout(handle);
  }, [deck, format, currentDeckName]);

  // Helper for filtering collection via SearchControls
  const searchHelperRef = useRef(null);

  // Initialize/refresh helper whenever ownedCards changes
  useEffect(() => {
    searchHelperRef.current = new SearchFunctions(ownedCards, setCollectionSearchResults);
  }, [ownedCards]);

  const isCardCommander = (card) => {
    if (!card) return false;
    const typeLine = (card.type || card.type_line || '').toLowerCase();
    const oracleText = (card.text || card.oracle_text || '').toLowerCase();

    // Standard rule: legendary creatures
    if (typeLine.includes('legendary') && typeLine.includes('creature')) {
      return true;
    }

    // Background commanders (special rule from CLB set)
    if (typeLine.includes('legendary') && typeLine.includes('background')) {
      return true;
    }

    // Any card explicitly stating it can be commander
    if (oracleText.includes('can be your commander')) {
      return true;
    }

    return false;
  };

  const commanderColorIdentity = useMemo(() => {
    if (format !== 'commander' || deck.commanders.length === 0) {
      return null;
    }
    const colors = new Set();
    deck.commanders.forEach(c => {
      (c.color_identity || []).forEach(color => colors.add(color));
    });
    return colors;
  }, [deck.commanders, format]);

  const isCardInColorIdentity = (card, commanderId) => {
    if (!commanderId) return true; // Not in commander format or no commander selected
    if (!card.color_identity || card.color_identity.length === 0) {
      return true; // Colorless cards are always valid
    }
    return card.color_identity.every(color => commanderId.has(color));
  };

  const isBasicLand = (card) => {
    if (!card) return false;
    const typeLine = (card.type || card.type_line || '').toLowerCase();
    return typeLine.includes('basic') && typeLine.includes('land');
  };

  const setCommander = (card) => {
    if (format === 'commander' && isCardCommander(card)) {
      setDeck(prev => {
        // This replaces any existing commander.
        const newCommanders = [card];
        // Remove the new commander from the mainboard if it's there.
        const newMainboard = prev.mainboard.filter(entry => entry.card.id !== card.id);
        return {
          ...prev,
          commanders: newCommanders,
          mainboard: newMainboard
        };
      });
    }
  };

  const removeCommander = (cardId) => {
    setDeck(prev => ({
      ...prev,
      commanders: prev.commanders.filter(c => c.id !== cardId)
    }));
  };

  // Helper to aggregate collection counts by card name
  const buildCollectionCountMap = async () => {
    try {
      const collections = await window.electronAPI.collectionGetAll();
      const countMap = new Map();
      for (const coll of collections) {
        const records = await window.electronAPI.collectionGet(coll.collection_name, { limit: 10000, offset: 0 });
        records.forEach(rec => {
          const nameKey = (rec.name || '').toLowerCase();
          if (!nameKey) return;
          const existing = countMap.get(nameKey) || 0;
          countMap.set(nameKey, existing + (rec.quantity || 1));
        });
      }
      return countMap;
    } catch (err) {
      console.error('Unable to load collections from DB:', err);
      return new Map();
    }
  };


  // Load initial data on mount
  useEffect(() => {
    const loadInitialData = async () => {
      try {
        const stats = await window.electronAPI.bulkDataStats();
        setBulkDataStats(stats);
        const map = await buildCollectionCountMap();
        setCollectionCounts(map);
      } catch (err) {
        console.error('Failed to load initial data', err);
      }
    };
    loadInitialData();
  }, []);

  // Effect to load detailed info for owned cards
  useEffect(() => {
    const loadOwned = async () => {
      setOwnedLoading(true);
      try {
        const collections = await window.electronAPI.collectionGetAll();
        const tempMap = new Map();
        for (const coll of collections) {
          const collectedCards = await window.electronAPI.collectionGet(coll.collection_name, { limit: 10000, offset: 0 });
          for (const card of collectedCards) {
            if (!card.name) {
              console.warn('⚠️ DeckBuilder.loadOwned: card with undefined name', card);
              continue;
            }
            // The card IS the Scryfall data already - no need to look it up again
            const key = card.id || card.uuid;
            if (tempMap.has(key)) {
              const entry = tempMap.get(key);
              entry.quantity += 1; // Each collected card counts as 1
            } else {
              tempMap.set(key, { card: card, quantity: 1 });
            }
          }
        }
        setOwnedCards(Array.from(tempMap.values()));
      } catch (err) {
        console.error('Failed to load owned cards', err);
      } finally {
        setOwnedLoading(false);
      }
    };
    loadOwned();
  }, []);

  const handleCardClick = (card) => {
    setSelectedCard(card);
  };

  const handleCloseModal = () => {
    setSelectedCard(null);
  };

  const addCardToDeck = (card) => {
    if (format === 'commander' && deck.commanders.length === 0) {
      if (isCardCommander(card)) {
        setCommander(card);
        return;
      } else {
        console.warn("Please select a commander before adding non-commander cards to your deck.");
        return;
      }
    }

    if (commanderColorIdentity && !isCardInColorIdentity(card, commanderColorIdentity)) {
      console.warn("Card is outside of the commander's color identity.");
      return;
    }

    setDeck(prev => {
      const existingEntry = prev.mainboard.find(entry => entry.card.id === card.id);
      if (existingEntry) {
        // Commander singleton rule: only basic lands can have multiple copies
        if (format === 'commander' && !isBasicLand(card)) {
          alert("In Commander format, you can only have one copy of each non-basic card.");
          return prev; // Don't modify the deck
        }
        // Increment quantity
        const newMainboard = prev.mainboard.map(entry =>
          entry.card.id === card.id
            ? { ...entry, quantity: entry.quantity + 1 }
            : entry
        );
        return { ...prev, mainboard: newMainboard };
      } else {
        // Add new card
        return { ...prev, mainboard: [...prev.mainboard, { card, quantity: 1 }] };
      }
    });
  };

  const incrementQty = (cardId) => {
    setDeck(prev => {
      const cardEntry = prev.mainboard.find(entry => entry.card.id === cardId);
      if (!cardEntry) return prev;

      // Commander singleton rule: only basic lands can have multiple copies
      if (format === 'commander' && !isBasicLand(cardEntry.card)) {
        alert("In Commander format, you can only have one copy of each non-basic card.");
        return prev;
      }

      return {
        ...prev,
        mainboard: prev.mainboard.map(entry =>
          entry.card.id === cardId
            ? { ...entry, quantity: entry.quantity + 1 }
            : entry
        ),
      };
    });
  };

  const decrementQty = (cardId) => {
    setDeck(prev => {
      const newMainboard = prev.mainboard
        .map(entry =>
          entry.card.id === cardId
            ? { ...entry, quantity: entry.quantity - 1 }
            : entry
        )
        .filter(entry => entry.quantity > 0); // Remove if quantity is 0 or less
      return { ...prev, mainboard: newMainboard };
    });
  };

  const totalDeckSize = useMemo(() => {
    const mainboardCount = deck.mainboard.reduce((sum, entry) => sum + entry.quantity, 0);
    const commanderCount = deck.commanders.length;
    return mainboardCount + commanderCount;
  }, [deck.mainboard, deck.commanders]);

  // Filter cards based on commander rules
  const filteredSearchResults = useMemo(() => {
    if (format !== 'commander') return searchResults;
    if (deck.commanders.length === 0) {
      return searchResults.filter(isCardCommander);
    }
    return searchResults.filter(card => isCardInColorIdentity(card, commanderColorIdentity));
  }, [searchResults, deck.commanders, format, commanderColorIdentity]);

  const filteredOwnedCards = useMemo(() => {
    if (format !== 'commander') return ownedCards;
    if (deck.commanders.length === 0) {
      return ownedCards.filter(entry => isCardCommander(entry.card));
    }
    return ownedCards.filter(entry => isCardInColorIdentity(entry.card, commanderColorIdentity));
  }, [ownedCards, deck.commanders, format, commanderColorIdentity]);

  // NEW: apply inline search & sort on collection view
  const processedOwnedCards = useMemo(() => {
    let list = filteredOwnedCards;

    // Inline search filter by card attributes (name, type, oracle text). Supports multi-term matching.
    if (collectionSearch.trim() !== '') {
      const terms = collectionSearch.toLowerCase().split(/\s+/).filter(Boolean);
      list = list.filter(entry => {
        const name = (entry.card.name || '').toLowerCase();
        const typeLine = (entry.card.type || entry.card.type_line || '').toLowerCase();
        const oracle = (entry.card.text || entry.card.oracle_text || '').toLowerCase();
        return terms.every(t => name.includes(t) || typeLine.includes(t) || oracle.includes(t));
      });
    }

    // Sorting
    const sorted = [...list];
    switch (collectionSort) {
      case 'quantity':
        sorted.sort((a, b) => {
          const diff = (b.quantity || 0) - (a.quantity || 0);
          return diff !== 0 ? diff : a.card.name.localeCompare(b.card.name);
        });
        break;
      case 'cmc':
        sorted.sort((a, b) => {
          const aVal = a.card.manaValue ?? a.card.cmc ?? a.card.mana_value ?? 0;
          const bVal = b.card.manaValue ?? b.card.cmc ?? b.card.mana_value ?? 0;
          if (aVal === bVal) return a.card.name.localeCompare(b.card.name);
          return aVal - bVal;
        });
        break;
      case 'name':
      default:
        sorted.sort((a, b) => a.card.name.localeCompare(b.card.name));
        break;
    }
    return sorted;
  }, [filteredOwnedCards, collectionSearch, collectionSort]);

  // Final list to display in collection panel, taking commander rules into account
  const displayCollectionCards = useMemo(() => {
    let list = collectionSearchResults ?? processedOwnedCards;

    if (format !== 'commander') return list;

    if (deck.commanders.length === 0) {
      // Only potential commanders
      return list.filter(entry => isCardCommander(entry.card || entry));
    }

    // Filter by color identity relative to chosen commander
    return list.filter(entry => isCardInColorIdentity((entry.card || entry), commanderColorIdentity));
  }, [collectionSearchResults, processedOwnedCards, format, deck.commanders, commanderColorIdentity]);

  // --- Deck Persistence Handlers ---
  const handleSaveDeck = async (filename) => {
    const deckData = {
      mainboard: deck.mainboard,
      sideboard: deck.sideboard,
      commanders: deck.commanders,
      formatName: format,
    };
    const result = await window.electronAPI.deckSave(filename, deckData);
    if (result.success) {
      alert(`Deck "${result.filename}" saved.`);
      setCurrentDeckName(result.filename);
      // Clear the draft since the deck is now persisted under a real filename
      localStorage.removeItem('deckBuilderAutosave');
    } else {
      alert(`Error saving deck: ${result.error}`);
    }
  };

  const handleLoadDeck = async (filename) => {
    const result = await window.electronAPI.deckLoad(filename);
    if (result.success) {
      const loaded = result.deck;
      setDeck({
        mainboard: loaded.mainboard || [],
        sideboard: loaded.sideboard || [],
        commanders: loaded.commanders || [],
      });
      setFormat(loaded.formatName || 'commander');
      setCurrentDeckName(filename);
      // Clear recommendations from the previously loaded deck
      setRecommendations([]);
      setDeckArchetype(null);
      alert(`Deck "${filename}" loaded.`);
    } else {
      alert(`Error loading deck: ${result.error}`);
    }
  };

  const handleDeleteDeck = async (filename) => {
    const result = await window.electronAPI.deckDelete(filename);
    if (result.success) {
      alert(`Deck "${filename}" deleted.`);
    } else {
      alert(`Error deleting deck: ${result.error}`);
    }
  };

  const handleNewDeck = () => {
    setDeck({ mainboard: [], sideboard: [], commanders: [] });
    setFormat('commander');
    setRecommendations([]);
    setDeckArchetype(null);
    setCurrentDeckName('');
    // Clear any autosaved draft when starting fresh
    localStorage.removeItem('deckBuilderAutosave');
    console.log("Cleared deck.");
  };

  const removeCardFromDeck = (cardId) => {
    setDeck(prev => ({
      ...prev,
      mainboard: prev.mainboard.filter(entry => entry.card.id !== cardId)
    }));
  };

  const mainboardCount = useMemo(() => deck.mainboard.reduce((acc, entry) => acc + entry.quantity, 0), [deck.mainboard]);

  const sortedMainboard = useMemo(() => {
    return [...deck.mainboard].sort((a, b) => {
      if (a.card.name < b.card.name) return -1;
      if (a.card.name > b.card.name) return 1;
      return 0;
    });
  }, [deck.mainboard]);

  const memoizedDeckStats = useMemo(() => <DeckStatistics deck={deck} format={format} />, [deck, format]);

  // ---- Card database search handler (leftPanelView "search") ----
  const deckBulkSearch = useCallback(async (params) => {
    // Check if any search parameter provided
    const hasParams = Object.values(params).some(value => {
      if (Array.isArray(value)) return value.length > 0;
      return value && value.toString().trim() !== '';
    });

    if (!hasParams) {
      setSearchResults([]);
      return;
    }

    setSearchLoading(true);
    try {
      const results = await window.electronAPI.bulkDataSearch(params, { limit: 200 });
      setSearchResults(results || []);
    } catch (err) {
      console.error('Error searching bulk data', err);
      setSearchResults([]);
    } finally {
      setSearchLoading(false);
    }
  }, []);

  // NEW: Fetch card recommendations for the current deck
  const handleGetRecommendations = useCallback(async () => {
    // Prevent duplicate requests
    if (recoLoading) return;

    setRecoLoading(true);
    try {
      // Prepare a simplified deck object expected by the backend
      const simplifiedMainboard = deck.mainboard.flatMap(entry => {
        // Repeat the card object based on its quantity so the engine can infer weighting
        return Array(entry.quantity).fill(entry.card);
      });

      const payload = {
        deck: {
          mainboard: simplifiedMainboard,
          commanders: deck.commanders,
        },
        formatName: format,
      };

      const result = await window.electronAPI.getDeckRecommendations(payload);

      if (result && Array.isArray(result.recommendations)) {
        setRecommendations(result.recommendations);
        setDeckArchetype(result.archetype || null);
      } else {
        console.warn('Unexpected recommendations response:', result);
        setRecommendations([]);
        setDeckArchetype(null);
      }
    } catch (error) {
      console.error('Failed to fetch recommendations:', error);
      setRecommendations([]);
      setDeckArchetype(null);
    } finally {
      setRecoLoading(false);
    }
  }, [deck.mainboard, deck.commanders, format, recoLoading]);

  // Filter recommendations to only show cards from user's collection that match commander color identity
  const displayRecommendations = useMemo(() => {
    if (!recommendations.length) return [];

    // Create a map of owned card IDs for quick lookup
    const ownedCardIds = new Set(ownedCards.map(entry => entry.card.id));

    // Filter recommendations to only include cards we own
    let filteredRecs = recommendations.filter(card => ownedCardIds.has(card.id));

    // If we're in commander format and have a commander, also filter by color identity
    if (format === 'commander' && deck.commanders.length > 0) {
      filteredRecs = filteredRecs.filter(card => isCardInColorIdentity(card, commanderColorIdentity));
    }

    return filteredRecs;
  }, [recommendations, ownedCards, format, deck.commanders, commanderColorIdentity]);

  return (
    <div className="deck-builder-container">
      {selectedCard && <CardDetailModal card={selectedCard} onClose={handleCloseModal} />}
      <div className="deck-builder-left-panel">
        <div className="panel-toggle">
          <button onClick={() => setLeftPanelView('collection')} className={leftPanelView === 'collection' ? 'active' : ''}>My Collection</button>
          <button onClick={() => setLeftPanelView('search')} className={leftPanelView === 'search' ? 'active' : ''}>Card Search</button>
        </div>

        {leftPanelView === 'search' && (
          <div className="search-view">
            <SearchControls
              onSearch={deckBulkSearch}
              bulkDataStats={bulkDataStats}
            />
            <div className="search-results-grid">
              {searchLoading && <p>Searching...</p>}
              {!searchLoading && filteredSearchResults.map(card => {
                const isInDeck = deck.mainboard.some(entry => entry.card.id === card.id);
                const canAddMore = format !== 'commander' || isBasicLand(card) || !isInDeck;

                return (
                  <div key={card.id} className="card-grid-item">
                    <Card card={card} onCardClick={handleCardClick} />
                    <button
                      onClick={(e) => { e.stopPropagation(); addCardToDeck(card); }}
                      disabled={!canAddMore}
                      title={!canAddMore ? 'Commander format allows only one copy of non-basic cards' : ''}
                    >
                      {isInDeck && format === 'commander' && !isBasicLand(card) ? 'In Deck' : 'Add to Deck'}
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {leftPanelView === 'collection' && (
          <div className="collection-view">
            <h3>My Collection ({displayCollectionCards.length} unique)</h3>
            {/* NEW: inline search & sort controls */}
            <div className="collection-controls">
              <SearchControls
                onSearch={(params) => searchHelperRef.current?.handleCollectionSearch(params)}
                bulkDataStats={bulkDataStats}
              />
            </div>
            <div className="owned-cards-grid">
              {ownedLoading && <p>Loading collection...</p>}
              {!ownedLoading && displayCollectionCards.map(entry => {
                const isInDeck = deck.mainboard.some(deckEntry => deckEntry.card.id === entry.card.id);
                const canAddMore = format !== 'commander' || isBasicLand(entry.card) || !isInDeck;

                return (
                  <div key={entry.card.id} className="card-grid-item">
                    <Card card={entry.card} quantity={entry.quantity} onCardClick={handleCardClick} />
                    <button
                      onClick={(e) => { e.stopPropagation(); addCardToDeck(entry.card); }}
                      disabled={!canAddMore}
                      title={!canAddMore ? 'Commander format allows only one copy of non-basic cards' : ''}
                    >
                      {isInDeck && format === 'commander' && !isBasicLand(entry.card) ? 'In Deck' : 'Add to Deck'}
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      <div className="deck-builder-main-panel">
        <div className="deck-stats-and-actions">
          <h2>{currentDeckName ? `Deck: ${currentDeckName}` : 'Untitled Deck'}</h2>
          <div className="format-selector">
            <label>Format: </label>
            <select value={format} onChange={e => setFormat(e.target.value)}>
              <option value="commander">Commander</option>
              <option value="standard">Standard</option>
              <option value="modern">Modern</option>
              <option value="legacy">Legacy</option>
              <option value="vintage">Vintage</option>
              <option value="pauper">Pauper</option>
            </select>
          </div>
        </div>

        {format === 'commander' && (
          <div className="command-zone-container">
            <h3>Commander(s)</h3>
            <div className="command-zone">
              {/* Left: Commander card(s) */}
              <div className="commander-cards">
                {deck.commanders.length > 0 ? (
                  deck.commanders.map(c => (
                    <div key={c.id} className="card-grid-item-deck">
                      <Card card={c} onCardClick={handleCardClick} />
                      <div className="deck-card-actions">
                        <button className="remove-button" onClick={() => removeCommander(c.id)}>Remove</button>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="empty-slot">Drop a legendary creature here to set as commander.</div>
                )}
              </div>

              {/* Right: Commander details (showing first commander for now) */}
              {deck.commanders.length > 0 && (
                <div className="commander-details">
                  {(() => {
                    const cmd = deck.commanders[0];
                    return (
                      <>
                        <h4 className="details-name">{cmd.name}</h4>
                        {(cmd.manaCost || cmd.mana_cost) && (
                          <p className="details-line"><strong>Mana Cost:</strong> {cmd.manaCost || cmd.mana_cost}</p>
                        )}
                        {(cmd.type || cmd.type_line) && (
                          <p className="details-line"><strong>Type:</strong> {cmd.type.replace(/\?\?\?/g, '—') || cmd.type_line.replace(/\?\?\?/g, '—')}</p>
                        )}
                        {(cmd.text || cmd.oracle_text) && (
                          <p className="details-line whitespace-pre-line"><strong>Oracle Text:</strong> {cmd.text || cmd.oracle_text}</p>
                        )}
                        {cmd.power && cmd.toughness && (
                          <p className="details-line"><strong>P/T:</strong> {cmd.power}/{cmd.toughness}</p>
                        )}
                        {cmd.color_identity && cmd.color_identity.length > 0 && (
                          <p className="details-line"><strong>Color Identity:</strong> {cmd.color_identity.join(', ')}</p>
                        )}
                      </>
                    );
                  })()}
                </div>
              )}
            </div>
          </div>
        )}

        <div className="mainboard-container">
          <h3>Mainboard ({mainboardCount} cards)</h3>
          <div className="deck-card-grid">
            {sortedMainboard.map(entry => (
              <div key={entry.card.id} className="card-grid-item-deck">
                <Card card={entry.card} quantity={entry.quantity} onCardClick={handleCardClick} />
                <div className="deck-card-actions">
                  <button
                    onClick={() => incrementQty(entry.card.id)}
                    disabled={format === 'commander' && !isBasicLand(entry.card)}
                    title={format === 'commander' && !isBasicLand(entry.card) ? 'Commander format allows only one copy of non-basic cards' : ''}
                  >
                    +
                  </button>
                  <button onClick={() => decrementQty(entry.card.id)}>-</button>
                  <button className="remove-button" onClick={() => removeCardFromDeck(entry.card.id)}>Remove</button>
                  {format === 'commander' && isCardCommander(entry.card) && (
                    <button className="set-commander-button" onClick={() => setCommander(entry.card)}>Set Commander</button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="deck-builder-right-panel">
        <div className="panel-toggle">
          <button onClick={() => setRightPanelView('deck')} className={rightPanelView === 'deck' ? 'active' : ''}>Deck Info</button>
          <button onClick={() => setRightPanelView('recommendations')} className={rightPanelView === 'recommendations' ? 'active' : ''}>Recommendations</button>
        </div>

        {rightPanelView === 'deck' && (
          <div className="deck-info-view">
            <DeckManager
              deck={deck}
              format={format}
              currentDeckName={currentDeckName}
              onSave={handleSaveDeck}
              onLoad={handleLoadDeck}
              onDelete={handleDeleteDeck}
              onNew={handleNewDeck}
            />
            {memoizedDeckStats}
          </div>
        )}

        {rightPanelView === 'recommendations' && (
          <div className="recommendations-view">
            <button onClick={handleGetRecommendations} disabled={recoLoading}>
              {recoLoading ? 'Getting Suggestions...' : 'Suggest Cards'}
            </button>
            {deckArchetype && <h4>Suggestions for: {deckArchetype}</h4>}
            <div className="search-results-grid">
              {recoLoading && <p>Analyzing deck...</p>}
              {!recoLoading && displayRecommendations.map(card => {
                const isInDeck = deck.mainboard.some(entry => entry.card.id === card.id);
                const canAddMore = format !== 'commander' || isBasicLand(card) || !isInDeck;

                return (
                  <div key={card.id} className="card-grid-item">
                    <Card card={card} onCardClick={handleCardClick} />
                    <button
                      onClick={(e) => { e.stopPropagation(); addCardToDeck(card); }}
                      disabled={!canAddMore}
                      title={!canAddMore ? 'Commander format allows only one copy of non-basic cards' : ''}
                    >
                      {isInDeck && format === 'commander' && !isBasicLand(card) ? 'In Deck' : 'Add to Deck'}
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default DeckBuilder;
