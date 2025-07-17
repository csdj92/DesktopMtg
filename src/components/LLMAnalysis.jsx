import React, { useState, useEffect } from 'react';
import CardDetailModal from './CardDetailModal';
import './LLMAnalysis.css';

const LLMAnalysis = ({ deck, commander, isOpen, onClose }) => {
  const [partial, setPartial] = useState("");
  const [selectedCard, setSelectedCard] = useState(null);
  const [loading, setLoading] = useState(false);
  const [analysis, setAnalysis] = useState(null);
  const [recommendations, setRecommendations] = useState(null);
  const [description, setDescription] = useState(null);
  const [error, setError] = useState(null);
  const [llmInitialized, setLlmInitialized] = useState(false);
  const [activeTab, setActiveTab] = useState('analysis');

  useEffect(() => {
    if (isOpen) {
      initializeLLM();
    }
  }, [isOpen]);

  const initializeLLM = async () => {
    try {
      if (!window.electronAi) {
        throw new Error('LLM API not available. Make sure @electron/llm is loaded.');
      }

      console.log('✅ LLM API is available');
      
      // Create the model instance
      // Note: @electron/llm v1+ expects a `modelAlias` string that will be
      // resolved to a full path by the main-process `getModelPath` hook.
      // The alias should match the filename of our local GGUF model.
      await window.electronAi.create({
        modelAlias: 'Meta-Llama-3-8B-Instruct.Q4_K_M.gguf',
        systemPrompt: 'You are a Magic: The Gathering deck analysis assistant. Provide helpful, accurate advice about deck building, card synergies, and strategy.',
        temperature: 0.7,
        topK: 10
      });

      setLlmInitialized(true);
      console.log('✅ LLM initialized successfully');
    } catch (error) {
      console.error('❌ LLM initialization failed:', error);
      setError(`LLM initialization failed: ${error.message}`);
    }
  };

  const analyzeDeck = async () => {
    if (!llmInitialized) {
      setError('LLM not initialized. Please wait...');
      return;
    }

    setLoading(true);
    setActiveTab('analysis');
    setError(null);

    try {
      const deckList = deck.map(card => `${card.quantity}x ${card.name}`).join('\n');
      const commanderName = commander ? commander.name : 'Unknown Commander';
      
      const prompt = `Analyze this Magic: The Gathering Commander deck:

Commander: ${commanderName}
Deck List:
${deckList}

Please provide:
1. Overall strategy and theme analysis
2. Mana curve evaluation
3. Card synergy assessment
4. Strengths and weaknesses
5. 3-5 specific improvement suggestions

Format your response with **bold** for card names you reference.`;

      const response = await window.electronAi.prompt(prompt);
      
      setAnalysis({
        analysis: response,
        suggestions: [] // Could parse suggestions from response if needed
      });
    } catch (error) {
      console.error('Analysis failed:', error);
      setError(`Analysis failed: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  const getRecommendations = async () => {
    if (!llmInitialized) {
      setError('LLM not initialized. Please wait...');
      return;
    }

    setLoading(true);
    setActiveTab('recommendations');
    setError(null);

    try {
      const deckList = deck.map(card => `${card.quantity}x ${card.name}`).join('\n');
      const commanderName = commander ? commander.name : 'Unknown Commander';
      
      const prompt = `Recommend cards for this Magic: The Gathering Commander deck:

Commander: ${commanderName}
Current Deck:
${deckList}

Please suggest 5-10 cards that would improve this deck, explaining why each card would be beneficial. Consider:
- Synergy with the commander
- Filling gaps in the mana curve
- Improving card draw, ramp, or removal
- Enhancing the deck's overall strategy

Format your response with **bold** for card names you reference.`;

      const response = await window.electronAi.prompt(prompt);
      
      setRecommendations({
        recommendations: response,
        cards: [] // Could parse card names from response if needed
      });
    } catch (error) {
      console.error('Recommendations failed:', error);
      setError(`Recommendations failed: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  const generateDescription = async () => {
    if (!llmInitialized) {
      setError('LLM not initialized. Please wait...');
      return;
    }

    setLoading(true);
    setActiveTab('description');
    setError(null);

    try {
      const deckList = deck.map(card => `${card.quantity}x ${card.name}`).join('\n');
      const commanderName = commander ? commander.name : 'Unknown Commander';
      
      const prompt = `Generate a concise description for this Magic: The Gathering Commander deck:

Commander: ${commanderName}
Deck List:
${deckList}

Write a 2-3 paragraph description that covers:
- The deck's primary strategy and win conditions
- Key card interactions and synergies
- Playstyle and typical game plan

Format your response with **bold** for card names you reference.`;

      const response = await window.electronAi.prompt(prompt);
      
      setDescription({
        description: response
      });
    } catch (error) {
      console.error('Description generation failed:', error);
      setError(`Description generation failed: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  // Helper: turn **Card Name** segments into clickable spans
  const renderTextWithCardRefs = (text) => {
    if (!text) return null;
    const parts = text.split(/\*\*/); // split on Markdown bold markers
    return parts.map((part, idx) => {
      // odd indices are inside **  **
      if (idx % 2 === 1) {
        const cardName = part.trim();
        return (
          <span
            key={idx}
            className="card-ref"
            style={{ fontWeight: 'bold', color: '#4fc3f7', cursor: 'pointer' }}
            onClick={() => handleCardRefClick(cardName)}
          >
            {cardName}
          </span>
        );
      }
      return <span key={idx}>{part}</span>;
    });
  };

  const handleCardRefClick = async (cardName) => {
    try {
      const fullCard = await window.electronAPI.bulkDataFindCard(cardName);
      if (fullCard) {
        setSelectedCard(fullCard);
      }
    } catch (err) {
      console.error('Card lookup failed:', err);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="llm-analysis-overlay">
      <div className="llm-analysis-modal">
        <div className="llm-analysis-header">
          <h2>🤖 AI-Powered Deck Analysis</h2>
          <button onClick={onClose} className="llm-analysis-close">✕</button>
        </div>

        {error && (
          <div className="llm-analysis-error">
            <span className="error-icon">⚠️</span>
            {error}
            <button onClick={() => setError(null)} className="error-dismiss">✕</button>
          </div>
        )}

        <div className="llm-analysis-actions">
          <button 
            onClick={analyzeDeck}
            disabled={loading}
            className="llm-action-btn analysis"
          >
            {loading && activeTab === 'analysis' ? '🔄 Analyzing...' : '📊 Analyze Deck'}
          </button>
          
          <button 
            onClick={getRecommendations}
            disabled={loading}
            className="llm-action-btn recommendations"
          >
            {loading && activeTab === 'recommendations' ? '🔄 Getting Recs...' : '💡 Get Recommendations'}
          </button>
          
          <button 
            onClick={generateDescription}
            disabled={loading}
            className="llm-action-btn description"
          >
            {loading && activeTab === 'description' ? '🔄 Generating...' : '📝 Generate Description'}
          </button>
        </div>

        <div className="llm-analysis-tabs">
          <button 
            className={`tab ${activeTab === 'analysis' ? 'active' : ''}`}
            onClick={() => setActiveTab('analysis')}
          >
            📊 Analysis
          </button>
          <button 
            className={`tab ${activeTab === 'recommendations' ? 'active' : ''}`}
            onClick={() => setActiveTab('recommendations')}
          >
            💡 Recommendations
          </button>
          <button 
            className={`tab ${activeTab === 'description' ? 'active' : ''}`}
            onClick={() => setActiveTab('description')}
          >
            📝 Description
          </button>
        </div>

        <div className="llm-analysis-content">
          {activeTab === 'analysis' && (
            <div className="analysis-results">
              {analysis ? (
                <div>
                  <h3>🎯 Deck Analysis</h3>
                  <div className="analysis-text">
                    {renderTextWithCardRefs(analysis.analysis)}
                  </div>
                  {analysis.suggestions && analysis.suggestions.length > 0 && (
                    <div className="suggestions">
                      <h4>💡 Key Suggestions</h4>
                      <ul>
                        {analysis.suggestions.map((suggestion, index) => (
                          <li key={index}>{suggestion}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              ) : (
                <div className="placeholder">
                  <p>Click "Analyze Deck" to get AI-powered insights about your deck's strategy, strengths, and weaknesses.</p>
                </div>
              )}
            </div>
          )}

          {activeTab === 'recommendations' && (
            <div className="recommendations-results">
              {recommendations ? (
                <div>
                  <h3>💡 Card Recommendations</h3>
                  <div className="recommendations-text">
                    {renderTextWithCardRefs(recommendations.recommendations)}
                  </div>
                  {recommendations.cards && recommendations.cards.length > 0 && (
                    <div className="recommended-cards">
                      <h4>🎴 Suggested Cards</h4>
                      <ul>
                        {recommendations.cards.map((card, index) => (
                          <li key={index} className="card-suggestion">{card}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              ) : (
                <div className="placeholder">
                  <p>Click "Get Recommendations" to receive AI-suggested cards that would improve your deck.</p>
                </div>
              )}
            </div>
          )}

          {activeTab === 'description' && (
            <div className="description-results">
              {description ? (
                <div>
                  <h3>📝 Deck Description</h3>
                  <div className="description-text">
                    {renderTextWithCardRefs(description.description)}
                  </div>
                </div>
              ) : (
                <div className="placeholder">
                  <p>Click "Generate Description" to create a concise summary of your deck's theme and strategy.</p>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="llm-analysis-footer">
          <div className="llm-status">
            <span className={`status-indicator ${llmInitialized ? 'ready' : 'loading'}`}>
              {llmInitialized ? '🟢 LLM Ready' : '🟡 Initializing...'}
            </span>
          </div>
        </div>
      </div>

      {selectedCard && (
        <CardDetailModal
          card={selectedCard}
          onClose={() => setSelectedCard(null)}
        />
      )}
    </div>
  );
};

export default LLMAnalysis;