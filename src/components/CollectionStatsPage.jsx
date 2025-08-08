import React from 'react';
import './CollectionStatsPage.css';
import StatsOverview from './StatsOverview';
import RarityBreakdown from './RarityBreakdown';
import CardTypeAnalysis from './CardTypeAnalysis';
import CollectionValueMetrics from './CollectionValueMetrics';
import FormatLegality from './FormatLegality';
import TribalAnalysis from './TribalAnalysis';

const CollectionStatsPage = ({ collectionCards, collectionStats, onRefreshStats }) => {
    return (
        <div className="collection-stats-page">
            <div className="stats-header">
                <h2>📊 Collection Statistics</h2>
                <button
                    className="refresh-stats-button"
                    onClick={onRefreshStats}
                    title="Refresh Statistics"
                >
                    🔄 Refresh
                </button>
            </div>

            <div className="stats-content">
                <StatsOverview
                    collectionStats={collectionStats}
                    onRefreshStats={onRefreshStats}
                />

                <RarityBreakdown />

                <CardTypeAnalysis />

                <CollectionValueMetrics collectionCards={collectionCards} />

                <FormatLegality collectionCards={collectionCards} />

                <TribalAnalysis collectionCards={collectionCards} />
            </div>
        </div>
    );
};

export default CollectionStatsPage;