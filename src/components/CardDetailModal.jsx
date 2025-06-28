import React, { useState, useEffect } from 'react';
import './CardDetailModal.css';

const CardDetailModal = ({
  card,
  onClose,
  // Navigation props
  onNavigatePrevious,
  onNavigateNext,
  hasPrevious = false,
  hasNext = false,
  currentIndex = -1,
  totalCards = 0
}) => {
  if (!card) return null;

  const [addStatus, setAddStatus] = useState(null);
  const [ownedQty, setOwnedQty] = useState(null);
  const [actionMode, setActionMode] = useState(null); // 'add' | 'update'
  const [collectionInput, setCollectionInput] = useState('My Collection');
  const [quantityInput, setQuantityInput] = useState(1);
  const [showRulings, setShowRulings] = useState(false);

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
    if (!face) return 'https://placehold.co/488x680/1a1a1a/e0e0e0?text=No+Image';
    if (face.image_uris) {
      return face.image_uris.normal || face.image_uris.large;
    }
    if (card.image_uris) {
      return card.image_uris.normal || card.image_uris.large;
    }
    return 'https://placehold.co/488x680/1a1a1a/e0e0e0?text=No+Image';
  };

  const cardFace = card.card_faces ? card.card_faces[0] : card;
  const imageUrl = getImageUrl(cardFace);

  const resetForm = () => {
    setCollectionInput('My Collection');
    setQuantityInput(1);
    setActionMode(null);
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

  const performUpdateOrDelete = async () => {
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

      let res;
      if (newQty === 0) {
        res = await window.electronAPI.collectionDeleteCard(collectionInput.trim(), cardKey);
        if (res.success) {
          alert('Card deleted from collection');
          setOwnedQty(prev => Math.max(0, (prev || 0) - 1));
          resetForm();
          onClose();
        }
      } else {
        res = await window.electronAPI.collectionUpdateCardQuantity(collectionInput.trim(), cardKey, newQty);
        if (res.success) {
          alert('Quantity updated');
          setOwnedQty(newQty); // simplistic update
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
            <img src={imageUrl} alt={card.name} />
            <div className="legalities">
              <h3>Legalities</h3>
              <ul>
                {Object.entries(legalities).map(([format, legality]) => (
                  <li key={format}>
                    <span className="format-name">{format.replace(/_/g, ' ')}:</span>
                    <span className={`legality-status ${legality}`}>{legality.replace(/_/g, ' ')}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
          <div className="modal-card-details">
            <h2>{card.name}</h2>
            <p>{(card.type || card.type_line || '').replace(/\?\?\?/g, '—')}</p>
            <p><strong>Set:</strong> {card.setName}</p>
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

            <div className="external-links">
              {card.related_uris?.gatherer && <a href={card.related_uris.gatherer} target="_blank" rel="noopener noreferrer">Gatherer</a>}
              {card.purchase_uris?.tcgplayer && <a href={card.purchase_uris.tcgplayer} target="_blank" rel="noopener noreferrer">Buy on TCGPlayer</a>}
              {card.purchase_uris?.cardmarket && <a href={card.purchase_uris.cardmarket} target="_blank" rel="noopener noreferrer">Buy on Cardmarket</a>}
              {card.purchase_uris?.cardkingdom && <a href={card.purchase_uris.cardkingdom} target="_blank" rel="noopener noreferrer">Buy on Card Kingdom</a>}
              {card.related_uris?.edhrec && <a href={card.related_uris.edhrec} target="_blank" rel="noopener noreferrer">EDHREC</a>}
            </div>

            <button className="add-to-collection-btn" onClick={() => { setActionMode('add'); }}>
              {addStatus || '➕ Add to Collection'}
            </button>

            <button className="add-to-collection-btn" onClick={() => { setActionMode('update'); }}>
              ✏️ Update / 🗑️ Delete
            </button>

            {actionMode && (
              <div className="collection-form">
                <h4>{actionMode === 'add' ? 'Add to Collection' : 'Update / Delete'}</h4>
                <input
                  type="text"
                  value={collectionInput}
                  onChange={(e) => setCollectionInput(e.target.value)}
                  placeholder="Collection name"
                />
                <input
                  type="number"
                  value={quantityInput}
                  onChange={(e) => setQuantityInput(e.target.value)}
                  min="0"
                  placeholder="Quantity (0 to delete)"
                />
                <div className="form-buttons">
                  <button onClick={actionMode === 'add' ? performAdd : performUpdateOrDelete}>
                    {actionMode === 'add' ? 'Add' : 'Confirm'}
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