import React, { useState } from 'react';
import Card from '../Card';

const BattlefieldArea = ({
    gameState,
    onDropZoneEnter,
    onDropZoneLeave,
    onDrop,
    dragState,
    onCardTap
}) => {
    const [tappedCards, setTappedCards] = useState(new Set());
    const handleDragOver = (e, zone) => {
        e.preventDefault();
        onDropZoneEnter(zone);
    };

    const handleDragLeave = (e, zone) => {
        e.preventDefault();
        onDropZoneLeave();
    };

    const handleDrop = (e, zone) => {
        e.preventDefault();
        onDrop(e, zone);
    };

    const getZoneClass = (zone) => {
        const baseClass = `battlefield-zone zone-${zone}`;
        const isDropTarget = dragState.dropTarget === `battlefield-${zone}`;
        return `${baseClass} ${isDropTarget ? 'drop-target' : ''}`;
    };

    const getAuxiliaryZoneClass = (zone) => {
        const baseClass = `${zone}-zone`;
        const isDropTarget = dragState.dropTarget === zone;
        return `${baseClass} ${isDropTarget ? 'drop-target' : ''}`;
    };

    const handleCardTap = (card) => {
        const cardKey = `${card.id}-${card.instanceId}`;
        setTappedCards(prev => {
            const newSet = new Set(prev);
            if (newSet.has(cardKey)) {
                newSet.delete(cardKey);
            } else {
                newSet.add(cardKey);
            }
            return newSet;
        });

        // Call parent handler if provided
        if (onCardTap) {
            onCardTap(card, !tappedCards.has(cardKey));
        }
    };

    const isCardTapped = (card) => {
        const cardKey = `${card.id}-${card.instanceId}`;
        return tappedCards.has(cardKey);
    };

    const renderBattlefieldCard = (card, index, zone) => {
        const isTapped = isCardTapped(card);
        return (
            <div
                key={`${zone}-${card.id}-${index}`}
                className={`battlefield-card ${isTapped ? 'tapped' : ''}`}
                onClick={() => handleCardTap(card)}
                title={isTapped ? 'Click to untap' : 'Click to tap'}
            >
                <Card
                    card={card}
                    disableModal={false}
                    showFlipButton={true}
                />
                {isTapped && <div className="tap-indicator">⟲</div>}
            </div>
        );
    };

    return (
        <div className={`battlefield-area ${dragState.isDragging ? 'drag-active' : ''}`}>
            <h3>⚔️ Battlefield</h3>
            {dragState.isDragging && (
                <div className="drag-instruction">
                    Drop your card in the appropriate zone below
                </div>
            )}
            <div className="battlefield-zones">
                {/* Lands Zone */}
                <div
                    className={getZoneClass('lands')}
                    onDragOver={(e) => handleDragOver(e, 'battlefield-lands')}
                    onDragLeave={(e) => handleDragLeave(e, 'battlefield-lands')}
                    onDrop={(e) => handleDrop(e, 'battlefield-lands')}
                >
                    <h4>Lands</h4>
                    <div className="zone-cards">
                        {gameState.battlefield.lands.length === 0 ? (
                            <div className="drop-indicator">Drop lands here</div>
                        ) : (
                            gameState.battlefield.lands.map((card, index) =>
                                renderBattlefieldCard(card, index, 'lands')
                            )
                        )}
                    </div>
                </div>

                {/* Creatures Zone */}
                <div
                    className={getZoneClass('creatures')}
                    onDragOver={(e) => handleDragOver(e, 'battlefield-creatures')}
                    onDragLeave={(e) => handleDragLeave(e, 'battlefield-creatures')}
                    onDrop={(e) => handleDrop(e, 'battlefield-creatures')}
                >
                    <h4>Creatures</h4>
                    <div className="zone-cards">
                        {gameState.battlefield.creatures.length === 0 ? (
                            <div className="drop-indicator">Drop creatures here</div>
                        ) : (
                            gameState.battlefield.creatures.map((card, index) =>
                                renderBattlefieldCard(card, index, 'creatures')
                            )
                        )}
                    </div>
                </div>

                {/* Other Permanents Zone */}
                <div
                    className={getZoneClass('other')}
                    onDragOver={(e) => handleDragOver(e, 'battlefield-other')}
                    onDragLeave={(e) => handleDragLeave(e, 'battlefield-other')}
                    onDrop={(e) => handleDrop(e, 'battlefield-other')}
                >
                    <h4>Other Permanents</h4>
                    <div className="zone-cards">
                        {gameState.battlefield.other.length === 0 ? (
                            <div className="drop-indicator">Drop artifacts, enchantments, etc. here</div>
                        ) : (
                            gameState.battlefield.other.map((card, index) =>
                                renderBattlefieldCard(card, index, 'other')
                            )
                        )}
                    </div>
                </div>
            </div>

            {/* Auxiliary Zones */}
            <div className="auxiliary-zones">
                {/* Graveyard */}
                <div
                    className={getAuxiliaryZoneClass('graveyard')}
                    onDragOver={(e) => handleDragOver(e, 'graveyard')}
                    onDragLeave={(e) => handleDragLeave(e, 'graveyard')}
                    onDrop={(e) => handleDrop(e, 'graveyard')}
                >
                    <h4>Graveyard</h4>
                    <div
                        className="zone-stack"
                        onClick={() => gameState.graveyard.length > 0 && alert(`Graveyard contains ${gameState.graveyard.length} cards:\n${gameState.graveyard.map(c => c.name).join('\n')}`)}
                        title={gameState.graveyard.length > 0 ? 'Click to view all cards in graveyard' : 'Graveyard is empty'}
                    >
                        {gameState.graveyard.length === 0 ? (
                            <div className="drop-indicator">Drop cards to graveyard</div>
                        ) : (
                            gameState.graveyard.slice(-3).map((card, index) => (
                                <div key={`graveyard-${card.id}-${index}`} className="stack-card">
                                    <Card
                                        card={card}
                                        disableModal={false}
                                        showFlipButton={false}
                                    />
                                </div>
                            ))
                        )}
                    </div>
                    <div className="zone-count">{gameState.graveyard.length}</div>
                </div>

                {/* Exile */}
                <div
                    className={getAuxiliaryZoneClass('exile')}
                    onDragOver={(e) => handleDragOver(e, 'exile')}
                    onDragLeave={(e) => handleDragLeave(e, 'exile')}
                    onDrop={(e) => handleDrop(e, 'exile')}
                >
                    <h4>Exile</h4>
                    <div
                        className="zone-stack"
                        onClick={() => gameState.exile.length > 0 && alert(`Exile contains ${gameState.exile.length} cards:\n${gameState.exile.map(c => c.name).join('\n')}`)}
                        title={gameState.exile.length > 0 ? 'Click to view all cards in exile' : 'Exile is empty'}
                    >
                        {gameState.exile.length === 0 ? (
                            <div className="drop-indicator">Drop cards to exile</div>
                        ) : (
                            gameState.exile.slice(-3).map((card, index) => (
                                <div key={`exile-${card.id}-${index}`} className="stack-card">
                                    <Card
                                        card={card}
                                        disableModal={false}
                                        showFlipButton={false}
                                    />
                                </div>
                            ))
                        )}
                    </div>
                    <div className="zone-count">{gameState.exile.length}</div>
                </div>
            </div>
        </div>
    );
};

export default BattlefieldArea;