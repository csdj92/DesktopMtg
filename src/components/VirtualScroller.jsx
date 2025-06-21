import React, { useCallback, useMemo } from 'react';
import { FixedSizeList as List } from 'react-window';
import InfiniteLoader from 'react-window-infinite-loader';
import Card from '../Card';

// This component wraps the InfiniteLoader and FixedSizeList from react-window
// to create a virtualized list that can load more items as the user scrolls.

// The Item renderer is now defined outside the main component
// It receives all its data from the `data` prop passed via `itemData`
const Item = ({ index, style, data }) => {
  const { items, hasNextPage, getCardsPerRow, containerWidth, totalItems } = data;
  const cardsPerRow = getCardsPerRow(containerWidth);
  const startIndex = index * cardsPerRow;
  const endIndex = Math.min(startIndex + cardsPerRow, totalItems);

  if (startIndex >= items.length && hasNextPage) {
    return (
      <div style={style} className="loading-indicator">
        <div className="loading-text">Loading more cards...</div>
      </div>
    );
  }

  const rowCards = [];
  for (let i = startIndex; i < endIndex; i++) {
    const card = items[i];
    if (card) {
      rowCards.push(
        <div key={card.id || `card-${i}`} className="virtual-grid-card">
          <Card card={card} />
        </div>
      );
    } else if (i < items.length) {
      rowCards.push(<div key={`placeholder-${i}`} className="virtual-grid-card" />);
    }
  }

  return (
    <div style={style} className="virtual-grid-row">
      {rowCards}
    </div>
  );
};

function VirtualScroller({
  hasNextPage,
  isNextPageLoading,
  items,
  loadNextPage,
  itemHeight = 320, // Height of a row of cards
  cardWidth = 240,  // Width of each card including gap
}) {
  const getCardsPerRow = useCallback((containerWidth) => {
    return Math.max(1, Math.floor(containerWidth / cardWidth));
  }, [cardWidth]);

  const getRowCount = useCallback((totalItems, cardsPerRow) => {
    return Math.ceil(totalItems / cardsPerRow);
  }, []);

  const isItemLoaded = useCallback((index, containerWidth) => {
    const cardsPerRow = getCardsPerRow(containerWidth);
    const startIndex = index * cardsPerRow;
    if (!hasNextPage) {
      return true;
    }
    return startIndex < items.length;
  }, [items.length, hasNextPage, getCardsPerRow]);

  const handleLoadMore = useCallback(() => {
    if (loadNextPage && !isNextPageLoading) {
      return loadNextPage();
    }
    return Promise.resolve();
  }, [loadNextPage, isNextPageLoading]);

  return (
    <div className="virtual-scroller-container">
      <AutoSizer>
        {({ height, width }) => {
          if (height === 0 || width === 0) {
            return null;
          }

          const cardsPerRow = getCardsPerRow(width);
          const totalItems = items.length + (hasNextPage ? cardsPerRow : 0);
          const rowCount = getRowCount(totalItems, cardsPerRow);

          // Create itemData object directly without useMemo since it's in render prop
          const itemData = {
            items,
            hasNextPage,
            getCardsPerRow,
            containerWidth: width,
            totalItems,
          };

          return (
            <InfiniteLoader
              isItemLoaded={(index) => isItemLoaded(index, width)}
              itemCount={rowCount}
              loadMoreItems={handleLoadMore}
              threshold={2}
            >
              {({ onItemsRendered, ref }) => (
                <List
                  className="virtual-list"
                  height={height}
                  itemCount={rowCount}
                  itemSize={itemHeight}
                  onItemsRendered={onItemsRendered}
                  ref={ref}
                  width={width}
                  itemData={itemData}
                >
                  {Item}
                </List>
              )}
            </InfiniteLoader>
          );
        }}
      </AutoSizer>
    </div>
  );
}

// Simplified AutoSizer component
class AutoSizer extends React.Component {
  state = {
    height: 0,
    width: 0,
  };

  container = React.createRef();

  componentDidMount() {
    this.updateSize();
    
    // Use ResizeObserver for better performance
    if (window.ResizeObserver) {
      this.resizeObserver = new ResizeObserver(() => {
        this.updateSize();
      });
      if (this.container.current) {
        this.resizeObserver.observe(this.container.current);
      }
    } else {
      // Fallback for older browsers
      window.addEventListener('resize', this.updateSize);
    }
  }

  componentWillUnmount() {
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
    } else {
      window.removeEventListener('resize', this.updateSize);
    }
  }

  updateSize = () => {
    if (this.container.current) {
      const rect = this.container.current.getBoundingClientRect();
      const height = rect.height;
      const width = rect.width;
      
      // Only update if dimensions actually changed
      if (this.state.height !== height || this.state.width !== width) {
        this.setState({ height, width });
      }
    }
  };

  render() {
    const { children } = this.props;
    const { height, width } = this.state;
    
    return (
      <div
        ref={this.container}
        style={{ height: '100%', width: '100%' }}
      >
        {height > 0 && width > 0 && children({ height, width })}
      </div>
    );
  }
}

export default VirtualScroller; 