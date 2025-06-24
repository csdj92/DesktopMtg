import React, { useState, useCallback } from 'react';
import debounce from 'lodash.debounce';

const SearchControls = ({ onSearch, bulkDataStats }) => {
  const [searchParams, setSearchParams] = useState({
    name: '',
    text: '',
    type: '',
    colors: [],
    manaCost: '',
    manaValue: '',
    power: '',
    toughness: '',
    rarity: '',
    subTypes: '',
    superTypes: '',
    types: '',
  });
  const [collapsed, setCollapsed] = useState(false);

  const toggleCollapsed = () => setCollapsed((prev) => !prev);

  const debouncedSearch = useCallback(
    debounce((params) => {
      onSearch(params);
    }, 500),
    [onSearch]
  );

  const handleChange = (e) => {
    const { name, value } = e.target;
    setSearchParams((prev) => {
      const newParams = { ...prev, [name]: value };
      debouncedSearch(newParams);
      return newParams;
    });
  };

  const handleColorChange = (color) => {
    setSearchParams((prev) => {
      const newColors = prev.colors.includes(color)
        ? prev.colors.filter((c) => c !== color)
        : [...prev.colors, color];
      const newParams = { ...prev, colors: newColors };
      debouncedSearch(newParams);
      return newParams;
    });
  };

  return (
    <div className={`search-controls-wrapper ${collapsed ? 'collapsed' : ''}`}>
      <div className="search-main">
        <input
          type="text"
          name="name"
          value={searchParams.name}
          onChange={handleChange}
          placeholder="Card name..."
          className="search-input"
        />
        {bulkDataStats && (
          <div className="database-info">
            📊 {bulkDataStats.cardCount?.toLocaleString()} cards available
          </div>
        )}
        <button
          type="button"
          className="collapse-button"
          onClick={toggleCollapsed}
          title={collapsed ? 'Expand search options' : 'Collapse search options'}
        >
          {collapsed ? '▾' : '▴'}
        </button>
      </div>
      {!collapsed && (
      <div className="search-advanced">
        <div className="search-field">
          <input
            type="text"
            name="text"
            value={searchParams.text}
            onChange={handleChange}
            placeholder="Oracle text..."
          />
        </div>
        <div className="search-field">
          <input
            type="text"
            name="type"
            value={searchParams.type}
            onChange={handleChange}
            placeholder="Type line..."
          />
        </div>
        <div className="search-field">
          <input
            type="text"
            name="types"
            value={searchParams.types}
            onChange={handleChange}
            placeholder="Types (e.g., Creature, Instant)..."
          />
        </div>
        <div className="search-field">
          <input
            type="text"
            name="subTypes"
            value={searchParams.subTypes}
            onChange={handleChange}
            placeholder="Subtypes (e.g., Human, Wizard)..."
          />
        </div>
        <div className="search-field">
          <input
            type="text"
            name="superTypes"
            value={searchParams.superTypes}
            onChange={handleChange}
            placeholder="Supertypes (e.g., Legendary, Basic)..."
          />
        </div>
        <div className="search-field">
            <div className="color-selector">
                {['W', 'U', 'B', 'R', 'G'].map((color) => (
                    <button
                        key={color}
                        className={`color-button ${searchParams.colors.includes(color) ? 'selected' : ''}`}
                        onClick={() => handleColorChange(color)}
                    >
                        {color}
                    </button>
                ))}
            </div>
        </div>
        <div className="search-field">
          <input
            type="text"
            name="manaCost"
            value={searchParams.manaCost}
            onChange={handleChange}
            placeholder="Mana cost (e.g., {2}{W}{U})..."
          />
        </div>
        <div className="search-field">
          <input
            type="number"
            name="manaValue"
            value={searchParams.manaValue}
            onChange={handleChange}
            placeholder="Mana value (CMC)..."
            min="0"
          />
        </div>
        <div className="search-field-group">
            <div className="search-field">
            <input
                type="text"
                name="power"
                value={searchParams.power}
                onChange={handleChange}
                placeholder="Power..."
            />
            </div>
            <div className="search-field">
            <input
                type="text"
                name="toughness"
                value={searchParams.toughness}
                onChange={handleChange}
                placeholder="Toughness..."
            />
            </div>
        </div>
        <div className="search-field">
            <select name="rarity" value={searchParams.rarity} onChange={handleChange}>
                <option value="">Any Rarity</option>
                <option value="common">Common</option>
                <option value="uncommon">Uncommon</option>
                <option value="rare">Rare</option>
                <option value="mythic">Mythic</option>
                <option value="special">Special</option>
                <option value="bonus">Bonus</option>
            </select>
        </div>
      </div>
      )}
    </div>
  );
};

export default SearchControls; 