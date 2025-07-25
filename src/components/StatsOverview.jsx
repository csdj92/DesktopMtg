import React, { useState, useEffect } from 'react';
import './StatsOverview.css';

const StatsOverview = ({ collectionStats, onRefreshStats }) => {
    const [rarityData, setRarityData] = useState(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        loadRarityData();
    }, []);

    const loadRarityData = async () => {
        try {
            setLoading(true);
            const data = await window.electronAPI.getRarityBreakdown();
            setRarityData(data);
        } catch (error) {
            console.error('Error loading rarity data:', error);
        } finally {
            setLoading(false);
        }
    };

    const calculateFoilStats = () => {
        if (!rarityData?.totals) return { foil: 0, normal: 0 };
        return {
            foil: rarityData.totals.foil_quantity || 0,
            normal: rarityData.totals.normal_quantity || 0
        };
    };

    const foilStats = calculateFoilStats();

    if (loading) {
        return (
            <div className="stats-overview">
                <h3>📊 Collection Overview</h3>
                <div className="stats-grid">
                    <div className="stat-card loading">
                        <div className="stat-value">...</div>
                        <div className="stat-label">Loading...</div>
                    </div>
                    <div className="stat-card loading">
                        <div className="stat-value">...</div>
                        <div className="stat-label">Loading...</div>
                    </div>
                    <div className="stat-card loading">
                        <div className="stat-value">...</div>
                        <div className="stat-label">Loading...</div>
                    </div>
                    <div className="stat-card loading">
                        <div className="stat-value">...</div>
                        <div className="stat-label">Loading...</div>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="stats-overview">
            <div className="stats-overview-header">
                <h3>📊 Collection Overview</h3>
                <button
                    className="refresh-overview-button"
                    onClick={() => {
                        onRefreshStats();
                        loadRarityData();
                    }}
                    title="Refresh Overview"
                >
                    🔄
                </button>
            </div>

            <div className="stats-grid">
                <div className="stat-card">
                    <div className="stat-value">{rarityData?.totals?.total_quantity || 0}</div>
                    <div className="stat-label">Total Cards</div>
                    <div className="stat-detail">Physical copies owned</div>
                </div>

                <div className="stat-card">
                    <div className="stat-value">{rarityData?.totals?.unique_cards || 0}</div>
                    <div className="stat-label">Unique Cards</div>
                    <div className="stat-detail">Different card names</div>
                </div>

                <div className="stat-card">
                    <div className="stat-value">${(collectionStats?.totalValue || 0).toFixed(2)}</div>
                    <div className="stat-label">Estimated Value</div>
                    <div className="stat-detail">Current market price</div>
                </div>

                <div className="stat-card">
                    <div className="stat-value">{Object.keys(collectionStats?.setBreakdown || {}).length}</div>
                    <div className="stat-label">Sets Represented</div>
                    <div className="stat-detail">Different expansions</div>
                </div>
            </div>

            <div className="foil-breakdown">
                <h4>🌟 Foil vs Regular Cards</h4>
                <div className="foil-stats-grid">
                    <div className="foil-stat-card">
                        <div className="foil-stat-value">{foilStats.foil}</div>
                        <div className="foil-stat-label">Foil Cards</div>
                        <div className="foil-stat-percentage">
                            {rarityData?.totals?.total_quantity > 0
                                ? ((foilStats.foil / rarityData.totals.total_quantity) * 100).toFixed(1)
                                : 0}%
                        </div>
                    </div>

                    <div className="foil-stat-card">
                        <div className="foil-stat-value">{foilStats.normal}</div>
                        <div className="foil-stat-label">Regular Cards</div>
                        <div className="foil-stat-percentage">
                            {rarityData?.totals?.total_quantity > 0
                                ? ((foilStats.normal / rarityData.totals.total_quantity) * 100).toFixed(1)
                                : 0}%
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default StatsOverview;