// Utility function to normalize keywords from different formats
function normalizeKeywords(keywords) {
  if (Array.isArray(keywords)) {
    return keywords.map(k => k.toLowerCase());
  } else if (typeof keywords === 'string') {
    return [keywords.toLowerCase()];
  }
  return [];
}

module.exports = { normalizeKeywords }; 