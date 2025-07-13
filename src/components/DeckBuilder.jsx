import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import './DeckBuilder.css';
import useImageCache from '../hooks/useImageCache';
import CardDetailModal from './CardDetailModal';
import DeckStatistics from './DeckStatistics';
import SearchControls from './SearchControls';
import SearchFunctions from './search';
import GridLayout from "react-grid-layout";
import 'react-grid-layout/css/styles.css';
import 'react-resizable/css/styles.css';
import SpellbookExport from './SpellbookExport';
import useCardNavigation from '../hooks/useCardNavigation';


// Helper functions for synergy score interpretation
const getSynergyScoreClass = (score) => {
  if (score >= 300) return 'synergy-excellent';
  if (score >= 250) return 'synergy-great';
  if (score >= 200) return 'synergy-good';
  if (score >= 150) return 'synergy-decent';
  return 'synergy-fair';
};

const getSynergyScoreDisplay = (score) => {
  if (score >= 300) return `★★★ ${score.toFixed(0)}`;
  if (score >= 250) return `★★☆ ${score.toFixed(0)}`;
  if (score >= 200) return `★☆☆ ${score.toFixed(0)}`;
  if (score >= 150) return `◆ ${score.toFixed(0)}`;
  return score.toFixed(0);
};

const getSynergyScoreLabel = (score) => {
  if (score >= 300) return 'Excellent Synergy';
  if (score >= 250) return 'Great Synergy';
  if (score >= 200) return 'Good Synergy';
  if (score >= 150) return 'Decent Synergy';
  return 'Fair Synergy';
};

