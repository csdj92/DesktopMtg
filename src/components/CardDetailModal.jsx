import React, { useState, useEffect } from 'react';
import './CardDetailModal.css';
import useImageCache from '../hooks/useImageCache';
import PatternAnalysis from './PatternAnalysis';

const CardDetailModal = ({
  card,
  onClose,
  // Navigation props
  onNavigatePrevious,
  onNavigateNext,
  hasPrevious = false,
  hasNext = false,
  currentIndex = -1,
  totalCards = 0,
  // Deck management props
  isInDeck = false,
  onAddToDeck,
  onRemoveFromDeck,
  deckFormat = 'commander',
  commanderColorIdentity = null,
  // Collection quantities
  foil_quantity = 0,
  normal_quantity = 0
}) => {
  if (!card) return null;

  const [addStatus, setAddStatus] = useState(null);
  const [ownedQty, setOwnedQty] = useState(null);
  const [actionMode, setActionMode] = useState(null); // 'add' | 'update' | 'delete'
  const [collectionInput, setCollectionInput] = useState('My Collection');
  const [quantityInput, setQuantityInput] = useState(1);
  const [deleteMode, setDeleteMode] = useState('specific'); // 'specific' | 'all'
  const [showRulings, setShowRulings] = useState(false);
  const [showLegalities, setShowLegalities] = useState(false);
  const [collectionNames, setCollectionNames] = useState([]);
  const [currentFace, setCurrentFace] = useState(0);

  // Deck management state
  const [deckActionStatus, setDeckActionStatus] = useState('idle'); // 'idle' | 'adding' | 'removing' | 'success' | 'error'

  // Helper function to detect double-faced cards
  const isDoubleFaced = (card) => {
    // Check for Scryfall format (card_faces array)
    if (card && card.card_faces && Array.isArray(card.card_faces) && card.card_faces.length > 1) {
      return true;
    }

    // Check for new database format (layout indicates double-faced)
    if (card && card.layout) {
      const doubleFacedLayouts = [
        'saga',
        'adventure',
        'class',
        'aftermath',
        'split',
        'flip',
        'transform',
        'prototype',
        'meld',
        'leveler',
        'mutate',
        'vanguard',
        'planar',
        'scheme',
        'modal_dfc',
        'case',
        'reversible_card',
        'augment',
        'host',
      ];
      if (doubleFacedLayouts.includes(card.layout)) {
        return true;
      }
    }

    // Check if there are face-specific fields indicating multiple faces
    if (card && card.faceName && card.faceName !== card.name) {
      return true;
    }

    return false;
  };

  // Helper function to get current face data
  const getCurrentFace = () => {
    if (isDoubleFaced(card)) {
      // Handle Scryfall format with card_faces array
      if (card.card_faces && Array.isArray(card.card_faces) && card.card_faces.length > 1) {
        const faceIndex = Math.max(0, Math.min(currentFace, card.card_faces.length - 1));
        return card.card_faces[faceIndex];
      }

      // Handle new database format - for now, return the card itself
      // TODO: Implement proper face switching for new database format
      return card;
    }
    return card;
  };

  const handleFlip = (e) => {
    e.stopPropagation(); // Prevent card click events when flipping
    const newFaceIndex = currentFace === 0 ? 1 : 0;
    setCurrentFace(newFaceIndex);
  };

  useEffect(() => {
    let isMounted = true;
    (async () => {
      try {
        // Get quantity from user collections
        const res = await window.electronAPI.collectionGetCardQuantity(card.name);

        // Check if the card is marked as collected in the main database
        let isCollected = false;
        if (card.id || card.uuid) {
          try {
            // We don't have a direct API to check if a card is collected, so we'll search for it
            const collectedCards = await window.electronAPI.collectionGetSimple({
              limit: 1,
              search: card.name
            });

            isCollected = collectedCards && collectedCards.some(c =>
              (c.id === card.id || c.uuid === card.uuid) && c.collected
            );


            // If there's a mismatch (0 quantity but still marked as collected), fix it
            if ((res?.total === 0 || !res?.total) && isCollected && (card.id || card.uuid)) {
              console.log('Fixing collection sync issue for card:', card.name);
              await window.electronAPI.collectionMarkCard(card.id || card.uuid, false);
              isCollected = false;
            }
          } catch (err) {
            console.error('Error checking card collected status:', err);
          }
        }

        if (isMounted) {
          setOwnedQty(res?.total || 0);
        }
      } catch (err) {
        console.error('Ownership query failed:', err);
      }
    })();
    return () => { isMounted = false; };
  }, [card.name, card.id, card.uuid]);

  // Load collection names for the dropdown
  useEffect(() => {
    let isMounted = true;
    (async () => {
      try {
        const names = await window.electronAPI.getCollectionNames();
        if (isMounted) {
          setCollectionNames(names);
        }
      } catch (err) {
        console.error('Failed to load collection names:', err);
      }
    })();
    return () => { isMounted = false; };
  }, []);

  const handleBackdropClick = (e) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  // The user provided this structure, so I'll use it
  const legalities = card.legalities || {};

  const getImageUrl = (face) => {
    if (!face) return null;
    if (face.image_uris) {
      return face.image_uris.normal || face.image_uris.large;
    }
    if (card.image_uris) {
      return card.image_uris.normal || card.image_uris.large;
    }
    return null;
  };

  const cardFace = getCurrentFace();
  const rawImageUrl = getImageUrl(cardFace);
  const { imageUrl, isLoading } = useImageCache(rawImageUrl);

  const resetForm = () => {
    setCollectionInput('My Collection');
    setQuantityInput(1);
    setActionMode(null);
    setDeleteMode('specific');
  };

  const performAdd = async () => {
    try {
      setAddStatus('Adding...');
      const quantity = parseInt(quantityInput, 10) || 1;
      const result = await window.electronAPI.collectionAddCard(collectionInput.trim(), {
        card_name: card.name,
        set_code: card.set_code || card.setCode || card.set,
        set_name: card.set_name || card.setName,
        collector_number: card.collector_number || card.collectorNumber || card.number,
        foil: 'normal',
        rarity: card.rarity,
        quantity
      });

      if (result && result.success) {
        setAddStatus('Added!');
        setOwnedQty(prev => (prev || 0) + quantity);
        setTimeout(() => setAddStatus(null), 2000);
        resetForm();
      } else {
        setAddStatus('Error');
        alert(result.error || 'Failed to add card');
      }
    } catch (err) {
      console.error('Failed to add card to collection:', err);
      setAddStatus('Error');
      alert(err.message || 'Failed to add card');
    }
  };

  const performUpdate = async () => {
    try {
      const newQty = parseInt(quantityInput, 10);
      if (isNaN(newQty) || newQty < 0) {
        return alert('Invalid quantity');
      }

      const cardKey = {
        card_name: card.name,
        set_code: card.set_code || card.setCode || card.set,
        collector_number: card.collector_number || card.collectorNumber || card.number,
        foil: card.foil || 'normal',
        uuid: card.uuid
      };

      const collectionNames = await window.electronAPI.getCollectionNames();


      const res = await window.electronAPI.collectionUpdateCardQuantity(collectionInput.trim(), cardKey, newQty);
      if (res && res.success) {
        alert('Quantity updated');
        setOwnedQty(newQty);
        resetForm();
      } else {
        alert(res?.error || 'Operation failed');
      }
    } catch (err) {
      console.error(err);
      alert(err.message || 'Operation failed');
    }
  };

  // Function to force sync collection with main database
  const syncCollectionWithDatabase = async () => {
    try {
      console.log('Syncing collection with main database...');
      const result = await window.electronAPI.collectionSync();
      if (result && result.success) {
        console.log('Collection sync completed successfully');
        return true;
      } else {
        console.error('Collection sync failed:', result?.error);
        return false;
      }
    } catch (error) {
      console.error('Collection sync error:', error);
      return false;
    }
  };

  const performDelete = async () => {
    try {
      const cardKey = {
        card_name: card.name,
        set_code: card.set_code || card.setCode || card.set,
        collector_number: card.collector_number || card.collectorNumber || card.number,
        foil: 'normal'
      };

      console.log('Deleting card:', cardKey);
      console.log('Collection:', collectionInput.trim());
      console.log('Mode:', deleteMode);

      let res;
      if (deleteMode === 'all') {
        console.log('Attempting to delete all copies...');

        // First, mark the card as not collected in the main database
        if (card.id || card.uuid) {
          try {
            await window.electronAPI.collectionMarkCard(card.id || card.uuid, false);
            console.log('Card marked as not collected in main database');
          } catch (markError) {
            console.error('Error marking card as not collected:', markError);
          }
        }

        // Then delete from collection
        res = await window.electronAPI.collectionDeleteCard(collectionInput.trim(), cardKey);
        console.log('Delete response:', res);

        // Force sync to ensure database consistency
        await syncCollectionWithDatabase();

        if (res && res.success) {
          alert('All copies deleted from collection');
          setOwnedQty(0);
          resetForm();
          onClose();
        } else {
          // Check if the card doesn't exist in the collection
          if (ownedQty === 0 || ownedQty === null) {
            // If the card shows 0 quantity but might still be marked as collected in the main DB
            if (card.id || card.uuid) {
              await window.electronAPI.collectionMarkCard(card.id || card.uuid, false);
              alert('Card removed from collection');
              onClose();
            } else {
              alert('This card is not in the collection');
            }
          } else {
            alert('Failed to delete card from collection');
          }
        }
      } else {
        // Delete specific quantity
        const deleteQty = parseInt(quantityInput, 10);
        if (isNaN(deleteQty) || deleteQty <= 0) {
          return alert('Invalid quantity to delete');
        }

        // Get current quantity from the database
        try {
          const currentQtyResult = await window.electronAPI.collectionGetCardQuantity(card.name, {
            set_code: cardKey.set_code,
            collector_number: cardKey.collector_number,
            foil: cardKey.foil
          });

          const currentQty = currentQtyResult?.total || 0;
          console.log(`Current quantity in database: ${currentQty}`);

          if (currentQty === 0) {
            // If quantity is 0 but card might still be marked as collected
            if (card.id || card.uuid) {
              await window.electronAPI.collectionMarkCard(card.id || card.uuid, false);
              alert('Card removed from collection');
              onClose();
              return;
            } else {
              alert('This card is not in the collection');
              return;
            }
          }

          if (deleteQty > currentQty) {
            return alert(`Cannot delete ${deleteQty} copies when you only own ${currentQty}`);
          }

          const newQty = currentQty - deleteQty;
          console.log(`Attempting to update quantity from ${currentQty} to ${newQty}...`);

          // If removing all copies, mark as not collected in main database
          if (newQty === 0 && (card.id || card.uuid)) {
            try {
              await window.electronAPI.collectionMarkCard(card.id || card.uuid, false);
              console.log('Card marked as not collected in main database');
            } catch (markError) {
              console.error('Error marking card as not collected:', markError);
            }
          }

          res = await window.electronAPI.collectionUpdateCardQuantity(collectionInput.trim(), cardKey, newQty);
          console.log('Update quantity response:', res);

          // Force sync to ensure database consistency
          await syncCollectionWithDatabase();

          if (res && res.success) {
            alert(`${deleteQty} cop${deleteQty === 1 ? 'y' : 'ies'} deleted from collection`);
            setOwnedQty(newQty);
            resetForm();

            // If quantity is now 0, close the modal
            if (newQty === 0) {
              onClose();
            }
          } else {
            alert('Failed to update card quantity');
          }
        } catch (error) {
          console.error('Error getting current quantity:', error);
          alert('Failed to get current card quantity. Please try again.');
          return;
        }
      }
    } catch (err) {
      console.error('Delete operation error:', err);
      alert(err.message || 'Operation failed');
    }
  };

  // Deck management validation logic
  const validateDeckAction = (card) => {
    if (!card) return { valid: false, error: 'Invalid card data' };

    // Check color identity for commander format
    if (deckFormat === 'commander' && commanderColorIdentity) {
      if (card.color_identity && card.color_identity.length > 0) {
        const isValidColorIdentity = card.color_identity.every(color =>
          commanderColorIdentity.has(color)
        );
        if (!isValidColorIdentity) {
          return {
            valid: false,
            error: `This card is outside your commander's color identity. Card colors: ${card.color_identity.join(', ')}`
          };
        }
      }
    }

    // Check singleton rules for commander format
    if (deckFormat === 'commander') {
      const typeLine = (card.type || card.type_line || '').toLowerCase();
      const isBasicLand = typeLine.includes('basic') && typeLine.includes('land');

      if (!isBasicLand && isInDeck) {
        return {
          valid: false,
          error: 'Commander format allows only one copy of each non-basic card'
        };
      }
    }

    return { valid: true };
  };

  // Deck management click handlers
  const handleAddToDeck = async () => {
    if (!onAddToDeck) return;

    const validation = validateDeckAction(card);
    if (!validation.valid) {
      setDeckActionStatus('error');
      alert(validation.error);
      setTimeout(() => setDeckActionStatus('idle'), 2000);
      return;
    }

    try {
      setDeckActionStatus('adding');
      await onAddToDeck(card);
      setDeckActionStatus('success');
      setTimeout(() => setDeckActionStatus('idle'), 1500);
    } catch (error) {
      console.error('Failed to add card to deck:', error);
      setDeckActionStatus('error');
      alert('Failed to add card to deck');
      setTimeout(() => setDeckActionStatus('idle'), 2000);
    }
  };

  const handleRemoveFromDeck = async () => {
    if (!onRemoveFromDeck) return;

    try {
      setDeckActionStatus('removing');
      await onRemoveFromDeck(card.id);
      setDeckActionStatus('success');
      setTimeout(() => setDeckActionStatus('idle'), 1500);
    } catch (error) {
      console.error('Failed to remove card from deck:', error);
      setDeckActionStatus('error');
      alert('Failed to remove card from deck');
      setTimeout(() => setDeckActionStatus('idle'), 2000);
    }
  };

  return (
    <div className="modal-backdrop" onClick={handleBackdropClick}>
      <div className="modal-content">
        <div className="modal-header">
          <button className="modal-close-button" onClick={onClose}>&times;</button>
          {totalCards > 1 && (
            <div className="navigation-info">
              <span className="card-position">
                {currentIndex + 1} of {totalCards}
              </span>
              <div className="navigation-buttons">
                <button
                  className="nav-button nav-previous"
                  onClick={onNavigatePrevious}
                  disabled={!hasPrevious}
                  title="Previous card (←)"
                >
                  ←
                </button>
                <button
                  className="nav-button nav-next"
                  onClick={onNavigateNext}
                  disabled={!hasNext}
                  title="Next card (→)"
                >
                  →
                </button>
              </div>
            </div>
          )}
        </div>
        <div className="modal-body">
          <div className="modal-card-image">
            <img
              src={imageUrl}
              alt={cardFace.name || card.name}
              className={isLoading ? 'loading' : ''}
              loading="lazy"
            />
            {isDoubleFaced(card) && (
              <button
                className="flip-button modal-flip-button"
                onClick={handleFlip}
                title={`Flip to ${currentFace === 0 ? 'back' : 'front'} face`}
                aria-label={`Flip card to show ${currentFace === 0 ? 'back' : 'front'} face`}
              >
                🔄
              </button>
            )}
            <div className="legalities">
              <button onClick={() => setShowLegalities(!showLegalities)} className="legalities-toggle-btn">
                {showLegalities ? 'Hide' : 'Show'} Legalities ({Object.keys(legalities).length})
              </button>
              {showLegalities && (
                <ul>
                  {Object.entries(legalities).map(([format, legality]) => (
                    <li key={format}>
                      <span className="format-name">{format.replace(/_/g, ' ')}:</span>
                      <span className={`legality-status ${legality}`}>{legality.replace(/_/g, ' ')}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
          <div className="modal-card-details">
            <h2>{cardFace.name || card.name}</h2>
            <p>{(cardFace.type || cardFace.type_line || card.type || card.type_line || '').replace(/\?\?\?/g, '—')}</p>
            <p><strong>Set:</strong> {card.set_name}</p>
            <p><strong>Rarity:</strong> {card.rarity}</p>
            {ownedQty !== null && (
              <div className="owned-quantity">
                <p><strong>Owned:</strong> {ownedQty} {ownedQty === 1 ? 'copy' : 'copies'}</p>
                {(foil_quantity > 0 || normal_quantity > 0) && (
                  <div className="foil-breakdown-details">
                    {normal_quantity > 0 && (
                      <span className="quantity-item normal">
                        {normal_quantity} Normal
                      </span>
                    )}
                    {foil_quantity > 0 && (
                      <span className="quantity-item foil">
                        {foil_quantity} Foil ★
                      </span>
                    )}
                  </div>
                )}
              </div>
            )}
            <p><strong>Collector Number:</strong> {card.number}</p>

            {(card.prices?.usd_regular || card.prices?.usd) && (
              <p><strong>Regular Price:</strong> ${card.prices?.usd_regular || card.prices?.usd}</p>
            )}
            {card.prices?.usd_foil && <p><strong>Foil Price:</strong> ${card.prices.usd_foil}</p>}

            <p><strong>Artist:</strong> {card.artist}</p>

            {card.rulings && card.rulings.length > 0 && (
              <div className="rulings-section">
                <button onClick={() => setShowRulings(!showRulings)} className="rulings-toggle-btn">
                  {showRulings ? 'Hide' : 'Show'} Rulings ({card.rulings.length})
                </button>
                {showRulings && (
                  <ul className="rulings-list">
                    {card.rulings.map((ruling, index) => (
                      <li key={index}>
                        <span className="ruling-date">{new Date(ruling.date).toLocaleDateString()}</span>
                        <p className="ruling-text">{ruling.text}</p>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            {/* 🔧 NEW: Advanced Pattern Analysis */}
            <PatternAnalysis card={card} />

            <div className="external-links">
              {card.related_uris?.gatherer && <a href={card.related_uris.gatherer} target="_blank" rel="noopener noreferrer">Gatherer</a>}
              {card.purchase_uris?.tcgplayer && <a href={card.purchase_uris.tcgplayer} target="_blank" rel="noopener noreferrer">Buy on TCGPlayer</a>}
              {card.purchase_uris?.cardmarket && <a href={card.purchase_uris.cardmarket} target="_blank" rel="noopener noreferrer">Buy on Cardmarket</a>}
              {card.purchase_uris?.cardkingdom && <a href={card.purchase_uris.cardkingdom} target="_blank" rel="noopener noreferrer">Buy on Card Kingdom</a>}
              {card.related_uris?.edhrec && <a href={card.related_uris.edhrec} target="_blank" rel="noopener noreferrer">EDHREC</a>}
            </div>

            {/* Deck Management Buttons */}
            {(onAddToDeck || onRemoveFromDeck) && (
              <div className="deck-actions">
                <h4>Deck Management</h4>
                <div className="deck-action-buttons">
                  {!isInDeck ? (
                    <button
                      className={`deck-action-btn add-to-deck ${deckActionStatus === 'adding' ? 'loading' : ''}`}
                      onClick={handleAddToDeck}
                      disabled={deckActionStatus === 'adding' || deckActionStatus === 'removing'}
                    >
                      {deckActionStatus === 'adding' ? '⏳ Adding...' :
                        deckActionStatus === 'success' ? '✅ Added!' :
                          '➕ Add to Deck'}
                    </button>
                  ) : (
                    <button
                      className={`deck-action-btn remove-from-deck ${deckActionStatus === 'removing' ? 'loading' : ''}`}
                      onClick={handleRemoveFromDeck}
                      disabled={deckActionStatus === 'adding' || deckActionStatus === 'removing'}
                    >
                      {deckActionStatus === 'removing' ? '⏳ Removing...' :
                        deckActionStatus === 'success' ? '✅ Removed!' :
                          '➖ Remove from Deck'}
                    </button>
                  )}
                </div>
                {deckActionStatus === 'error' && (
                  <div className="deck-action-error">
                    ❌ Operation failed. Please try again.
                  </div>
                )}
              </div>
            )}

            <div className="collection-buttons-group">
              <button className="add-to-collection-btn" onClick={() => { setActionMode('add'); }}>
                {addStatus || '➕ Add'}
              </button>

              <button
                className="add-to-collection-btn"
                onClick={() => {
                  if (ownedQty === 0 || ownedQty === null) {
                    alert('This card is not in the collection');
                    return;
                  }
                  setActionMode('update');
                }}
                disabled={ownedQty === 0 || ownedQty === null}
                title={ownedQty === 0 || ownedQty === null ? 'Card not in collection' : 'Update quantity'}
              >
                ✏️ Update
              </button>

              <button
                className="add-to-collection-btn delete-btn"
                onClick={async () => {
                  // If quantity is 0 but card might still be in the database
                  if (ownedQty === 0 || ownedQty === null) {
                    if (card.id || card.uuid) {
                      // Try to fix the sync issue by marking as not collected
                      try {
                        await window.electronAPI.collectionMarkCard(card.id || card.uuid, false);
                        await syncCollectionWithDatabase();
                        alert('Card removed from collection');
                        onClose();
                      } catch (error) {
                        console.error('Error fixing collection sync:', error);
                        alert('This card is not in the collection');
                      }
                    } else {
                      alert('This card is not in the collection');
                    }
                    return;
                  }
                  setActionMode('delete');
                }}
                disabled={false} // Never disable the remove button to allow fixing sync issues
                title="Remove from collection"
              >
                🗑️ Remove
              </button>
            </div>

            {actionMode && (
              <div className="collection-form">
                <h4>
                  {actionMode === 'add' ? 'Add to Collection' :
                    actionMode === 'update' ? 'Update Quantity' :
                      'Remove from Collection'}
                </h4>
                <select
                  value={collectionInput}
                  onChange={(e) => setCollectionInput(e.target.value)}
                  style={{ width: '100%', padding: '8px', marginBottom: '8px' }}
                >
                  <option value="">Select a collection...</option>
                  {collectionNames.map((name, index) => (
                    <option key={index} value={name}>
                      {name}
                    </option>
                  ))}
                </select>
                {actionMode === 'delete' && (
                  <div className="delete-mode-selector">
                    <label>
                      <input
                        type="radio"
                        name="deleteMode"
                        value="specific"
                        checked={deleteMode === 'specific'}
                        onChange={(e) => setDeleteMode(e.target.value)}
                      />
                      Remove specific quantity
                    </label>
                    <label>
                      <input
                        type="radio"
                        name="deleteMode"
                        value="all"
                        checked={deleteMode === 'all'}
                        onChange={(e) => setDeleteMode(e.target.value)}
                      />
                      Remove all copies
                    </label>
                  </div>
                )}
                {(actionMode === 'add' || actionMode === 'update' || (actionMode === 'delete' && deleteMode === 'specific')) && (
                  <input
                    type="number"
                    value={quantityInput}
                    onChange={(e) => setQuantityInput(e.target.value)}
                    min={actionMode === 'delete' ? 1 : 0}
                    placeholder={actionMode === 'delete' ? 'Quantity to remove' : 'Quantity'}
                  />
                )}
                <div className="form-buttons">
                  <button onClick={
                    actionMode === 'add' ? performAdd :
                      actionMode === 'update' ? performUpdate :
                        performDelete
                  }>
                    {actionMode === 'add' ? 'Add' :
                      actionMode === 'update' ? 'Update' :
                        'Remove'}
                  </button>
                  <button onClick={resetForm}>Cancel</button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default CardDetailModal; 