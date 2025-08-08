import { useEffect, useState } from 'react';

export default function useDeckValidation(deck, format, debounceMs = 500) {
  const [results, setResults] = useState({ valid: true, errors: [], warnings: [] });

  useEffect(() => {
    const handle = setTimeout(async () => {
      try {
        if ((deck?.mainboard?.length || 0) > 0 || (deck?.commanders?.length || 0) > 0) {
          const res = await window.electronAPI.deckValidate(deck, format);
          setResults(res || { valid: true, errors: [], warnings: [] });
        } else {
          setResults({ valid: true, errors: [], warnings: [] });
        }
      } catch (e) {
        setResults({ valid: true, errors: [], warnings: [] });
      }
    }, debounceMs);
    return () => clearTimeout(handle);
  }, [deck, format, debounceMs]);

  return results;
}


