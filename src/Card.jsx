import React, { useState } from 'react';
import './Card.css'; // Import the dedicated stylesheet
import CardDetailModal from './components/CardDetailModal';
import useImageCache from './hooks/useImageCache';

const Card = ({ card, quantity = 1, disableModal = false }) => {
  const [currentFace, setCurrentFace] = useState(0);
  const [isHovered, setIsHovered] = useState(false);
  const [showDetails, setShowDetails] = useState(false);

  if (!card) {
    return <div className="card-container error-card"><span>Card Data Missing</span></div>;
  }

  const isDoubleFaced = card.card_faces && card.card_faces.length > 1;
  const cardFace = isDoubleFaced ? card.card_faces[currentFace] : card;

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
    setCurrentFace(prev => (prev === 0 ? 1 : 0));
  };

  const handleCardClick = () => {
    if (disableModal) return;
    setShowDetails(true);
  };

  const handleCloseModal = () => {
    setShowDetails(false);
  };

  const price = card.prices?.usd ? `$${card.prices.usd}` : (card.prices?.usd_foil ? `$${card.prices.usd_foil} (Foil)`: null);

  return (
    <>
      <div 
        className="card-container"
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        onClick={handleCardClick}
      >
        <img 
          src={imageUrl} 
          alt={cardFace.name || card.name} 
          className={`card-image-background ${isLoading ? 'loading' : ''}`}
          loading="lazy"
        />

        {/* Header for badges and flip button */}
        <div className="card-header">
          {isDoubleFaced && (
            <button className="flip-button" onClick={handleFlip} title="Flip card">
              🔄
            </button>
          )}
          <div className="badges">
            {quantity > 1 && <span className="quantity-badge">{quantity}x</span>}
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

      {showDetails && <CardDetailModal card={card} onClose={handleCloseModal} />}
    </>
  );
};

export default Card;
