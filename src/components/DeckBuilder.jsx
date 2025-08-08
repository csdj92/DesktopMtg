import React, { useState, useEffect, useMemo, useCallback, useRef, useDeferredValue, Suspense, lazy } from 'react';
import './DeckBuilder.css';
import useImageCache from '../hooks/useImageCache';
import Card from '../Card';
import CardDetailModal from './CardDetailModal';
import DeckStatistics from './DeckStatistics';
import SearchControls from './SearchControls';
import SearchFunctions from './search';
import { WidthProvider, Responsive } from "react-grid-layout";
import useDeckValidation from '../hooks/useDeckValidation';
import {
  isCardCommander,
  isBasicLand,
  isCardLegalInFormat as isCardLegalInFormatUtil,
  getCardTypes,
  getPrimaryCardType,
  groupCardsByType,
  matchesTypeFilter,
  sortCards,
  getMaxCopiesAllowed as getMaxCopiesAllowedUtil,
  isCardInColorIdentity as isCardInColorIdentityUtil,
} from '../utils/cards';
import { safeConfirm, safeAlert } from '../utils/dialogs';
import { ToastProvider, useToast } from '../context/ToastContext';

const ResponsiveGridLayout = WidthProvider(Responsive);
import 'react-grid-layout/css/styles.css';
import 'react-resizable/css/styles.css';
const SpellbookExport = lazy(() => import('./SpellbookExport'));
const RecommendationSettings = lazy(() => import('./RecommendationSettings'));
const StrategyTester = lazy(() => import('./StrategyTester'));
const PatternAnalysis = lazy(() => import('./PatternAnalysis'));
import useCardNavigation from '../hooks/useCardNavigation';
import { Plus, Save, Trash2, X, AlertTriangle, CheckCircle, Settings, Brain, XCircle } from 'lucide-react';
// const AIPanel = lazy(() => import('./AIPanel'));

// ===================================================================================
// New: Centralized configuration for all available panels in the Deck Builder.
// This makes it easy to add new panels or modify existing ones in the future.
// ===================================================================================
const ALL_PANELS_CONFIG = {
  collectionSearch: { id: 'collectionSearch', title: 'Collection & Search' },
  deckView: { id: 'deckView', title: 'Deck Builder' },
  deckInfo: { id: 'deckInfo', title: 'Deck Info & Tools' },
  recommendations: { id: 'recommendations', title: 'Recommendations' },
  tokenSuggestions: { id: 'tokenSuggestions', title: 'Token Suggestions' },
  autoBuild: { id: 'autoBuild', title: 'Auto-Build Commander' },
  deckStats: { id: 'deckStats', title: 'Deck Statistics' },
  spellbookExport: { id: 'spellbookExport', title: 'Spellbook Combo Finder' },
  // aiPanel: { id: 'aiPanel', title: 'AI Assistant' },
};

// ===================================================================================
// Bootstrap-style responsive layout generation (following react-grid-layout example)
// ===================================================================================
const generateResponsiveLayouts = (panels) => {
  // Define responsive widths - wider on smaller screens (bootstrap style)
  const widths = { lg: 3, md: 4, sm: 6, xs: 12, xxs: 12 };
  const heights = {
    collectionSearch: 20,
    deckView: 20,
    deckInfo: 8,
    recommendations: 12,
    tokenSuggestions: 12,
    autoBuild: 10,
    deckStats: 12,
    spellbookExport: 8,
    // aiPanel: 14
  };
  const cols = 12; // Use 12 columns for all breakpoints like bootstrap

  const layouts = Object.keys(widths).reduce((memo, breakpoint) => {
    const width = widths[breakpoint];
    memo[breakpoint] = panels.map((panel, i) => {
      const layout = {
        x: (i * width) % cols, // Auto-calculate x position
        y: 0, // Let collision algorithm figure out y - CRITICAL for auto-positioning
        w: width,
        h: heights[panel.id] || 12,
        i: panel.id,
        minW: 2,
        minH: 8
      };
      return layout;
    });
    return memo;
  }, {});

  if (process.env.NODE_ENV !== 'production') {
    console.log('🎯 Generated bootstrap layouts:', layouts);
  }
  return layouts;
};

const getDefaultPanels = () => [
  ALL_PANELS_CONFIG.collectionSearch,
  ALL_PANELS_CONFIG.deckView,
  ALL_PANELS_CONFIG.deckInfo,
  ALL_PANELS_CONFIG.deckStats,
  // ALL_PANELS_CONFIG.aiPanel,
];


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



// --- DeckManager Component ---
const DeckManager = React.memo(function DeckManager({ deck, format, currentDeckName, onSave, onLoad, onDelete, onNew }) {
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
      safeAlert('Please enter a name for the deck.');
      return;
    }
    await onSave(deckFilename);
    fetchSavedDecks();
  };

  const handleDeleteDeck = async (filename) => {
    if (safeConfirm(`Are you sure you want to delete the deck "${filename}"?`)) {
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
          aria-label="Deck name"
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
});

// ===================================================================================
// New: LayoutControls component
// This component provides the UI for adding, removing, and managing layouts.
// ===================================================================================
const LayoutControls = ({ panels, onAddPanel, onRemovePanel, onSaveLayout, onResetLayout, layouts }) => {
  const [isMenuOpen, setIsMenuOpen] = useState(false);

  const availablePanelsToAdd = Object.values(ALL_PANELS_CONFIG).filter(
    p => !panels.some(panelOnScreen => panelOnScreen.id === p.id)
  );

  const handleDebugLayouts = () => {
    console.group('🔍 Layout Debug Information');
    console.log('Current layouts:', layouts);
    console.log('Current panels:', panels);
    console.log('LocalStorage layouts:', localStorage.getItem('deckBuilderLayouts'));
    console.log('LocalStorage panels:', localStorage.getItem('deckBuilderPanels'));

    // Check for layout issues (using 12-column bootstrap grid)
    Object.keys(layouts).forEach(breakpoint => {
      const layout = layouts[breakpoint];
      const cols = 12; // Bootstrap-style: 12 columns for all breakpoints

      console.group(`📊 ${breakpoint.toUpperCase()} Layout (${cols} cols)`);

      layout.forEach(item => {
        const issues = [];
        if (item.x + item.w > cols) issues.push(`width overflow (x:${item.x} + w:${item.w} > ${cols})`);
        if (item.x < 0) issues.push('negative x');
        if (item.y < 0) issues.push('negative y');
        if (item.w <= 0) issues.push('invalid width');
        if (item.h <= 0) issues.push('invalid height');

        console.log(`${item.i}:`, {
          x: item.x, y: item.y, w: item.w, h: item.h,
          issues: issues.length > 0 ? issues : 'OK'
        });
      });

      console.groupEnd();
    });

    console.groupEnd();
  };

  return (
    <div className="layout-controls">
      <div className="relative">
        <button onClick={() => setIsMenuOpen(!isMenuOpen)} className="control-button add-panel-button">
          <Plus size={16} /> Add Panel
        </button>
        {isMenuOpen && (
          <div className="add-panel-menu">
            {availablePanelsToAdd.length > 0 ? (
              availablePanelsToAdd.map(panel => (
                <button
                  key={panel.id}
                  onClick={() => {
                    onAddPanel(panel);
                    setIsMenuOpen(false);
                  }}
                >
                  {panel.title}
                </button>
              ))
            ) : (
              <div className="no-panels-message">All panels are on screen.</div>
            )}
          </div>
        )}
      </div>
      <button onClick={onSaveLayout} className="control-button">
        <Save size={16} /> Save Layout
      </button>
      <button onClick={onResetLayout} className="control-button">
        <Trash2 size={16} /> Reset Layout
      </button>
      <button onClick={handleDebugLayouts} className="control-button">
        Debug Layouts
      </button>
      <button onClick={() => {
        // Clear localStorage
        localStorage.removeItem('deckBuilderLayouts');
        localStorage.removeItem('deckBuilderPanels');

        // Force reinitialize with bootstrap layout
        const defaultPanels = getDefaultPanels();
        const defaultLayouts = generateResponsiveLayouts(defaultPanels);
        setPanels(defaultPanels);
        setLayouts(defaultLayouts);

        console.log('🔄 Force refreshed with bootstrap layouts:', defaultLayouts);
      }} className="control-button">
        Force Refresh
      </button>
    </div>
  );
};


