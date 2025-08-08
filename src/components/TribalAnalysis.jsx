import React, { useEffect, useMemo, useState } from 'react';
import './TribalAnalysis.css';

const extractSubtypes = (typeLineRaw = '') => {
  // Handles: "Legendary Creature — Elf Druid", possible hyphen variants, and DFC using " // "
  const result = new Set();
  const typeLine = String(typeLineRaw);

  // Split double-faced types first
  const faces = typeLine.split(' // ');
  faces.forEach((face) => {
    // Try em dash, en dash, ascii hyphen, or the observed placeholder '???'
    let dashMatch = face.match(/\s(?:[—–-]|\?\?\?)\s(.+)$/);
    if (!dashMatch) {
      // Some data may have weird spacing; try a looser capture around the separators
      dashMatch = face.match(/(?:[—–-]|\?\?\?)\s*(.+)$/);
    }
    const right = dashMatch ? dashMatch[1] : '';
    if (right) {
      right.split(/\s+/).forEach((s) => {
        const cleaned = s.trim();
        if (cleaned) result.add(cleaned);
      });
    }
  });

  return Array.from(result);
};

const normalize = (s) => String(s || '').toLowerCase();

const COMMON_TRIBES = [
  'human', 'elf', 'goblin', 'zombie', 'vampire', 'angel', 'dragon', 'merfolk', 'warrior', 'wizard',
  'soldier', 'spirit', 'ally', 'sliver', 'construct', 'beast', 'cleric', 'elemental', 'demon', 'druid'
];

const TribalAnalysis = ({ collectionCards = [] }) => {
  const [cards, setCards] = useState(collectionCards);

  useEffect(() => {
    setCards(collectionCards);
  }, [collectionCards]);

  // Fallback: if no cards were passed, load from backend (user_collections)
  useEffect(() => {
    const load = async () => {
      try {
        if (!cards || cards.length === 0 && window?.electronAPI?.collectionGetSimple) {
          const fetched = await window.electronAPI.collectionGetSimple({ limit: 10000, offset: 0 });
          // Normalize to the same shape used in App processedCards
          const normalized = (fetched || []).map((card) => ({
            name: card.name,
            quantity: card.total_quantity || card.quantity || 1,
            foil_quantity: card.foil_quantity || 0,
            normal_quantity: card.normal_quantity || 0,
            scryfallData: card,
          }));
          console.log('[TribalAnalysis] Fallback fetched cards:', fetched?.length || 0);
          console.log('[TribalAnalysis] Sample fetched:', normalized.slice(0, 5).map(c => ({ name: c.name, type_line: c.scryfallData?.type_line || c.scryfallData?.type })));
          setCards(normalized);
        }
      } catch (e) {
        console.warn('TribalAnalysis fallback load failed:', e);
      }
    };
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const analysis = useMemo(() => {
    const tribeToCounts = new Map();

    console.log('[TribalAnalysis] analyzing cards count:', cards?.length || 0);

    (cards || []).forEach((entry, idx) => {
      const card = entry.scryfallData || {};
      const qty = Number(
        entry.quantity || entry.total_quantity || entry.normal_quantity + entry.foil_quantity || 0
      ) || 0;
      // Normalize odd separators (observed '???' in dataset). Convert to em dash form for parsing.
      const rawTypeLine = card.type_line || card.type || card.types || '';
      const normalizedTypeLine = String(rawTypeLine).replace(/\s\?\?\?\s/g, ' — ');
      const typeLine = normalizedTypeLine;

      // Focus on cards that have a subtype section
      let subs = extractSubtypes(typeLine);

      // If not found on main line, attempt card_faces
      if ((!subs || subs.length === 0) && Array.isArray(card.card_faces)) {
        card.card_faces.forEach((face) => {
          const faceSubs = extractSubtypes(face.type_line || face.type || '');
          faceSubs.forEach((s) => subs.push(s));
        });
      }

      if (idx < 5) {
        console.log('[TribalAnalysis] sample card', {
          name: card.name,
          qty,
          type_line: typeLine,
          subs,
        });
      }

      if (subs.length === 0) return;

      subs.forEach((sub) => {
        const tribe = normalize(sub);
        const prev = tribeToCounts.get(tribe) || { unique: 0, copies: 0 };
        // Count unique once per card
        prev.unique += 1;
        prev.copies += qty;
        tribeToCounts.set(tribe, prev);
      });
    });

    // Convert and sort by copies desc
    const rows = Array.from(tribeToCounts.entries())
      .map(([tribe, agg]) => ({ tribe, ...agg }))
      .sort((a, b) => b.copies - a.copies);

    const totalWithTribe = rows.reduce((s, r) => s + r.copies, 0);
    const topCommon = rows
      .filter((r) => COMMON_TRIBES.includes(r.tribe))
      .slice(0, 12);
    const topAll = rows.slice(0, 12);

    return { rows, totalWithTribe, topCommon, topAll };
  }, [cards]);

  const pct = (n, d) => (d > 0 ? ((n / d) * 100).toFixed(1) : '0.0');

  return (
    <div className="tribal-analysis">
      <div className="ta-header">
        <h3>🧬 Tribal Analysis</h3>
      </div>

      <div className="ta-summary">
        <div className="ta-card">
          <div className="ta-value">{analysis.rows.length}</div>
          <div className="ta-label">Detected Tribes</div>
        </div>
        <div className="ta-card">
          <div className="ta-value">{analysis.totalWithTribe}</div>
          <div className="ta-label">Copies With Subtypes</div>
        </div>
      </div>

      <div className="ta-sections">
        <div className="ta-section">
          <h4>🔥 Top Tribes (Overall)</h4>
          <div className="ta-list">
            {analysis.topAll.map((r) => (
              <div key={`all-${r.tribe}`} className="ta-item">
                <div className="ta-item-main">
                  <span className="ta-tribe">{r.tribe}</span>
                  <span className="ta-count">{r.copies} copies</span>
                </div>
                <div className="ta-bar">
                  <div
                    className="ta-bar-fill"
                    style={{ width: `${pct(r.copies, analysis.totalWithTribe)}%` }}
                    title={`${pct(r.copies, analysis.totalWithTribe)}% of subtype cards`}
                  />
                </div>
              </div>
            ))}
            {analysis.topAll.length === 0 && <div className="ta-empty">No creature subtypes detected</div>}
          </div>
        </div>

        <div className="ta-section">
          <h4>🏹 Common Tribes Focus</h4>
          <div className="ta-list">
            {analysis.topCommon.map((r) => (
              <div key={`common-${r.tribe}`} className="ta-item">
                <div className="ta-item-main">
                  <span className="ta-tribe">{r.tribe}</span>
                  <span className="ta-count">{r.copies} copies</span>
                </div>
                <div className="ta-bar">
                  <div
                    className="ta-bar-fill ta-common"
                    style={{ width: `${pct(r.copies, analysis.totalWithTribe)}%` }}
                  />
                </div>
              </div>
            ))}
            {analysis.topCommon.length === 0 && <div className="ta-empty">No common tribes found</div>}
          </div>
        </div>
      </div>
    </div>
  );
};

export default TribalAnalysis;


