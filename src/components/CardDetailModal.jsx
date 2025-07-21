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
  commanderColorIdentity = null
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

  // Deck management state
  const [deckActionStatus, setDeckActionStatus] = useState('idle'); // 'idle' | 'adding' | 'removing' | 'success' | 'error'

  useEffect(() => {
    let isMounted = true;
    (async () => {
      try {
        const res = await window.electronAPI.collectionGetCardQuantity(card.name);
        if (isMounted) {
          setOwnedQty(res?.total || 0);
        }
      } catch (err) {
        console.error('Ownership query failed:', err);
      }
    })();
    return () => { isMounted = false; };
  }, [card.name]);

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

  const cardFace = card.card_faces ? card.card_faces[0] : card;
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
        set_code: card.setCode,
        set_name: card.setName,
        collector_number: card.number,
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
        set_code: card.setCode,
        collector_number: card.number,
        foil: 'normal'
      };

      const res = await window.electronAPI.collectionUpdateCardQuantity(collectionInput.trim(), cardKey, newQty);
      if (res.success) {
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

  const performDelete = async () => {
    try {
      const cardKey = {
        card_name: card.name,
        set_code: card.setCode,
        collector_number: card.number,
        foil: 'normal'
      };

      let res;
      if (deleteMode === 'all') {
        res = await window.electronAPI.collectionDeleteCard(collectionInput.trim(), cardKey);
        if (res.success) {
          alert('All copies deleted from collection');
          setOwnedQty(0);
          resetForm();
          onClose();
        }
      } else {
        // Delete specific quantity
        const deleteQty = parseInt(quantityInput, 10);
        if (isNaN(deleteQty) || deleteQty <= 0) {
          return alert('Invalid quantity to delete');
        }
        
        const currentQty = ownedQty || 0;
        if (deleteQty > currentQty) {
          return alert(`Cannot delete ${deleteQty} copies when you only own ${currentQty}`);
        }
        
        const newQty = currentQty - deleteQty;
        res = await window.electronAPI.collectionUpdateCardQuantity(collectionInput.trim(), cardKey, newQty);
        if (res.success) {
          alert(`${deleteQty} cop${deleteQty === 1 ? 'y' : 'ies'} deleted from collection`);
          setOwnedQty(newQty);
          resetForm();
        }
      }

      if (!res || !res.success) {
        alert(res?.error || 'Operation failed');
      }
    } catch (err) {
      console.error(err);
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
              alt={card.name}
              className={isLoading ? 'loading' : ''}
              loading="lazy"
            />
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
            <h2>{card.name}</h2>
            <p>{(card.type || card.type_line || '').replace(/\?\?\?/g, '—')}</p>
            <p><strong>Set:</strong> {card.set_name}</p>
            <p><strong>Rarity:</strong> {card.rarity}</p>
            {ownedQty !== null && (
              <p><strong>Owned:</strong> {ownedQty} {ownedQty === 1 ? 'copy' : 'copies'}</p>
            )}
            <p><strong>Collector Number:</strong> {card.number}</p>

            {card.prices?.usd && <p><strong>Price:</strong> ${card.prices.usd}</p>}
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

              <button className="add-to-collection-btn" onClick={() => { setActionMode('update'); }}>
                ✏️ Update
              </button>

              <button className="add-to-collection-btn delete-btn" onClick={() => { setActionMode('delete'); }}>
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
                <input
                  type="text"
                  value={collectionInput}
                  onChange={(e) => setCollectionInput(e.target.value)}
                  placeholder="Collection name"
                />
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