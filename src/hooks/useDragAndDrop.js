import { useState, useCallback } from 'react';

const useDragAndDrop = () => {
    const [dragState, setDragState] = useState({
        draggedCard: null,
        dragSource: null,
        dropTarget: null,
        isDragging: false
    });

    // Start drag operation
    const handleDragStart = useCallback((card, source, event) => {
        console.log('Drag start:', card.name, source);
        setDragState({
            draggedCard: card,
            dragSource: source,
            dropTarget: null,
            isDragging: true
        });

        // Set drag data with fallback
        try {
            // Create a simplified card object to avoid circular references
            const simplifiedCard = {
                id: card.id,
                instanceId: card.instanceId,
                name: card.name,
                type_line: card.type_line || card.type,
                type: card.type,
                mana_cost: card.mana_cost,
                image_uris: card.image_uris,
                card_faces: card.card_faces
            };

            const dragData = JSON.stringify({
                card: simplifiedCard,
                source
            });
            event.dataTransfer.setData('application/json', dragData);
            event.dataTransfer.setData('text/plain', card.name); // Fallback
            event.dataTransfer.effectAllowed = 'move';
        } catch (error) {
            console.error('Error setting drag data:', error);
            // Set minimal fallback data
            event.dataTransfer.setData('text/plain', card.name);
        }
    }, []);

    // Handle drag end
    const handleDragEnd = useCallback(() => {
        // Don't clear the drag state here - let the drop handler do it
        // This is because drop event fires after dragend in HTML5 drag and drop
        setDragState(prev => ({
            ...prev,
            isDragging: false
        }));
    }, []);

    // Set drop target
    const setDropTarget = useCallback((target) => {
        setDragState(prev => ({
            ...prev,
            dropTarget: target
        }));
    }, []);

    // Clear drop target
    const clearDropTarget = useCallback(() => {
        setDragState(prev => ({
            ...prev,
            dropTarget: null
        }));
    }, []);

    // Handle drop
    const handleDrop = useCallback((event, targetZone) => {
        event.preventDefault();
        console.log('Drop event:', targetZone, dragState);

        // Note: dragState.isDragging might be false here because dragEnd fires before drop
        // So we'll rely on the presence of draggedCard instead

        let result = null;

        // Use the drag state instead of dataTransfer for more reliable data
        if (dragState.draggedCard && dragState.dragSource) {
            console.log('Using drag state data');
            result = {
                card: dragState.draggedCard,
                source: dragState.dragSource,
                target: targetZone,
                success: true
            };
        } else {
            // Fallback to dataTransfer if state is not available
            try {
                const dragDataString = event.dataTransfer.getData('application/json');
                console.log('DataTransfer JSON:', dragDataString);
                if (dragDataString && dragDataString.trim()) {
                    const dragData = JSON.parse(dragDataString);
                    console.log('Parsed drag data:', dragData);
                    result = {
                        card: dragData.card,
                        source: dragData.source,
                        target: targetZone,
                        success: true
                    };
                }
            } catch (error) {
                console.error('Error parsing drag data:', error);
            }
        }

        // Clear drag state after processing drop
        setDragState({
            draggedCard: null,
            dragSource: null,
            dropTarget: null,
            isDragging: false
        });

        return result || {
            card: null,
            source: null,
            target: null,
            success: false
        };
    }, [dragState]);

    // Check if a zone is a valid drop target
    const isValidDropTarget = useCallback((zone, card) => {
        if (!card) return false;

        const cardType = (card.type_line || card.type || '').toLowerCase();

        switch (zone) {
            case 'battlefield-lands':
                return cardType.includes('land');
            case 'battlefield-creatures':
                return cardType.includes('creature');
            case 'battlefield-other':
                return !cardType.includes('land') && !cardType.includes('creature');
            case 'graveyard':
            case 'exile':
                return true;
            default:
                return false;
        }
    }, []);

    return {
        dragState,
        handleDragStart,
        handleDragEnd,
        setDropTarget,
        clearDropTarget,
        handleDrop,
        isValidDropTarget
    };
};

export default useDragAndDrop;