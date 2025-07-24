import React from 'react';
import Card from '../Card';

const DragPreview = ({ dragState, dragPreviewRef }) => {
    if (!dragState.isDragging || !dragState.draggedCard) {
        return null;
    }

    return (
        <div
            ref={dragPreviewRef}
            className="drag-preview"
            style={{
                position: 'fixed',
                pointerEvents: 'none',
                zIndex: 1000,
                width: '120px',
                display: 'none'
            }}
        >
            <Card
                card={dragState.draggedCard}
                disableModal={true}
                showFlipButton={false}
            />
        </div>
    );
};

export default DragPreview;