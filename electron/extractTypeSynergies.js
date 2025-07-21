/**
 * Extract creature type synergies from oracle text
 * This is a completely rewritten version to ensure we only get one entry per tribal type
 */
const extractTypeSynergies = (text) => {
    const synergies = {};
    const processedTypes = new Set(); // Track which types we've already processed

    // Common creature types that appear in tribal strategies
    const tribalTypes = [
        'angel', 'beast', 'bird', 'demon', 'dragon', 'dwarf', 'elf', 'elemental', 'faerie', 'giant',
        'goblin', 'human', 'knight', 'merfolk', 'soldier', 'spirit', 'vampire', 'warrior', 'wizard', 'zombie'
    ];

    // First pass: collect all tribal synergies in a map to avoid duplicates
    const tribalMap = new Map();

    tribalTypes.forEach(type => {
        // Skip if we've already processed this type
        if (processedTypes.has(type)) return;

        // Check if the type is mentioned in the text (case insensitive)
        const typeRegex = new RegExp(type, 'i');
        if (!typeRegex.test(text)) return;

        // Look for synergy patterns
        const patterns = [
            `other ${type}`,
            `${type} creatures`,
            `${type} spells`,
            `cast ${type}`,
            `each ${type}`,
            `target ${type}`,
            `${type} you control`,
            `${type} entering`,
            `${type} enters`
        ];

        const matchedPatterns = patterns.filter(pattern =>
            text.toLowerCase().includes(pattern.toLowerCase())
        );

        if (matchedPatterns.length > 0) {
            // Mark this type as processed
            processedTypes.add(type);

            // Calculate strength once for this type
            const strength = calculateTribalStrength(text, type);

            // Store in map with all matched patterns
            tribalMap.set(type, {
                type: type,
                pattern: matchedPatterns[0], // Use first pattern for display
                patterns: matchedPatterns,
                matchCount: matchedPatterns.length,
                strength: strength
            });
        }
    });

    // Convert map to array for the final synergies object
    if (tribalMap.size > 0) {
        synergies.tribal = Array.from(tribalMap.values());
    }

    // Equipment synergies
    if (text.includes('equipment')) {
        synergies.equipment = extractEquipmentSynergies(text);
    }

    // Artifact synergies
    if (text.includes('artifact')) {
        synergies.artifacts = extractArtifactSynergies(text);
    }

    return synergies;
};

module.exports = extractTypeSynergies;