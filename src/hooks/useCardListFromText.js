import { useState, useCallback } from 'react';

/**
 * Hook: useCardListFromText
 * ----------------------------------------
 * Converts a deck object (shape used by DeckBuilder: { mainboard: [], commanders: [] })
 * into a text list understood by Commander Spellbook and POSTs it to their endpoint.
 *
 * Usage:
 *   const { sendToSpellbook, data, loading, error } = useCardListFromText(deck);
 *   // then call sendToSpellbook() when ready.
 */
export default function useCardListFromText(deck) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [parseErrors, setParseErrors] = useState([]);
  const [combos, setCombos] = useState(null);

  const buildDeckText = useCallback(() => {
    if (!deck) return '';

    // Build mainboard lines: "<qty> <card name>"
    const mainLines = deck.mainboard
      .filter(entry => entry && entry.card && entry.quantity)
      .map(entry => `${entry.quantity} ${entry.card.name}`);

    // Commander section
    const commanderLines = deck.commanders && deck.commanders.length > 0
      ? ['// Commanders',
         ...deck.commanders.map(c => `1 ${c.name}`)]
      : [];

    return [...mainLines, ...commanderLines].join('\n');
  }, [deck]);

  const fetchCombos = useCallback(async (deckObject) => {
    try {
      const query = new URLSearchParams({
        offset: '0',
        ordering: '-popularity,identity_count,card_count,-created',
        q: 'legal:commander'
      }).toString();
      if (process.env.NODE_ENV !== 'production') {
        console.log('[Spellbook] POST /find-my-combos body', deckObject);
      }
      const res = await fetch(`https://backend.commanderspellbook.com/find-my-combos?${query}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(deckObject)
      });
      if (!res.ok) throw new Error(`Combos API status ${res.status}`);
      const json = await res.json();
      if (process.env.NODE_ENV !== 'production') {
        console.log('[Spellbook] Combos response', json);
      }
      setCombos(json);
      return json;
    } catch (err) {
      console.error('fetchCombos error', err);
      return null;
    }
  }, []);

  const sendToSpellbook = useCallback(async (withCombos=false) => {
    try {
      setLoading(true);
      setError(null);
      setData(null);
      setCombos(null);

      const textPayload = buildDeckText();

      const res = await fetch('https://backend.commanderspellbook.com/card-list-from-text', {
        method: 'POST',
        headers: {
          'Content-Type': 'text/plain'
        },
        body: textPayload,
      });

      if (!res.ok) {
        if(res.status===400){
          const body = await res.json();
          const msgArr = [];
          if(Array.isArray(body.main)){
            body.main.forEach(m=> typeof m==='string' && msgArr.push(m));
          }
          Object.keys(body.main||{}).forEach(k=>{
            const entry=body.main[k];
            if(entry.card) msgArr.push(`Card #${k}: ${entry.card}`);
            if(entry.quantity) msgArr.push(`Card #${k} quantity: ${entry.quantity}`);
          });
          setParseErrors(msgArr);
          throw new Error('Deck list contained errors');
        }
        throw new Error(`Spellbook API responded with status ${res.status}`);
      }

      setParseErrors([]);
      const deckJson = await res.json();
      setData(deckJson);
      if(withCombos){
        await fetchCombos(deckJson);
      }
      return deckJson;
    } catch (err) {
      setError(err);
      console.error('useCardListFromText error:', err);
      return null;
    } finally {
      setLoading(false);
    }
  }, [buildDeckText, fetchCombos]);

  const deckText = buildDeckText();

  return { sendToSpellbook, data, combos, loading, error, parseErrors, deckText };
} 