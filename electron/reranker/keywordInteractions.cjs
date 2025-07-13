const keywordInteractions = {
  proliferate: ['counter', '+1/+1', 'charge'],
  lifelink: ['lifegain', 'vigilance'],
  lifegain: ['lifelink'],
  dredge: ['graveyard', 'flashback'],
  flashback: ['graveyard', 'dredge'],
  delve: ['graveyard', 'selfmill'],
  evoke: ['creature', 'flashback'],
  convoke: ['tokens', 'token'],
  kicker: ['flexible'],
  cascade: ['spell', 'instant', 'sorcery'],
  mutate: ['creature'],
}; 

module.exports = { keywordInteractions }; 