// --- Main DeckBuilder Component ---
const DeckBuilderInner = () => {
  const [bulkDataStats, setBulkDataStats] = useState(null);
  const [searchResults, setSearchResults] = useState([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [deck, setDeck] = useState({ mainboard: [], sideboard: [], commanders: [] });
  const [collectionCounts, setCollectionCounts] = useState(new Map());
  const [ownedCards, setOwnedCards] = useState([]);
  const [ownedLoading, setOwnedLoading] = useState(false);

  // REMOVED: `leftPanelView` and `rightPanelView` states are now obsolete.
  // The presence of a panel in the `panels` state determines its visibility.

  // New state for recommendations
  const [recommendations, setRecommendations] = useState([]);
  const [deckArchetype, setDeckArchetype] = useState(null);
  const [deckAnalysis, setDeckAnalysis] = useState(null);
  const [recoLoading, setRecoLoading] = useState(false);

  // 🧪 Strategy Testing State
  const [strategyComparison, setStrategyComparison] = useState(null);
  const [availableStrategies, setAvailableStrategies] = useState([]);
  const [activeStrategy, setActiveStrategy] = useState('primary_fallback');
  const [format, setFormat] = useState('commander'); // 'commander' | 'standard'
  const [selectedCard, setSelectedCard] = useState(null); // For modal
  const [currentDeckName, setCurrentDeckName] = useState('');

  // ===================================================================================
  // New: Deck validation via hook
  // ===================================================================================
  const validationResults = useDeckValidation(deck, format, 500);


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

  // NEW: state for recommendation settings modal
  const [showSettings, setShowSettings] = useState(false);

  // 🔧 NEW: state for pattern analysis in recommendations
  const [showPatternAnalysis, setShowPatternAnalysis] = useState(null); // cardId of card being analyzed

  // Hold results returned by advanced search controls
  const [collectionSearchResults, setCollectionSearchResults] = useState(null); // null means no search yet

  // Search term state for AI suggestions
  const [searchTerm, setSearchTerm] = useState('');

  // ===================================================================================
  // New: State management for dynamic layouts and panels
  // ===================================================================================
  const [layouts, setLayouts] = useState({});
  const [panels, setPanels] = useState([]);

  // (previous inline validation effect replaced)

  // One-time effect guards (avoid duplicate work in React 18 StrictMode dev)
  const restoredDraftRef = useRef(false);
  const layoutInitRef = useRef(false);
  const initialDataRef = useRef(false);
  const ownedLoadedRef = useRef(false);

  // --- Auto-save draft deck to localStorage ---
  // 1) Restore any previous draft on first mount
  useEffect(() => {
    if (restoredDraftRef.current) return;
    restoredDraftRef.current = true;
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
          if (process.env.NODE_ENV !== 'production') {
            console.log('💾 Restored autosaved deck draft.');
          }
        }
      }
    } catch (err) {
      console.error('Failed to restore autosaved deck', err);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ===================================================================================
  // Bootstrap-style layout initialization
  // ===================================================================================
  useEffect(() => {
    if (layoutInitRef.current) return;
    layoutInitRef.current = true;
    try {
      const savedLayouts = localStorage.getItem('deckBuilderLayouts');
      const savedPanels = localStorage.getItem('deckBuilderPanels');

      // CORRECTED: Add check for 'undefined' string to prevent JSON parsing errors.
      if (savedLayouts && savedLayouts !== 'undefined' && savedPanels && savedPanels !== 'undefined') {
        const parsedLayouts = JSON.parse(savedLayouts);
        const parsedPanels = JSON.parse(savedPanels);
        setLayouts(parsedLayouts);
        setPanels(parsedPanels);
        if (process.env.NODE_ENV !== 'production') {
          console.log('✅ Loaded saved layouts from localStorage:', parsedLayouts);
        }
      } else {
        const defaultPanels = getDefaultPanels();
        const defaultLayouts = generateResponsiveLayouts(defaultPanels);
        setLayouts(defaultLayouts);
        setPanels(defaultPanels);
        if (process.env.NODE_ENV !== 'production') {
          console.log('ℹ️ No saved layouts found, using bootstrap-style default:', defaultLayouts);
        }
      }
    } catch (err) {
      console.error('Failed to load layouts from localStorage, using defaults.', err);
      const defaultPanels = getDefaultPanels();
      const defaultLayouts = generateResponsiveLayouts(defaultPanels);
      setLayouts(defaultLayouts);
      setPanels(defaultPanels);
    }
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

  // Initialize/refresh helper whenever ownedCards or format changes
  useEffect(() => {
    searchHelperRef.current = new SearchFunctions(ownedCards, setCollectionSearchResults, format, isCardLegalInFormat);
  }, [ownedCards, format]);

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

  const isCardInColorIdentity = (card, commanderId) => isCardInColorIdentityUtil(card, commanderId);

  // Helper function to get the maximum allowed copies of a card in the current format
  const getMaxCopiesAllowed = (card) => getMaxCopiesAllowedUtil(card, format);

  // Helper function to get the user's collection quantity for a card
  const getCollectionQuantity = (card) => {
    if (!card || !card.name) return 0;

    // Use collectionCounts as primary source (aggregates quantities by card name)
    const nameKey = card.name.toLowerCase();
    const totalQuantity = collectionCounts.get(nameKey) || 0;
    
    if (totalQuantity > 0) {
      return totalQuantity;
    }

    // Fallback to ownedCards if not found in collectionCounts
    const ownedEntry = ownedCards.find(entry => entry.card.name === card.name);
    if (ownedEntry) {
      return ownedEntry.quantity;
    }

    // Debug logging for missing cards
    if (collectionCounts.size > 0) {
      console.warn(`⚠️ Card "${card.name}" not found in collectionCounts (${collectionCounts.size} total cards)`);
    }

    return 0;
  };

  // Helper function to check if we can add more copies of a card
  const canAddMoreCopies = (card, currentQuantity = 0) => {
    const maxAllowed = getMaxCopiesAllowed(card);
    const collectionQuantity = getCollectionQuantity(card);

    // Can't add more than format allows
    if (currentQuantity >= maxAllowed) {
      return { canAdd: false, reason: `Maximum ${maxAllowed} copies allowed in ${format} format` };
    }

    // For lands, allow unlimited copies (especially basic lands)
    const isLand = (card.type || card.type_line || '').toLowerCase().includes('land');
    if (isLand) {
      return { canAdd: true };
    }

    // Can't add more than user owns (only for non-land cards)
    if (currentQuantity >= collectionQuantity) {
      return { canAdd: false, reason: `You only own ${collectionQuantity} copies of this card` };
    }

    return { canAdd: true };
  };

  const isCardLegalInFormat = (card) => isCardLegalInFormatUtil(card, format);
  // helpers replaced by utils imports

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

      // Fetch all collection records in parallel
      const collectionRecordsArrays = await Promise.all(
        (collections || []).map((coll) =>
          window.electronAPI
            .collectionGet(coll.collection_name, { limit: 10000, offset: 0 })
            .catch((e) => {
              console.error('Failed to load collection records for', coll.collection_name, e);
              return [];
            })
        )
      );

      // Aggregate unique names
      const allCardNames = new Set();
      collectionRecordsArrays.forEach((records) => {
        (records || []).forEach((rec) => {
          if (rec?.name) {
            allCardNames.add(rec.name);
          }
        });
      });

      if (process.env.NODE_ENV !== 'production') {
        console.log(`🔍 Building collection count map for ${allCardNames.size} unique card names`);
      }

      // Query quantities with limited concurrency
      const namesArray = Array.from(allCardNames);
      const CONCURRENCY = 20;
      for (let i = 0; i < namesArray.length; i += CONCURRENCY) {
        const batch = namesArray.slice(i, i + CONCURRENCY);
        const results = await Promise.allSettled(
          batch.map((cardName) => window.electronAPI.collectionGetCardQuantity(cardName))
        );
        results.forEach((res, idx) => {
          if (res.status === 'fulfilled') {
            const totalQuantity = res.value?.total || 0;
            if (totalQuantity > 0) {
              countMap.set(batch[idx].toLowerCase(), totalQuantity);
            }
          }
        });
      }

      if (process.env.NODE_ENV !== 'production') {
        console.log(`✅ Collection count map built with ${countMap.size} cards`);
      }
      return countMap;
    } catch (err) {
      console.error('Unable to load collections from DB:', err);
      return new Map();
    }
  };


  // Load initial data on mount
  useEffect(() => {
    if (initialDataRef.current) return;
    initialDataRef.current = true;
    const loadInitialData = async () => {
      try {
        const stats = await window.electronAPI.bulkDataStats();
        setBulkDataStats(stats);
        const map = await buildCollectionCountMap();
        setCollectionCounts(map);
        if (process.env.NODE_ENV !== 'production') {
          console.log(`📊 Collection counts loaded: ${map.size} cards`);
        }
      } catch (err) {
        console.error('Failed to load initial data', err);
      }
    };
    loadInitialData();
  }, []);

  // Effect to load detailed info for owned cards
  useEffect(() => {
    if (ownedLoadedRef.current) return;
    ownedLoadedRef.current = true;
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
            // Use total_quantity from the database query result
            const cardQuantity = card.total_quantity || card.quantity || 1;
            

            
            if (tempMap.has(key)) {
              const entry = tempMap.get(key);
              entry.quantity += cardQuantity; // Add the actual quantity
            } else {
              tempMap.set(key, { card: card, quantity: cardQuantity });
            }
          }
        }
        const ownedCardsArray = Array.from(tempMap.values());
        setOwnedCards(ownedCardsArray);
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
      safeAlert("This card is already your commander and cannot be added to the mainboard.");
      return;
    }

    setDeck(prev => {
      // Check for existing card by ID first
      const existingEntryById = prev.mainboard.find(entry => entry.card.id === card.id);
      if (existingEntryById) {
        // Check if we can add more copies
        const canAdd = canAddMoreCopies(card, existingEntryById.quantity);
        if (!canAdd.canAdd) {
          safeAlert(canAdd.reason);
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

      // Check for existing card by name (for Commander singleton rule and different printings)
      const existingEntryByName = prev.mainboard.find(entry => entry.card.name === card.name);
      if (existingEntryByName) {
        if (format === 'commander' && !isBasicLand(card)) {
          safeAlert(`In Commander format, you can only have one copy of "${card.name}". You already have this card in your deck.`);
          return prev; // Don't modify the deck
        }

        // For other formats, check if we can add more copies
        const canAdd = canAddMoreCopies(card, existingEntryByName.quantity);
        if (!canAdd.canAdd) {
          safeAlert(canAdd.reason);
          return prev; // Don't modify the deck
        }

        // Increment quantity of the existing card
        const newMainboard = prev.mainboard.map(entry =>
          entry.card.name === card.name
            ? { ...entry, quantity: entry.quantity + 1 }
            : entry
        );
        return { ...prev, mainboard: newMainboard };
      }

      // Check if we can add this new card
      const canAdd = canAddMoreCopies(card, 0);
      if (!canAdd.canAdd) {
        safeAlert(canAdd.reason);
        return prev; // Don't modify the deck
      }

      // Add new card
      return { ...prev, mainboard: [...prev.mainboard, { card, quantity: 1 }] };
    });
  };

  const incrementQty = (cardId) => {
    setDeck(prev => {
      const cardEntry = prev.mainboard.find(entry => entry.card.id === cardId);
      if (!cardEntry) return prev;

      // Check if we can add more copies
      const canAdd = canAddMoreCopies(cardEntry.card, cardEntry.quantity);
      if (!canAdd.canAdd) {
        alert(canAdd.reason);
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
  }, [deck.mainboard, deck.commanders, format]);

  // Filter and sort cards based on commander rules and type filter
  const filteredSearchResults = useMemo(() => {
    let results = searchResults;
    const originalCount = results.length;

    // Debug: Log what we're filtering
    if (originalCount > 0) {
      console.log(`🔍 Starting with ${originalCount} search results for ${format} format`);
      console.log(`🔍 First few cards:`, results.slice(0, 3).map(c => ({
        name: c.name,
        legalities: c.legalities,
        [format.toLowerCase()]: c.legalities?.[format.toLowerCase()]
      })));
    }

    // Apply format legality filter first
    results = results.filter(isCardLegalInFormat);
    const filteredCount = results.length;

    // Log filtering stats
    if (originalCount > 0 && originalCount !== filteredCount) {
      console.log(`🔍 Filtered ${originalCount - filteredCount} illegal cards from ${originalCount} total results for ${format} format`);
      console.log(`🔍 Remaining cards:`, results.slice(0, 3).map(c => ({
        name: c.name,
        [format.toLowerCase()]: c.legalities?.[format.toLowerCase()]
      })));
    }

    // Apply type filter
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

    // Apply format legality filter first
    results = results.filter(entry => isCardLegalInFormat(entry.card));

    // Apply type filter
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
  // Defer heavy inline search filtering to reduce UI blocking during fast typing
  const deferredCollectionSearch = useDeferredValue(collectionSearch);

  const processedOwnedCards = useMemo(() => {
    let list = filteredOwnedCards;

    // Inline search filter by card attributes (name, type, oracle text). Supports multi-term matching.
    if (deferredCollectionSearch.trim() !== '') {
      const terms = deferredCollectionSearch.toLowerCase().split(/\s+/).filter(Boolean);
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
  const toast = useToast();

  const handleSaveDeck = async (filename) => {
    const deckData = {
      mainboard: deck.mainboard,
      sideboard: deck.sideboard,
      commanders: deck.commanders,
      formatName: format,
    };
    const result = await window.electronAPI.deckSave(filename, deckData);
    if (result.success) {
      toast.success('Deck saved', `"${result.filename}"`);
      setCurrentDeckName(result.filename);
      // Clear the draft since the deck is now persisted under a real filename
      localStorage.removeItem('deckBuilderAutosave');
    } else {
      toast.error('Error saving deck', result.error);
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
      toast.success('Deck loaded', `"${filename}"`);
    } else {
      toast.error('Error loading deck', result.error);
    }
  };

  const handleDeleteDeck = async (filename) => {
    const result = await window.electronAPI.deckDelete(filename);
    if (result.success) {
      toast.info('Deck deleted', `"${filename}"`);
    } else {
      toast.error('Error deleting deck', result.error);
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
      // Add format parameter to the search
      const searchParamsWithFormat = {
        ...params,
        format: format
      };
      const results = await window.electronAPI.bulkDataSearch(searchParamsWithFormat, { limit: 200 });
      setSearchResults(results || []);
    } catch (err) {
      console.error('Error searching bulk data', err);
      setSearchResults([]);
    } finally {
      setSearchLoading(false);
    }
  }, [format]);

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

        // 🧪 Update strategy testing data
        setStrategyComparison(result.strategyComparison || null);
        setAvailableStrategies(result.availableStrategies || []);
        setActiveStrategy(result.activeStrategy || 'primary_fallback');
      } else {
        console.warn('Unexpected recommendations response:', result);
        setRecommendations([]);
        setDeckArchetype(null);
        setDeckAnalysis(null);
        setStrategyComparison(null);
        setAvailableStrategies([]);
      }
    } catch (error) {
      console.error('Failed to fetch recommendations:', error);
      setRecommendations([]);
      setDeckArchetype(null);
      setDeckAnalysis(null);
      setStrategyComparison(null);
      setAvailableStrategies([]);
    } finally {
      setRecoLoading(false);
    }
  }, [deck.mainboard, deck.commanders, format, recoLoading]);

  // 🧪 Strategy Testing Handler
  const handleStrategyChange = useCallback(async (strategy) => {
    try {
      await window.electronAPI.setActiveStrategy(strategy);
      setActiveStrategy(strategy);

      // Regenerate recommendations with the new strategy
      if (deck.mainboard.length > 0) {
        await handleGetRecommendations();
      }
    } catch (error) {
      console.error('Failed to change strategy:', error);
    }
  }, [deck.mainboard, handleGetRecommendations]);

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
    // we just need to apply UI-level filters (format legality, type filter and sorting)
    let filteredRecs = recommendations;

    // Apply format legality filter first
    filteredRecs = filteredRecs.filter(isCardLegalInFormat);

    // Apply type filter
    if (cardTypeFilter !== 'all') {
      filteredRecs = filteredRecs.filter(card => matchesTypeFilter(card, cardTypeFilter));
    }

    // Apply sorting using separate recommendation sort controls
    return sortCards(filteredRecs, recommendationsSort, recommendationsSortDirection);
  }, [recommendations, cardTypeFilter, recommendationsSort, recommendationsSortDirection]);

  // Filter token suggestions to only show legal cards
  const filteredTokenSuggestions = useMemo(() => {
    if (!tokenSuggestions.length) return [];

    // Apply format legality filter
    return tokenSuggestions.filter(isCardLegalInFormat);
  }, [tokenSuggestions]);

  // Determine current card list for navigation based on context
  const currentCardList = useMemo(() => {
    switch (navigationContext) {
      case 'search':
        return filteredSearchResults;
      case 'recommendations':
        return displayRecommendations;
      case 'tokens':
        return filteredTokenSuggestions;
      case 'deck':
        // For deck view, flatten all cards from grouped mainboard
        return Object.values(groupedMainboard).flat().map(entry => entry.card);
      case 'collection':
      default:
        return displayCollectionCards.map(entry => entry.card || entry);
    }
  }, [navigationContext, filteredSearchResults, displayRecommendations, filteredTokenSuggestions, groupedMainboard, displayCollectionCards]);

  // Keyboard navigation using custom hook
  const navigation = useCardNavigation(
    currentCardList,
    selectedCard,
    setSelectedCard,
    !!selectedCard // Modal is open when selectedCard exists
  );

  // REMOVED: `layoutConfig` is no longer static. It's managed by the `layouts` state.

  const [autoBuildLoading, setAutoBuildLoading] = useState(false);

  // NEW: state for auto-build synergy score
  const [autoBuildSynergy, setAutoBuildSynergy] = useState(null);

  const handleAutoBuildCommander = useCallback(async () => {
    if (autoBuildLoading) return;
    if (format !== 'commander') {
      toast.warning('Not available', 'Auto build supports Commander only');
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

      // Store the synergy score
      setAutoBuildSynergy(synergy);

      console.log('🛠️ Auto-built deck synergy score:', synergy?.toFixed?.(0));
    } catch (err) {
      console.error('Auto build error:', err);
      toast.error('Auto build failed', err.message);
      setAutoBuildSynergy(null);
    } finally {
      setAutoBuildLoading(false);
    }
  }, [autoBuildLoading, format, toast]);

  // ===================================================================================
  // New: Layout and Panel Management Functions
  // ===================================================================================
  const handleLayoutChange = (currentLayout, allLayouts) => {
    // This function is called by react-grid-layout.
    // We update our state which will be persisted on drag/resize stop.
    // Only update if the layouts have actually changed to prevent unnecessary re-renders
    const layoutsStringified = JSON.stringify(allLayouts);
    const currentLayoutsStringified = JSON.stringify(layouts);

    if (layoutsStringified !== currentLayoutsStringified) {
      setLayouts(allLayouts);
    }
  };

  const persistLayoutToLocalStorage = () => {
    try {
      localStorage.setItem('deckBuilderLayouts', JSON.stringify(layouts));
      localStorage.setItem('deckBuilderPanels', JSON.stringify(panels));
    } catch (err) {
      console.error('Failed to persist layouts:', err);
    }
  };

  const handleSaveLayout = () => {
    persistLayoutToLocalStorage();
    toast.success('Layout saved');
  };

  const handleResetLayout = () => {
    if (safeConfirm('Are you sure you want to reset the layout to default?')) {
      const defaultPanels = getDefaultPanels();
      const defaultLayouts = generateResponsiveLayouts(defaultPanels);

      setLayouts(defaultLayouts);
      setPanels(defaultPanels);

      // Clear localStorage
      localStorage.removeItem('deckBuilderLayouts');
      localStorage.removeItem('deckBuilderPanels');

      // Force immediate persistence of the new layout
      try {
        localStorage.setItem('deckBuilderLayouts', JSON.stringify(defaultLayouts));
        localStorage.setItem('deckBuilderPanels', JSON.stringify(defaultPanels));
      } catch (err) {
        console.error('Failed to persist reset layouts:', err);
      }

      toast.info('Layout reset to default');
    }
  };

  const handleAddPanel = (panelConfig) => {
    // Add to panels list
    const newPanels = [...panels, panelConfig];
    setPanels(newPanels);

    // Regenerate layouts using bootstrap-style algorithm
    const newLayouts = generateResponsiveLayouts(newPanels);
    setLayouts(newLayouts);
  };

  const handleRemovePanel = (panelId) => {
    const panelTitle = ALL_PANELS_CONFIG[panelId]?.title || 'Panel';

    // Add confirmation to prevent accidental removals
    if (safeConfirm(`Are you sure you want to remove the "${panelTitle}" panel?`)) {
      // Remove from panels list
      const newPanels = panels.filter(p => p.id !== panelId);
      setPanels(newPanels);

      // Regenerate layouts using bootstrap-style algorithm
      const newLayouts = generateResponsiveLayouts(newPanels);
      setLayouts(newLayouts);
    }
  };

  // ===================================================================================
  // New: Panel Content Rendering
  // These functions encapsulate the JSX for each panel, keeping the main return clean.
  // They receive all necessary state and handlers as props.
  // ===================================================================================

  const renderPanelContent = (panel) => {
    const panelProps = {
      // Pass all state and handlers needed by the panels here
      deck, format, setFormat, bulkDataStats, searchResults, searchLoading, deckBulkSearch, cardTypeFilter, setCardTypeFilter, collectionSort, setCollectionSort, sortDirection, setSortDirection, addCardToDeck, removeCardFromDeck, handleCardClick, ownedLoading, displayCollectionCards, searchHelperRef, currentDeckName, handleSaveDeck, handleLoadDeck, handleDeleteDeck, handleNewDeck, autoBuildLoading, handleAutoBuildCommander, memoizedDeckStats, groupedMainboard, expandedCategories, toggleCategory, expandAllCategories, collapseAllCategories, mainboardCount, incrementQty, decrementQty, setCommander, removeCommander, isBasicLand, isCardCommander, recoLoading, handleGetRecommendations, displayRecommendations, recommendationsSort, setRecommendationsSort, recommendationsSortDirection, setRecommendationsSortDirection, tokenLoading, handleGetTokenSuggestions, tokenSuggestions, validationResults, autoBuildSynergy, showSettings, setShowSettings, searchTerm, setSearchTerm,
      // 🧪 Strategy Testing Props
      strategyComparison, availableStrategies, activeStrategy, handleStrategyChange,
      // 🔧 Pattern Analysis Props
      showPatternAnalysis, setShowPatternAnalysis,
      // Filtered token suggestions
      filteredTokenSuggestions,
      // Helper functions for quantity management
      getMaxCopiesAllowed, getCollectionQuantity, canAddMoreCopies
    };

    switch (panel.id) {
      case 'collectionSearch': return <CollectionSearchPanel {...panelProps} />;
      case 'deckView': return <DeckViewPanel {...panelProps} />;
      case 'deckInfo': return <DeckInfoPanel {...panelProps} />;
      case 'recommendations': return <RecommendationsPanel {...panelProps} />;
      case 'tokenSuggestions': return <TokenSuggestionsPanel {...panelProps} />;
      case 'autoBuild': return <AutoBuildPanel {...panelProps} />;
      case 'deckStats': return <DeckStatsPanel {...panelProps} />;
      case 'spellbookExport': return <SpellbookExportPanel {...panelProps} />;
      // case 'aiPanel': return <AIPanelComponent {...panelProps} />;
      default: return <div>Unknown Panel</div>;
    }
  };


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
          isInDeck={deck.mainboard.some(entry => entry.card.id === selectedCard.id)}
          onAddToDeck={addCardToDeck}
          onRemoveFromDeck={removeCardFromDeck}
          deckFormat={format}
          commanderColorIdentity={commanderColorIdentity}
        />
      )}

      {/* ============================================================== */}
      {/* New: Layout Controls are placed at the top of the component     */}
      {/* ============================================================== */}
      <LayoutControls
        panels={panels}
        onAddPanel={handleAddPanel}
        onRemovePanel={handleRemovePanel}
        onSaveLayout={handleSaveLayout}
        onResetLayout={handleResetLayout}
        layouts={layouts}
      />

      {/* Only render the grid when we have both layouts and panels properly initialized */}
      {Object.keys(layouts).length > 0 && panels.length > 0 &&
        Object.keys(layouts).every(bp => Array.isArray(layouts[bp])) && (
          <ResponsiveGridLayout
            className="deck-builder-grid"
            layouts={layouts}
            breakpoints={{ lg: 1200, md: 996, sm: 768, xs: 480, xxs: 0 }}
            cols={{ lg: 12, md: 12, sm: 12, xs: 12, xxs: 12 }}
            rowHeight={30}
            onLayoutChange={handleLayoutChange}
            onDragStop={persistLayoutToLocalStorage}
            onResizeStop={persistLayoutToLocalStorage}
            draggableHandle=".drag-handle"
            resizeHandles={["s", "w", "e", "n", "sw", "nw", "se", "ne"]}
            margin={[10, 10]}
            containerPadding={[10, 10]}
            compactType="vertical"
            preventCollision={false}
          >
            {panels.map(panel => (
              <div key={panel.id} className="panel">
                <div className="drag-handle panel-drag-bar">
                  <span>⋮⋮ {ALL_PANELS_CONFIG[panel.id]?.title || 'Panel'}</span>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      e.preventDefault();
                      handleRemovePanel(panel.id);
                    }}
                    className="remove-panel-button"
                    title="Remove Panel"
                    aria-label={`Remove ${ALL_PANELS_CONFIG[panel.id]?.title || 'panel'}`}
                    onMouseDown={(e) => e.stopPropagation()}
                    onMouseUp={(e) => e.stopPropagation()}
                  >
                    <XCircle size={18} />
                  </button>
                </div>
                <Suspense fallback={<div style={{ padding: 12 }}>Loading…</div>}>{renderPanelContent(panel)}</Suspense>
              </div>
            ))}
          </ResponsiveGridLayout>
        )}

      {/* Recommendation Settings Modal */}
      <Suspense fallback={<div style={{ padding: 12 }}>Loading settings…</div>}>
        <RecommendationSettings
          isOpen={showSettings}
          onClose={() => setShowSettings(false)}
        />
      </Suspense>
    </div>
  );
};

