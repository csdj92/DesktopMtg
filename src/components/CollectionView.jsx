import React, { useMemo, useCallback, useState, useEffect, useRef } from 'react';
import Card from '../Card';
import SearchControls from './SearchControls';
import SemanticSearchV2 from './SemanticSearchV2';
import CardDetailModal from './CardDetailModal';
import useCardNavigation from '../hooks/useCardNavigation';

const CollectionView = React.memo(function CollectionView({
    // Collection data
    collectionCards,
    collectionStats,
    collectionLoading,

    // Search state
    collectionSearchMode,
    setCollectionSearchMode,
    collectionSemanticResults,
    collectionSemanticLoading,
    filteredCollectionCards,

    // Actions
    onCollectionSearch,
    onRefreshCollection,
    onSyncCollection,
    onSemanticResults,
    onLoadMore, // New prop for loading more cards
}) {
    // Navigation state
    const [selectedCard, setSelectedCard] = useState(null);
    const [navigationContext, setNavigationContext] = useState('collection');

    // Virtualization state
    const CARDS_PER_PAGE = 200;
    const [displayedCount, setDisplayedCount] = useState(CARDS_PER_PAGE);
    const [isLoadingMore, setIsLoadingMore] = useState(false);
    const loader = useRef(null);

    // Reset displayed count when search mode or results change
    useEffect(() => {
        setDisplayedCount(CARDS_PER_PAGE);
    }, [collectionSearchMode, filteredCollectionCards.length, collectionSemanticResults.length]);

    const loadMoreCards = useCallback(() => {
        const currentCards = collectionSearchMode === 'semantic'
            ? collectionSemanticResults
            : filteredCollectionCards;

        if (displayedCount >= currentCards.length) return;

        setIsLoadingMore(true);

        // Simulate loading delay for better UX
        setTimeout(() => {
            setDisplayedCount(prev => Math.min(prev + CARDS_PER_PAGE, currentCards.length));
            setIsLoadingMore(false);
        }, 100);
    }, [collectionSearchMode, collectionSemanticResults, filteredCollectionCards, displayedCount]);

    const handleObserver = useCallback((entities) => {
        const target = entities[0];
        if (target.isIntersecting && !isLoadingMore) {
            loadMoreCards();
        }
    }, [isLoadingMore, loadMoreCards]);

    // Intersection observer for infinite scroll
    useEffect(() => {
        const options = {
            root: null,
            rootMargin: "20px",
            threshold: 1.0
        };

        const observer = new IntersectionObserver(handleObserver, options);
        if (loader.current) {
            observer.observe(loader.current);
        }

        return () => {
            if (loader.current) {
                observer.unobserve(loader.current);
            }
        };
    }, [handleObserver]);


    // Get the current card list for navigation (use full list, not just displayed)
    const currentCardList = useMemo(() => {
        return collectionSearchMode === 'semantic'
            ? collectionSemanticResults
            : filteredCollectionCards;
    }, [collectionSearchMode, collectionSemanticResults, filteredCollectionCards]);

    // Decide which list to render (virtualized)
    const cardsToShow = useMemo(() => {
        const allCards = collectionSearchMode === 'semantic'
            ? collectionSemanticResults
            : filteredCollectionCards;

        return allCards.slice(0, displayedCount);
    }, [collectionSearchMode, collectionSemanticResults, filteredCollectionCards, displayedCount]);

    // Stable toggles for search mode
    const handleRegularMode = useCallback(() => {
        setCollectionSearchMode('regular');
    }, [setCollectionSearchMode]);

    const handleSemanticMode = useCallback(() => {
        setCollectionSearchMode('semantic');
    }, [setCollectionSearchMode]);

    // Card click handler
    const handleCardClick = useCallback((cardData, context = 'collection') => {
        // Find the full card object from the current list for navigation
        const fullCard = currentCardList.find(c =>
            c.cardKey === cardData.cardKey ||
            c.scryfallData?.id === cardData.id
        ) || cardData;

        setSelectedCard(fullCard);
        setNavigationContext(context);
    }, [currentCardList]);

    const handleCloseModal = useCallback(() => {
        setSelectedCard(null);
    }, []);

    // Memoize bulkDataStats so SearchControls only sees a new object
    const bulkDataStats = useMemo(() => ({
        cardCount: filteredCollectionCards.length,
        totalCards: collectionStats?.totalCards
    }), [filteredCollectionCards.length, collectionStats?.totalCards]);

    // Keyboard navigation using custom hook
    const navigation = useCardNavigation(
        currentCardList,
        selectedCard,
        setSelectedCard,
        !!selectedCard // Modal is open when selectedCard exists
    );

    // Build the result-count string once
    const resultCountText = useMemo(() => {
        const totalCards = collectionSearchMode === 'semantic'
            ? collectionSemanticResults.length
            : filteredCollectionCards.length;

        if (collectionSearchMode === 'semantic') {
            return `Showing ${Math.min(displayedCount, totalCards)} of ${totalCards} matching cards from your collection`;
        }
        return `Showing ${Math.min(displayedCount, totalCards)} of ${collectionStats?.totalCards || 0} cards`;
    }, [
        collectionSearchMode,
        collectionSemanticResults.length,
        filteredCollectionCards.length,
        collectionStats?.totalCards,
        displayedCount
    ]);

    return (
        <div className="collection-content">
            {/* Card Detail Modal with Navigation */}
            {selectedCard && (
                <CardDetailModal
                    card={selectedCard.scryfallData || selectedCard}
                    onClose={handleCloseModal}
                    onNavigatePrevious={navigation.navigateToPrevious}
                    onNavigateNext={navigation.navigateToNext}
                    hasPrevious={navigation.hasPrevious}
                    hasNext={navigation.hasNext}
                    currentIndex={navigation.currentIndex}
                    totalCards={navigation.totalCards}
                    foil_quantity={selectedCard.foil_quantity || 0}
                    normal_quantity={selectedCard.normal_quantity || 0}
                />
            )}

            <div className="collection-header">
                <div className="collection-title-row">
                    <h2>📚 My Collection</h2>
                    <div className="collection-buttons">
                        <button
                            className="refresh-button"
                            onClick={onSyncCollection}
                            title="Sync collections to main database"
                            disabled={collectionLoading}
                        >
                            🔄 Sync
                        </button>
                        <button
                            className="refresh-button"
                            onClick={onRefreshCollection}
                            title="Refresh collection data"
                            disabled={collectionLoading}
                        >
                            🔄 Refresh
                        </button>
                    </div>
                </div>
                {collectionStats && (
                    <div className="collection-stats">
                        <div className="stat-item">
                            <span className="stat-value">{collectionStats.totalCards}</span>
                            <span className="stat-label">Total Cards</span>
                        </div>
                        <div className="stat-item">
                            <span className="stat-value">{collectionStats.uniqueCards}</span>
                            <span className="stat-label">Unique Cards</span>
                        </div>
                        <div className="stat-item">
                            <span className="stat-value">${collectionStats.totalValue.toFixed(2)}</span>
                            <span className="stat-label">Est. Value</span>
                        </div>
                        {collectionStats.regularValue > 0 && (
                            <div className="stat-item">
                                <span className="stat-value">${collectionStats.regularValue.toFixed(2)}</span>
                                <span className="stat-label">Regular Value</span>
                            </div>
                        )}
                        {collectionStats.foilValue > 0 && (
                            <div className="stat-item">
                                <span className="stat-value">${collectionStats.foilValue.toFixed(2)}</span>
                                <span className="stat-label">Foil Value</span>
                            </div>
                        )}
                        <div className="stat-item">
                            <span className="stat-value">
                                {Object.keys(collectionStats.setBreakdown || {}).length}
                            </span>
                            <span className="stat-label">Sets</span>
                        </div>
                    </div>
                )}
            </div>

            <div className="collection-search">
                <div className="search-mode-toggle">
                    <button
                        className={`mode-button ${collectionSearchMode === 'regular' ? 'active' : ''}`}
                        onClick={handleRegularMode}
                    >
                        🔍 Regular Search
                    </button>
                    <button
                        className={`mode-button ${collectionSearchMode === 'semantic' ? 'active' : ''}`}
                        onClick={handleSemanticMode}
                    >
                        🧠 Semantic Search
                    </button>
                </div>

                {collectionSearchMode === 'regular' ? (
                    <SearchControls
                        onSearch={onCollectionSearch}
                        bulkDataStats={bulkDataStats}
                    />
                ) : (
                    <SemanticSearchV2
                        collectionCards={collectionCards}
                        displayResults={false}
                        onResults={onSemanticResults}
                    />
                )}
            </div>

            <div className="collection-results">
                <div className="results-header">
                    <h3>Your Cards</h3>
                    <span className="result-count">{resultCountText}</span>
                </div>

                {collectionSemanticLoading && (
                    <div className="loading-state">
                        <div className="spinner"></div>
                        <p>Searching your collection...</p>
                    </div>
                )}

                <div className="cards-grid">
                    {cardsToShow.map((card, idx) => (
                        <Card
                            key={`${card.cardKey}-${idx}`}
                            card={card.scryfallData}
                            quantity={card.quantity}
                            foil_quantity={card.foil_quantity}
                            normal_quantity={card.normal_quantity}
                            onCardClick={(card) => handleCardClick(card, 'collection')}
                        />
                    ))}
                </div>

                {/* Loading states */}
                {collectionLoading && (
                    <div className="loading-state">
                        <div className="spinner"></div>
                        <p>Loading collection...</p>
                    </div>
                )}

                {isLoadingMore && (
                    <div className="loading-state">
                        <div className="spinner"></div>
                        <p>Loading more cards...</p>
                    </div>
                )}

                {/* Intersection observer target */}
                {(() => {
                    const totalCards = collectionSearchMode === 'semantic'
                        ? collectionSemanticResults.length
                        : filteredCollectionCards.length;
                    return displayedCount < totalCards ? <div ref={loader} style={{ height: '20px' }} /> : null;
                })()}
            </div>
        </div>
    );
});

export default CollectionView;
