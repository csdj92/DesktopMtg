import React, { useState, useEffect } from 'react';
import './PatternAnalysis.css';

/**
 * PatternAnalysis Component - Displays parsed oracle text patterns
 * Shows triggers, engines, synergies, keywords, and mechanical relationships
 */
const PatternAnalysis = ({ card, showSynergyWith = null, onPatternClick = null }) => {
  const [patterns, setPatterns] = useState(null);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    if (card && card.name) {
      fetchPatterns();
    }
  }, [card]);

  const fetchPatterns = async () => {
    if (!card?.name) return;
    
    setLoading(true);
    try {
      const result = await window.electronAPI.testOraclePatternAnalysis(card.name);
      if (result.success) {
        setPatterns(result.patterns);
      }
    } catch (error) {
      console.error('Failed to fetch pattern analysis:', error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="pattern-analysis loading">
        <div className="loading-spinner"></div>
        <span>Analyzing oracle text patterns...</span>
      </div>
    );
  }

  if (!patterns) {
    return null;
  }

  const hasAnyPatterns = patterns.triggers?.length > 0 || 
                        patterns.engines?.length > 0 || 
                        patterns.typeSynergies?.tribal?.length > 0 ||
                        patterns.typeSynergies?.equipment?.length > 0 ||
                        patterns.keywords?.length > 0 ||
                        Object.keys(patterns.resources || {}).length > 0;

  if (!hasAnyPatterns) {
    return (
      <div className="pattern-analysis empty">
        <span className="empty-message">No advanced patterns detected</span>
      </div>
    );
  }

  return (
    <div className="pattern-analysis">
      <div 
        className="pattern-header" 
        onClick={() => setExpanded(!expanded)}
      >
        <h4>⚙️ Mechanical Patterns</h4>
        <button className="expand-toggle">
          {expanded ? '−' : '+'}
        </button>
      </div>

      {expanded && (
        <div className="pattern-content">
          
          {/* Triggered Abilities */}
          {patterns.triggers?.length > 0 && (
            <div className="pattern-section">
              <h5>🔔 Triggered Abilities</h5>
              <div className="pattern-items">
                {patterns.triggers.map((trigger, index) => (
                  <div key={index} className={`pattern-item trigger-${trigger.type}`}>
                    <div className="pattern-icon">
                      {trigger.type === 'enters_battlefield' && '⭐'}
                      {trigger.type === 'dies_or_leaves' && '💀'}
                      {trigger.type === 'attacks' && '⚔️'}
                      {trigger.type === 'cast_spell' && '✨'}
                    </div>
                    <div className="pattern-details">
                      <span className="pattern-type">
                        {trigger.type.replace(/_/g, ' ').toUpperCase()}
                      </span>
                      {trigger.affects?.length > 0 && (
                        <div className="affects-list">
                          {trigger.affects.map((affect, i) => (
                            <span key={i} className={`affect-tag ${affect.category}`}>
                              {affect.type}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Mechanical Engines */}
          {patterns.engines?.length > 0 && (
            <div className="pattern-section">
              <h5>🔄 Mechanical Engines</h5>
              <div className="pattern-items">
                {patterns.engines.map((engine, index) => (
                  <div key={index} className={`pattern-item engine-${engine.type}`}>
                    <div className="pattern-icon">
                      {engine.type === 'discard_draw' && '🎴'}
                      {engine.type === 'sacrifice_engine' && '⚰️'}
                      {engine.type === 'tap_engine' && '🔃'}
                    </div>
                    <div className="pattern-details">
                      <span className="pattern-type">
                        {engine.type.replace(/_/g, ' ').toUpperCase()}
                      </span>
                      {engine.optional && <span className="modifier">Optional</span>}
                      {engine.conditional && <span className="modifier">Conditional</span>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Tribal Synergies */}
          {patterns.typeSynergies?.tribal?.length > 0 && (
            <div className="pattern-section">
              <h5>🏰 Tribal Synergies</h5>
              <div className="pattern-items">
                {patterns.typeSynergies.tribal.map((tribal, index) => (
                  <div key={index} className="pattern-item tribal-synergy">
                    <div className="pattern-icon">🛡️</div>
                    <div className="pattern-details">
                      <span className="pattern-type">{tribal.type.toUpperCase()}</span>
                      <div className="synergy-strength">
                        <span className="strength-label">Strength:</span>
                        <div className="strength-bar">
                          <div 
                            className="strength-fill" 
                            style={{ width: `${(tribal.strength / 5) * 100}%` }}
                          ></div>
                        </div>
                        <span className="strength-value">{tribal.strength}/5</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Equipment Synergies */}
          {patterns.typeSynergies?.equipment?.length > 0 && (
            <div className="pattern-section">
              <h5>⚔️ Equipment Synergies</h5>
              <div className="pattern-items">
                {patterns.typeSynergies.equipment.map((equip, index) => (
                  <div key={index} className="pattern-item equipment-synergy">
                    <div className="pattern-icon">🗡️</div>
                    <div className="pattern-details">
                      <span className="pattern-type">{equip.type.replace(/_/g, ' ').toUpperCase()}</span>
                      <span className="strength-badge">Strength: {equip.strength}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Keywords */}
          {patterns.keywords?.length > 0 && (
            <div className="pattern-section">
              <h5>⚡ Keywords</h5>
              <div className="keywords-grid">
                {patterns.keywords.map((keyword, index) => (
                  <div key={index} className="keyword-item">
                    <span className="keyword-name">{keyword.keyword}</span>
                    {keyword.grants && <span className="grants-modifier">grants</span>}
                    {keyword.count > 1 && <span className="count-badge">{keyword.count}x</span>}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Resource Effects */}
          {Object.keys(patterns.resources || {}).length > 0 && (
            <div className="pattern-section">
              <h5>💎 Resource Effects</h5>
              <div className="resource-grid">
                {patterns.resources.cardDraw > 0 && (
                  <div className="resource-item">
                    <span className="resource-icon">📚</span>
                    <span>Draw {patterns.resources.cardDraw}</span>
                  </div>
                )}
                {patterns.resources.discard > 0 && (
                  <div className="resource-item">
                    <span className="resource-icon">🗑️</span>
                    <span>Discard {patterns.resources.discard}</span>
                  </div>
                )}
                {patterns.resources.manaGeneration && (
                  <div className="resource-item">
                    <span className="resource-icon">💰</span>
                    <span>Mana Generation</span>
                  </div>
                )}
                {patterns.resources.lifegain > 0 && (
                  <div className="resource-item">
                    <span className="resource-icon">❤️</span>
                    <span>Lifegain {patterns.resources.lifegain}</span>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Interaction Patterns */}
          {Object.keys(patterns.interaction || {}).length > 0 && (
            <div className="pattern-section">
              <h5>⚡ Interaction</h5>
              <div className="interaction-grid">
                {patterns.interaction.destruction > 0 && (
                  <div className="interaction-item">
                    <span className="interaction-icon">💥</span>
                    <span>Destruction ({patterns.interaction.destruction})</span>
                  </div>
                )}
                {patterns.interaction.exile > 0 && (
                  <div className="interaction-item">
                    <span className="interaction-icon">🌀</span>
                    <span>Exile ({patterns.interaction.exile})</span>
                  </div>
                )}
                {patterns.interaction.counterspells && (
                  <div className="interaction-item">
                    <span className="interaction-icon">🚫</span>
                    <span>Counterspells</span>
                  </div>
                )}
                {patterns.interaction.bounce && (
                  <div className="interaction-item">
                    <span className="interaction-icon">🔄</span>
                    <span>Bounce</span>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default PatternAnalysis; 