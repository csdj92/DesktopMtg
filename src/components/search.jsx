class SearchFunctions {
  constructor(collectionCards = [], setFilteredCollectionCards = () => {}) {
    this.collectionCards = collectionCards;
    this.setFilteredCollectionCards = setFilteredCollectionCards;
  }

  filterCollectionCards = (cards, searchParams) => {
    if (!searchParams || Object.values(searchParams).every(value => {
      if (Array.isArray(value)) {
        return value.length === 0;
      }
      return !value || value.trim() === '';
    })) {
      try {
        if (typeof this.setFilteredCollectionCards === 'function') {
          this.setFilteredCollectionCards(cards);
        }
      } catch (err) {
        // ignore
      }
      return;
    }

    const { name, text, type, colors, manaCost, manaValue, power, toughness, rarity, types, subTypes, superTypes } = searchParams;

    const filtered = cards.filter(cardEntry => {
      // Support two shapes: direct card or { card, quantity }
      const baseCard = cardEntry.card || cardEntry; // prefer nested .card if present
      if (!baseCard) return false;

      const scryfallData = baseCard.scryfallData || baseCard;

      // Name search (case-insensitive)
      if (name) {
        const cardName = (baseCard.name || '').toLowerCase();
        if (!cardName.includes(name.toLowerCase())) {
          return false;
        }
      }

      // Oracle text search (case-insensitive) - include card faces
      if (text) {
        const searchTextLower = text.toLowerCase();
        let hasTextMatch = false;
        const oracleText = scryfallData.text || scryfallData.oracle_text || '';
        if (oracleText && oracleText.toLowerCase().includes(searchTextLower)) {
          hasTextMatch = true;
        }
        if (!hasTextMatch && scryfallData.card_faces) {
          hasTextMatch = scryfallData.card_faces.some(face =>
            face.oracle_text && face.oracle_text.toLowerCase().includes(searchTextLower)
          );
        }
        if (!hasTextMatch) {
          return false;
        }
      }

      // Type line search (case-insensitive) - include card faces
      if (type) {
        const typeLower = type.toLowerCase();
        let hasTypeMatch = false;
        const typeLine = scryfallData.type || scryfallData.type_line || '';
        if (typeLine && typeLine.toLowerCase().includes(typeLower)) {
          hasTypeMatch = true;
        }
        if (!hasTypeMatch && scryfallData.card_faces) {
          hasTypeMatch = scryfallData.card_faces.some(face =>
            face.type_line && face.type_line.toLowerCase().includes(typeLower)
          );
        }
        if (!hasTypeMatch) {
          return false;
        }
      }
      
      // Colors (must include all selected colors)
      if (colors && colors.length > 0) {
        if (!scryfallData.colors || !colors.every(c => scryfallData.colors.includes(c))) {
          return false;
        }
      }

      // Mana cost (exact match, but flexible about brackets)
      if (manaCost) {
        const formattedManaCost = manaCost.replace(/\{/g, '').replace(/\}/g, '');
        const cardManaCost = (scryfallData.manaCost || scryfallData.mana_cost || '').replace(/\{/g, '').replace(/\}/g, '');
        if (cardManaCost !== formattedManaCost) {
          return false;
        }
      }
      
      // Power
      if (power && (!scryfallData.power || scryfallData.power !== power)) {
        return false;
      }

      // Toughness
      if (toughness && (!scryfallData.toughness || scryfallData.toughness !== toughness)) {
        return false;
      }
      
      // Mana value (converted mana cost)
      if (manaValue) {
        const cardManaValue = scryfallData.cmc || scryfallData.convertedManaCost || scryfallData.mana_value;
        if (!cardManaValue || parseInt(cardManaValue) !== parseInt(manaValue)) {
          return false;
        }
      }

      // Types search (case-insensitive)
      if (types) {
        const cardTypes = scryfallData.types || scryfallData.type_line || '';
        if (!cardTypes.toLowerCase().includes(types.toLowerCase())) {
          return false;
        }
      }

      // Subtypes search (case-insensitive)
      if (subTypes) {
        const cardSubtypes = scryfallData.subtypes || scryfallData.type_line || '';
        if (!cardSubtypes.toLowerCase().includes(subTypes.toLowerCase())) {
          return false;
        }
      }

      // Supertypes search (case-insensitive)
      if (superTypes) {
        const cardSupertypes = scryfallData.supertypes || scryfallData.type_line || '';
        if (!cardSupertypes.toLowerCase().includes(superTypes.toLowerCase())) {
          return false;
        }
      }

      // Rarity (exact match, case-insensitive)
      if (rarity && scryfallData.rarity.toLowerCase() !== rarity.toLowerCase()) {
        return false;
      }

      return true;
    })
    
    // Push results to callback if provided
    try {
      if (typeof this.setFilteredCollectionCards === 'function') {
        this.setFilteredCollectionCards(filtered);
      }
    } catch (err) {
      // Silent catch – parent may not provide callback
    }
  }

  handleCollectionSearch = (searchParams) => {
    this.filterCollectionCards(this.collectionCards, searchParams);
  }
}

export default SearchFunctions