// --- Placeholder: Card Component ---
// In a real app, this would be in its own file (e.g., '../Card.js')
const Card = ({ card, quantity, onCardClick, showSynergyScore = false }) => {
  // CORRECTED LOGIC: Handle single-faced and double-faced cards
  const getImageUrl = (cardData) => {
    if (!cardData) return null;
    // Check for double-faced cards, which have a `card_faces` array
    if (cardData.card_faces && cardData.card_faces.length > 0 && cardData.card_faces[0].image_uris) {
      return cardData.card_faces[0].image_uris.normal;
    }
    // Fallback for single-faced cards
    if (cardData.image_uris) {
      return cardData.image_uris.normal;
    }
    // Final fallback if no image is found
    return null;
  };

  const rawImageUrl = getImageUrl(card);
  const { imageUrl, isLoading } = useImageCache(rawImageUrl);

  return (
    <div className="card-component" onClick={() => onCardClick(card)}>
      <img 
        src={imageUrl} 
        alt={card?.name || 'Card Image'} 
        loading="lazy"
        className={isLoading ? 'loading' : ''}
      />
      {quantity && <div className="card-quantity-badge">{quantity}</div>}
      {showSynergyScore && card.synergy_score !== undefined && (
        <div 
          className={`card-synergy-badge ${getSynergyScoreClass(card.synergy_score)}`}
          title={getSynergyScoreLabel(card.synergy_score)}
        >
          {getSynergyScoreDisplay(card.synergy_score)}
        </div>
      )}
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
  const [rightPanelView, setRightPanelView] = useState('deck'); // 'deck' | 'recommendations' | 'tokens'

  // New state for recommendations
  const [recommendations, setRecommendations] = useState([]);
  const [deckArchetype, setDeckArchetype] = useState(null);
  const [deckAnalysis, setDeckAnalysis] = useState(null);
  const [recoLoading, setRecoLoading] = useState(false);
  const [format, setFormat] = useState('commander'); // 'commander' | 'standard'
  const [selectedCard, setSelectedCard] = useState(null); // For modal
  const [currentDeckName, setCurrentDeckName] = useState('');

  // Navigation state - tracks which card list context we're navigating
  const [navigationContext, setNavigationContext] = useState('collection'); // 'collection' | 'search' | 'recommendations' | 'tokens'

  // NEW: controls for inline collection search and sorting
  const [collectionSearch, setCollectionSearch] = useState('');
  const [collectionSort, setCollectionSort] = useState('name'); // 'name' | 'cmc' | 'power' | 'toughness' | 'rarity' | 'quantity'
  const [sortDirection, setSortDirection] = useState('asc'); // 'asc' | 'desc'
  const [cardTypeFilter, setCardTypeFilter] = useState('all'); // 'all' | 'creature' | 'land' | 'instant' | etc.

  // NEW: separate controls for recommendations sorting
  const [recommendationsSort, setRecommendationsSort] = useState('synergy'); // 'synergy' | 'name' | 'cmc' | 'power' | 'toughness' | 'rarity'
  const [recommendationsSortDirection, setRecommendationsSortDirection] = useState('desc'); // 'asc' | 'desc'

  // NEW: state for tracking which card type categories are expanded
  const [expandedCategories, setExpandedCategories] = useState(new Set(['Creatures', 'Lands'])); // Start with creatures and lands expanded

  // Hold results returned by advanced search controls
  const [collectionSearchResults, setCollectionSearchResults] = useState(null); // null means no search yet

  // Window width for responsive GridLayout
  const [windowWidth, setWindowWidth] = useState(window.innerWidth);

  // Handle window resize for responsive GridLayout
  useEffect(() => {
    const handleResize = () => setWindowWidth(window.innerWidth);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

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

  // Helper to extract primary card types for filtering
  const getCardTypes = (card) => {
    if (!card) return [];
    const typeLine = (card.type || card.type_line || '').toLowerCase();
    const types = [];

    // Check for main card types
    if (typeLine.includes('creature')) types.push('creature');
    if (typeLine.includes('land')) types.push('land');
    if (typeLine.includes('instant')) types.push('instant');
    if (typeLine.includes('sorcery')) types.push('sorcery');
    if (typeLine.includes('enchantment')) types.push('enchantment');
    if (typeLine.includes('artifact')) types.push('artifact');
    if (typeLine.includes('planeswalker')) types.push('planeswalker');
    if (typeLine.includes('battle')) types.push('battle');

    return types;
  };

  // Helper to get the primary type for grouping
  const getPrimaryCardType = (card) => {
    if (!card) return 'Other';
    const types = getCardTypes(card);
    
    // Return the first type found, or 'Other' if none
    if (types.length > 0) {
      return types[0].charAt(0).toUpperCase() + types[0].slice(1) + 's'; // Pluralize
    }
    return 'Other';
  };

  // Helper to group deck cards by type
  const groupCardsByType = (mainboard) => {
    const groups = {};
    
    mainboard.forEach(entry => {
      const type = getPrimaryCardType(entry.card);
      if (!groups[type]) {
        groups[type] = [];
      }
      groups[type].push(entry);
    });

    // Sort each group by name
    Object.keys(groups).forEach(type => {
      groups[type].sort((a, b) => a.card.name.localeCompare(b.card.name));
    });

    // Define preferred order for card types
    const typeOrder = ['Creatures', 'Lands', 'Instants', 'Sorceries', 'Enchantments', 'Artifacts', 'Planeswalkers', 'Battles', 'Other'];
    
    // Return groups in preferred order
    const orderedGroups = {};
    typeOrder.forEach(type => {
      if (groups[type]) {
        orderedGroups[type] = groups[type];
      }
    });

    return orderedGroups;
  };

  const matchesTypeFilter = (card, filter) => {
    if (filter === 'all') return true;
    const cardTypes = getCardTypes(card);
    return cardTypes.includes(filter);
  };

  // Helper function for comprehensive card sorting
  const sortCards = (cardList, sortBy, direction = 'asc') => {
    const sorted = [...cardList];

    switch (sortBy) {
      case 'cmc':
        sorted.sort((a, b) => {
          const cardA = a.card || a;
          const cardB = b.card || b;
          const aVal = cardA.manaValue ?? cardA.cmc ?? cardA.mana_value ?? 0;
          const bVal = cardB.manaValue ?? cardB.cmc ?? cardB.mana_value ?? 0;
          if (aVal === bVal) return cardA.name.localeCompare(cardB.name);
          return direction === 'asc' ? aVal - bVal : bVal - aVal;
        });
        break;

      case 'power':
        sorted.sort((a, b) => {
          const cardA = a.card || a;
          const cardB = b.card || b;
          const aVal = cardA.power ? parseInt(cardA.power, 10) : (direction === 'asc' ? Infinity : -1);
          const bVal = cardB.power ? parseInt(cardB.power, 10) : (direction === 'asc' ? Infinity : -1);
          if (isNaN(aVal) && isNaN(bVal)) return cardA.name.localeCompare(cardB.name);
          if (isNaN(aVal)) return 1;
          if (isNaN(bVal)) return -1;
          if (aVal === bVal) return cardA.name.localeCompare(cardB.name);
          return direction === 'asc' ? aVal - bVal : bVal - aVal;
        });
        break;

      case 'toughness':
        sorted.sort((a, b) => {
          const cardA = a.card || a;
          const cardB = b.card || b;
          const aVal = cardA.toughness ? parseInt(cardA.toughness, 10) : (direction === 'asc' ? Infinity : -1);
          const bVal = cardB.toughness ? parseInt(cardB.toughness, 10) : (direction === 'asc' ? Infinity : -1);
          if (isNaN(aVal) && isNaN(bVal)) return cardA.name.localeCompare(cardB.name);
          if (isNaN(aVal)) return 1;
          if (isNaN(bVal)) return -1;
          if (aVal === bVal) return cardA.name.localeCompare(cardB.name);
          return direction === 'asc' ? aVal - bVal : bVal - aVal;
        });
        break;

      case 'rarity':
        sorted.sort((a, b) => {
          const cardA = a.card || a;
          const cardB = b.card || b;
          const rarityOrder = { 'mythic': 4, 'rare': 3, 'uncommon': 2, 'common': 1, 'special': 0 };
          const aVal = rarityOrder[cardA.rarity?.toLowerCase()] ?? 0;
          const bVal = rarityOrder[cardB.rarity?.toLowerCase()] ?? 0;
          if (aVal === bVal) return cardA.name.localeCompare(cardB.name);
          return direction === 'asc' ? aVal - bVal : bVal - aVal;
        });
        break;

      case 'quantity':
        sorted.sort((a, b) => {
          const diff = direction === 'asc'
            ? (a.quantity || 0) - (b.quantity || 0)
            : (b.quantity || 0) - (a.quantity || 0);
          if (diff !== 0) return diff;
          const cardA = a.card || a;
          const cardB = b.card || b;
          return cardA.name.localeCompare(cardB.name);
        });
        break;

      case 'synergy':
        sorted.sort((a, b) => {
          const cardA = a.card || a;
          const cardB = b.card || b;
          const aVal = cardA.synergy_score ?? 0;
          const bVal = cardB.synergy_score ?? 0;
          if (aVal === bVal) return cardA.name.localeCompare(cardB.name);
          return direction === 'asc' ? aVal - bVal : bVal - aVal;
        });
        break;

      case 'name':
      default:
        sorted.sort((a, b) => {
          const cardA = a.card || a;
          const cardB = b.card || b;
          return direction === 'asc'
            ? cardA.name.localeCompare(cardB.name)
            : cardB.name.localeCompare(cardA.name);
        });
        break;
    }

    return sorted;
  };

  const setCommander = (card) => {
    if (format === 'commander' && isCardCommander(card)) {
      setDeck(prev => {
        // This replaces any existing commander.
        const newCommanders = [card];
        // Remove the new commander from the mainboard if it's there (by name to handle different printings)
        const newMainboard = prev.mainboard.filter(entry => entry.card.name !== card.name);
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

  const handleCardClick = useCallback((card, context = 'collection') => {
    setSelectedCard(card);
    setNavigationContext(context);
  }, []);

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

    // Check if card is already a commander
    if (format === 'commander' && deck.commanders.some(commander => commander.id === card.id)) {
      alert("This card is already your commander and cannot be added to the mainboard.");
      return;
    }

    setDeck(prev => {
      // Check for existing card by ID first
      const existingEntryById = prev.mainboard.find(entry => entry.card.id === card.id);
      if (existingEntryById) {
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
      }

      // Check for existing card by name (singleton rule for different printings)
      if (format === 'commander' && !isBasicLand(card)) {
        const existingEntryByName = prev.mainboard.find(entry => entry.card.name === card.name);
        if (existingEntryByName) {
          alert(`In Commander format, you can only have one copy of "${card.name}". You already have this card in your deck.`);
          return prev; // Don't modify the deck
        }
      }

      // Add new card
      return { ...prev, mainboard: [...prev.mainboard, { card, quantity: 1 }] };
    });
  };

  const incrementQty = (cardId) => {
    setDeck(prev => {
      const cardEntry = prev.mainboard.find(entry => entry.card.id === cardId);
      if (!cardEntry) return prev;

      // Commander singleton rule: only basic lands can have multiple copies
      if (format === 'commander' && !isBasicLand(cardEntry.card)) {
        alert(`In Commander format, you can only have one copy of "${cardEntry.card.name}".`);
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

  // Filter and sort cards based on commander rules and type filter
  const filteredSearchResults = useMemo(() => {
    let results = searchResults;

    // Apply type filter first
    if (cardTypeFilter !== 'all') {
      results = results.filter(card => matchesTypeFilter(card, cardTypeFilter));
    }

    // Apply commander format rules
    if (format === 'commander') {
      if (deck.commanders.length === 0) {
        results = results.filter(isCardCommander);
      } else {
        results = results.filter(card => isCardInColorIdentity(card, commanderColorIdentity));
      }
    }

    // Apply sorting
    return sortCards(results, collectionSort, sortDirection);
  }, [searchResults, deck.commanders, format, commanderColorIdentity, cardTypeFilter, collectionSort, sortDirection]);

  const filteredOwnedCards = useMemo(() => {
    let results = ownedCards;

    // Apply type filter first
    if (cardTypeFilter !== 'all') {
      results = results.filter(entry => matchesTypeFilter(entry.card, cardTypeFilter));
    }

    // Apply commander format rules
    if (format === 'commander') {
      if (deck.commanders.length === 0) {
        results = results.filter(entry => isCardCommander(entry.card));
      } else {
        results = results.filter(entry => isCardInColorIdentity(entry.card, commanderColorIdentity));
      }
    }

    // Apply sorting
    return sortCards(results, collectionSort, sortDirection);
  }, [ownedCards, deck.commanders, format, commanderColorIdentity, cardTypeFilter, collectionSort, sortDirection]);

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

    // Apply comprehensive sorting
    return sortCards(list, collectionSort, sortDirection);
  }, [filteredOwnedCards, collectionSearch, collectionSort, sortDirection]);

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
      setDeckAnalysis(null);
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
    setDeckAnalysis(null);
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

  // NEW: Group mainboard cards by type
  const groupedMainboard = useMemo(() => {
    return groupCardsByType(deck.mainboard);
  }, [deck.mainboard]);

  // Helper function to toggle category expansion
  const toggleCategory = (categoryName) => {
    setExpandedCategories(prev => {
      const newSet = new Set(prev);
      if (newSet.has(categoryName)) {
        newSet.delete(categoryName);
      } else {
        newSet.add(categoryName);
      }
      return newSet;
    });
  };

  // Helper function to expand all categories
  const expandAllCategories = () => {
    setExpandedCategories(new Set(Object.keys(groupedMainboard)));
  };

  // Helper function to collapse all categories
  const collapseAllCategories = () => {
    setExpandedCategories(new Set());
  };

  const memoizedDeckStats = useMemo(() => <DeckStatistics deck={deck} format={format} deckAnalysis={deckAnalysis} />, [deck, format, deckAnalysis]);

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
        setDeckAnalysis(result.deckAnalysis || null);
      } else {
        console.warn('Unexpected recommendations response:', result);
        setRecommendations([]);
        setDeckArchetype(null);
        setDeckAnalysis(null);
      }
    } catch (error) {
      console.error('Failed to fetch recommendations:', error);
      setRecommendations([]);
      setDeckArchetype(null);
      setDeckAnalysis(null);
    } finally {
      setRecoLoading(false);
    }
  }, [deck.mainboard, deck.commanders, format, recoLoading]);

  // NEW: Token analysis and suggestions
  const [tokenSuggestions, setTokenSuggestions] = useState([]);
  const [tokenLoading, setTokenLoading] = useState(false);

  // Function to analyze card text for token patterns
  const analyzeTokenPatterns = useCallback((cards) => {
    const tokenNames = new Set();

    cards.forEach(card => {
      const text = card.oracle_text || card.text || '';
      const lowerText = text.toLowerCase();

      // Look for specific token names that are commonly used
      const commonTokens = [
        'treasure', 'treasures', 'food', 'clue', 'blood', 'gold', 'shard',
        'soldier', 'goblin', 'elf', 'zombie', 'spirit', 'beast',
        'dragon', 'angel', 'demon', 'elemental', 'construct',
        'thopter', 'servo', 'saproling', 'plant', 'insect',
        'knight', 'warrior', 'wizard', 'rogue', 'cleric',
        'token', 'tokens', 'copy', 'copies'
      ];

      commonTokens.forEach(tokenType => {
        if (lowerText.includes(tokenType + ' token') ||
          lowerText.includes(tokenType + ' creature token') ||
          (tokenType === 'treasure' && lowerText.includes('treasure')) ||
          (tokenType === 'food' && lowerText.includes('food')) ||
          (tokenType === 'clue' && lowerText.includes('clue'))) {
          tokenNames.add(tokenType);
        }
      });

      // Look for specific power/toughness patterns
      const ptPatterns = [
        /create.*?(\d+\/\d+).*?(\w+).*?creature token/gi,
        /create.*?(\d+\/\d+).*?creature token/gi,
        /(\d+\/\d+).*?(\w+).*?creature token/gi,
      ];

      ptPatterns.forEach(pattern => {
        const matches = text.matchAll(pattern);
        for (const match of matches) {
          if (match[2]) {
            tokenNames.add(match[2].toLowerCase()); // Add the creature type
          }
        }
      });
    });

    return Array.from(tokenNames);
  }, []);

  // Function to search for token cards
  const searchForTokens = useCallback(async (tokenNames) => {
    if (!tokenNames.length) return [];

    try {
      const allTokens = [];

      // Search for each token name using the dedicated token search API
      for (const tokenName of tokenNames) {
        // Try searching for the token name directly in the tokens table
        const tokenResults = await window.electronAPI.bulkDataSearchTokens({
          name: tokenName
        }, { limit: 10 });

        if (tokenResults && tokenResults.length > 0) {
          allTokens.push(...tokenResults);
        }
      }

      // Remove duplicates and return
      const uniqueTokens = allTokens.filter((token, index, self) =>
        index === self.findIndex(t => t.id === token.id)
      );

      return uniqueTokens.slice(0, 20); // Limit to 20 tokens to avoid overwhelming the UI
    } catch (error) {
      console.error('Failed to search for tokens:', error);
      return [];
    }
  }, []);

  // Handler to get token suggestions
  const handleGetTokenSuggestions = useCallback(async () => {
    if (tokenLoading) return;

    setTokenLoading(true);
    try {
      // Analyze all cards in the deck
      const allDeckCards = [
        ...deck.mainboard.map(entry => entry.card),
        ...deck.commanders
      ];

      if (allDeckCards.length === 0) {
        setTokenSuggestions([]);
        return;
      }

      const tokenNames = analyzeTokenPatterns(allDeckCards);
      console.log('Token names found:', tokenNames);

      const tokens = await searchForTokens(tokenNames);
      setTokenSuggestions(tokens);
    } catch (error) {
      console.error('Failed to get token suggestions:', error);
      setTokenSuggestions([]);
    } finally {
      setTokenLoading(false);
    }
  }, [deck.mainboard, deck.commanders, tokenLoading, analyzeTokenPatterns, searchForTokens]);

  // Filter and sort recommendations to only show cards from user's collection that match commander color identity and type filter
  const displayRecommendations = useMemo(() => {
    if (!recommendations.length) return [];

    // Since recommendations now come pre-filtered from the backend to only include owned cards,
    // we just need to apply UI-level filters (type filter and sorting)
    let filteredRecs = recommendations;

    // Apply type filter
    if (cardTypeFilter !== 'all') {
      filteredRecs = filteredRecs.filter(card => matchesTypeFilter(card, cardTypeFilter));
    }

    // Apply sorting using separate recommendation sort controls
    return sortCards(filteredRecs, recommendationsSort, recommendationsSortDirection);
  }, [recommendations, cardTypeFilter, recommendationsSort, recommendationsSortDirection]);

  // Determine current card list for navigation based on context
  const currentCardList = useMemo(() => {
    switch (navigationContext) {
      case 'search':
        return filteredSearchResults;
      case 'recommendations':
        return displayRecommendations;
      case 'tokens':
        return tokenSuggestions;
      case 'collection':
      default:
        return displayCollectionCards;
    }
  }, [navigationContext, filteredSearchResults, displayRecommendations, tokenSuggestions, displayCollectionCards]);

  // Keyboard navigation using custom hook
  const navigation = useCardNavigation(
    currentCardList,
    selectedCard,
    setSelectedCard,
    !!selectedCard // Modal is open when selectedCard exists
  );

  // Grid layout positions
  const layoutConfig = [
    { i: 'left', x: 0, y: 0, w: 4, h: 22, minW: 3, minH: 8 },
    { i: 'main', x: 4, y: 0, w: 8, h: 22, minW: 4, minH: 10 },
    { i: 'right', x: 12, y: 0, w: 4, h: 22, minW: 2, minH: 8 }
  ];

  const [autoBuildLoading, setAutoBuildLoading] = useState(false);

  const handleAutoBuildCommander = useCallback(async () => {
    if (autoBuildLoading) return;
    if (format !== 'commander') {
      alert('Auto build currently supports Commander format only.');
      return;
    }
    setAutoBuildLoading(true);
    try {
      const result = await window.electronAPI.autoBuildCommanderDeck();
      if (!result.success || !result.deck) {
        throw new Error(result.error || 'Failed to generate a deck');
      }

      const { deck: generated, synergy } = result;

      // Transform into DeckBuilder state shape
      const transformedMainboard = (generated.mainboard || []).map(card => ({ card, quantity: 1 }));
      setDeck({ commanders: generated.commanders || [], mainboard: transformedMainboard, sideboard: [] });
      setRightPanelView('deck');
      console.log('🛠️ Auto-built deck synergy score:', synergy?.toFixed?.(0));
    } catch (err) {
      console.error('Auto build error:', err);
      alert('Auto build failed: ' + err.message);
    } finally {
      setAutoBuildLoading(false);
    }
  }, [autoBuildLoading, format]);

  return (
    <div className="deck-builder-container">
      {selectedCard && (
        <CardDetailModal
          card={selectedCard}
          onClose={() => setSelectedCard(null)}
          onNavigatePrevious={navigation.navigateToPrevious}
          onNavigateNext={navigation.navigateToNext}
          hasPrevious={navigation.hasPrevious}
          hasNext={navigation.hasNext}
          currentIndex={navigation.currentIndex}
          totalCards={navigation.totalCards}
        />
      )}
      <GridLayout
        className="deck-builder-grid"
        layout={layoutConfig}
        cols={16}
        rowHeight={30}
        width={windowWidth}
        draggableHandle=".drag-handle"
        isResizable={true}
        isDraggable={true}
        resizeHandles={['se', 'sw', 'ne', 'nw']}
        margin={[10, 10]}
        containerPadding={[10, 10]}
        compactType="vertical"
        preventCollision={false}
        autoSize={true}
        useCSSTransforms={true}
        onLayoutChange={(layout) => {
          // Optional: Save layout changes to localStorage or state
          console.log('Layout changed:', layout);
        }}
      >
        {/* Left Panel */}
        <div key="left" className="deck-builder-left-panel panel">
          <div className="drag-handle panel-drag-bar">⋮⋮ Collection & Search</div>
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
              <div className="collection-controls">
                <select
                  value={cardTypeFilter}
                  onChange={(e) => setCardTypeFilter(e.target.value)}
                  title="Filter by card type"
                >
                  <option value="all">All Types</option>
                  <option value="creature">Creatures</option>
                  <option value="land">Lands</option>
                  <option value="instant">Instants</option>
                  <option value="sorcery">Sorceries</option>
                  <option value="enchantment">Enchantments</option>
                  <option value="artifact">Artifacts</option>
                  <option value="planeswalker">Planeswalkers</option>
                  <option value="battle">Battles</option>
                </select>
                <select
                  value={collectionSort}
                  onChange={(e) => setCollectionSort(e.target.value)}
                  title="Sort cards by"
                >
                  <option value="name">Name</option>
                  <option value="cmc">Mana Cost</option>
                  <option value="power">Power</option>
                  <option value="toughness">Toughness</option>
                  <option value="rarity">Rarity</option>
                </select>
                <button
                  className="sort-direction-toggle"
                  onClick={() => setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc')}
                  title={`Sort ${sortDirection === 'asc' ? 'ascending' : 'descending'} - click to toggle`}
                >
                  {sortDirection === 'asc' ? '↑' : '↓'}
                </button>
              </div>
              <div className="search-results-grid">
                {searchLoading && <p>Searching...</p>}
                {!searchLoading && filteredSearchResults.map(card => {
                  const isInDeck = deck.mainboard.some(entry => entry.card.id === card.id);

                  return (
                    <div key={card.id} className="card-grid-item">
                      <Card card={card} onCardClick={(card) => handleCardClick(card, 'search')} />
                      <button
                        className={isInDeck ? 'remove-from-deck' : ''}
                        onClick={(e) => {
                          e.stopPropagation();
                          if (isInDeck) {
                            removeCardFromDeck(card.id);
                          } else {
                            addCardToDeck(card);
                          }
                        }}
                      >
                        {isInDeck ? 'Remove from Deck' : 'Add to Deck'}
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
                <select
                  value={cardTypeFilter}
                  onChange={(e) => setCardTypeFilter(e.target.value)}
                  title="Filter by card type"
                >
                  <option value="all">All Types</option>
                  <option value="creature">Creatures</option>
                  <option value="land">Lands</option>
                  <option value="instant">Instants</option>
                  <option value="sorcery">Sorceries</option>
                  <option value="enchantment">Enchantments</option>
                  <option value="artifact">Artifacts</option>
                  <option value="planeswalker">Planeswalkers</option>
                  <option value="battle">Battles</option>
                </select>
                <select
                  value={collectionSort}
                  onChange={(e) => setCollectionSort(e.target.value)}
                  title="Sort cards by"
                >
                  <option value="name">Name</option>
                  <option value="cmc">Mana Cost</option>
                  <option value="power">Power</option>
                  <option value="toughness">Toughness</option>
                  <option value="rarity">Rarity</option>
                  <option value="quantity">Quantity</option>
                </select>
                <button
                  className="sort-direction-toggle"
                  onClick={() => setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc')}
                  title={`Sort ${sortDirection === 'asc' ? 'ascending' : 'descending'} - click to toggle`}
                >
                  {sortDirection === 'asc' ? '↑' : '↓'}
                </button>
              </div>
              <div className="owned-cards-grid">
                {ownedLoading && <p>Loading collection...</p>}
                {!ownedLoading && displayCollectionCards.map(entry => {
                  const isInDeck = deck.mainboard.some(deckEntry => deckEntry.card.id === entry.card.id);

                  return (
                    <div key={entry.card.id} className="card-grid-item">
                      <Card card={entry.card} quantity={entry.quantity} onCardClick={(card) => handleCardClick(card, 'collection')} />
                      <button
                        className={isInDeck ? 'remove-from-deck' : ''}
                        onClick={(e) => {
                          e.stopPropagation();
                          if (isInDeck) {
                            removeCardFromDeck(entry.card.id);
                          } else {
                            addCardToDeck(entry.card);
                          }
                        }}
                      >
                        {isInDeck ? 'Remove from Deck' : 'Add to Deck'}
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
        {/* Main Panel */}
        <div key="main" className="deck-builder-main-panel panel">
          <div className="drag-handle panel-drag-bar">⋮⋮ Deck Builder</div>
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
                            <p className="details-line" style={{ whiteSpace: 'pre-line' }}><strong>Oracle Text:</strong> {(cmd.text || cmd.oracle_text).replace(/\\n/g, '\n').replace(/\?\?\?/g, '—')}</p>
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
            
            {/* Category management controls */}
            {Object.keys(groupedMainboard).length > 1 && (
              <div className="category-controls">
                <button onClick={expandAllCategories}>Expand All</button>
                <button onClick={collapseAllCategories}>Collapse All</button>
              </div>
            )}

            {/* Scrollable categories container */}
            <div className="categories-container">
              {/* Grouped cards by type */}
              {Object.entries(groupedMainboard).map(([categoryName, cards]) => {
                const isExpanded = expandedCategories.has(categoryName);
                const totalCards = cards.reduce((sum, entry) => sum + entry.quantity, 0);
                
                return (
                  <div key={categoryName} className="card-type-category">
                    <div 
                      className={`category-header ${isExpanded ? 'expanded' : ''}`}
                      onClick={() => toggleCategory(categoryName)}
                    >
                      <div className="category-title">
                        <span>{categoryName}</span>
                        <span className="category-count">{totalCards}</span>
                      </div>
                      <span className={`category-toggle ${isExpanded ? 'expanded' : ''}`}>
                        ▶
                      </span>
                    </div>
                    
                    <div className={`category-content ${!isExpanded ? 'collapsed' : ''}`}>
                      {cards.map(entry => (
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
                );
              })}

              {/* Empty state */}
              {Object.keys(groupedMainboard).length === 0 && (
                <div style={{ 
                  textAlign: 'center', 
                  color: 'var(--text-secondary)', 
                  padding: '40px 20px',
                  fontStyle: 'italic'
                }}>
                  No cards in mainboard. Add cards from your collection or search results.
                </div>
              )}
            </div>
          </div>
        </div>
        {/* Right Panel */}
        <div key="right" className="deck-builder-right-panel panel">
          <div className="drag-handle panel-drag-bar">⋮⋮ Deck Tools</div>
          <div className="panel-toggle">
            <button onClick={() => setRightPanelView('deck')} className={rightPanelView === 'deck' ? 'active' : ''}>Deck Info</button>
            <button onClick={() => setRightPanelView('recommendations')} className={rightPanelView === 'recommendations' ? 'active' : ''}>Recommendations</button>
            <button onClick={() => setRightPanelView('tokens')} className={rightPanelView === 'tokens' ? 'active' : ''}>Token Suggestions</button>
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
              <button className="auto-build-button" onClick={handleAutoBuildCommander} disabled={autoBuildLoading || ownedLoading}>
                {autoBuildLoading ? 'Building Deck…' : 'Auto Build Commander Deck'}
              </button>
              {memoizedDeckStats}
              <SpellbookExport deck={deck} />
            </div>
          )}

          {rightPanelView === 'recommendations' && (
            <div className="recommendations-view">
              <button onClick={handleGetRecommendations} disabled={recoLoading}>
                {recoLoading ? 'Getting Suggestions...' : 'Suggest Cards'}
              </button>
              {deckArchetype && <h4>Suggestions for: {deckArchetype}</h4>}
              
              {/* Synergy Score Legend */}
              <div className="synergy-legend" style={{ 
                fontSize: '0.8rem', 
                color: 'var(--text-secondary)', 
                margin: '8px 0',
                padding: '8px',
                backgroundColor: 'var(--bg-tertiary)',
                borderRadius: '4px'
              }}>
                <strong>Synergy Scores:</strong> 
                <span className="synergy-legend-item">
                  <span className="synergy-badge-mini synergy-excellent">★★★</span> 300+ Excellent
                </span>
                <span className="synergy-legend-item">
                  <span className="synergy-badge-mini synergy-great">★★☆</span> 250+ Great
                </span>
                <span className="synergy-legend-item">
                  <span className="synergy-badge-mini synergy-good">★☆☆</span> 200+ Good
                </span>
                <span className="synergy-legend-item">
                  <span className="synergy-badge-mini synergy-decent">◆</span> 150+ Decent
                </span>
              </div>
              <div className="collection-controls">
                <select
                  value={cardTypeFilter}
                  onChange={(e) => setCardTypeFilter(e.target.value)}
                  title="Filter by card type"
                >
                  <option value="all">All Types</option>
                  <option value="creature">Creatures</option>
                  <option value="land">Lands</option>
                  <option value="instant">Instants</option>
                  <option value="sorcery">Sorceries</option>
                  <option value="enchantment">Enchantments</option>
                  <option value="artifact">Artifacts</option>
                  <option value="planeswalker">Planeswalkers</option>
                  <option value="battle">Battles</option>
                </select>
                <select
                  value={recommendationsSort}
                  onChange={(e) => setRecommendationsSort(e.target.value)}
                  title="Sort cards by"
                >
                  <option value="synergy">Synergy Score</option>
                  <option value="name">Name</option>
                  <option value="cmc">Mana Cost</option>
                  <option value="power">Power</option>
                  <option value="toughness">Toughness</option>
                  <option value="rarity">Rarity</option>
                </select>
                <button
                  className="sort-direction-toggle"
                  onClick={() => setRecommendationsSortDirection(recommendationsSortDirection === 'asc' ? 'desc' : 'asc')}
                  title={`Sort ${recommendationsSortDirection === 'asc' ? 'ascending' : 'descending'} - click to toggle`}
                >
                  {recommendationsSortDirection === 'asc' ? '↑' : '↓'}
                </button>
              </div>
              <div className="search-results-grid">
                {recoLoading && <p>Analyzing deck...</p>}
                {!recoLoading && displayRecommendations.map(card => {
                  const isInDeck = deck.mainboard.some(entry => entry.card.id === card.id);

                  return (
                    <div key={card.id} className="card-grid-item">
                      <Card card={card} onCardClick={(card) => handleCardClick(card, 'recommendations')} showSynergyScore={true} />
                      <button
                        className={isInDeck ? 'remove-from-deck' : ''}
                        onClick={(e) => {
                          e.stopPropagation();
                          if (isInDeck) {
                            removeCardFromDeck(card.id);
                          } else {
                            addCardToDeck(card);
                          }
                        }}
                      >
                        {isInDeck ? 'Remove from Deck' : 'Add to Deck'}
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {rightPanelView === 'tokens' && (
            <div className="recommendations-view">
              <button onClick={handleGetTokenSuggestions} disabled={tokenLoading}>
                {tokenLoading ? 'Analyzing Tokens...' : 'Find Token Suggestions'}
              </button>
              <p style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', margin: '8px 0' }}>
                Based on your deck's cards that create tokens
              </p>
              <div className="search-results-grid">
                {tokenLoading && <p>Analyzing deck for token patterns...</p>}
                {!tokenLoading && tokenSuggestions.length === 0 && <p>No token suggestions found. Make sure your deck has cards that create tokens!</p>}
                {!tokenLoading && tokenSuggestions.map(token => {
                  const isInDeck = deck.mainboard.some(entry => entry.card.id === token.id);

                  return (
                    <div key={token.id} className="card-grid-item">
                      <Card card={token} onCardClick={(card) => handleCardClick(card, 'tokens')} />
                      <button
                        className={isInDeck ? 'remove-from-deck' : ''}
                        onClick={(e) => {
                          e.stopPropagation();
                          if (isInDeck) {
                            removeCardFromDeck(token.id);
                          } else {
                            addCardToDeck(token);
                          }
                        }}
                      >
                        {isInDeck ? 'Remove from Deck' : 'Add to Deck'}
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </GridLayout>
    </div>
  );
};

export default DeckBuilder;
