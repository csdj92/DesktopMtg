import React from 'react';
import './ComboResultsSimple.css';
import { Badge } from './ui/badge';

export default function ComboResultsSimple({ title, combos, emptyMessage }) {
  if (!combos || combos.length === 0) {
    return emptyMessage ? (
      <div className="empty-state">
        <div className="empty-icon">🎴</div>
        <p className="empty-message">{emptyMessage}</p>
      </div>
    ) : null;
  }

  return (
    <section className="combo-results-section">
      <div className="combo-section-header">
        <h4 className="combo-title">{title}</h4>
        <Badge variant="secondary" className="combo-count-badge">
          {combos.length}
        </Badge>
      </div>
      
      <div className="combo-list">
        {combos.map((combo, idx) => {
          const cardNames = combo.uses?.map(u => u.card?.name).filter(Boolean) || [];
          const produces = combo.produces?.map(p => p.feature?.name).filter(Boolean) || [];
          const steps = combo.description ? combo.description.split('\n').filter(Boolean) : [];
          
          // Parse prerequisites and initial card states
          const getZoneDisplayName = (zone) => {
            const zoneMap = {
              'H': 'hand',
              'B': 'battlefield', 
              'G': 'graveyard',
              'L': 'library',
              'E': 'exile'
            };
            return zoneMap[zone] || zone.toLowerCase();
          };

          const cardStates = [];
          
          // Add cards from 'uses' array
          combo.uses?.forEach(use => {
            if (use.zoneLocations && use.zoneLocations.length > 0) {
              const zones = use.zoneLocations.map(zone => getZoneDisplayName(zone)).join(' or ');
              cardStates.push(`${use.card?.name} ${zones === 'battlefield' ? 'on the' : 'in'} ${zones}`);
            }
          });
          
          // Add requirements from 'requires' array
          combo.requires?.forEach(req => {
            if (req.template?.name && req.zoneLocations && req.zoneLocations.length > 0) {
              const zones = req.zoneLocations.map(zone => getZoneDisplayName(zone)).join(' or ');
              const quantityText = req.quantity > 1 ? `${req.quantity} ` : '';
              cardStates.push(`${quantityText}${req.template.name} ${zones === 'battlefield' ? 'on the' : 'in'} ${zones}`);
            }
          });

          return (
            <div key={combo.id || idx} className="combo-item" data-hoverable>
              {/* Header: card names + produces chips */}
              <div className="combo-header">
                <div className="combo-cards-section">
                  <h5 className="combo-cards">{cardNames.join(' + ')}</h5>
                  {cardNames.length > 0 && (
                    <div className="combo-card-count">
                      {cardNames.length} {cardNames.length === 1 ? 'card' : 'cards'}
                    </div>
                  )}
                </div>

                {produces.length > 0 && (
                  <div className="combo-produces" title="Combo results">
                    {produces.map((feature, i) => (
                      <Badge key={i} variant="default" className="produce-chip">
                        {feature}
                      </Badge>
                    ))}
                  </div>
                )}
              </div>

              {/* Prerequisites/Initial Card State */}
              {(cardStates.length > 0 || combo.notablePrerequisites || combo.easyPrerequisites) && (
                <div className="combo-prerequisites">
                  <h6 className="prerequisites-title">Initial Card State</h6>
                  
                  {cardStates.length > 0 && (
                    <ul className="card-states-list">
                      {cardStates.map((state, i) => (
                        <li key={i} className="card-state-item">{state}</li>
                      ))}
                    </ul>
                  )}
                  
                  {combo.notablePrerequisites && (
                    <div className="notable-prerequisites">
                      <strong>Notable Prerequisites:</strong>
                      <p className="prerequisite-text">{combo.notablePrerequisites}</p>
                    </div>
                  )}
                  
                  {combo.easyPrerequisites && combo.easyPrerequisites !== combo.notablePrerequisites && (
                    <div className="easy-prerequisites">
                      <strong>Easy Prerequisites:</strong>
                      <p className="prerequisite-text">{combo.easyPrerequisites}</p>
                    </div>
                  )}
                </div>
              )}

              {/* Collapsible steps */}
              {steps.length > 0 && (
                <details className="combo-steps" data-collapsible>
                  <summary className="combo-steps-summary">
                    <span className="steps-label">View Steps</span>
                    <span className="steps-count">({steps.length})</span>
                  </summary>
                  <div className="combo-steps-content">
                    <ol className="steps-list">
                      {steps.map((step, i) => (
                        <li key={i} className="step-item">{step}</li>
                      ))}
                    </ol>
                  </div>
                </details>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
} 