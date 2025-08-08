import React, { useState, useEffect } from 'react';
import './StrategyTester.css';

const StrategyTester = ({ strategyComparison, availableStrategies, activeStrategy, onStrategyChange }) => {
  const [selectedStrategy, setSelectedStrategy] = useState(activeStrategy);
  const [showComparison, setShowComparison] = useState(false);
  const [showStats, setShowStats] = useState(true);
  const [isExpanded, setIsExpanded] = useState(true);

  useEffect(() => {
    setSelectedStrategy(activeStrategy);
  }, [activeStrategy]);

  const handleStrategyChange = async (strategy) => {
    setSelectedStrategy(strategy);
    if (onStrategyChange) {
      await onStrategyChange(strategy);
    }
  };

  const strategyLabels = {
    primary_fallback: 'Primary/Fallback',
    weighted_70_30: 'Weighted 70/30',
    weighted_50_50: 'Weighted 50/50', 
    weighted_30_70: 'Weighted 30/70',
    max_score: 'Max Score',
    average: 'Average',
    multiplicative: 'Multiplicative',
    additive: 'Additive',
    semantic_only: 'Semantic Only',
    keyword_only: 'Keyword Only',
    smart_hybrid: 'Smart Hybrid'
  };

  const strategyDescriptions = {
    primary_fallback: 'Use semantic if available, otherwise keyword',
    weighted_70_30: '70% semantic + 30% keyword',
    weighted_50_50: '50% semantic + 50% keyword',
    weighted_30_70: '30% semantic + 70% keyword', 
    max_score: 'Take the higher of the two scores',
    average: 'Simple average of both scores',
    multiplicative: 'Multiply scores (rewards cards good in both)',
    additive: 'Add scores together',
    semantic_only: 'Use only semantic similarity',
    keyword_only: 'Use only keyword matching',
    smart_hybrid: 'Intelligent hybrid with confidence-based weighting and keyword relevance'
  };

  if (!strategyComparison || !availableStrategies) {
    return (
      <div className="strategy-tester">
        <p>No strategy comparison data available. Generate recommendations first.</p>
      </div>
    );
  }

  return (
    <div className="strategy-tester">
      <div className="strategy-header">
        <h3>🧪 Strategy Testing</h3>
        <div className="header-buttons">
          <button 
            className="toggle-main-btn"
            onClick={() => setIsExpanded(!isExpanded)}
          >
            {isExpanded ? 'Collapse' : 'Expand'} All
          </button>
          {isExpanded && (
            <button 
              className="toggle-comparison-btn"
              onClick={() => setShowComparison(!showComparison)}
            >
              {showComparison ? 'Hide' : 'Show'} Comparison
            </button>
          )}
        </div>
      </div>

      {isExpanded && (
        <>
          {/* Active Strategy Selector */}
          <div className="active-strategy-section">
            <label htmlFor="strategy-select">Active Strategy:</label>
            <select 
              id="strategy-select"
              value={selectedStrategy}
              onChange={(e) => handleStrategyChange(e.target.value)}
              className="strategy-select"
            >
              {availableStrategies.map(strategy => (
                <option key={strategy} value={strategy}>
                  {strategyLabels[strategy] || strategy}
                </option>
              ))}
            </select>
            <p className="strategy-description">
              {strategyDescriptions[selectedStrategy]}
            </p>
          </div>

          {/* Strategy Comparison */}
          {showComparison && (
            <div className="strategy-comparison">
              <h4>Top 5 Recommendations by Strategy</h4>
              <div className="comparison-grid">
                {availableStrategies.map(strategy => (
                  <div 
                    key={strategy} 
                    className={`strategy-column ${strategy === selectedStrategy ? 'active' : ''}`}
                  >
                    <h5>{strategyLabels[strategy] || strategy}</h5>
                    <div className="card-list">
                      {(strategyComparison[strategy] || []).slice(0, 5).map((card, index) => (
                        <div key={index} className="card-item">
                          <div className="card-name">{card.name}</div>
                          <div className="card-scores">
                            <span className="total-score">Score: {card.score}</span>
                            <div className="sub-scores">
                              <span className="semantic">S: {card.semantic}</span>
                              <span className="keyword">K: {card.keyword}</span>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Strategy Statistics */}
          <div className="strategy-stats">
            <div className="stats-header">
              <h4>Strategy Statistics</h4>
              <button 
                className="toggle-stats-btn"
                onClick={() => setShowStats(!showStats)}
              >
                {showStats ? 'Hide' : 'Show'} Statistics
              </button>
            </div>
            {showStats && (
              <div className="stats-grid">
                {availableStrategies.map(strategy => {
                  const cards = strategyComparison[strategy] || [];
                  const avgScore = cards.length > 0 
                    ? (cards.reduce((sum, card) => sum + parseFloat(card.score), 0) / cards.length).toFixed(3)
                    : '0.000';
                  const maxScore = cards.length > 0 
                    ? Math.max(...cards.map(card => parseFloat(card.score))).toFixed(3)
                    : '0.000';
                  
                  return (
                    <div key={strategy} className={`stat-item ${strategy === selectedStrategy ? 'active' : ''}`}>
                      <div className="stat-label">{strategyLabels[strategy]}</div>
                      <div className="stat-values">
                        <span>Avg: {avgScore}</span>
                        <span>Max: {maxScore}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
};

export default StrategyTester; 