import React, { useEffect, useState } from 'react';
import useCardListFromText from '../hooks/useCardListFromText';
import ComboResultsSimple from './ComboResultsSimple';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from './ui/card';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { Progress } from './ui/progress';
import { Separator } from './ui/separator';
import { Tabs, TabsList, TabsTrigger, TabsContent } from './ui/tabs';
import './SpellbookExport.css';

/**
 * SpellbookExport Component
 * -------------------------
 * Props:
 *   - deck: the deck object from DeckBuilder (must include mainboard & commanders)
 *   - onResult (optional): callback(resultJson)
 */
export default function SpellbookExport({ deck, onResult }) {
  const { sendToSpellbook, data, combos, loading, error, parseErrors, deckText } = useCardListFromText(deck);
  const [showDebug, setShowDebug] = useState(false);

  // Manual combo search handler
  const handleSearchCombos = async () => {
    if(deck && (deck.mainboard.length || deck.commanders.length)){
      const result = await sendToSpellbook(true);
      if(result && onResult) onResult(result);
    }
  };

  const hasResults = combos?.results;
  const includedCount = combos?.results?.included?.length || 0;
  const almostIncludedCount = combos?.results?.almostIncluded?.length || 0;
  const colorMissingCount = combos?.results?.almostIncludedByAddingColors?.length || 0;
  const totalCombos = includedCount + almostIncludedCount + colorMissingCount;

  return (
    <div className="spellbook-export-container">
      <div className="spellbook-export-header">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="spellbook-title">
              <span className="text-2xl">🔮</span>
              Commander Spellbook
            </h3>
            <p className="spellbook-description">
              Discover powerful combos and synergies in your deck
            </p>
          </div>
          <div className="spellbook-header-actions">
            <Button 
              onClick={handleSearchCombos}
              disabled={loading || !deck || (!deck.mainboard?.length && !deck.commanders?.length)}
              className="search-combos-btn"
            >
              {loading ? (
                <>
                  <div className="spinner-small" />
                  Searching...
                </>
              ) : (
                <>
                  <span className="search-icon">🔍</span>
                  Search Combos
                </>
              )}
            </Button>
            {hasResults && (
              <Badge variant="secondary" className="px-3 py-1 bg-primary text-primary-foreground">
                {totalCombos} {totalCombos === 1 ? 'combo' : 'combos'} found
              </Badge>
            )}
          </div>
        </div>
      </div>

      <div className="spellbook-export-content">
        {/* Error State */}
        {error && (
          <div className="error-section">
            <div className="error-header">
              <span className="error-icon">⚠️</span>
              Connection Error
            </div>
            <p className="error-message">{error.message}</p>
          </div>
        )}

        {/* Parse Errors */}
        {parseErrors && parseErrors.length > 0 && (
          <div className="warning-section">
            <div className="warning-header">
              <span className="warning-icon">⚠️</span>
              Parsing Issues
            </div>
            <ul className="warning-list">
              {parseErrors.map((msg, idx) => (
                <li key={idx} className="warning-item">
                  <span className="warning-bullet">•</span>
                  {msg}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Results */}
        {hasResults && (
          <div className="results-section">
            {/* Quick Stats */}
            <div className="stats-grid">
              <div className="stat-card stat-ready">
                <div className="stat-number">{includedCount}</div>
                <div className="stat-label">Ready Combos</div>
              </div>
              <div className="stat-card stat-almost">
                <div className="stat-number">{almostIncludedCount}</div>
                <div className="stat-label">Missing 1 Piece</div>
              </div>
              <div className="stat-card stat-colors">
                <div className="stat-number">{colorMissingCount}</div>
                <div className="stat-label">Need Colors</div>
              </div>
            </div>

            <Separator />

            {/* Combo Results Tabs */}
            <Tabs defaultValue="included" className="combo-tabs">
              <TabsList className="tabs-list">
                <TabsTrigger value="included" className="tab-trigger">
                  <span className="tab-indicator tab-indicator-ready"></span>
                  Ready ({includedCount})
                </TabsTrigger>
                <TabsTrigger value="almost" className="tab-trigger">
                  <span className="tab-indicator tab-indicator-almost"></span>
                  Almost ({almostIncludedCount})
                </TabsTrigger>
                <TabsTrigger value="colors" className="tab-trigger">
                  <span className="tab-indicator tab-indicator-colors"></span>
                  Colors ({colorMissingCount})
                </TabsTrigger>
              </TabsList>
              
              <TabsContent value="included" className="tab-content">
                <ComboResultsSimple 
                  title="Ready to Use" 
                  combos={combos.results?.included}
                  emptyMessage="No complete combos found in your current deck."
                />
              </TabsContent>
              
              <TabsContent value="almost" className="tab-content">
                <ComboResultsSimple 
                  title="Missing One Piece" 
                  combos={combos.results?.almostIncluded}
                  emptyMessage="No combos are missing just one piece."
                />
              </TabsContent>
              
              <TabsContent value="colors" className="tab-content">
                <ComboResultsSimple 
                  title="Need Additional Colors" 
                  combos={combos.results?.almostIncludedByAddingColors}
                  emptyMessage="No combos are missing due to color requirements."
                />
              </TabsContent>
            </Tabs>
          </div>
        )}

        {/* Debug Section */}
        {(deckText || combos) && (
          <div className="debug-section">
            <Separator />
            <div className="debug-header">
              <h4 className="debug-title">Developer Tools</h4>
              <Button 
                variant="ghost" 
                size="sm" 
                onClick={() => setShowDebug(!showDebug)}
                className="debug-toggle"
              >
                {showDebug ? 'Hide' : 'Show'} Debug Info
              </Button>
            </div>
            
            {showDebug && (
              <div className="debug-content">
                {deckText && (
                  <div className="debug-item">
                    <label className="debug-label">
                      Deck Text for Spellbook
                    </label>
                    <textarea
                      readOnly
                      value={deckText}
                      className="debug-textarea"
                    />
                  </div>
                )}
                
                {combos && (
                  <div className="debug-item">
                    <label className="debug-label">
                      Raw API Response
                    </label>
                    <pre className="debug-json">
                      {JSON.stringify(combos, null, 2)}
                    </pre>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
} 