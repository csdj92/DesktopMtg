import React, { useState, useEffect, useCallback, useMemo } from 'react';
import './HandSimulator.css';

// Card component for displaying cards in hand
const Card = ({ card, onCardClick }) => {
  const getImageUrl = (cardData) => {
    if (!cardData) return 'https://placehold.co/600x800/1a1a1a/e0e0e0?text=No+Image';

    // Handle double-faced cards
    if (cardData.card_faces && cardData.card_faces.length > 0 && cardData.card_faces[0].image_uris) {
      return cardData.card_faces[0].image_uris.normal;
    }

    // Handle single-faced cards
    if (cardData.image_uris) {
      return cardData.image_uris.normal;
    }

    return 'https://placehold.co/600x800/1a1a1a/e0e0e0?text=No+Image';
  };

  const imageUrl = getImageUrl(card);

  return (
    <div className="simulator-card" onClick={() => onCardClick && onCardClick(card)}>
      <img src={imageUrl} alt={card?.name || 'Card Image'} loading="lazy" />
    </div>
  );
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

// Utility to flatten deck entries into repeated card list based on quantity (same as DeckStatistics)
const expandEntries = (entries) => {
  const list = [];
  entries.forEach(({ card, quantity }) => {
    for (let i = 0; i < quantity; i++) {
      list.push(card);
    }
  });
  return list;
};

// Create a deck array from deck data (expanding quantities)
const createDeckArray = (deckData) => {
  const cards = [];

  // Add commanders (in formats where they start in play, but for simulation we include them)
  if (deckData.commanders) {
    deckData.commanders.forEach(commanderEntry => {
      if (commanderEntry && commanderEntry.card) {
        cards.push(commanderEntry.card);
      }
    });
  }

  // Add mainboard cards using the same logic as DeckStatistics
  if (deckData.mainboard) {
    cards.push(...expandEntries(deckData.mainboard));
  }

  return cards;
};

// Calculate mana curve for hand analysis
const calculateManaCurve = (cards) => {
  const curve = { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0, '7+': 0 };

  cards.forEach(card => {
    if (card) {
      // Use same property access pattern as DeckStatistics
      const cmc = card.manaValue ?? card.cmc ?? card.mana_value ?? 0;
      if (cmc >= 7) {
        curve['7+']++;
      } else {
        curve[cmc]++;
      }
    }
  });

  return curve;
};

// Count lands in hand
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
  const [loading, setLoading] = useState(false);
  const [selectedCard, setSelectedCard] = useState(null);

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
  }, [deckData]);

  // Reset simulation
  const resetSimulation = useCallback(() => {
    if (deckData) {
      const deckArray = createDeckArray(deckData);
      const shuffled = shuffleArray(deckArray);
      setShuffledDeck(shuffled);
    }
    setCurrentHand([]);
    setMulliganCount(0);
  }, [deckData]);

  // Calculate hand statistics
  const handStats = useMemo(() => {
    if (currentHand.length === 0) return null;

    const validCards = currentHand.filter(card => card);

    return {
      cardCount: currentHand.length,
      landCount: countLands(currentHand),
      manaCurve: calculateManaCurve(currentHand),
      avgCmc: validCards.length > 0 ? validCards.reduce((sum, card) => sum + (card.manaValue ?? card.cmc ?? card.mana_value ?? 0), 0) / validCards.length : 0
    };
  }, [currentHand]);

  // Deck statistics
  const deckStats = useMemo(() => {
    if (!deckData) return null;

    const allCards = createDeckArray(deckData);
    const validCards = allCards.filter(card => card);

    return {
      totalCards: allCards.length,
      landCount: countLands(allCards),
      manaCurve: calculateManaCurve(allCards),
      avgCmc: validCards.length > 0 ? validCards.reduce((sum, card) => sum + (card.manaValue ?? card.cmc ?? card.mana_value ?? 0), 0) / validCards.length : 0
    };
  }, [deckData]);

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
              <h3>📊 Deck Statistics</h3>
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
                  <span className="stat-label">Avg CMC:</span>
                  <span className="stat-value">{deckStats.avgCmc.toFixed(2)}</span>
                </div>
              </div>

              <div className="mana-curve">
                <h4>Deck Mana Curve</h4>
                <div className="curve-bars">
                  {Object.entries(deckStats.manaCurve).map(([cmc, count]) => (
                    <div key={cmc} className="curve-bar">
                      <div className="bar" style={{ height: `${(count / Math.max(...Object.values(deckStats.manaCurve))) * 60 + 5}px` }}></div>
                      <span className="bar-label">{cmc}</span>
                      <span className="bar-count">{count}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Middle Column - Simulation Controls */}
        <div className="middle-column">
          {deckData && (
            <div className="simulation-controls">
              <h3>🎯 Simulation</h3>
              <div className="control-buttons">
                <button onClick={drawOpeningHand} disabled={currentHand.length > 0}>
                  Draw Opening Hand
                </button>
                <button onClick={drawNewHand} disabled={!deckData}>
                  Draw New Hand
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

        {/* Right Column - Hand Display */}
        <div className="right-column">
          {currentHand.length > 0 && (
            <div className="hand-display">
              <h3>🃏 Current Hand ({currentHand.length} cards)</h3>

              {/* Hand Stats */}
              {handStats && (
                <div className="hand-stats">
                  <div className="stat-item">
                    <span className="stat-label">Lands:</span>
                    <span className="stat-value">{handStats.landCount}</span>
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

              {/* Hand Mana Curve */}
              <div className="hand-mana-curve">
                <h4>Hand Mana Curve</h4>
                <div className="curve-bars">
                  {Object.entries(handStats.manaCurve).map(([cmc, count]) => (
                    <div key={cmc} className="curve-bar">
                      <div className="bar" style={{ height: `${count > 0 ? (count / Math.max(...Object.values(handStats.manaCurve))) * 40 + 5 : 0}px` }}></div>
                      <span className="bar-label">{cmc}</span>
                      <span className="bar-count">{count}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Cards in Hand */}
              <div className="hand-cards">
                {currentHand.filter(card => card).map((card, index) => (
                  <Card
                    key={`${card.id}-${index}`}
                    card={card}
                    onCardClick={setSelectedCard}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Card Detail Modal */}
      {selectedCard && (
        <div className="card-modal-overlay" onClick={() => setSelectedCard(null)}>
          <div className="card-modal" onClick={e => e.stopPropagation()}>
            <button className="modal-close" onClick={() => setSelectedCard(null)}>×</button>
            <img src={selectedCard.image_uris?.large || selectedCard.image_uris?.normal} alt={selectedCard.name} />
            <div className="card-details">
              <h3>{selectedCard.name}</h3>
              <p><strong>Type:</strong> {selectedCard.type_line}</p>
              <p><strong>CMC:</strong> {selectedCard.cmc}</p>
              {selectedCard.oracle_text && <p><strong>Text:</strong> {selectedCard.oracle_text}</p>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default HandSimulator; 