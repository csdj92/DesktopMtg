import React from 'react';
import './CollectionStatsPage.css';
import StatsOverview from './StatsOverview';
import RarityBreakdown from './RarityBreakdown';
import CardTypeAnalysis from './CardTypeAnalysis';

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

                <div className="stats-placeholder">
                    <p>More detailed statistics will be implemented in future tasks...</p>
                    <ul>
                        <li>Mana curve analysis</li>
                        <li>Format legality</li>
                        <li>Collection value metrics</li>
                        <li>Tribal analysis</li>
                        <li>And much more!</li>
                    </ul>
                </div>
            </div>
        </div>
    );
};

export default CollectionStatsPage;