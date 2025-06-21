import React, { useEffect, useState, memo } from 'react';
import './SetBrowser.css';

// Simple in-memory cache to persist set list for the lifetime of the renderer process
let cachedSets = null;

/**
 * Displays a scrollable list/grid of Magic: The Gathering sets.
 * When a set is clicked, it calls the provided onSelect callback with the set object { code, name, released_at, card_count }.
 */
const SetBrowserComponent = ({ onSelect }) => {
  const [sets, setSets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    const fetchSets = async () => {
      // If we already have cached data, use it immediately and skip fetch
      if (cachedSets && Array.isArray(cachedSets)) {
        setSets(cachedSets);
        setLoading(false);
        return;
      }

      try {
        const data = await window.electronAPI.listSets();
        // Sort by release date descending (newest first)
        const sorted = (data || []).sort((a, b) => {
          const aDate = new Date(a.released_at || '1970-01-01');
          const bDate = new Date(b.released_at || '1970-01-01');
          return bDate - aDate;
        });
        cachedSets = sorted; // cache for future mounts
        setSets(sorted);
      } catch (e) {
        console.error('Failed to load sets', e);
        setError('Failed to load sets');
      } finally {
        setLoading(false);
      }
    };

    fetchSets();
  }, []);

  if (loading) {
    return <div className="set-browser-loading">Loading sets…</div>;
  }

  if (error) {
    return <div className="set-browser-error">{error}</div>;
  }

  return (
    <div className="set-browser">
      {sets.map((set) => (
        <button
          key={set.code}
          className="set-browser-item"
          onClick={() => onSelect && onSelect(set)}
          title={`${set.name} (${set.code.toUpperCase()})`}
        >
          <span className="set-code">{set.code.toUpperCase()}</span>
          <span className="set-name">{set.name}</span>
        </button>
      ))}
    </div>
  );
};

// Wrap with React.memo to prevent unnecessary re-renders when parent props don't change
const SetBrowser = memo(SetBrowserComponent);

export default SetBrowser; 