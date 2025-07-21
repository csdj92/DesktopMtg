import React, { useMemo, useCallback } from 'react'
import Card from '../Card'
import SearchControls from './SearchControls'
import SemanticSearchV2 from './SemanticSearchV2'

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
    onSemanticResults
}) {
    // Stable toggles for search mode
    const handleRegularMode = useCallback(() => {
        setCollectionSearchMode('regular')
    }, [setCollectionSearchMode])

    const handleSemanticMode = useCallback(() => {
        setCollectionSearchMode('semantic')
    }, [setCollectionSearchMode])

    // Memoize bulkDataStats so SearchControls only sees a new object
    const bulkDataStats = useMemo(() => ({
        cardCount: filteredCollectionCards.length,
        totalCards: collectionStats?.totalCards
    }), [filteredCollectionCards.length, collectionStats?.totalCards])

    // Decide which list to render
    const cardsToShow = useMemo(() => {
        return collectionSearchMode === 'semantic'
            ? collectionSemanticResults
            : filteredCollectionCards
    }, [collectionSearchMode, collectionSemanticResults, filteredCollectionCards])

    // Build the result-count string once
    const resultCountText = useMemo(() => {
        if (collectionSearchMode === 'semantic') {
            return `Showing ${collectionSemanticResults.length} matching cards from your collection`
        }
        return `Showing ${filteredCollectionCards.length} of ${collectionStats?.totalCards || 0} cards`
    }, [
        collectionSearchMode,
        collectionSemanticResults.length,
        filteredCollectionCards.length,
        collectionStats?.totalCards
    ])

    return (
        <div className="collection-content">
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
                        <div className="stat-item">
                            <span className="stat-value">
                                {Object.keys(collectionStats.setBreakdown).length}
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
                        />
                    ))}
                </div>
            </div>
        </div>
    )
})

export default CollectionView
