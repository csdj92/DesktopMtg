import React, { useState, useEffect } from 'react';
import Card from '../Card';
import CardDetailModal from './CardDetailModal';
import './SearchControls.css';
import './SemanticSearchV2.css';

function SemanticSearchV2({
  collectionCards = null,     // Array of cards from user's collection (optional)
  onResults = null,           // Callback to pass results back to parent (optional)
  displayResults = true       // Whether this component should render its own results grid
}) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [searchStats, setSearchStats] = useState(null);
  const [resultLimit, setResultLimit] = useState(100);
  const [selectedCard, setSelectedCard] = useState(null);
  const [cardDetailLoading, setCardDetailLoading] = useState(false);
  const [fullCardCache, setFullCardCache] = useState(new Map());
  const [modelProgress, setModelProgress] = useState(null);

  useEffect(() => {
    if (window.electronAPI?.onSemanticModelProgress) {
      const handler = (p) => setModelProgress(p);
      window.electronAPI.onSemanticModelProgress(handler);
    }
  }, []);

  const defaultPlaceholder = "Describe a card (e.g., 'flying creatures that cost 3 mana')";

  const handleSearch = async () => {
    if (!query.trim()) return;

    setIsLoading(true);
    setSearchStats(null);

    try {
      const startTime = Date.now();
      console.log('Starting semantic search for:', query);
      
      // Call the semantic search API - only get partial data for performance
      const searchResults = await window.electronAPI.searchCardsSemantic(query, {
        limit: Math.max(1, resultLimit) || undefined
      });

      const searchTime = Date.now() - startTime;
      
      let finalResults = searchResults;

      // If collectionCards are provided, filter & map results to that subset
      if (Array.isArray(collectionCards) && collectionCards.length > 0) {
        // console.log('Filtering results to collection cards:', collectionCards.length);
        const nameToDistance = new Map();
        searchResults.forEach(r => {
          // Use lowercase for case-insensitive match
          nameToDistance.set(r.name.toLowerCase(), r.distance);
        });

        // Map collection cards that are present in semantic results
        finalResults = collectionCards
          .filter(c => nameToDistance.has((c.scryfallData?.name || c.name || '').toLowerCase()))
          .map(c => {
            const distance = nameToDistance.get((c.scryfallData?.name || c.name || '').toLowerCase());
            return {
              ...c,
              _distance: distance,
              _similarity: 1 - distance
            };
          })
          // Sort by semantic distance ascending (closest match first)
          .sort((a, b) => a._distance - b._distance);
      }

      console.log('Semantic search completed:', {
        query,
        resultsCount: finalResults.length,
        searchTime: `${searchTime}ms`
      });

      setResults(finalResults);

      // Notify parent if callback provided
      if (typeof onResults === 'function') {
        onResults(finalResults);
      }

      setSearchStats({
        resultCount: finalResults.length,
        searchTime,
        query: query.trim()
      });

    } catch (error) {
      console.error('Semantic search error:', error);
      setResults([]);

      if (typeof onResults === 'function') {
        onResults([]);
      }

      setSearchStats({
        resultCount: 0,
        searchTime: 0,
        query: query.trim(),
        error: error.message
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyPress = (e) => {
    if (e.key === 'Enter') {
      handleSearch();
    }
  };

  const clearSearch = () => {
    setQuery('');
    setResults([]);
    setSearchStats(null);

    if (typeof onResults === 'function') {
      onResults([]);
    }
  };

  const handleCardClick = async (partialCard) => {
    setCardDetailLoading(true);
    try {
      const cacheKey = partialCard.name;
      if (fullCardCache.has(cacheKey)) {
        setSelectedCard(fullCardCache.get(cacheKey));
        setCardDetailLoading(false);
        return;
      }

      const fullCard = await window.electronAPI.bulkDataFindCard(partialCard.name);
      if (fullCard) {
        fullCard._distance = partialCard.distance;
        fullCard._similarity = 1 - partialCard.distance;
        setFullCardCache(prev => new Map(prev).set(cacheKey, fullCard));
        setSelectedCard(fullCard);
      }
    } catch (e) {
      console.error('Error fetching full card data', e);
    } finally {
      setCardDetailLoading(false);
    }
  };

  const closeModal = () => setSelectedCard(null);

  return (
    <div className="semantic-search-v2">
      {/* Search Interface */}
      <div className="search-controls">
        <div className="search-bar">
          <input
            type="number"
            value={resultLimit}
            onChange={(e) => setResultLimit(parseInt(e.target.value) || 1)}
            min={1}
            max={1000}
            className="limit-input"
            placeholder="Max results"
            title="Max results"
          />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyPress={handleKeyPress}
            placeholder={defaultPlaceholder}
            className="search-input"
            disabled={isLoading}
          />
          <button 
            onClick={handleSearch} 
            disabled={isLoading || !query.trim()} 
            className="search-button"
          >
            {isLoading ? 'Searching...' : 'Search'}
          </button>
          {query && (
            <button 
              onClick={clearSearch} 
              className="clear-button"
              disabled={isLoading}
            >
              Clear
            </button>
          )}
        </div>
        
        <div className="search-info">
          <p className="semantic-search-hint">
            🧠 <strong>Semantic Search</strong><br/>
            Describe what the card does, not just keywords. Try: "creatures that gain life", "instant spells that counter", "artifacts that draw cards"
          </p>
        </div>
      </div>

      {/* Search Stats */}
      

      {/* Loading State */}
      {isLoading && (
        <div className="loading-state">
          {modelProgress !== null ? (
            <p>Downloading model: {(modelProgress * 100).toFixed(1)}%</p>
          ) : (
            <p>Searching...</p>
          )}
        </div>
      )}

      {/* Results */}
      {displayResults && !isLoading && results.length > 0 && (
        <div className="results-container">
          <div className="results-header">
            <h3>Search Results</h3>
            <div className="results-info">
              <span>Showing {results.length} unique cards</span>
              <small>Ranked by semantic similarity</small>
            </div>
          </div>
          
          <div className="cards-grid-simple">
            {results.map((card, index) => (
              <div key={`${card.name}-${index}`} className="card-wrapper clickable-card" onClick={() => handleCardClick(card)}>
                <Card
                  card={{
                    id: `semantic-${card.name}-${index}`,
                    name: card.name,
                            mana_cost: card.manaCost || card.mana_cost,
        type_line: card.type || card.type_line,
        oracle_text: card.text || card.oracle_text,
                    image_uris: card.image_uri ? { normal: card.image_uri } : null,
                  }}
                  disableModal={true}
                />
                <div className="similarity-score">
                  Similarity: {(1 - card.distance).toFixed(3)}
                  <small>Distance: {card.distance.toFixed(4)}</small>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Empty State */}
      {displayResults && !isLoading && !searchStats && (
        <div className="empty-state">
          <h2>🧠 Semantic Search</h2>
          <p>Search Magic cards by describing what they do</p>
          <div className="example-queries">
            <h4>Try these example searches:</h4>
            <ul>
              <li>"flying creatures that cost 3 mana"</li>
              <li>"instant spells that counter unless opponent pays"</li>
              <li>"artifacts that draw cards when they enter"</li>
              <li>"creatures with lifelink and vigilance"</li>
              <li>"red burn spells that deal damage to any target"</li>
            </ul>
          </div>
        </div>
      )}

      {/* No Results */}
      {displayResults && !isLoading && searchStats && results.length === 0 && !searchStats.error && (
        <div className="no-results">
          <h3>No results found</h3>
          <p>Try a different search query or be more descriptive</p>
        </div>
      )}

      {selectedCard && (
        <CardDetailModal card={selectedCard} onClose={closeModal} loading={cardDetailLoading} />
      )}
    </div>
  );
}

export default SemanticSearchV2; 