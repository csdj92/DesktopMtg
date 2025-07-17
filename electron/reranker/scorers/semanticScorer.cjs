const { weights } = require('../weights.cjs');
const settingsManager = require('../../settingsManager.cjs');

function semanticScorer(card) {
  // Use semantic_score if available, otherwise convert distance using configurable method
  let raw = card.semantic_score;
  
  if (raw === undefined && (card._distance !== undefined || card.distance !== undefined)) {
    const distance = card._distance || card.distance || 1.0;
    const settings = settingsManager.getSettings();
    const conversionType = settings.recommendations?.scoring?.distanceConversion || 'sqrt';
    
    switch (conversionType) {
      case 'linear':
        raw = Math.max(0, 1 - distance);
        break;
      case 'sqrt':
        raw = Math.max(0, 1 - Math.sqrt(distance));
        break;
      case 'exponential':
        raw = Math.max(0, Math.exp(-distance));
        break;
      case 'aggressive_exp':
        raw = Math.max(0, Math.exp(-distance * 2));
        break;
      default:
        raw = Math.max(0, 1 - Math.sqrt(distance));
    }
  }
  
  return (raw || 0) * weights.baseBoost;
}

module.exports = { semanticScorer }; 