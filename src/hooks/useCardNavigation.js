import { useCallback, useEffect, useMemo } from 'react';

/**
 * Custom hook for managing keyboard navigation through a list of cards
 * @param {Array} cardList - Array of cards or card entries to navigate through
 * @param {Object} currentCard - Currently selected card
 * @param {Function} onCardChange - Callback when navigating to a different card
 * @param {boolean} isModalOpen - Whether the modal is currently open
 * @returns {Object} Navigation state and handlers
 */
const useCardNavigation = (cardList, currentCard, onCardChange, isModalOpen = false) => {
    // Memoize the current card index to avoid recalculation
    const currentIndex = useMemo(() => {
        if (!cardList || !currentCard) return -1;

        // Handle different card structures:
        // 1. Direct card objects (search results)
        // 2. Card entries with .card property
        // 3. Collection cards with .scryfallData property
        return cardList.findIndex(item => {
            const card = item.card || item.scryfallData || item;
            const currentCardData = currentCard.scryfallData || currentCard;
            return card.id === currentCardData.id;
        });
    }, [cardList, currentCard]);

    // Memoize navigation availability
    const navigationState = useMemo(() => ({
        hasPrevious: currentIndex > 0,
        hasNext: currentIndex >= 0 && currentIndex < cardList.length - 1,
        currentIndex,
        totalCards: cardList.length
    }), [currentIndex, cardList.length]);

    // Navigation handlers with useCallback to prevent unnecessary re-renders
    const navigateToPrevious = useCallback(() => {
        if (!navigationState.hasPrevious || !onCardChange) return;

        const previousItem = cardList[currentIndex - 1];
        // For collection cards, pass the full item (with scryfallData)
        // For other contexts, pass just the card data
        const previousCard = previousItem.scryfallData ? previousItem : (previousItem.card || previousItem);
        onCardChange(previousCard);
    }, [cardList, currentIndex, navigationState.hasPrevious, onCardChange]);

    const navigateToNext = useCallback(() => {
        if (!navigationState.hasNext || !onCardChange) return;

        const nextItem = cardList[currentIndex + 1];
        // For collection cards, pass the full item (with scryfallData)
        // For other contexts, pass just the card data
        const nextCard = nextItem.scryfallData ? nextItem : (nextItem.card || nextItem);
        onCardChange(nextCard);
    }, [cardList, currentIndex, navigationState.hasNext, onCardChange]);

    // Keyboard event handler
    const handleKeyPress = useCallback((event) => {
        // Only handle arrow keys and prevent default behavior
        if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;

        event.preventDefault();
        event.stopPropagation();

        switch (event.key) {
            case 'ArrowLeft':
                navigateToPrevious();
                break;
            case 'ArrowRight':
                navigateToNext();
                break;
            default:
                break;
        }
    }, [navigateToPrevious, navigateToNext]);

    // Set up keyboard event listeners when modal is open
    useEffect(() => {
        if (!isModalOpen) return;

        const handleKeyDown = (event) => handleKeyPress(event);

        // Add event listener to document to capture keyboard events globally
        document.addEventListener('keydown', handleKeyDown);

        // Cleanup function to remove event listener
        return () => {
            document.removeEventListener('keydown', handleKeyDown);
        };
    }, [isModalOpen, handleKeyPress]);

    return {
        ...navigationState,
        navigateToPrevious,
        navigateToNext,
        handleKeyPress
    };
};

export default useCardNavigation; 