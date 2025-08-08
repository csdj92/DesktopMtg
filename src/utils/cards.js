// Card-related utility functions extracted for reuse

export const isCardCommander = (card) => {
  if (!card) return false;
  const typeLine = (card.type || card.type_line || '').toLowerCase();
  const oracleText = (card.text || card.oracle_text || '').toLowerCase();
  if (typeLine.includes('legendary') && typeLine.includes('creature')) return true;
  if (typeLine.includes('legendary') && typeLine.includes('background')) return true;
  if (oracleText.includes('can be your commander')) return true;
  return false;
};

export const isBasicLand = (card) => {
  if (!card) return false;
  const typeLine = (card.type || card.type_line || '').toLowerCase();
  return typeLine.includes('basic') && typeLine.includes('land');
};

export const isCardLegalInFormat = (card, format) => {
  if (!card || !format) return true;
  if (card.legalities && typeof card.legalities === 'object') {
    const formatKey = format.toLowerCase();
    const legality = card.legalities[formatKey];
    return legality === 'legal' || legality === 'restricted';
  }
  return false;
};

export const getCardTypes = (card) => {
  if (!card) return [];
  const typeLine = (card.type || card.type_line || '').toLowerCase();
  const types = [];
  if (typeLine.includes('creature')) types.push('creature');
  if (typeLine.includes('land')) types.push('land');
  if (typeLine.includes('instant')) types.push('instant');
  if (typeLine.includes('sorcery')) types.push('sorcery');
  if (typeLine.includes('enchantment')) types.push('enchantment');
  if (typeLine.includes('artifact')) types.push('artifact');
  if (typeLine.includes('planeswalker')) types.push('planeswalker');
  if (typeLine.includes('battle')) types.push('battle');
  return types;
};

export const getPrimaryCardType = (card) => {
  if (!card) return 'Other';
  const types = getCardTypes(card);
  if (types.length > 0) {
    return types[0].charAt(0).toUpperCase() + types[0].slice(1) + 's';
  }
  return 'Other';
};

export const groupCardsByType = (mainboard) => {
  const groups = {};
  (mainboard || []).forEach(entry => {
    const type = getPrimaryCardType(entry.card);
    if (!groups[type]) groups[type] = [];
    groups[type].push(entry);
  });
  Object.keys(groups).forEach(type => {
    groups[type].sort((a, b) => a.card.name.localeCompare(b.card.name));
  });
  const typeOrder = ['Creatures', 'Lands', 'Instants', 'Sorceries', 'Enchantments', 'Artifacts', 'Planeswalkers', 'Battles', 'Other'];
  const orderedGroups = {};
  typeOrder.forEach(type => {
    if (groups[type]) orderedGroups[type] = groups[type];
  });
  return orderedGroups;
};

export const matchesTypeFilter = (card, filter) => {
  if (filter === 'all') return true;
  const cardTypes = getCardTypes(card);
  return cardTypes.includes(filter);
};

export const sortCards = (cardList, sortBy, direction = 'asc') => {
  const sorted = [...cardList];
  switch (sortBy) {
    case 'cmc':
      sorted.sort((a, b) => {
        const cardA = a.card || a;
        const cardB = b.card || b;
        const aVal = cardA.manaValue ?? cardA.cmc ?? cardA.mana_value ?? 0;
        const bVal = cardB.manaValue ?? cardB.cmc ?? cardB.mana_value ?? 0;
        if (aVal === bVal) return cardA.name.localeCompare(cardB.name);
        return direction === 'asc' ? aVal - bVal : bVal - aVal;
      });
      break;
    case 'power':
      sorted.sort((a, b) => {
        const cardA = a.card || a;
        const cardB = b.card || b;
        const aVal = cardA.power ? parseInt(cardA.power, 10) : (direction === 'asc' ? Infinity : -1);
        const bVal = cardB.power ? parseInt(cardB.power, 10) : (direction === 'asc' ? Infinity : -1);
        if (isNaN(aVal) && isNaN(bVal)) return cardA.name.localeCompare(cardB.name);
        if (isNaN(aVal)) return 1;
        if (isNaN(bVal)) return -1;
        if (aVal === bVal) return cardA.name.localeCompare(cardB.name);
        return direction === 'asc' ? aVal - bVal : bVal - aVal;
      });
      break;
    case 'toughness':
      sorted.sort((a, b) => {
        const cardA = a.card || a;
        const cardB = b.card || b;
        const aVal = cardA.toughness ? parseInt(cardA.toughness, 10) : (direction === 'asc' ? Infinity : -1);
        const bVal = cardB.toughness ? parseInt(cardB.toughness, 10) : (direction === 'asc' ? Infinity : -1);
        if (isNaN(aVal) && isNaN(bVal)) return cardA.name.localeCompare(cardB.name);
        if (isNaN(aVal)) return 1;
        if (isNaN(bVal)) return -1;
        if (aVal === bVal) return cardA.name.localeCompare(cardB.name);
        return direction === 'asc' ? aVal - bVal : bVal - aVal;
      });
      break;
    case 'rarity':
      sorted.sort((a, b) => {
        const cardA = a.card || a;
        const cardB = b.card || b;
        const rarityOrder = { 'mythic': 4, 'rare': 3, 'uncommon': 2, 'common': 1, 'special': 0 };
        const aVal = rarityOrder[cardA.rarity?.toLowerCase()] ?? 0;
        const bVal = rarityOrder[cardB.rarity?.toLowerCase()] ?? 0;
        if (aVal === bVal) return cardA.name.localeCompare(cardB.name);
        return direction === 'asc' ? aVal - bVal : bVal - aVal;
      });
      break;
    case 'quantity':
      sorted.sort((a, b) => {
        const diff = direction === 'asc' ? (a.quantity || 0) - (b.quantity || 0) : (b.quantity || 0) - (a.quantity || 0);
        if (diff !== 0) return diff;
        const cardA = a.card || a;
        const cardB = b.card || b;
        return cardA.name.localeCompare(cardB.name);
      });
      break;
    case 'synergy':
      sorted.sort((a, b) => {
        const cardA = a.card || a;
        const cardB = b.card || b;
        const aVal = cardA.synergy_score ?? 0;
        const bVal = cardB.synergy_score ?? 0;
        if (aVal === bVal) return cardA.name.localeCompare(cardB.name);
        return direction === 'asc' ? aVal - bVal : bVal - aVal;
      });
      break;
    case 'name':
    default:
      sorted.sort((a, b) => {
        const cardA = a.card || a;
        const cardB = b.card || b;
        return direction === 'asc' ? cardA.name.localeCompare(cardB.name) : cardB.name.localeCompare(cardA.name);
      });
      break;
  }
  return sorted;
};

export const getMaxCopiesAllowed = (card, format) => {
  if (format === 'commander') {
    return isBasicLand(card) ? 999 : 1;
  }
  return 4;
};

export const isCardInColorIdentity = (card, commanderIdSet) => {
  if (!commanderIdSet) return true;
  if (!card?.color_identity || card.color_identity.length === 0) return true;
  return card.color_identity.every((color) => commanderIdSet.has(color));
};


