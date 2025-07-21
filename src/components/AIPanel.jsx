import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './ui/tabs';
import { Separator } from './ui/separator';
import { ScrollArea } from './ui/scroll-area';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from './ui/tooltip';
import { 
  Brain, 
  Lightbulb, 
  TrendingUp, 
  Target, 
  Zap, 
  AlertCircle, 
  CheckCircle,
  Loader2,
  Sparkles
} from 'lucide-react';
import './AIPanel.css';
import CardDetailModal from './CardDetailModal';

// Global state to track LLM initialization across all AIPanel instances
let globalLlmInitialized = false;
let globalLlmInitializing = false;

const AIPanel = ({ deck, commander, onCardSuggestion, onClose, recommendations, deckArchetype, deckAnalysis, format }) => {
  const [analysis, setAnalysis] = useState(null);
  const [suggestions, setSuggestions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [llmInitialized, setLlmInitialized] = useState(globalLlmInitialized);
  const [activeTab, setActiveTab] = useState('analysis');
  const [selectedCard, setSelectedCard] = useState(null);
  const [cardDetailLoading, setCardDetailLoading] = useState(false);

  useEffect(() => {
    if (!globalLlmInitialized && !globalLlmInitializing) {
      initializeLLM();
    } else if (globalLlmInitialized) {
      setLlmInitialized(true);
    }
  }, []);

  useEffect(() => {
    if (llmInitialized && deck && deck.length > 0) {
      analyzeDeck();
    }
  }, [llmInitialized, deck, commander]);

  useEffect(() => {
    if (typeof analysis === 'string') {
      try {
        setAnalysis(JSON.parse(analysis));
      } catch {
        // fallback: leave as string
      }
    }
  }, [analysis]);

  

  const analyzeDeck = async () => {
    if (!llmInitialized || !deck || deck.length === 0) return;

    setLoading(true);
    setError(null);

    try {
      const deckList = deck.map(card => `${card.quantity}x ${card.name}`).join('\n');
      const commanderText = commander ? `Commander: ${commander.name}` : '';
      const formatText = format ? `Format: ${format}` : '';
      
      // Include existing recommendations and analysis if available
      const existingRecommendationsText = recommendations && recommendations.length > 0 
        ? `\n\nExisting Recommendations from Deck Builder:\n${recommendations.slice(0, 10).map(rec => `- ${rec.name}: ${rec.reason || 'Recommended card'}`).join('\n')}`
        : '';
      
      const archetypeText = deckArchetype 
        ? `\nDeck Archetype: ${deckArchetype.name || deckArchetype}`
        : '';
      
      const existingAnalysisText = deckAnalysis && deckAnalysis.summary
        ? `\nExisting Analysis: ${deckAnalysis.summary}`
        : '';
      
      const prompt = `Analyze this Magic: The Gathering deck and provide:
1. Overall strategy assessment (consider the commander and format)
2. Mana curve analysis
3. Key synergies and combos
4. Potential weaknesses
5. 3-5 specific card recommendations with explanations

${commanderText}
${formatText}
${archetypeText}
${existingAnalysisText}

Deck (${deck.length} cards):
${deckList}
${existingRecommendationsText}

${existingRecommendationsText ? 'Consider the existing recommendations above but provide your own analysis and suggestions that may complement or differ from them.' : ''}

Please format your response as JSON with these sections:
{
  "strategy": "Brief strategy description that takes into account the commander and format",
  "manaCurve": "Mana curve assessment",
  "synergies": ["List of key synergies"],
  "weaknesses": ["List of potential issues"],
  "recommendations": [
    {
      "card": "Card Name",
      "reason": "Why this card would help the deck strategy",
      "category": "ramp|removal|draw|synergy|protection"
    }
  ]
}`;

      // Try to get response with proper timeout handling
      let response;
      try {
        response = await window.electronAi.prompt(prompt, {
          timeout: 30000 // 30 seconds timeout
        });
      } catch (promptError) {
        // If model stopped or timed out, try to reinitialize
        if (promptError.message.includes('stopped') || 
            promptError.message.includes('timeout') || 
            promptError.message.includes('Cannot read properties of undefined')) {
          console.log('🔄 Model seems to have stopped, trying to reinitialize...');
          globalLlmInitialized = false;
          setLlmInitialized(false);
          
          try {
            // Try to destroy the existing model first
            try {
              await window.electronAi.destroy();
              console.log('🔄 Destroyed existing LLM instance');
            } catch (destroyError) {
              console.log('🔄 No existing LLM instance to destroy');
            }
            
            await initializeLLM();
            
            // Retry the prompt once after reinitializing
            if (globalLlmInitialized) {
              response = await window.electronAi.prompt(prompt, {
                timeout: 30000 // 30 seconds timeout
              });
            } else {
              throw new Error('Failed to reinitialize LLM after error');
            }
          } catch (reinitError) {
            console.error('❌ Failed to reinitialize LLM:', reinitError);
            throw new Error(`LLM reinitialization failed: ${reinitError.message}`);
          }
        } else {
          throw promptError;
        }
      }
      
      try {
        const analysisData = JSON.parse(response);
        setAnalysis(analysisData);
        setSuggestions(analysisData.recommendations || []);
      } catch (parseError) {
        // Fallback to text analysis if JSON parsing fails
        setAnalysis({
          strategy: "Analysis completed",
          manaCurve: "See full analysis below",
          synergies: [],
          weaknesses: [],
          rawResponse: response
        });
      }
    } catch (error) {
      console.error('❌ Deck analysis failed:', error);
      
      // Handle specific error types
      if (error.message.includes('timeout') || error.message.includes('Cannot read properties of undefined (reading \'timeout\')')) {
        setError('Analysis timed out. The model may be loading or busy. Please try again.');
      } else if (error.message.includes('stopped')) {
        setError('Model stopped unexpectedly. Please try reinitializing.');
        setLlmInitialized(false);
        globalLlmInitialized = false;
      } else if (error.message.includes('modelAlias')) {
        setError('Model file not found. Please ensure the AI model is downloaded.');
        setLlmInitialized(false);
        globalLlmInitialized = false;
      } else {
        setError(`Analysis failed: ${error.message}`);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleCardSuggestion = (card) => {
    if (onCardSuggestion) {
      onCardSuggestion(card);
    }
  };

  const getCategoryIcon = (category) => {
    switch (category) {
      case 'ramp': return <TrendingUp className="w-4 h-4" />;
      case 'removal': return <Target className="w-4 h-4" />;
      case 'draw': return <Sparkles className="w-4 h-4" />;
      case 'synergy': return <Zap className="w-4 h-4" />;
      case 'protection': return <CheckCircle className="w-4 h-4" />;
      default: return <Lightbulb className="w-4 h-4" />;
    }
  };

  const getCategoryColor = (category) => {
    switch (category) {
      case 'ramp': return 'bg-green-100 text-green-800';
      case 'removal': return 'bg-red-100 text-red-800';
      case 'draw': return 'bg-blue-100 text-blue-800';
      case 'synergy': return 'bg-purple-100 text-purple-800';
      case 'protection': return 'bg-yellow-100 text-yellow-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  // Helper to open card modal by name
  const handleCardNameClick = async (cardName) => {
    setCardDetailLoading(true);
    try {
      const card = await window.electronAPI.bulkDataFindCard(cardName);
      if (card) setSelectedCard(card);
    } catch (err) {
      console.error('Failed to fetch card for modal:', err);
    } finally {
      setCardDetailLoading(false);
    }
  };

  // Helper: Render human-readable analysis from JSON
  const renderFullAnalysis = (rawResponse, handleCardNameClick) => {
    let data;
    if (!rawResponse) return null;
    try {
      data = typeof rawResponse === 'string' ? JSON.parse(rawResponse) : rawResponse;
    } catch {
      return <div className="text-sm bg-gray-50 p-3 rounded whitespace-pre-wrap">{rawResponse}</div>;
    }
    return (
      <div className="full-analysis-rendered space-y-4">
        {data.strategy && (
          <div>
            <h4 className="font-semibold mb-1">Strategy</h4>
            <p className="text-sm">{data.strategy}</p>
          </div>
        )}
        {data.manaCurve && (
          <div>
            <h4 className="font-semibold mb-1">Mana Curve</h4>
            {data.manaCurve.mana_distribution && (
              <div className="mb-2">
                <table className="text-xs bg-slate-800 rounded">
                  <thead>
                    <tr>
                      <th className="px-2 py-1">Mana Cost</th>
                      <th className="px-2 py-1">Count</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(data.manaCurve.mana_distribution).map(([cost, count]) => (
                      <tr key={cost}>
                        <td className="px-2 py-1">{cost}</td>
                        <td className="px-2 py-1">{count}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {data.manaCurve.notes && <p className="text-xs text-muted-foreground">{data.manaCurve.notes}</p>}
          </div>
        )}
        {data.synergies && data.synergies.length > 0 && (
          <div>
            <h4 className="font-semibold mb-1">Key Synergies</h4>
            <ul className="list-disc ml-5 space-y-1">
              {data.synergies.map((syn, i) => (
                <li key={i}>
                  {syn.split(/([A-Z][a-zA-Z0-9'\-: ]+)/g).map((part, idx) => {
                    // Try to detect card names (simple heuristic: capitalized words)
                    if (part && /^[A-Z][a-zA-Z0-9'\-: ]{2,}$/.test(part.trim())) {
                      return (
                        <button
                          key={idx}
                          className="text-blue-400 hover:underline focus:underline focus:outline-none bg-transparent border-none p-0 m-0 inline"
                          style={{ cursor: 'pointer' }}
                          onClick={() => handleCardNameClick(part.trim())}
                          type="button"
                        >
                          {part}
                        </button>
                      );
                    }
                    return part;
                  })}
                </li>
              ))}
            </ul>
          </div>
        )}
        {data.weaknesses && data.weaknesses.length > 0 && (
          <div>
            <h4 className="font-semibold mb-1">Potential Weaknesses</h4>
            <ul className="list-disc ml-5 space-y-1">
              {data.weaknesses.map((w, i) => <li key={i}>{w}</li>)}
            </ul>
          </div>
        )}
        {data.recommendations && data.recommendations.length > 0 && (
          <div>
            <h4 className="font-semibold mb-1">AI Recommendations</h4>
            <ul className="list-disc ml-5 space-y-1">
              {data.recommendations.map((rec, i) => (
                <li key={i}>
                  <button
                    className="text-blue-400 hover:underline focus:underline focus:outline-none bg-transparent border-none p-0 m-0 inline"
                    style={{ cursor: 'pointer' }}
                    onClick={() => handleCardNameClick(rec.card)}
                    type="button"
                  >
                    {rec.card}
                  </button>
                  {rec.reason && <span className="ml-2 text-xs text-muted-foreground">{rec.reason}</span>}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    );
  };

  if (error) {
    return (
      <Card className="ai-panel-error">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-red-600">
            <AlertCircle className="w-5 h-5" />
            AI Analysis Error
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-gray-600">{error}</p>
          <div className="flex gap-2 mt-4">
            <Button 
              onClick={initializeLLM} 
              size="sm"
              variant="outline"
            >
              Retry Initialization
            </Button>
            {llmInitialized && (
              <Button 
                onClick={analyzeDeck} 
                size="sm"
                disabled={loading}
              >
                {loading ? 'Analyzing...' : 'Retry Analysis'}
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="ai-panel">
      <Card className="h-full">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2">
            <Brain className="w-5 h-5 text-blue-600" />
            AI Deck Assistant
            {loading && <Loader2 className="w-4 h-4 animate-spin" />}
          </CardTitle>
        </CardHeader>
        
        <CardContent className="p-0">
          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <TabsList className="grid w-full grid-cols-3 mx-4 mb-4">
              <TabsTrigger value="analysis">Analysis</TabsTrigger>
              <TabsTrigger value="suggestions">AI Suggestions</TabsTrigger>
              <TabsTrigger value="recommendations">Recommendations</TabsTrigger>
            </TabsList>
            
            <TabsContent value="analysis" className="px-4 pb-4">
              <ScrollArea className="h-[400px]">
                {loading ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="w-6 h-6 animate-spin mr-2" />
                    <span>Analyzing deck...</span>
                  </div>
                ) : analysis ? (
                  <div className="space-y-4">
                    {commander && (
                      <div>
                        <h3 className="font-semibold mb-2 flex items-center gap-2">
                          <Brain className="w-4 h-4" />
                          Commander
                        </h3>
                        <div className="bg-purple-50 p-3 rounded">
                          <p className="text-sm font-medium">{commander.name}</p>
                          {commander.type_line && (
                            <p className="text-xs text-gray-600 mt-1">{commander.type_line}</p>
                          )}
                          {commander.mana_cost && (
                            <p className="text-xs text-gray-600 mt-1">Mana Cost: {commander.mana_cost}</p>
                          )}
                        </div>
                      </div>
                    )}
                    
                    <div>
                      <h3 className="font-semibold mb-2 flex items-center gap-2">
                        <Target className="w-4 h-4" />
                        Strategy
                      </h3>
                      <p className="text-sm text-gray-600 bg-gray-50 p-3 rounded">
                        {analysis.strategy}
                      </p>
                    </div>
                    
                    <Separator />
                    
                    <div>
                      <h3 className="font-semibold mb-2 flex items-center gap-2">
                        <TrendingUp className="w-4 h-4" />
                        Mana Curve
                      </h3>
                      <p className="text-sm text-gray-600 bg-gray-50 p-3 rounded">
                        {analysis.manaCurve}
                      </p>
                    </div>
                    
                    {analysis.synergies && analysis.synergies.length > 0 && (
                      <>
                        <Separator />
                        <div>
                          <h3 className="font-semibold mb-2 flex items-center gap-2">
                            <Zap className="w-4 h-4" />
                            Key Synergies
                          </h3>
                          <div className="space-y-2">
                            {analysis.synergies.map((synergy, index) => (
                              <div key={index} className="text-sm bg-blue-50 p-2 rounded">
                                {synergy}
                              </div>
                            ))}
                          </div>
                        </div>
                      </>
                    )}
                    
                    {analysis.weaknesses && analysis.weaknesses.length > 0 && (
                      <>
                        <Separator />
                        <div>
                          <h3 className="font-semibold mb-2 flex items-center gap-2">
                            <AlertCircle className="w-4 h-4" />
                            Potential Issues
                          </h3>
                          <div className="space-y-2">
                            {analysis.weaknesses.map((weakness, index) => (
                              <div key={index} className="text-sm bg-yellow-50 p-2 rounded">
                                {weakness}
                              </div>
                            ))}
                          </div>
                        </div>
                      </>
                    )}
                    
                    {analysis.rawResponse && (
                      <>
                        <Separator />
                        <div>
                          <h3 className="font-semibold mb-2">Full Analysis</h3>
                          {renderFullAnalysis(analysis.rawResponse, handleCardNameClick)}
                        </div>
                      </>
                    )}
                  </div>
                ) : (
                  <div className="flex items-center justify-center py-8 text-gray-500">
                    <Brain className="w-6 h-6 mr-2" />
                    <span>Add cards to your deck to get AI analysis</span>
                  </div>
                )}
              </ScrollArea>
            </TabsContent>
            
            <TabsContent value="suggestions" className="px-4 pb-4">
              <ScrollArea className="h-[400px]">
                {loading ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="w-6 h-6 animate-spin mr-2" />
                    <span>Generating suggestions...</span>
                  </div>
                ) : suggestions.length > 0 ? (
                  <div className="space-y-3">
                    {suggestions.map((suggestion, index) => (
                      <Card key={index} className="border-l-4 border-l-blue-500">
                        <CardContent className="p-4">
                          <div className="flex items-start justify-between">
                            <div className="flex-1">
                              <div className="flex items-center gap-2 mb-2">
                                <h4 className="font-medium">{suggestion.card}</h4>
                                <Badge 
                                  variant="secondary" 
                                  className={`${getCategoryColor(suggestion.category)} text-xs`}
                                >
                                  <span className="flex items-center gap-1">
                                    {getCategoryIcon(suggestion.category)}
                                    {suggestion.category}
                                  </span>
                                </Badge>
                              </div>
                              <p className="text-sm text-gray-600">
                                {suggestion.reason}
                              </p>
                            </div>
                            <TooltipProvider>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={() => handleCardSuggestion(suggestion.card)}
                                    className="ml-2"
                                  >
                                    <Lightbulb className="w-4 h-4" />
                                  </Button>
                                </TooltipTrigger>
                                <TooltipContent>
                                  <p>Search for this card</p>
                                </TooltipContent>
                              </Tooltip>
                            </TooltipProvider>
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                ) : (
                  <div className="flex items-center justify-center py-8 text-gray-500">
                    <Lightbulb className="w-6 h-6 mr-2" />
                    <span>No suggestions available yet</span>
                  </div>
                )}
              </ScrollArea>
            </TabsContent>
            
            <TabsContent value="recommendations" className="px-4 pb-4">
              <ScrollArea className="h-[400px]">
                {analysis && analysis.recommendations && analysis.recommendations.length > 0 ? (
                  <div className="space-y-3">
                    {analysis.recommendations.map((rec, index) => (
                      <Card key={index} className="border-l-4 border-l-green-500">
                        <CardContent className="p-4">
                          <div className="flex items-start justify-between">
                            <div className="flex-1">
                              <div className="flex items-center gap-2 mb-2">
                                <button
                                  className="font-medium text-blue-400 hover:underline focus:underline focus:outline-none"
                                  style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}
                                  onClick={() => handleCardNameClick(rec.card)}
                                  type="button"
                                >
                                  {rec.card}
                                </button>
                                <Badge 
                                  variant="secondary" 
                                  className={`${getCategoryColor(rec.category)} text-xs`}
                                >
                                  <span className="flex items-center gap-1">
                                    {getCategoryIcon(rec.category)}
                                    {rec.category}
                                  </span>
                                </Badge>
                              </div>
                              <p className="text-sm text-gray-600">
                                {rec.reason}
                              </p>
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                ) : (
                  <div className="flex items-center justify-center py-8 text-gray-500">
                    <Lightbulb className="w-6 h-6 mr-2" />
                    <span>No recommendations available yet</span>
                  </div>
                )}
              </ScrollArea>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
      {selectedCard && (
        <CardDetailModal card={selectedCard} onClose={() => setSelectedCard(null)} loading={cardDetailLoading} />
      )}
    </div>
  );
};

export default AIPanel; 