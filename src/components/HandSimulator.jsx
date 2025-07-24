import React, { useState, useEffect, useCallback, useMemo } from 'react';
import Card from '../Card';
import CardDetailModal from './CardDetailModal';
import BattlefieldArea from './BattlefieldArea';

import useCardNavigation from '../hooks/useCardNavigation';
import useDragAndDrop from '../hooks/useDragAndDrop';
import './HandSimulator.css';

// Import utility functions from DeckStatistics for consistent analysis
const expandEntries = (entries) => {
  const list = [];
  entries.forEach(({ card, quantity }) => {
    for (let i = 0; i < quantity; i++) {
      list.push(card);
    }
  });
  return list;
};

// Fisher-Yates shuffle algorithm
const shuffleArray = (array) => {
  const shuffled = [...array];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
};

// Create a deck array from deck data (expanding quantities) - using DeckStatistics approach
const createDeckArray = (deckData) => {
  const cards = [
    ...expandEntries(deckData.mainboard || []),
    ...(deckData.commanders || []), // commanders count as 1 each
  ];
  return cards.map((card, index) => ({
    ...card,
    instanceId: `${card.id}-${index}`,
  }));
};

// Enhanced statistics analysis using DeckStatistics methodology
const analyzeDeckStatistics = (cards) => {
  const manaBucketLabels = ['0', '1', '2', '3', '4', '5', '6', '7+'];
  const manaCurveCounts = Array(manaBucketLabels.length).fill(0);

  // Color mapping from DeckStatistics
  const colorMap = {
    W: { name: 'White', symbol: '☀️', hex: '#FFFBD5' },
    U: { name: 'Blue', symbol: '💧', hex: '#0E68AB' },
    B: { name: 'Black', symbol: '💀', hex: '#150B00' },
    R: { name: 'Red', symbol: '🔥', hex: '#D3202A' },
    G: { name: 'Green', symbol: '🌲', hex: '#00733E' },
    C: { name: 'Colorless', symbol: '⚪', hex: '#CAC5C0' },
  };

  const typeCategories = [
    'Creature', 'Instant', 'Sorcery', 'Artifact', 'Enchantment', 'Planeswalker', 'Land', 'Battle'
  ];

  // Initialize counters
  const allManaCosts = [];
  const nonlandManaCosts = [];
  let totalManaCostAll = 0;
  const typeCounts = {};
  typeCategories.forEach(t => (typeCounts[t] = 0));
  const colorCounts = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 };
  const manaSymbolCounts = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0, X: 0 };

  let totalManaCost = 0;
  let validManaCards = 0;
  const nonlandCards = [];

  cards.forEach((card) => {
    if (!card) return;

    // Handle double-faced cards
    const primaryFace = (card.card_faces && card.card_faces.length > 0) ? card.card_faces[0] : card;
    const tLine = (primaryFace.type_line || card.type_line || card.type || '').toLowerCase();

    // Mana value tracking using DeckStatistics approach
    let cmc = card.manaValue ?? card.cmc ?? card.mana_value ?? 0;

    // Lands should be counted as 0 mana cost in the mana curve
    if (tLine.includes('land')) {
      cmc = 0;
    }

    allManaCosts.push(cmc);
    totalManaCostAll += cmc;

    const idx = cmc >= 7 ? 7 : Math.max(0, Math.min(7, Math.round(cmc)));

    // Add all cards to mana curve (including lands as 0)
    manaCurveCounts[idx] += 1;

    // Track non-land cards separately for average calculations
    if (!tLine.includes('land')) {
      nonlandManaCosts.push(cmc);
      totalManaCost += cmc;
      validManaCards += 1;
      nonlandCards.push(card);
    }

    // Type analysis
    let matchedType = null;
    for (const t of typeCategories) {
      if (tLine.includes(t.toLowerCase())) {
        matchedType = t;
        break;
      }
    }
    if (matchedType) {
      typeCounts[matchedType] += 1;
    } else {
      typeCounts['Other'] = (typeCounts['Other'] || 0) + 1;
    }

    // Color identity analysis
    const colors = card.color_identity && card.color_identity.length > 0 ? card.color_identity : ['C'];
    colors.forEach((c) => {
      if (colorCounts[c] !== undefined) colorCounts[c] += 1;
    });

    // Mana symbol analysis
    const manaCost = primaryFace.mana_cost || card.mana_cost || card.manaCost || '';
    if (manaCost) {
      const symbols = manaCost.match(/\{([WUBRG0-9XC]+)\}/g) || [];
      symbols.forEach(symbol => {
        const clean = symbol.replace(/[{}]/g, '');
        if (/^[WUBRG]$/.test(clean)) {
          manaSymbolCounts[clean] += 1;
        } else if (/^[0-9]+$/.test(clean)) {
          manaSymbolCounts.C += parseInt(clean);
        } else if (clean === 'X') {
          manaSymbolCounts.X += 1;
        }
      });
    }
  });

  // Calculate statistics
  const totalCards = cards.length || 1;
  const avgManaCostWithLands = totalCards > 0 ? totalManaCostAll / totalCards : 0;
  const avgManaCostWithoutLands = validManaCards > 0 ? totalManaCost / validManaCards : 0;

  // Calculate median
  const calculateMedian = (arr) => {
    if (!arr || arr.length === 0) return 0;
    const sorted = [...arr].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 !== 0
      ? sorted[mid]
      : (sorted[mid - 1] + sorted[mid]) / 2;
  };

  const medianManaCostWithLands = calculateMedian(allManaCosts);
  const medianManaCostWithoutLands = calculateMedian(nonlandManaCosts);

  return {
    manaCurveCounts,
    typeCounts,
    colorCounts,
    manaSymbolCounts,
    totalCards,
    avgManaCost: avgManaCostWithoutLands,
    avgManaCostWithLands,
    medianManaCostWithLands,
    medianManaCostWithoutLands,
    totalManaValue: totalManaCostAll,
    nonlandCards: nonlandCards.length,
    landCards: totalCards - nonlandCards.length,
    colorMap
  };
};

