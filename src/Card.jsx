import React, { useState } from 'react';
import './Card.css'; // Import the dedicated stylesheet
import CardDetailModal from './components/CardDetailModal';
import useImageCache from './hooks/useImageCache';

const Card = ({
  card,
  quantity = 1,
  foil_quantity = 0,
  normal_quantity = 0,
  disableModal = false,
  showFlipButton = true,
  onFlip,
  onCardClick,
  showSynergyScore = false,
  isDraggable = false,
  onDragStart,
  onDragEnd,
  dragSource = 'hand'
}) => {
  const [currentFace, setCurrentFace] = useState(0);
  const [isHovered, setIsHovered] = useState(false);
  const [showDetails, setShowDetails] = useState(false);

  if (!card) {
    return <div className="card-container error-card"><span>Card Data Missing</span></div>;
  }

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

  const cardFace = getCurrentFace();

  // Robustly get the correct image URL for any face
  const getImageUrl = (face) => {
    if (!face) return null;
    if (face.image_uris) {
      return face.image_uris.normal || face.image_uris.large;
    }
    // Fallback for the root object if faces don't have images (rare case)
    if (card.image_uris) {
      return card.image_uris.normal || card.image_uris.large;
    }
    return null;
  };

  const rawImageUrl = getImageUrl(cardFace);
  const { imageUrl, isLoading } = useImageCache(rawImageUrl);

  const handleFlip = (e) => {
    e.stopPropagation(); // Prevent card click events when flipping
    const newFaceIndex = currentFace === 0 ? 1 : 0;
    setCurrentFace(newFaceIndex);

    // Call optional flip callback if provided
    if (onFlip) {
      onFlip(card, newFaceIndex);
    }
  };

  const handleCardClick = () => {
    if (onCardClick) {
      onCardClick(card);
      return;
    }
    if (disableModal) return;
    setShowDetails(true);
  };

  const handleDragStart = (e) => {
    if (isDraggable && onDragStart) {
      onDragStart(card, dragSource, e);
    }
  };

  const handleDragEnd = (e) => {
    if (isDraggable && onDragEnd) {
      onDragEnd(e);
    }
  };

  const handleCloseModal = () => {
    setShowDetails(false);
  };

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

  const getPriceDisplay = () => {
    const regularPrice = card.prices?.usd_regular || card.prices?.usd;
    const foilPrice = card.prices?.usd_foil;

    if (regularPrice && foilPrice) {
      return `$${regularPrice} / $${foilPrice} (F)`;
    } else if (regularPrice) {
      return `$${regularPrice}`;
    } else if (foilPrice) {
      return `$${foilPrice} (Foil)`;
    }
    return null;
  };

  const price = getPriceDisplay();

  return (
    <>
      <div
        className={`card-container ${isDraggable ? 'draggable' : ''}`}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        onClick={handleCardClick}
        draggable={isDraggable}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        style={{ cursor: isDraggable ? 'grab' : 'pointer' }}
      >
        <img
          src={imageUrl}
          alt={cardFace.name || card.name}
          className={`card-image-background ${isLoading ? 'loading' : ''}`}
          loading="lazy"
        />

        {/* Header for badges and flip button */}
        <div className="card-header">
          {isDoubleFaced(card) && showFlipButton && (
            <button
              className="flip-button"
              onClick={handleFlip}
              title={`Flip to ${currentFace === 0 ? 'back' : 'front'} face`}
              aria-label={`Flip card to show ${currentFace === 0 ? 'back' : 'front'} face`}
            >
              🔄
            </button>
          )}
          <div className="badges">
            {quantity > 1 && (
              <span className="quantity-badge">
                {quantity}x
              </span>
            )}
            {showSynergyScore && card.synergy_score !== undefined && (
              <span
                className={`synergy-badge ${getSynergyScoreClass(card.synergy_score)}`}
                title={getSynergyScoreLabel(card.synergy_score)}
              >
                {getSynergyScoreDisplay(card.synergy_score)}
              </span>
            )}
          </div>
        </div>

        {/* Footer with name, type, and price */}
        {!isHovered && (
          <div className="card-footer">
            <div className="name-and-type">
              <p className="footer-card-name">{cardFace.name || card.name}</p>
              <p className="footer-type-line">{(cardFace.type || cardFace.type_line || card.type || card.type_line || '').replace(/\?\?\?/g, '—')}</p>
            </div>
            {price && <div className="footer-price">{price}</div>}
          </div>
        )}
      </div>

      {showDetails && (
        <CardDetailModal
          card={card}
          onClose={handleCloseModal}
          foil_quantity={foil_quantity}
          normal_quantity={normal_quantity}
        />
      )}
    </>
  );
};

export default Card;
