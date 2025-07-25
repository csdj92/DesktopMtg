import React, { useState, useEffect } from 'react';
import './CardTypeAnalysis.css';

const CardTypeAnalysis = () => {
    const [typeData, setTypeData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    useEffect(() => {
        loadTypeData();
    }, []);

    const loadTypeData = async () => {
        try {
            setLoading(true);
            setError(null);
            const data = await window.electronAPI.getCardTypeDistribution();
            setTypeData(data);
        } catch (error) {
            console.error('Error loading card type data:', error);
            setError('Failed to load card type data');
        } finally {
            setLoading(false);
        }
    };

    const getTypeIcon = (type) => {
        const icons = {
            'Creature': '🐉',
            'Instant': '⚡',
            'Sorcery': '🔮',
            'Enchantment': '✨',
            'Artifact': '⚙️',
            'Planeswalker': '👑',
            'Land': '🏔️',
            'Battle': '⚔️',
            'Other': '❓'
        };
        return icons[type] || '❓';
    };

    const getTypeColor = (type) => {
        const colors = {
            'Creature': '#4CAF50',
            'Instant': '#2196F3',
            'Sorcery': '#9C27B0',
            'Enchantment': '#FF9800',
            'Artifact': '#795548',
            'Planeswalker': '#E91E63',
            'Land': '#8BC34A',
            'Battle': '#F44336',
            'Other': '#607D8B'
        };
        return colors[type] || '#607D8B';
    };

    const calculateTokenGenerators = () => {
        // This is a placeholder calculation - in a real implementation,
        // you would need to analyze oracle text for token generation
        if (!typeData?.type_distribution) return 0;

        // Rough estimate: assume some percentage of creatures and sorceries generate tokens
        const creatures = typeData.type_distribution.find(t => t.type === 'Creature');
        const sorceries = typeData.type_distribution.find(t => t.type === 'Sorcery');
        const enchantments = typeData.type_distribution.find(t => t.type === 'Enchantment');

        const creatureTokens = creatures ? Math.floor(creatures.total_quantity * 0.15) : 0;
        const sorceryTokens = sorceries ? Math.floor(sorceries.total_quantity * 0.25) : 0;
        const enchantmentTokens = enchantments ? Math.floor(enchantments.total_quantity * 0.10) : 0;

        return creatureTokens + sorceryTokens + enchantmentTokens;
    };

    if (loading) {
        return (
            <div className="card-type-analysis">
                <h3>🃏 Card Type Analysis</h3>
                <div className="type-loading">
                    <div className="loading-spinner"></div>
                    <p>Loading card type data...</p>
                </div>
            </div>
        );
    }

    if (error) {
        return (
            <div className="card-type-analysis">
                <h3>🃏 Card Type Analysis</h3>
                <div className="type-error">
                    <p>❌ {error}</p>
                    <button onClick={loadTypeData} className="retry-button">
                        🔄 Retry
                    </button>
                </div>
            </div>
        );
    }

    if (!typeData || !typeData.type_distribution) {
        return (
            <div className="card-type-analysis">
                <h3>🃏 Card Type Analysis</h3>
                <div className="type-empty">
                    <p>No card type data available</p>
                </div>
            </div>
        );
    }

    const maxQuantity = Math.max(...typeData.type_distribution.map(item => item.total_quantity));
    const tokenGenerators = calculateTokenGenerators();

    return (
        <div className="card-type-analysis">
            <div className="type-header">
                <h3>🃏 Card Type Analysis</h3>
                <button
                    className="refresh-type-button"
                    onClick={loadTypeData}
                    title="Refresh Card Type Data"
                >
                    🔄
                </button>
            </div>

            <div className="type-summary">
                <div className="summary-stat">
                    <span className="summary-value">{typeData.totals.unique_cards}</span>
                    <span className="summary-label">Unique Cards</span>
                </div>
                <div className="summary-stat">
                    <span className="summary-value">{typeData.totals.total_quantity}</span>
                    <span className="summary-label">Total Cards</span>
                </div>
                <div className="summary-stat">
                    <span className="summary-value">{tokenGenerators}</span>
                    <span className="summary-label">Token Generators</span>
                </div>
            </div>

            <div className="type-distribution">
                <h4>Card Type Distribution</h4>
                <div className="type-cards">
                    {typeData.type_distribution.map((item) => (
                        <div key={item.type} className="type-card">
                            <div className="type-card-header">
                                <div className="type-info">
                                    <span className="type-icon">{getTypeIcon(item.type)}</span>
                                    <span
                                        className="type-name"
                                        style={{ color: getTypeColor(item.type) }}
                                    >
                                        {item.type}
                                    </span>
                                </div>
                                <div className="type-percentage">
                                    {item.quantity_percentage}%
                                </div>
                            </div>

                            <div className="type-stats">
                                <div className="type-stat">
                                    <span className="stat-value">{item.unique_count}</span>
                                    <span className="stat-label">Unique</span>
                                </div>
                                <div className="type-stat">
                                    <span className="stat-value">{item.total_quantity}</span>
                                    <span className="stat-label">Total</span>
                                </div>
                            </div>

                            <div className="type-progress-bar">
                                <div
                                    className="type-progress-fill"
                                    style={{
                                        width: `${(item.total_quantity / maxQuantity) * 100}%`,
                                        backgroundColor: getTypeColor(item.type)
                                    }}
                                ></div>
                            </div>
                        </div>
                    ))}
                </div>
            </div>

            {typeData.creature_breakdown && typeData.creature_breakdown.length > 0 && (
                <div className="creature-breakdown">
                    <h4>🐉 Creature Analysis</h4>
                    <div className="creature-stats">
                        {typeData.creature_breakdown.map((item) => (
                            <div key={item.type} className="creature-stat-card">
                                <div className="creature-stat-header">
                                    <span className="creature-stat-icon">
                                        {item.type.includes('Legendary') ? '👑' : '🐾'}
                                    </span>
                                    <span className="creature-stat-name">{item.type}</span>
                                </div>
                                <div className="creature-stat-values">
                                    <div className="creature-stat-value">
                                        <span className="value">{item.unique_count}</span>
                                        <span className="label">Unique</span>
                                    </div>
                                    <div className="creature-stat-value">
                                        <span className="value">{item.total_quantity}</span>
                                        <span className="label">Total</span>
                                    </div>
                                </div>
                                <div className="creature-percentage">
                                    {typeData.totals.total_quantity > 0
                                        ? ((item.total_quantity / typeData.totals.total_quantity) * 100).toFixed(1)
                                        : 0}% of collection
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            <div className="type-visual">
                <h4>Visual Distribution</h4>
                <div className="type-chart">
                    {typeData.type_distribution.map((item) => (
                        <div
                            key={item.type}
                            className="chart-segment"
                            style={{
                                width: `${item.quantity_percentage}%`,
                                backgroundColor: getTypeColor(item.type)
                            }}
                            title={`${item.type}: ${item.quantity_percentage}%`}
                        >
                            {parseFloat(item.quantity_percentage) > 8 && (
                                <span className="chart-label">
                                    {getTypeIcon(item.type)}
                                </span>
                            )}
                        </div>
                    ))}
                </div>
                <div className="chart-legend">
                    {typeData.type_distribution.map((item) => (
                        <div key={item.type} className="legend-item">
                            <div
                                className="legend-color"
                                style={{ backgroundColor: getTypeColor(item.type) }}
                            ></div>
                            <span className="legend-text">
                                {getTypeIcon(item.type)} {item.type} ({item.quantity_percentage}%)
                            </span>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
};

export default CardTypeAnalysis;