// Count lands in collection
const countLands = (cards) => {
  return cards.filter(card =>
    card && (card.type || card.type_line || '').toLowerCase().includes('land')
  ).length;
};

const HandSimulator = () => {
  const [savedDecks, setSavedDecks] = useState([]);
  const [selectedDeck, setSelectedDeck] = useState(null);
  const [deckData, setDeckData] = useState(null);
  const [shuffledDeck, setShuffledDeck] = useState([]);
  const [currentHand, setCurrentHand] = useState([]);
  const [mulliganCount, setMulliganCount] = useState(0);
  const [deckPosition, setDeckPosition] = useState(0); // Track current position in deck
  const [loading, setLoading] = useState(false);
  const [selectedCard, setSelectedCard] = useState(null);

  // Game state for battlefield, graveyard, and exile
  const [gameState, setGameState] = useState({
    battlefield: {
      lands: [],
      creatures: [],
      other: []
    },
    graveyard: [],
    exile: []
  });

  // Navigation state
  const [navigationContext, setNavigationContext] = useState('hand-simulator');

  // Drag and drop functionality
  const {
    dragState,
    handleDragStart,
    handleDragEnd,
    setDropTarget,
    clearDropTarget,
    handleDrop,
    isValidDropTarget
  } = useDragAndDrop();

  // Load saved decks on component mount
  useEffect(() => {
    const fetchSavedDecks = async () => {
      try {
        const result = await window.electronAPI.deckList();
        if (result.success) {
          setSavedDecks(result.decks.sort());
        } else {
          console.error("Failed to fetch saved decks:", result.error);
        }
      } catch (error) {
        console.error("Error fetching saved decks:", error);
      }
    };

    fetchSavedDecks();
  }, []);

  // Load selected deck
  const loadDeck = useCallback(async (deckName) => {
    if (!deckName) return;

    setLoading(true);
    try {
      const result = await window.electronAPI.deckLoad(deckName);
      if (result.success) {
        console.log('Loaded deck data:', result.deck);
        setDeckData(result.deck);
        setSelectedDeck(deckName);
        setCurrentHand([]);
        setMulliganCount(0);
        setDeckPosition(0);

        // Create and shuffle the deck
        const deckArray = createDeckArray(result.deck);
        console.log('Created deck array:', deckArray.length, 'cards');
        console.log('Sample cards:', deckArray.slice(0, 3));
        const shuffled = shuffleArray(deckArray);
        setShuffledDeck(shuffled);
      } else {
        console.error("Failed to load deck:", result.error);
        alert(`Error loading deck: ${result.error}`);
      }
    } catch (error) {
      console.error("Error loading deck:", error);
      alert("Failed to load deck");
    } finally {
      setLoading(false);
    }
  }, []);

  // Draw opening hand
  const drawOpeningHand = useCallback(() => {
    if (shuffledDeck.length < 7) {
      alert("Deck has fewer than 7 cards!");
      return;
    }

    const hand = shuffledDeck.slice(0, 7);
    setCurrentHand(hand);
    setDeckPosition(7); // Set position after drawing 7 cards
  }, [shuffledDeck]);

  // Mulligan - reshuffle and draw new hand
  const mulligan = useCallback(() => {
    if (!deckData) return;

    const deckArray = createDeckArray(deckData);
    const shuffled = shuffleArray(deckArray);
    setShuffledDeck(shuffled);

    // Draw one less card for each mulligan (minimum 1)
    const handSize = Math.max(1, 7 - mulliganCount - 1);
    const newHand = shuffled.slice(0, handSize);
    setCurrentHand(newHand);
    setDeckPosition(handSize); // Set position after drawing mulligan hand
    setMulliganCount(prev => prev + 1);
  }, [deckData, mulliganCount]);

  // Keep hand - just for tracking
  const keepHand = useCallback(() => {
    // In a real game, you might want to track kept hands or do additional analysis
    console.log("Hand kept after", mulliganCount, "mulligans");
  }, [mulliganCount]);

  // Draw new hand - reshuffle and draw full 7 cards without mulligan penalty
  const drawNewHand = useCallback(() => {
    if (!deckData) return;

    const deckArray = createDeckArray(deckData);
    const shuffled = shuffleArray(deckArray);
    setShuffledDeck(shuffled);

    // Draw a fresh 7-card hand
    const newHand = shuffled.slice(0, 7);
    setCurrentHand(newHand);
    setDeckPosition(7); // Set position after drawing 7 cards
  }, [deckData]);

  // Draw next card from deck
  const drawNextCard = useCallback(() => {
    if (deckPosition >= shuffledDeck.length) {
      alert("No more cards in deck!");
      return;
    }

    const nextCard = shuffledDeck[deckPosition];
    setCurrentHand(prev => [...prev, nextCard]);
    setDeckPosition(prev => prev + 1);
  }, [shuffledDeck, deckPosition]);

  // Reset simulation
  const resetSimulation = useCallback(() => {
    if (deckData) {
      const deckArray = createDeckArray(deckData);
      const shuffled = shuffleArray(deckArray);
      setShuffledDeck(shuffled);
    }
    setCurrentHand([]);
    setMulliganCount(0);
    setDeckPosition(0);
    setGameState({
      battlefield: {
        lands: [],
        creatures: [],
        other: []
      },
      graveyard: [],
      exile: []
    });
  }, [deckData]);

  // Drag and drop handlers
  const onDragStart = useCallback((card, source, event) => {
    handleDragStart(card, source, event);
  }, [handleDragStart]);

  const onDragEnd = useCallback((event) => {
    handleDragEnd(event);
  }, [handleDragEnd]);

  const handleDropZoneEnter = useCallback((zone) => {
    if (dragState.isDragging && isValidDropTarget(zone, dragState.draggedCard)) {
      setDropTarget(zone);
    }
  }, [dragState.isDragging, dragState.draggedCard, isValidDropTarget, setDropTarget]);

  const handleDropZoneLeave = useCallback(() => {
    clearDropTarget();
  }, [clearDropTarget]);

  // Move card between zones
  const moveCard = useCallback((card, source, target) => {
    console.log('Moving card:', card.name, 'from', source, 'to', target);

    if (source === 'hand') {
      // Check if card is still in hand to prevent duplicate moves
      setCurrentHand(prev => {
        const cardExists = prev.some(c => c.instanceId === card.instanceId);
        if (!cardExists) {
          console.log('Card not found in hand, skipping move');
          return prev;
        }

        // Remove card from hand
        return prev.filter(c => c.instanceId !== card.instanceId);
      });

      // Add card to target zone
      setGameState(prev => {
        const newState = { ...prev };

        switch (target) {
          case 'battlefield-lands':
            // Check if card already exists in target zone
            if (!prev.battlefield.lands.some(c => c.instanceId === card.instanceId)) {
              newState.battlefield.lands = [...prev.battlefield.lands, card];
            }
            break;
          case 'battlefield-creatures':
            if (!prev.battlefield.creatures.some(c => c.instanceId === card.instanceId)) {
              newState.battlefield.creatures = [...prev.battlefield.creatures, card];
            }
            break;
          case 'battlefield-other':
            if (!prev.battlefield.other.some(c => c.instanceId === card.instanceId)) {
              newState.battlefield.other = [...prev.battlefield.other, card];
            }
            break;
          case 'graveyard':
            if (!prev.graveyard.some(c => c.instanceId === card.instanceId)) {
              newState.graveyard = [...prev.graveyard, card];
            }
            break;
          case 'exile':
            if (!prev.exile.some(c => c.instanceId === card.instanceId)) {
              newState.exile = [...prev.exile, card];
            }
            break;
          default:
            return prev;
        }

        return newState;
      });
    }
  }, []);

  const onDrop = useCallback((event, zone) => {
    console.log('onDrop called for zone:', zone);
    const result = handleDrop(event, zone);
    if (result && result.success) {
      console.log('Drop successful, moving card');
      moveCard(result.card, result.source, result.target);
    } else {
      console.log('Drop failed or no result');
    }
  }, [handleDrop, moveCard]);



  // Calculate hand statistics using DeckStatistics methodology
  const handStats = useMemo(() => {
    if (currentHand.length === 0) return null;

    const validCards = currentHand.filter(card => card);
    const handAnalysis = analyzeDeckStatistics(validCards);

    return {
      cardCount: currentHand.length,
      landCount: countLands(currentHand),
      manaCurve: handAnalysis.manaCurveCounts,
      manaCurveObject: Object.fromEntries(
        handAnalysis.manaCurveCounts.map((count, idx) => [
          idx === 7 ? '7+' : idx.toString(), count
        ])
      ),
      avgCmc: handAnalysis.avgManaCost,
      avgCmcWithLands: handAnalysis.avgManaCostWithLands,
      colorDistribution: handAnalysis.colorCounts,
      typeDistribution: handAnalysis.typeCounts,
      manaSymbols: handAnalysis.manaSymbolCounts,
      colorMap: handAnalysis.colorMap
    };
  }, [currentHand]);

  // Deck statistics using DeckStatistics methodology
  const deckStats = useMemo(() => {
    if (!deckData) return null;

    const allCards = createDeckArray(deckData);
    const deckAnalysis = analyzeDeckStatistics(allCards);

    return {
      totalCards: deckAnalysis.totalCards,
      landCount: deckAnalysis.landCards,
      nonlandCount: deckAnalysis.nonlandCards,
      manaCurve: deckAnalysis.manaCurveCounts,
      manaCurveObject: Object.fromEntries(
        deckAnalysis.manaCurveCounts.map((count, idx) => [
          idx === 7 ? '7+' : idx.toString(), count
        ])
      ),
      avgCmc: deckAnalysis.avgManaCost,
      avgCmcWithLands: deckAnalysis.avgManaCostWithLands,
      medianCmc: deckAnalysis.medianManaCostWithoutLands,
      medianCmcWithLands: deckAnalysis.medianManaCostWithLands,
      totalManaValue: deckAnalysis.totalManaValue,
      colorDistribution: deckAnalysis.colorCounts,
      typeDistribution: deckAnalysis.typeCounts,
      manaSymbols: deckAnalysis.manaSymbolCounts,
      colorMap: deckAnalysis.colorMap
    };
  }, [deckData]);

  // Navigation handlers
  const handleCardClick = useCallback((card) => {
    setSelectedCard(card);
    setNavigationContext('hand-simulator');
  }, []);

  const handleCloseModal = useCallback(() => {
    setSelectedCard(null);
  }, []);

  // Keyboard navigation using custom hook
  const navigation = useCardNavigation(
    currentHand.filter(card => card), // Filter out any null cards
    selectedCard,
    setSelectedCard,
    !!selectedCard // Modal is open when selectedCard exists
  );

  return (
    <div className="hand-simulator">
      <div className="simulator-header">
        <h1>🎲 Draw Simulator</h1>
        <p>Load a deck and simulate drawing opening hands to test consistency</p>
      </div>

      <div className="simulator-content">
        {/* Left Column - Deck Selection & Info */}
        <div className="left-column">
          {/* Deck Selection */}
          <div className="deck-selection">
            <h3>Select a Deck</h3>
            {savedDecks.length === 0 ? (
              <p className="no-decks">No saved decks found. Build and save decks in the Deck Builder first.</p>
            ) : (
              <div className="deck-list">
                {savedDecks.map(deckName => (
                  <button
                    key={deckName}
                    className={`deck-button ${selectedDeck === deckName ? 'selected' : ''}`}
                    onClick={() => loadDeck(deckName)}
                    disabled={loading}
                  >
                    {deckName}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Deck Info */}
          {deckData && (
            <div className="deck-info">
              <h3>Deck Statistics</h3>
              <div className="deck-stats">
                <div className="stat-item">
                  <span className="stat-label">Total Cards:</span>
                  <span className="stat-value">{deckStats.totalCards}</span>
                </div>
                <div className="stat-item">
                  <span className="stat-label">Lands:</span>
                  <span className="stat-value">{deckStats.landCount}</span>
                </div>
                <div className="stat-item">
                  <span className="stat-label">Non-lands:</span>
                  <span className="stat-value">{deckStats.nonlandCount}</span>
                </div>
                <div className="stat-item">
                  <span className="stat-label">Avg CMC:</span>
                  <span className="stat-value">{deckStats.avgCmc.toFixed(2)}</span>
                </div>
                <div className="stat-item">
                  <span className="stat-label">Median CMC:</span>
                  <span className="stat-value">{deckStats.medianCmc.toFixed(1)}</span>
                </div>
                <div className="stat-item">
                  <span className="stat-label">Total MV:</span>
                  <span className="stat-value">{deckStats.totalManaValue}</span>
                </div>
              </div>

              <div className="mana-curve">
                <h4>Deck Mana Curve</h4>
                <div className="curve-bars">
                  {Object.entries(deckStats.manaCurveObject).map(([cmc, count]) => (
                    <div key={cmc} className="curve-bar">
                      <div className="bar" style={{ height: `${(count / Math.max(...Object.values(deckStats.manaCurveObject))) * 60 + 5}px` }}></div>
                      <span className="bar-label">{cmc}</span>
                      <span className="bar-count">{count}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Color Distribution */}
              <div className="color-distribution">
                <h4>Color Distribution</h4>
                <div className="color-bars">
                  {Object.entries(deckStats.colorDistribution)
                    .filter(([_, count]) => count > 0)
                    .map(([color, count]) => (
                      <div key={color} className="color-bar">
                        <span className="color-symbol" style={{ color: deckStats.colorMap[color]?.hex }}>
                          {deckStats.colorMap[color]?.symbol}
                        </span>
                        <span className="color-name">{deckStats.colorMap[color]?.name}</span>
                        <span className="color-count">{count}</span>
                      </div>
                    ))}
                </div>
              </div>

              {/* Type Distribution */}
              <div className="type-distribution">
                <h4>Card Types</h4>
                <div className="type-bars">
                  {Object.entries(deckStats.typeDistribution)
                    .filter(([_, count]) => count > 0)
                    .sort(([, a], [, b]) => b - a)
                    .slice(0, 6)
                    .map(([type, count]) => (
                      <div key={type} className="type-bar">
                        <span className="type-name">{type}</span>
                        <span className="type-count">{count}</span>
                      </div>
                    ))}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Middle Column - Battlefield at Top, Hand Below */}
        <div className="middle-column">
          {/* Battlefield Area - Moved to top */}
          {deckData && (
            <div className="battlefield-container">
              <BattlefieldArea
                gameState={gameState}
                onDropZoneEnter={handleDropZoneEnter}
                onDropZoneLeave={handleDropZoneLeave}
                onDrop={onDrop}
                dragState={dragState}
              />
            </div>
          )}

          {/* Hand Display and Info - now below the battlefield */}
          {currentHand.length > 0 && (
            <>
              {/* Cards in Hand */}
              <div className="hand-cards-side">
                <div className="hand-cards">
                  {currentHand.filter(card => card).map((card, index) => (
                    <div key={card.instanceId} className={`hand-card ${dragState.draggedCard?.instanceId === card.instanceId ? 'dragging' : ''}`}>
                      <Card
                        card={card}
                        onCardClick={handleCardClick}
                        isDraggable={true}
                        onDragStart={onDragStart}
                        onDragEnd={onDragEnd}
                        dragSource="hand"
                      />
                    </div>
                  ))}
                </div>
              </div>

              {/* Hand Info and Stats */}
              <div className="hand-info-side">
                {/* Hand Stats */}
                {handStats && (
                  <div className="hand-stats">
                    <div className="stat-item">
                      <span className="stat-label">Lands:</span>
                      <span className="stat-value">{handStats.landCount}</span>
                    </div>
                    <div className="stat-item">
                      <span className="stat-label">Non-lands:</span>
                      <span className="stat-value">{handStats.cardCount - handStats.landCount}</span>
                    </div>
                    <div className="stat-item">
                      <span className="stat-label">Avg CMC:</span>
                      <span className="stat-value">{handStats.avgCmc.toFixed(2)}</span>
                    </div>
                    <div className="stat-item">
                      <span className="stat-label">Mulligans:</span>
                      <span className="stat-value">{mulliganCount}</span>
                    </div>
                  </div>
                )}

                {/* Hand Info - Compact Colors and Mana Curve */}
                <div className="hand-info">
                  <h4>Hand Info</h4>
                  <div className="hand-info-content">
                    {/* Hand Colors */}
                    {Object.values(handStats.colorDistribution).some(count => count > 0) && (
                      <div className="hand-colors-section">
                        <h5>Colors</h5>
                        <div className="hand-color-bars">
                          {Object.entries(handStats.colorDistribution)
                            .filter(([_, count]) => count > 0)
                            .map(([color, count]) => (
                              <div key={color} className="hand-color-item">
                                <span className="color-symbol" style={{ color: handStats.colorMap[color]?.hex }}>
                                  {handStats.colorMap[color]?.symbol}
                                </span>
                                <span className="color-count">{count}</span>
                              </div>
                            ))}
                        </div>
                      </div>
                    )}

                    {/* Hand Mana Curve */}
                    <div className="hand-mana-curve-section">
                      <h5>Mana Curve</h5>
                      <div className="curve-bars">
                        {Object.entries(handStats.manaCurveObject).map(([cmc, count]) => (
                          <div key={cmc} className="curve-bar">
                            <div className="bar" style={{ height: `${count > 0 ? (count / Math.max(...Object.values(handStats.manaCurveObject))) * 30 + 3 : 0}px` }}></div>
                            <span className="bar-label">{cmc}</span>
                            <span className="bar-count">{count}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </>
          )}
        </div>

        {/* Right Column - Simulation Controls */}
        <div className="right-column">
          {deckData && (
            <div className="simulation-controls">
              <h3>Draw new hand</h3>
              <div className="control-buttons">
                <button onClick={drawOpeningHand} disabled={currentHand.length > 0}>
                  Draw Opening Hand
                </button>
                <button onClick={drawNewHand} disabled={!deckData}>
                  Draw New Hand
                </button>
                <button onClick={drawNextCard} disabled={currentHand.length === 0 || deckPosition >= shuffledDeck.length}>
                  Draw Next Card ({shuffledDeck.length - deckPosition} left)
                </button>
                <button onClick={mulligan} disabled={currentHand.length === 0}>
                  Mulligan ({mulliganCount > 0 ? `${mulliganCount} taken` : 'None'})
                </button>
                <button onClick={keepHand} disabled={currentHand.length === 0}>
                  Keep Hand
                </button>
                <button onClick={resetSimulation}>
                  Reset
                </button>
              </div>
            </div>
          )}


        </div>
      </div>

      {/* Card Detail Modal */}
      {selectedCard && (
        <CardDetailModal
          card={selectedCard}
          onClose={handleCloseModal}
          onNavigatePrevious={navigation.navigateToPrevious}
          onNavigateNext={navigation.navigateToNext}
          hasPrevious={navigation.hasPrevious}
          hasNext={navigation.hasNext}
          currentIndex={navigation.currentIndex}
          totalCards={navigation.totalCards}
        />
      )}


    </div>
  );
};

export default HandSimulator; 