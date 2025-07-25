import React, { useState, useEffect } from 'react';
import './RarityBreakdown.css';

const RarityBreakdown = () => {
    const [rarityData, setRarityData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    useEffect(() => {
        loadRarityData();
    }, []);

    const loadRarityData = async () => {
        try {
            setLoading(true);
            setError(null);
            const data = await window.electronAPI.getRarityBreakdown();
            setRarityData(data);
        } catch (error) {
            console.error('Error loading rarity data:', error);
            setError('Failed to load rarity data');
        } finally {
            setLoading(false);
        }
    };

    const getRarityColor = (rarity) => {
        const colors = {
            'mythic': '#ff8c00',
            'rare': '#ffd700',
            'uncommon': '#c0c0c0',
            'common': '#000000',
            'special': '#ff69b4'
        };
        return colors[rarity] || '#666666';
    };

    const getRarityIcon = (rarity) => {
        const icons = {
            'mythic': '🔥',
            'rare': '💎',
            'uncommon': '⚡',
            'common': '⚪',
            'special': '✨'
        };
        return icons[rarity] || '❓';
    };

    const formatRarityName = (rarity) => {
        return rarity.charAt(0).toUpperCase() + rarity.slice(1);
    };

    if (loading) {
        return (
            <div className="rarity-breakdown">
                <h3>🎯 Rarity Breakdown</h3>
                <div className="rarity-loading">
                    <div className="loading-spinner"></div>
                    <p>Loading rarity data...</p>
                </div>
            </div>
        );
    }

    if (error) {
        return (
            <div className="rarity-breakdown">
                <h3>🎯 Rarity Breakdown</h3>
                <div className="rarity-error">
                    <p>❌ {error}</p>
                    <button onClick={loadRarityData} className="retry-button">
                        🔄 Retry
                    </button>
                </div>
            </div>
        );
    }

    if (!rarityData || !rarityData.breakdown) {
        return (
            <div className="rarity-breakdown">
                <h3>🎯 Rarity Breakdown</h3>
                <div className="rarity-empty">
                    <p>No rarity data available</p>
                </div>
            </div>
        );
    }

    const maxQuantity = Math.max(...rarityData.breakdown.map(item => item.total_quantity));

    return (
        <div className="rarity-breakdown">
            <div className="rarity-header">
                <h3>🎯 Rarity Breakdown</h3>
                <button
                    className="refresh-rarity-button"
                    onClick={loadRarityData}
                    title="Refresh Rarity Data"
                >
                    🔄
                </button>
            </div>

            <div className="rarity-summary">
                <div className="summary-stat">
                    <span className="summary-value">{rarityData.totals.unique_cards}</span>
                    <span className="summary-label">Unique Cards</span>
                </div>
                <div className="summary-stat">
                    <span className="summary-value">{rarityData.totals.total_quantity}</span>
                    <span className="summary-label">Total Cards</span>
                </div>
                <div className="summary-stat">
                    <span className="summary-value">{rarityData.totals.foil_quantity}</span>
                    <span className="summary-label">Foil Cards</span>
                </div>
            </div>

            <div className="rarity-cards">
                {rarityData.breakdown.map((item) => (
                    <div key={item.rarity} className="rarity-card">
                        <div className="rarity-card-header">
                            <div className="rarity-info">
                                <span className="rarity-icon">{getRarityIcon(item.rarity)}</span>
                                <span
                                    className="rarity-name"
                                    style={{ color: getRarityColor(item.rarity) }}
                                >
                                    {formatRarityName(item.rarity)}
                                </span>
                            </div>
                            <div className="rarity-percentage">
                                {item.quantity_percentage}%
                            </div>
                        </div>

                        <div className="rarity-stats">
                            <div className="rarity-stat">
                                <span className="stat-value">{item.unique_count}</span>
                                <span className="stat-label">Unique</span>
                            </div>
                            <div className="rarity-stat">
                                <span className="stat-value">{item.total_quantity}</span>
                                <span className="stat-label">Total</span>
                            </div>
                        </div>

                        <div className="rarity-progress-bar">
                            <div
                                className="rarity-progress-fill"
                                style={{
                                    width: `${(item.total_quantity / maxQuantity) * 100}%`,
                                    backgroundColor: getRarityColor(item.rarity)
                                }}
                            ></div>
                        </div>

                        <div className="foil-breakdown">
                            <div className="foil-stat">
                                <span className="foil-icon">🌟</span>
                                <span className="foil-count">{item.foil_quantity}</span>
                                <span className="foil-label">Foil</span>
                            </div>
                            <div className="foil-stat">
                                <span className="foil-icon">⚪</span>
                                <span className="foil-count">{item.normal_quantity}</span>
                                <span className="foil-label">Normal</span>
                            </div>
                        </div>
                    </div>
                ))}
            </div>

            <div className="rarity-visual">
                <h4>Visual Distribution</h4>
                <div className="rarity-chart">
                    {rarityData.breakdown.map((item) => (
                        <div
                            key={item.rarity}
                            className="chart-segment"
                            style={{
                                width: `${item.quantity_percentage}%`,
                                backgroundColor: getRarityColor(item.rarity)
                            }}
                            title={`${formatRarityName(item.rarity)}: ${item.quantity_percentage}%`}
                        >
                            {parseFloat(item.quantity_percentage) > 10 && (
                                <span className="chart-label">
                                    {item.quantity_percentage}%
                                </span>
                            )}
                        </div>
                    ))}
                </div>
                <div className="chart-legend">
                    {rarityData.breakdown.map((item) => (
                        <div key={item.rarity} className="legend-item">
                            <div
                                className="legend-color"
                                style={{ backgroundColor: getRarityColor(item.rarity) }}
                            ></div>
                            <span className="legend-text">
                                {formatRarityName(item.rarity)} ({item.quantity_percentage}%)
                            </span>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
};

export default RarityBreakdown;