const DeckBuilder = () => {
  return (
    <ToastProvider>
      <DeckBuilderInner />
    </ToastProvider>
  );
};

// ===================================================================================
// New: Individual Panel Components
// These functional components render the content for each specific panel.
// ===================================================================================

const CollectionSearchPanel = React.memo(function CollectionSearchPanel(props) {
  const { deck, format, filteredSearchResults, bulkDataStats, searchResults, searchLoading, deckBulkSearch, cardTypeFilter, setCardTypeFilter, collectionSort, setCollectionSort, sortDirection, setSortDirection, addCardToDeck, removeCardFromDeck, handleCardClick, ownedLoading, displayCollectionCards, searchHelperRef, getMaxCopiesAllowed, getCollectionQuantity, canAddMoreCopies } = props;
  const [activeView, setActiveView] = useState('collection'); // 'collection' | 'search'

  return (
    <>
      <div className="panel-toggle">
        <button onClick={() => setActiveView('collection')} className={activeView === 'collection' ? 'active' : ''}>My Collection</button>
        <button onClick={() => setActiveView('search')} className={activeView === 'search' ? 'active' : ''}>Card Search</button>
      </div>

      {activeView === 'search' && (
        <div className="search-view">
          <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', margin: '4px 0 8px 0', fontStyle: 'italic' }}>
            Search results filtered to show only cards legal in {format} format
            {searchResults.length > 0 && filteredSearchResults.length !== searchResults.length && (
              <span style={{ color: 'var(--accent-secondary)' }}>
                {' '}({searchResults.length - filteredSearchResults.length} illegal cards hidden)
              </span>
            )}
          </p>
          <SearchControls
            onSearch={deckBulkSearch}
            bulkDataStats={bulkDataStats}
          />
          <div className="collection-controls">
            <select value={cardTypeFilter} onChange={(e) => setCardTypeFilter(e.target.value)} title="Filter by card type">
              <option value="all">All Types</option>
              <option value="creature">Creatures</option><option value="land">Lands</option><option value="instant">Instants</option><option value="sorcery">Sorceries</option><option value="enchantment">Enchantments</option><option value="artifact">Artifacts</option><option value="planeswalker">Planeswalkers</option><option value="battle">Battles</option>
            </select>
            <select value={collectionSort} onChange={(e) => setCollectionSort(e.target.value)} title="Sort cards by">
              <option value="name">Name</option><option value="cmc">Mana Cost</option><option value="power">Power</option><option value="toughness">Toughness</option><option value="rarity">Rarity</option>
            </select>
            <button className="sort-direction-toggle" onClick={() => setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc')} title={`Sort ${sortDirection === 'asc' ? 'ascending' : 'descending'} - click to toggle`}>
              {sortDirection === 'asc' ? '↑' : '↓'}
            </button>
          </div>
          <div className="search-results-grid">
            {searchLoading && <p>Searching...</p>}
            {!searchLoading && (
              <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', margin: '8px 0' }}>
                Showing {filteredSearchResults.length} of {searchResults.length} results
              </div>
            )}
            {!searchLoading && filteredSearchResults.map(card => {
              const isInDeck = deck.mainboard.some(entry => entry.card.id === card.id);
              const deckQuantity = isInDeck ? deck.mainboard.find(entry => entry.card.id === card.id).quantity : 0;
              const collectionQuantity = getCollectionQuantity(card);
              const maxAllowed = getMaxCopiesAllowed(card);
              const canAdd = canAddMoreCopies(card, deckQuantity);

              return (
                <div key={card.id} className="card-grid-item">
                  <Card card={card} onCardClick={(card) => handleCardClick(card, 'search')} />
                  <div className="card-info">
                    <div className="quantity-info">
                      <span>Owned: {collectionQuantity}</span>
                      <span>Max: {maxAllowed}</span>
                      {isInDeck && <span>In Deck: {deckQuantity}</span>}
                    </div>
                    <div className="deck-actions">
                      {isInDeck ? (
                        <>
                          <button
                            className="remove-from-deck"
                            onClick={(e) => {
                              e.stopPropagation();
                              removeCardFromDeck(card.id);
                            }}
                            title="Remove from deck"
                          >
                            Remove
                          </button>
                          {canAdd.canAdd && (
                            <button
                              className="add-more"
                              onClick={(e) => {
                                e.stopPropagation();
                                addCardToDeck(card);
                              }}
                              title="Add another copy"
                            >
                              Add More
                            </button>
                          )}
                        </>
                      ) : (
                        <button
                          disabled={!canAdd.canAdd}
                          onClick={(e) => {
                            e.stopPropagation();
                            addCardToDeck(card);
                          }}
                          title={!canAdd.canAdd ? canAdd.reason : 'Add to deck'}
                        >
                          Add to Deck
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {activeView === 'collection' && (
        <div className="collection-view">
          <h3>My Collection ({displayCollectionCards.length} unique)</h3>
          <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', margin: '4px 0 8px 0', fontStyle: 'italic' }}>
            Showing only cards legal in {format} format
          </p>
          <div className="collection-controls">
            <SearchControls onSearch={(params) => searchHelperRef.current?.handleCollectionSearch(params)} bulkDataStats={bulkDataStats} />
            <select value={cardTypeFilter} onChange={(e) => setCardTypeFilter(e.target.value)} title="Filter by card type">
              <option value="all">All Types</option><option value="creature">Creatures</option><option value="land">Lands</option><option value="instant">Instants</option><option value="sorcery">Sorceries</option><option value="enchantment">Enchantments</option><option value="artifact">Artifacts</option><option value="planeswalker">Planeswalkers</option><option value="battle">Battles</option>
            </select>
            <select value={collectionSort} onChange={(e) => setCollectionSort(e.target.value)} title="Sort cards by">
              <option value="name">Name</option><option value="cmc">Mana Cost</option><option value="power">Power</option><option value="toughness">Toughness</option><option value="rarity">Rarity</option><option value="quantity">Quantity</option>
            </select>
            <button className="sort-direction-toggle" onClick={() => setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc')} title={`Sort ${sortDirection === 'asc' ? 'ascending' : 'descending'} - click to toggle`}>
              {sortDirection === 'asc' ? '↑' : '↓'}
            </button>
          </div>
          <div className="owned-cards-grid">
            {ownedLoading && <p>Loading collection...</p>}
            {!ownedLoading && displayCollectionCards.map(entry => {
              const isInDeck = deck.mainboard.some(deckEntry => deckEntry.card.id === entry.card.id);
              const deckQuantity = isInDeck ? deck.mainboard.find(deckEntry => deckEntry.card.id === entry.card.id).quantity : 0;
              const maxAllowed = getMaxCopiesAllowed(entry.card);
              const canAdd = canAddMoreCopies(entry.card, deckQuantity);

              return (
                <div key={entry.card.id} className="card-grid-item">
                  <Card card={entry.card} quantity={entry.quantity} onCardClick={(card) => handleCardClick(card, 'collection')} />
                  <div className="card-info">
                    <div className="quantity-info">
                      <span>Owned: {entry.quantity}</span>
                      <span>Max: {maxAllowed}</span>
                      {isInDeck && <span>In Deck: {deckQuantity}</span>}
                    </div>
                    <div className="deck-actions">
                      {isInDeck ? (
                        <>
                          <button
                            className="remove-from-deck"
                            onClick={(e) => {
                              e.stopPropagation();
                              removeCardFromDeck(entry.card.id);
                            }}
                            title="Remove from deck"
                          >
                            Remove
                          </button>
                          {canAdd.canAdd && (
                            <button
                              className="add-more"
                              onClick={(e) => {
                                e.stopPropagation();
                                addCardToDeck(entry.card);
                              }}
                              title="Add another copy"
                            >
                              Add More
                            </button>
                          )}
                        </>
                      ) : (
                        <button
                          disabled={!canAdd.canAdd}
                          onClick={(e) => {
                            e.stopPropagation();
                            addCardToDeck(entry.card);
                          }}
                          title={!canAdd.canAdd ? canAdd.reason : 'Add to deck'}
                        >
                          Add to Deck
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </>
  );
});

const DeckViewPanel = React.memo(function DeckViewPanel(props) {
  const { deck, format, setFormat, currentDeckName, handleCardClick, removeCommander, mainboardCount, groupedMainboard, expandedCategories, toggleCategory, expandAllCategories, collapseAllCategories, incrementQty, decrementQty, removeCardFromDeck, setCommander, isCardCommander, isBasicLand } = props;

  return (
    <>
      <div className="deck-stats-and-actions">
        <h2>{currentDeckName ? `Deck: ${currentDeckName}` : 'Untitled Deck'}</h2>
        <div className="format-selector">
          <label>Format: </label>
          <select value={format} onChange={e => setFormat(e.target.value)}>
            <option value="commander">Commander</option><option value="standard">Standard</option><option value="modern">Modern</option><option value="legacy">Legacy</option><option value="vintage">Vintage</option><option value="pauper">Pauper</option>
          </select>
        </div>
      </div>

      {format === 'commander' && (
        <div className="command-zone-container">
          <h3>Commander(s)</h3>
          <div className="command-zone">
            <div className="commander-cards">
              {deck.commanders.length > 0 ? (
                deck.commanders.map(c => (
                  <div key={c.id} className="card-grid-item-deck">
                    <Card card={c} onCardClick={(card) => handleCardClick(card, 'deck')} />
                    <div className="deck-card-actions"><button className="remove-button" onClick={() => removeCommander(c.id)}>Remove</button></div>
                  </div>
                ))
              ) : <div className="empty-slot">Drop a legendary creature here.</div>}
            </div>
            {deck.commanders.length > 0 && (
              <div className="commander-details">
                {(() => { const cmd = deck.commanders[0]; return (<> <h4 className="details-name">{cmd.name}</h4> {(cmd.manaCost || cmd.mana_cost) && (<p className="details-line"><strong>Mana Cost:</strong> {cmd.manaCost || cmd.mana_cost}</p>)} {(cmd.type || cmd.type_line) && (<p className="details-line"><strong>Type:</strong> {cmd.type.replace(/\?\?\?/g, '—') || cmd.type_line.replace(/\?\?\?/g, '—')}</p>)} {(cmd.text || cmd.oracle_text) && (<p className="details-line" style={{ whiteSpace: 'pre-line' }}><strong>Oracle Text:</strong> {(cmd.text || cmd.oracle_text).replace(/\\n/g, '\n').replace(/\?\?\?/g, '—')}</p>)} {cmd.power && cmd.toughness && (<p className="details-line"><strong>P/T:</strong> {cmd.power}/{cmd.toughness}</p>)} {cmd.color_identity && cmd.color_identity.length > 0 && (<p className="details-line"><strong>Color Identity:</strong> {cmd.color_identity.join(', ')}</p>)} </>); })()}
              </div>
            )}
          </div>
        </div>
      )}

      <div className="mainboard-container">
        <h3>Mainboard ({mainboardCount} cards)</h3>
        {Object.keys(groupedMainboard).length > 1 && (
          <div className="category-controls"><button onClick={expandAllCategories}>Expand All</button><button onClick={collapseAllCategories}>Collapse All</button></div>
        )}
        <div className="categories-container">
          {Object.entries(groupedMainboard).map(([categoryName, cards]) => {
            const isExpanded = expandedCategories.has(categoryName);
            const totalCards = cards.reduce((sum, entry) => sum + entry.quantity, 0);
            return (
              <div key={categoryName} className="card-type-category">
                <div
                  className={`category-header ${isExpanded ? 'expanded' : ''}`}
                  role="button"
                  tabIndex={0}
                  aria-expanded={isExpanded}
                  onClick={() => toggleCategory(categoryName)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      toggleCategory(categoryName);
                    }
                  }}
                >
                  <div className="category-title"><span>{categoryName}</span><span className="category-count">{totalCards}</span></div>
                  <span className={`category-toggle ${isExpanded ? 'expanded' : ''}`}>▶</span>
                </div>
                <div className={`category-content ${!isExpanded ? 'collapsed' : ''}`}>
                  {cards.map(entry => (
                    <div key={entry.card.id} className="card-grid-item-deck">
                      <Card card={entry.card} quantity={entry.quantity} onCardClick={(card) => handleCardClick(card, 'deck')} />
                      <div className="deck-card-actions">
                        <button onClick={() => incrementQty(entry.card.id)} disabled={format === 'commander' && !isBasicLand(entry.card)} title={format === 'commander' && !isBasicLand(entry.card) ? 'Commander format allows only one copy' : ''}>+</button>
                        <button onClick={() => decrementQty(entry.card.id)}>-</button>
                        <button className="remove-button" onClick={() => removeCardFromDeck(entry.card.id)}>Remove</button>
                        {format === 'commander' && isCardCommander(entry.card) && (<button className="set-commander-button" onClick={() => setCommander(entry.card)}>Set Cmdr</button>)}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
          {Object.keys(groupedMainboard).length === 0 && (<div style={{ textAlign: 'center', color: 'var(--text-secondary)', padding: '40px 20px', fontStyle: 'italic' }}>No cards in mainboard.</div>)}
        </div>
      </div>
    </>
  );
});

const DeckInfoPanel = React.memo(function DeckInfoPanel(props) {
  const { deck, format, currentDeckName, handleSaveDeck, handleLoadDeck, handleDeleteDeck, handleNewDeck, validationResults } = props;
  return (
    <div className="deck-info-view">
      <DeckValidation results={validationResults} />
      <DeckManager deck={deck} format={format} currentDeckName={currentDeckName} onSave={handleSaveDeck} onLoad={handleLoadDeck} onDelete={handleDeleteDeck} onNew={handleNewDeck} />
    </div>
  );
});

const RecommendationsPanel = React.memo(function RecommendationsPanel(props) {
  const { deck, recoLoading, handleGetRecommendations, displayRecommendations, deckArchetype, cardTypeFilter, setCardTypeFilter, recommendationsSort, setRecommendationsSort, recommendationsSortDirection, setRecommendationsSortDirection, handleCardClick, addCardToDeck, removeCardFromDeck, showSettings, setShowSettings, strategyComparison, availableStrategies, activeStrategy, handleStrategyChange, showPatternAnalysis, setShowPatternAnalysis } = props;
  return (
    <div className="recommendations-view">
      <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
        <button onClick={handleGetRecommendations} disabled={recoLoading}>
          {recoLoading ? 'Getting Suggestions...' : 'Suggest Cards'}
        </button>
        <button
          onClick={() => setShowSettings(true)}
          title="Recommendation Engine Settings"
          style={{
            background: '#666',
            border: 'none',
            color: 'white',
            padding: '8px 12px',
            borderRadius: '4px',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '4px'
          }}
          aria-haspopup="dialog"
        >
          <Settings size={16} />
          Settings
        </button>
      </div>
      {deckArchetype && <h4>Suggestions for: {deckArchetype}</h4>}
      <div className="synergy-legend" style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', margin: '8px 0', padding: '8px', backgroundColor: 'var(--bg-tertiary)', borderRadius: '4px' }}>
        <strong>Synergy:</strong>
        <span className="synergy-legend-item"><span className="synergy-badge-mini synergy-excellent">★★★</span> 300+</span>
        <span className="synergy-legend-item"><span className="synergy-badge-mini synergy-great">★★☆</span> 250+</span>
        <span className="synergy-legend-item"><span className="synergy-badge-mini synergy-good">★☆☆</span> 200+</span>
        <span className="synergy-legend-item"><span className="synergy-badge-mini synergy-decent">◆</span> 150+</span>
      </div>
      <div className="collection-controls">
        <select value={cardTypeFilter} onChange={(e) => setCardTypeFilter(e.target.value)} title="Filter by card type">
          <option value="all">All Types</option><option value="creature">Creatures</option><option value="land">Lands</option><option value="instant">Instants</option><option value="sorcery">Sorceries</option><option value="enchantment">Enchantments</option><option value="artifact">Artifacts</option><option value="planeswalker">Planeswalkers</option><option value="battle">Battles</option>
        </select>
        <select value={recommendationsSort} onChange={(e) => setRecommendationsSort(e.target.value)} title="Sort cards by">
          <option value="synergy">Synergy</option><option value="name">Name</option><option value="cmc">Cost</option><option value="power">Power</option><option value="toughness">Toughness</option><option value="rarity">Rarity</option>
        </select>
        <button className="sort-direction-toggle" onClick={() => setRecommendationsSortDirection(recommendationsSortDirection === 'asc' ? 'desc' : 'asc')} title={`Sort ${recommendationsSortDirection === 'asc' ? 'ascending' : 'descending'}`}>
          {recommendationsSortDirection === 'asc' ? '↑' : '↓'}
        </button>
      </div>

      {/* 🧪 Strategy Testing Component */}
      {strategyComparison && availableStrategies && (
        <StrategyTester
          strategyComparison={strategyComparison}
          availableStrategies={availableStrategies}
          activeStrategy={activeStrategy}
          onStrategyChange={handleStrategyChange}
        />
      )}

      <div className="search-results-grid">
        {recoLoading && <p>Analyzing deck...</p>}
        {!recoLoading && displayRecommendations.map(card => {
          const isInDeck = deck.mainboard.some(entry => entry.card.id === card.id);
          const showingPatterns = showPatternAnalysis === card.id;
          return (
            <div key={card.id} className="card-grid-item">
              <Card card={card} onCardClick={(card) => handleCardClick(card, 'recommendations')} showSynergyScore={true} />
              <div className="card-actions">
                <button className={isInDeck ? 'remove-from-deck' : ''} onClick={(e) => { e.stopPropagation(); if (isInDeck) { removeCardFromDeck(card.id); } else { addCardToDeck(card); } }}>
                  {isInDeck ? 'Remove' : 'Add'}
                </button>
                <button
                  className="pattern-analysis-btn"
                  onClick={(e) => {
                    e.stopPropagation();
                    setShowPatternAnalysis(showingPatterns ? null : card.id);
                  }}
                  title="Show pattern analysis"
                >
                  ⚙️ {showingPatterns ? 'Hide' : 'Patterns'}
                </button>
              </div>
              {showingPatterns && (
                <div className="inline-pattern-analysis">
                  <PatternAnalysis card={card} />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
});

// ===================================================================================
// New: DeckValidation Component
// Displays legality errors and warnings for the current deck.
// ===================================================================================
const DeckValidation = React.memo(function DeckValidation({ results }) {
  if (!results || (results.errors.length === 0 && results.warnings.length === 0)) {
    return (
      <div className="deck-validation-widget valid">
        <CheckCircle size={18} />
        <span>Deck is valid for {results.format || 'the selected format'}.</span>
      </div>
    );
  }

  return (
    <div className="deck-validation-widget">
      <div className="validation-header">
        <AlertTriangle size={18} />
        <span>Deck Legality Issues</span>
      </div>
      <ul className="validation-list">
        {results.errors.map((error, index) => (
          <li key={`error-${index}`} className="error">
            {error}
          </li>
        ))}
        {results.warnings.map((warning, index) => (
          <li key={`warning-${index}`} className="warning">
            {warning}
          </li>
        ))}
      </ul>
    </div>
  );
});


const TokenSuggestionsPanel = React.memo(function TokenSuggestionsPanel(props) {
  const { deck, tokenLoading, handleGetTokenSuggestions, filteredTokenSuggestions, handleCardClick, addCardToDeck, removeCardFromDeck } = props;
  return (
    <div className="recommendations-view">
      <button onClick={handleGetTokenSuggestions} disabled={tokenLoading}>{tokenLoading ? 'Analyzing...' : 'Find Tokens'}</button>
      <p style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', margin: '8px 0' }}>Suggestions based on cards in your deck.</p>
      <div className="search-results-grid">
        {tokenLoading && <p>Analyzing deck for token patterns...</p>}
        {!tokenLoading && filteredTokenSuggestions.length === 0 && <p>No token suggestions found.</p>}
        {!tokenLoading && filteredTokenSuggestions.map(token => {
          const isInDeck = deck.mainboard.some(entry => entry.card.id === token.id);
          return (
            <div key={token.id} className="card-grid-item">
              <Card card={token} onCardClick={(card) => handleCardClick(card, 'tokens')} />
              <button className={isInDeck ? 'remove-from-deck' : ''} onClick={(e) => { e.stopPropagation(); if (isInDeck) { removeCardFromDeck(token.id); } else { addCardToDeck(token); } }}>
                {isInDeck ? 'Remove' : 'Add'}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
});

const AutoBuildPanel = React.memo(function AutoBuildPanel(props) {
  const { format, autoBuildLoading, handleAutoBuildCommander, autoBuildSynergy, deck } = props;

  const canAutoBuild = format === 'commander';
  const hasGeneratedDeck = autoBuildSynergy !== null;

  return (
    <div className="auto-build-view">
      <div className="auto-build-header">
        <h3>Auto-Build Commander</h3>
        <p style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', margin: '8px 0' }}>
          Generate a complete Commander deck automatically
        </p>
      </div>

      <button
        className="auto-build-button"
        onClick={handleAutoBuildCommander}
        disabled={autoBuildLoading || !canAutoBuild}
        style={{ width: '100%', marginBottom: '16px' }}
      >
        {autoBuildLoading ? 'Building Deck…' : 'Auto Build Commander Deck'}
      </button>

      {!canAutoBuild && (
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', fontStyle: 'italic' }}>
          Auto-build is only available for Commander format
        </p>
      )}

      {hasGeneratedDeck && (
        <div className="auto-build-results">
          <div className="synergy-score-display">
            <h4>Last Generated Deck</h4>
            <div className="synergy-score-container">
              <div className="synergy-score-value">
                <span className="synergy-score-number">{autoBuildSynergy?.toFixed?.(0) || 'N/A'}</span>
                <span className="synergy-score-label">Synergy Score</span>
              </div>
              <div className="synergy-score-description">
                <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                  Higher scores indicate better card synergies and coherent strategy
                </p>
              </div>
            </div>
          </div>

          <div className="deck-composition">
            <h5>Deck Composition</h5>
            <div className="composition-stats">
              <div className="stat">
                <span className="stat-label">Commanders:</span>
                <span className="stat-value">{deck.commanders.length}</span>
              </div>
              <div className="stat">
                <span className="stat-label">Mainboard:</span>
                <span className="stat-value">{deck.mainboard.length} unique cards</span>
              </div>
              <div className="stat">
                <span className="stat-label">Total Cards:</span>
                <span className="stat-value">{deck.commanders.length + deck.mainboard.reduce((sum, entry) => sum + entry.quantity, 0)}</span>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
});

const DeckStatsPanel = React.memo(function DeckStatsPanel(props) {
  const { deck, format, deckAnalysis } = props;

  return (
    <div className="deck-stats-view">
      <div className="deck-stats-content">
        <DeckStatistics deck={deck} format={format} deckAnalysis={deckAnalysis} />
      </div>
    </div>
  );
});

const SpellbookExportPanel = React.memo(function SpellbookExportPanel(props) {
  const { deck } = props;

  return (
    <div className="spellbook-export-view">
      <h3>Find a Combo courtesy of Spellbook</h3>
      <SpellbookExport deck={deck} />
    </div>
  );
});

// const AIPanelComponent = (props) => {
//   const {
//     deck,
//     searchTerm,
//     setSearchTerm,
//     handleCardClick,
//     recommendations,
//     deckArchetype,
//     deckAnalysis,
//     format
//   } = props;

//   const handleCardSuggestion = (cardName) => {
//     // Set the search term to the suggested card name
//     setSearchTerm(cardName);

//     // Optionally trigger a search or other action
//     console.log('AI suggested card:', cardName);
//   };

//   // Get the current commander from the deck
//   const commander = deck.commanders.length > 0 ? deck.commanders[0].card : null;

//   // Convert deck format for AI analysis
//   const deckForAI = deck.mainboard.map(entry => ({
//     name: entry.card.name,
//     quantity: entry.quantity,
//     ...entry.card
//   }));

//   return (
//     <div className="ai-panel-view">
//       <AIPanel
//         deck={deckForAI}
//         commander={commander}
//         onCardSuggestion={handleCardSuggestion}
//         recommendations={recommendations}
//         deckArchetype={deckArchetype}
//         deckAnalysis={deckAnalysis}
//         format={format}
//       />
//     </div>
//   );
// };

export default DeckBuilder;
