import React, { useState, useEffect } from 'react';
import './RecommendationSettings.css';

const RecommendationSettings = ({ isOpen, onClose }) => {
  const [settings, setSettings] = useState(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [resetConfirm, setResetConfirm] = useState(false);

  // Load settings when component opens
  useEffect(() => {
    if (isOpen && !settings) {
      loadSettings();
    }
  }, [isOpen]);

  const loadSettings = async () => {
    setLoading(true);
    try {
      const currentSettings = await window.electronAPI.getSettings();
      setSettings(currentSettings);
    } catch (error) {
      console.error('Failed to load settings:', error);
    } finally {
      setLoading(false);
    }
  };

  const saveSettings = async () => {
    setSaving(true);
    try {
      await window.electronAPI.saveSettings(settings);
      console.log('✅ Settings saved successfully');
    } catch (error) {
      console.error('❌ Failed to save settings:', error);
    } finally {
      setSaving(false);
    }
  };

  const resetSettings = async () => {
    if (!resetConfirm) {
      setResetConfirm(true);
      setTimeout(() => setResetConfirm(false), 3000); // Reset confirmation after 3s
      return;
    }

    setLoading(true);
    try {
      const defaultSettings = await window.electronAPI.resetSettings();
      setSettings(defaultSettings);
      setResetConfirm(false);
      console.log('✅ Settings reset to defaults');
    } catch (error) {
      console.error('❌ Failed to reset settings:', error);
    } finally {
      setLoading(false);
    }
  };

  const updateSetting = (path, value) => {
    const newSettings = { ...settings };
    const keys = path.split('.');
    let current = newSettings;
    
    for (let i = 0; i < keys.length - 1; i++) {
      current = current[keys[i]];
    }
    
    current[keys[keys.length - 1]] = value;
    setSettings(newSettings);
  };

  const getSetting = (path) => {
    const keys = path.split('.');
    let current = settings;
    
    for (const key of keys) {
      if (current && typeof current === 'object') {
        current = current[key];
      } else {
        return undefined;
      }
    }
    
    return current;
  };

  if (!isOpen) return null;

  return (
    <div className="settings-overlay">
      <div className="settings-modal">
        <div className="settings-header">
          <h2>⚙️ Recommendation Engine Settings</h2>
          <button onClick={onClose} className="settings-close">✕</button>
        </div>

        {loading ? (
          <div className="settings-loading">Loading settings...</div>
        ) : settings ? (
          <div className="settings-content">
            
            {/* Search Parameters */}
            <div className="settings-section">
              <h3>🔍 Search Parameters</h3>
              <div className="settings-row">
                <label>
                  Semantic Search Limit
                  <input
                    type="number"
                    min="1000"
                    max="200000"
                    step="1000"
                    value={getSetting('recommendations.search.semanticLimit') || 90000}
                    onChange={(e) => updateSetting('recommendations.search.semanticLimit', parseInt(e.target.value))}
                  />
                </label>
                <span className="setting-help">How many cards to search semantically (higher = more comprehensive but slower)</span>
              </div>
              
              <div className="settings-row">
                <label>
                  Rerank Limit
                  <input
                    type="number"
                    min="50"
                    max="1000"
                    step="50"
                    value={getSetting('recommendations.search.resultLimit') || 200}
                    onChange={(e) => updateSetting('recommendations.search.resultLimit', parseInt(e.target.value))}
                  />
                </label>
                <span className="setting-help">How many top cards to apply detailed reranking to</span>
              </div>

              <div className="settings-row">
                <label>
                  Final Results
                  <input
                    type="number"
                    min="20"
                    max="500"
                    step="10"
                    value={getSetting('recommendations.search.finalLimit') || 100}
                    onChange={(e) => updateSetting('recommendations.search.finalLimit', parseInt(e.target.value))}
                  />
                </label>
                <span className="setting-help">Number of final recommendations to display</span>
              </div>
            </div>

            {/* Scoring Weights - like "temperature" controls */}
            <div className="settings-section">
              <h3>🎯 Scoring Weights ("Temperature" Controls)</h3>
              
              <div className="settings-row">
                <label>
                  Semantic Similarity Weight
                  <input
                    type="range"
                    min="0"
                    max="200"
                    step="5"
                    value={getSetting('recommendations.weights.semantic') || 100}
                    onChange={(e) => updateSetting('recommendations.weights.semantic', parseInt(e.target.value))}
                  />
                  <span className="range-value">{getSetting('recommendations.weights.semantic') || 100}</span>
                </label>
                <span className="setting-help">How much to weight semantic similarity (higher = more focus on query matching)</span>
              </div>

              <div className="settings-row">
                <label>
                  Theme Synergy Multiplier
                  <input
                    type="range"
                    min="0"
                    max="300"
                    step="10"
                    value={getSetting('recommendations.weights.themeMultiplier') || 150}
                    onChange={(e) => updateSetting('recommendations.weights.themeMultiplier', parseInt(e.target.value))}
                  />
                  <span className="range-value">{getSetting('recommendations.weights.themeMultiplier') || 150}</span>
                </label>
                <span className="setting-help">Bonus for cards that match deck themes (graveyard, tokens, etc.)</span>
              </div>

              <div className="settings-row">
                <label>
                  Mana Curve Filling Bonus
                  <input
                    type="range"
                    min="0"
                    max="150"
                    step="5"
                    value={getSetting('recommendations.weights.curveMultiplier') || 80}
                    onChange={(e) => updateSetting('recommendations.weights.curveMultiplier', parseInt(e.target.value))}
                  />
                  <span className="range-value">{getSetting('recommendations.weights.curveMultiplier') || 80}</span>
                </label>
                <span className="setting-help">Bonus for cards that fill gaps in your mana curve</span>
              </div>

              <div className="settings-row">
                <label>
                  Tribal Synergy Bonus
                  <input
                    type="range"
                    min="0"
                    max="50"
                    step="1"
                    value={getSetting('recommendations.weights.tribalSynergy') || 25}
                    onChange={(e) => updateSetting('recommendations.weights.tribalSynergy', parseInt(e.target.value))}
                  />
                  <span className="range-value">{getSetting('recommendations.weights.tribalSynergy') || 25}</span>
                </label>
                <span className="setting-help">Bonus for creatures that share types with your deck</span>
              </div>

              <div className="settings-row">
                <label>
                  Card Draw Value
                  <input
                    type="range"
                    min="0"
                    max="30"
                    step="1"
                    value={getSetting('recommendations.weights.cardDraw') || 15}
                    onChange={(e) => updateSetting('recommendations.weights.cardDraw', parseInt(e.target.value))}
                  />
                  <span className="range-value">{getSetting('recommendations.weights.cardDraw') || 15}</span>
                </label>
                <span className="setting-help">How much to value card draw effects</span>
              </div>

              <div className="settings-row">
                <label>
                  Removal Value
                  <input
                    type="range"
                    min="0"
                    max="25"
                    step="1"
                    value={getSetting('recommendations.weights.removal') || 10}
                    onChange={(e) => updateSetting('recommendations.weights.removal', parseInt(e.target.value))}
                  />
                  <span className="range-value">{getSetting('recommendations.weights.removal') || 10}</span>
                </label>
                <span className="setting-help">How much to value removal/destroy effects</span>
              </div>
            </div>

            {/* Scoring Configuration */}
            <div className="settings-section">
              <h3>⚙️ Scoring Configuration</h3>
              
              <div className="settings-row">
                <label>
                  Distance Conversion Method
                  <select
                    value={getSetting('recommendations.scoring.distanceConversion') || 'sqrt'}
                    onChange={(e) => updateSetting('recommendations.scoring.distanceConversion', e.target.value)}
                  >
                    <option value="linear">Linear (1 - distance)</option>
                    <option value="sqrt">Square Root (1 - √distance) [Default]</option>
                    <option value="exponential">Exponential (e^-distance)</option>
                    <option value="aggressive_exp">Aggressive Exponential (e^-2*distance)</option>
                  </select>
                </label>
                <span className="setting-help">How to convert semantic search distances to scores - affects semantic score quality</span>
              </div>

              <div className="settings-row">
                <label>
                  Query Generation Mode
                  <select
                    value={getSetting('recommendations.scoring.queryMode') || 'focused'}
                    onChange={(e) => updateSetting('recommendations.scoring.queryMode', e.target.value)}
                  >
                    <option value="focused">Focused (Short, targeted queries) [Default]</option>
                    <option value="balanced">Balanced (Medium detail)</option>
                    <option value="comprehensive">Comprehensive (Full detail)</option>
                  </select>
                </label>
                <span className="setting-help">Controls query complexity - focused queries often work better for semantic search</span>
              </div>

              <div className="settings-row">
                <label>
                  Scoring Balance Mode
                  <select
                    value={getSetting('recommendations.scoring.balanceMode') || 'mixed'}
                    onChange={(e) => updateSetting('recommendations.scoring.balanceMode', e.target.value)}
                  >
                    <option value="similarity_first">Similarity First (Prioritize semantic/keyword scores)</option>
                    <option value="mixed">Mixed (Balanced approach) [Default]</option>
                    <option value="synergy_first">Synergy First (Prioritize deck theme bonuses)</option>
                  </select>
                </label>
                <span className="setting-help">How to balance initial similarity scores vs deck synergy bonuses</span>
              </div>

              <div className="settings-row">
                <label>
                  Similarity Score Scale
                  <input
                    type="range"
                    min="50"
                    max="500"
                    step="10"
                    value={getSetting('recommendations.scoring.similarityScale') || 200}
                    onChange={(e) => updateSetting('recommendations.scoring.similarityScale', parseInt(e.target.value))}
                  />
                  <span className="range-value">{getSetting('recommendations.scoring.similarityScale') || 200}x</span>
                </label>
                <span className="setting-help">Scale factor for similarity scores to balance with synergy bonuses (higher = more similarity influence)</span>
              </div>
            </div>

            {/* Advanced Thresholds */}
            <div className="settings-section">
              <h3>🔧 Advanced Thresholds</h3>
              
              <div className="settings-row">
                <label>
                  Theme Strength Cap
                  <input
                    type="range"
                    min="0.1"
                    max="1.0"
                    step="0.05"
                    value={getSetting('recommendations.thresholds.themeStrengthCap') || 0.6}
                    onChange={(e) => updateSetting('recommendations.thresholds.themeStrengthCap', parseFloat(e.target.value))}
                  />
                  <span className="range-value">{Math.round((getSetting('recommendations.thresholds.themeStrengthCap') || 0.6) * 100)}%</span>
                </label>
                <span className="setting-help">Maximum percentage of deck that can influence theme scoring</span>
              </div>

              <div className="settings-row">
                <label>
                  Curve Gap Minimum
                  <input
                    type="range"
                    min="0.01"
                    max="0.2"
                    step="0.01"
                    value={getSetting('recommendations.thresholds.curveNeedsMin') || 0.05}
                    onChange={(e) => updateSetting('recommendations.thresholds.curveNeedsMin', parseFloat(e.target.value))}
                  />
                  <span className="range-value">{Math.round((getSetting('recommendations.thresholds.curveNeedsMin') || 0.05) * 100)}%</span>
                </label>
                <span className="setting-help">Minimum curve gap before applying curve-filling bonuses</span>
              </div>
            </div>

            {/* Action Buttons */}
            <div className="settings-actions">
              <button 
                onClick={saveSettings} 
                disabled={saving}
                className="settings-save"
              >
                {saving ? 'Saving...' : '💾 Save Settings'}
              </button>
              
              <button 
                onClick={resetSettings}
                className={`settings-reset ${resetConfirm ? 'confirm' : ''}`}
              >
                {resetConfirm ? '⚠️ Click again to confirm reset' : '🔄 Reset to Defaults'}
              </button>
            </div>
          </div>
        ) : (
          <div className="settings-error">Failed to load settings</div>
        )}
      </div>
    </div>
  );
};

export default RecommendationSettings; 