const { app } = require('electron');
const path = require('path');
const fs = require('fs').promises;
const fsSync = require('fs');

class SettingsManager {
  constructor() {
    this.settingsPath = path.join(app.getPath('userData'), 'settings.json');
    this.currentSettings = null;
    this.defaultSettings = {
      recommendations: {
        // Search parameters
        search: {
          semanticLimit: 90000,        // How many cards to search semantically 
          resultLimit: 200,            // How many cards to rerank
          finalLimit: 100              // How many final recommendations to return
        },
        
        // Scoring configuration
        scoring: {
          distanceConversion: 'sqrt',  // How to convert semantic distances to scores: 'linear', 'sqrt', 'exponential', 'aggressive_exp'
          queryMode: 'focused',        // Query generation mode: 'focused', 'balanced', 'comprehensive'
          balanceMode: 'mixed',        // How to balance similarity vs synergy: 'similarity_first', 'synergy_first', 'mixed'
          similarityScale: 200,        // Scale factor for similarity scores to balance with synergy bonuses
        },
        
        // Scoring weights (like "temperature" controls)
        weights: {
          semantic: 100,               // Base semantic similarity weight
          themeMultiplier: 150,        // Theme synergy bonus multiplier
          curveMultiplier: 80,         // Mana curve filling bonus
          tribalSynergy: 25,           // Tribal creature matching bonus
          tribalSupport: 20,           // Tribal support cards bonus
          keywordSynergy: 10,          // Keyword ability synergy
          nameHashContrib: 1.0,        // Name-based consistency factor
          
          // Format-specific bonuses
          commander: {
            multiplayer: 20,           // "Each opponent" effects
            legendary: 10              // Legendary creature bonus
          },
          
          // Utility bonuses
          cardDraw: 15,                // Card advantage effects
          removal: 10,                 // Destroy/exile effects  
          tutor: 12                    // Search library effects
        },
        
        // Thresholds and caps
        thresholds: {
          themeStrengthCap: 0.6,       // Max theme dominance (60%)
          matchStrengthCap: 3,         // Max pattern matches to count
          curveNeedsMin: 0.05,         // Minimum curve gap to fill (5%)
          tribalMinCards: 4            // Min cards needed for tribal theme
        },
        
        // Ideal mana curve distribution (adjustable like difficulty curves)
        idealCurve: {
          0: 0.05,    // 5% at 0 mana
          1: 0.15,    // 15% at 1 mana  
          2: 0.20,    // 20% at 2 mana
          3: 0.20,    // 20% at 3 mana
          4: 0.15,    // 15% at 4 mana
          5: 0.10,    // 10% at 5 mana
          6: 0.08,    // 8% at 6 mana
          '7+': 0.07  // 7% at 7+ mana
        },
        
        // Active scoring strategy
        activeStrategy: 'primary_fallback'  // Which combination strategy to use
      }
    };
  }

  async initialize() {
    await this.loadSettings();
  }

  async loadSettings() {
    try {
      if (fsSync.existsSync(this.settingsPath)) {
        const settingsData = await fs.readFile(this.settingsPath, 'utf8');
        const loadedSettings = JSON.parse(settingsData);
        // Merge with defaults to ensure all required keys exist
        this.currentSettings = this.mergeSettings(this.defaultSettings, loadedSettings);
        console.log('✅ Settings loaded from:', this.settingsPath);
      } else {
        console.log('ℹ️ No settings file found, using defaults');
        this.currentSettings = { ...this.defaultSettings };
        await this.saveSettings();
      }
    } catch (error) {
      console.error('❌ Error loading settings:', error);
      this.currentSettings = { ...this.defaultSettings };
    }
  }

  async saveSettings(newSettings = null) {
    try {
      if (newSettings) {
        this.currentSettings = this.mergeSettings(this.currentSettings, newSettings);
      }
      await fs.writeFile(this.settingsPath, JSON.stringify(this.currentSettings, null, 2), 'utf8');
      console.log('✅ Settings saved to:', this.settingsPath);
      return { success: true };
    } catch (error) {
      console.error('❌ Error saving settings:', error);
      return { success: false, error: error.message };
    }
  }

  async resetSettings() {
    this.currentSettings = { ...this.defaultSettings };
    const result = await this.saveSettings();
    return result.success ? this.currentSettings : null;
  }

  getSettings() {
    return this.currentSettings;
  }

  // Deep merge utility for settings
  mergeSettings(target, source) {
    const result = { ...target };
    for (const key in source) {
      if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
        result[key] = this.mergeSettings(target[key] || {}, source[key]);
      } else {
        result[key] = source[key];
      }
    }
    return result;
  }
}

// Create singleton instance
const settingsManager = new SettingsManager();

module.exports = settingsManager; 