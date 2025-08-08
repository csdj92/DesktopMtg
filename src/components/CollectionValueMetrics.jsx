import React, { useMemo } from 'react';
import './CollectionValueMetrics.css';

const parseNumber = (val) => {
  if (val == null) return 0;
  if (typeof val === 'number') return val;
  const n = parseFloat(val);
  return Number.isFinite(n) ? n : 0;
};

const formatCurrency = (num) => `$${(num || 0).toFixed(2)}`;

const CollectionValueMetrics = ({ collectionCards = [] }) => {
  const metrics = useMemo(() => {
    const result = {
      totalValue: 0,
      totalFoilValue: 0,
      totalRegularValue: 0,
      averageValuePerUnique: 0,
      averageValuePerCopy: 0,
      totalCopies: 0,
      uniqueCount: 0,
      pricedUniqueCount: 0,
      valueBySet: {},
      topValuable: [],
    };

    const topCandidates = [];

    collectionCards.forEach((entry) => {
      const card = entry.scryfallData || {};
      const qty = parseNumber(entry.quantity || entry.total_quantity || 0);
      const foilQty = parseNumber(entry.foil_quantity || 0);
      const normalQty = parseNumber(entry.normal_quantity || 0);

      const prices = card.prices || {};
      const regularPrice = parseNumber(prices.usd_regular ?? prices.usd);
      const foilPrice = parseNumber(prices.usd_foil);

      const cardRegularValue = regularPrice * normalQty;
      const cardFoilValue = foilPrice * foilQty;
      const cardTotalValue = cardRegularValue + cardFoilValue;

      result.totalRegularValue += cardRegularValue;
      result.totalFoilValue += cardFoilValue;
      result.totalValue += cardTotalValue;
      result.totalCopies += qty;

      // Price coverage
      if (regularPrice > 0 || foilPrice > 0) {
        result.pricedUniqueCount += 1;
      }

      // Value by set
      const setCode = entry.setCode || card.set || card.setCode || 'UNKNOWN';
      result.valueBySet[setCode] = (result.valueBySet[setCode] || 0) + cardTotalValue;

      // Top valuable cards (by total holding value)
      topCandidates.push({
        name: card.name || entry.name,
        set: setCode,
        quantity: qty,
        totalValue: cardTotalValue,
        priceRegular: regularPrice,
        priceFoil: foilPrice,
      });
    });

    result.uniqueCount = collectionCards.length;
    result.averageValuePerUnique = result.uniqueCount > 0 ? result.totalValue / result.uniqueCount : 0;
    result.averageValuePerCopy = result.totalCopies > 0 ? result.totalValue / result.totalCopies : 0;

    // Top 10 valuable holdings
    topCandidates.sort((a, b) => b.totalValue - a.totalValue);
    result.topValuable = topCandidates.slice(0, 10);

    return result;
  }, [collectionCards]);

  const valueBySetSorted = useMemo(() => {
    return Object.entries(metrics.valueBySet)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8);
  }, [metrics.valueBySet]);

  const priceCoveragePct = metrics.uniqueCount > 0
    ? ((metrics.pricedUniqueCount / metrics.uniqueCount) * 100).toFixed(1)
    : '0.0';

  return (
    <div className="collection-value-metrics">
      <div className="cvm-header">
        <h3>💰 Collection Value Metrics</h3>
      </div>

      <div className="cvm-grid">
        <div className="cvm-card">
          <div className="cvm-value">{formatCurrency(metrics.totalValue)}</div>
          <div className="cvm-label">Total Estimated Value</div>
        </div>
        <div className="cvm-card">
          <div className="cvm-value">{formatCurrency(metrics.totalRegularValue)}</div>
          <div className="cvm-label">Regular Value</div>
        </div>
        <div className="cvm-card">
          <div className="cvm-value">{formatCurrency(metrics.totalFoilValue)}</div>
          <div className="cvm-label">Foil Value</div>
        </div>
        <div className="cvm-card">
          <div className="cvm-value">{formatCurrency(metrics.averageValuePerUnique)}</div>
          <div className="cvm-label">Avg Value per Unique</div>
        </div>
        <div className="cvm-card">
          <div className="cvm-value">{formatCurrency(metrics.averageValuePerCopy)}</div>
          <div className="cvm-label">Avg Value per Copy</div>
        </div>
        <div className="cvm-card">
          <div className="cvm-value">{priceCoveragePct}%</div>
          <div className="cvm-label">Price Coverage</div>
        </div>
      </div>

      <div className="cvm-sections">
        <div className="cvm-section">
          <h4>🏷️ Value by Set</h4>
          <div className="cvm-bars">
            {valueBySetSorted.map(([set, val]) => (
              <div key={set} className="cvm-bar-row">
                <span className="cvm-bar-label">{set}</span>
                <div className="cvm-bar-track">
                  <div
                    className="cvm-bar-fill"
                    style={{ width: `${metrics.totalValue > 0 ? (val / metrics.totalValue) * 100 : 0}%` }}
                    title={`${set}: ${formatCurrency(val)}`}
                  />
                </div>
                <span className="cvm-bar-value">{formatCurrency(val)}</span>
              </div>
            ))}
            {valueBySetSorted.length === 0 && (
              <div className="cvm-empty">No set value data</div>
            )}
          </div>
        </div>

        <div className="cvm-section">
          <h4>💎 Top Valuable Holdings</h4>
          <div className="cvm-top-list">
            {metrics.topValuable.map((item) => (
              <div key={`${item.name}|${item.set}`} className="cvm-top-item">
                <div className="cvm-top-main">
                  <span className="cvm-top-name">{item.name}</span>
                  <span className="cvm-top-set">[{item.set}]</span>
                </div>
                <div className="cvm-top-sub">
                  <span className="cvm-top-qty">x{item.quantity}</span>
                  <span className="cvm-top-val">{formatCurrency(item.totalValue)}</span>
                </div>
              </div>
            ))}
            {metrics.topValuable.length === 0 && (
              <div className="cvm-empty">No priced cards</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default CollectionValueMetrics;


