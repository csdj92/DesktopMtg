import React, { useEffect, useMemo, useState } from 'react';
import './FormatLegality.css';

const SUPPORTED_FORMATS = [
  'standard', 'pioneer', 'modern', 'legacy', 'vintage', 'pauper', 'commander'
];

const normalize = (v) => (v || '').toString().toLowerCase();

const FormatLegality = ({ collectionCards = [] }) => {
  const [formats, setFormats] = useState(SUPPORTED_FORMATS);
  const [selected, setSelected] = useState('commander');

  useEffect(() => {
    // If backend lists supported formats, we could fetch them. Keep defaults for now.
  }, []);

  // Debug: show incoming cards and a small sample of their legalities/type lines
  useEffect(() => {
    try {
      const sample = (collectionCards || []).slice(0, 5).map((entry) => ({
        name: entry?.scryfallData?.name || entry?.name,
        quantity: entry?.quantity || entry?.total_quantity,
        legalities: entry?.scryfallData?.legalities || null,
        type_line:
          entry?.scryfallData?.type_line ||
          entry?.scryfallData?.type ||
          entry?.type_line ||
          entry?.type || null,
      }));
      console.log('[FormatLegality] collectionCards count:', collectionCards?.length || 0);
      console.log('[FormatLegality] sample:', sample);
    } catch (e) {
      console.warn('[FormatLegality] debug logging failed:', e);
    }
  }, [collectionCards]);

  const data = useMemo(() => {
    const totals = {
      unique: collectionCards.length,
      copies: collectionCards.reduce((s, c) => s + (c.quantity || c.total_quantity || 0), 0),
    };

    const byFormat = {};
    formats.forEach((f) => {
      byFormat[f] = { legal: 0, restricted: 0, banned: 0, not_legal: 0 };
    });

    collectionCards.forEach((entry) => {
      const legalities = (entry.scryfallData && entry.scryfallData.legalities) || {};
      formats.forEach((f) => {
        const status = normalize(legalities[f]) || 'not_legal';
        if (!byFormat[f][status]) byFormat[f][status] = 0;
        byFormat[f][status] += 1;
      });
    });

    // Specific breakdown for currently selected format, including percentage
    const sel = selected;
    const formatTotals = byFormat[sel] || { legal: 0, restricted: 0, banned: 0, not_legal: 0 };
    const pct = (n) => (totals.unique > 0 ? ((n / totals.unique) * 100).toFixed(1) : '0.0');

    const debugRow = Object.fromEntries(
      Object.entries(byFormat).map(([fmt, row]) => [fmt, { ...row }])
    );
    try {
      console.log('[FormatLegality] computed byFormat:', debugRow);
    } catch {}

    return { totals, byFormat, selected: sel, pct, formatTotals };
  }, [collectionCards, formats, selected]);

  const statusColor = (status) => {
    switch (status) {
      case 'legal':
        return '#16a34a';
      case 'restricted':
        return '#f59e0b';
      case 'banned':
        return '#ef4444';
      default:
        return '#6b7280';
    }
  };

  return (
    <div className="format-legality">
      <div className="fl-header">
        <h3>⚖️ Format Legality</h3>
        <div className="fl-controls">
          <label htmlFor="fl-format">Format:</label>
          <select id="fl-format" value={data.selected} onChange={(e) => setSelected(e.target.value)}>
            {formats.map((f) => (
              <option key={f} value={f}>{f}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="fl-summary">
        <div className="fl-card">
          <div className="fl-value">{data.totals.unique}</div>
          <div className="fl-label">Unique Cards</div>
        </div>
        <div className="fl-card">
          <div className="fl-value">{data.totals.copies}</div>
          <div className="fl-label">Total Copies</div>
        </div>
      </div>

      <div className="fl-breakdown">
        {['legal', 'restricted', 'banned', 'not_legal'].map((key) => (
          <div className="fl-row" key={key}>
            <span className="fl-status" style={{ color: statusColor(key) }}>{key.replace('_', ' ')}</span>
            <div className="fl-bar">
              <div
                className="fl-bar-fill"
                style={{
                  width: `${data.pct(data.formatTotals[key])}%`,
                  backgroundColor: statusColor(key),
                }}
              />
            </div>
            <span className="fl-count">{data.formatTotals[key] || 0} ({data.pct(data.formatTotals[key])}%)</span>
          </div>
        ))}
      </div>

      <div className="fl-table">
        <table>
          <thead>
            <tr>
              <th>Format</th>
              <th>Legal</th>
              <th>Restricted</th>
              <th>Banned</th>
              <th>Not Legal</th>
            </tr>
          </thead>
          <tbody>
            {formats.map((f) => {
              const row = data.byFormat[f] || {};
              return (
                <tr key={f} className={f === data.selected ? 'active' : ''}>
                  <td>{f}</td>
                  <td>{row.legal || 0}</td>
                  <td>{row.restricted || 0}</td>
                  <td>{row.banned || 0}</td>
                  <td>{row.not_legal || 0}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default FormatLegality;


