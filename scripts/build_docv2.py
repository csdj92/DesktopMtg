import sqlite3
import json
import re
import hashlib
import pickle
import os
from pathlib import Path
from typing import List, Dict, Any, Optional, Tuple

import numpy as np
import lancedb
from lancedb.pydantic import LanceModel, Vector
from sentence_transformers import SentenceTransformer
import torch  # GPU detection


class MagicCard(LanceModel):
    # Existing fields
    name: str
    mana_cost: str | None = None
    mana_value: float
    type_line: str
    oracle_text: str | None = None
    image_uri: str
    keywords: List[str]
    colors: List[str]
    color_identity: List[str]
    power: str | None = None
    toughness: str | None = None
    loyalty: str | None = None
    rarity: str
    legalities: str  # store JSON text
    set_name: str
    vector: Vector(384)  # Legacy vector field for backward compatibility

    # Multiple vector fields for different embedding types (384 dimensions for all-MiniLM-L6-v2)
    primary_vector: Vector(
        384
    )  # Main semantic embedding - enhanced document representation
    keyword_vector: Vector(384)  # Keyword-optimized embedding for exact matching
    context_vector: Vector(384)  # Context-enhanced embedding with gameplay information

    # Preprocessed text fields for enhanced search capabilities
    normalized_text: str  # MTG-normalized oracle text with mana symbols converted
    expanded_abilities: str  # Expanded ability descriptions with full reminder text
    gameplay_context: List[str]  # Contextual gameplay tags and strategic information

    # Search metadata fields for ranking and filtering
    search_tags: List[str]  # Generated search tags for faceted search
    complexity_score: float  # Card complexity score for ranking (0.0-1.0)
    popularity_score: float  # Usage frequency score for ranking (0.0-1.0)


def create_card_document(card: dict) -> str:
    """Create a natural language description of the card for semantic embedding"""
    parts = []

    # Start with the card name
    name = card.get("name", "")
    if name:
        parts.append(name)

    # Add mana cost in natural language
    mana_cost = card.get("manaCost", "")
    if mana_cost:
        parts.append(f"costs {mana_cost}")

    # Add type line
    type_line = card.get("type", "")
    if type_line:
        parts.append(type_line)

    # Add power/toughness for creatures
    if card.get("power") is not None and card.get("toughness") is not None:
        parts.append(f"{card['power']}/{card['toughness']}")

    # Add loyalty for planeswalkers
    if card.get("loyalty") is not None:
        parts.append(f"loyalty {card['loyalty']}")

    # Add oracle text (the most important part for semantic search)
    oracle_text = card.get("text", "")
    if oracle_text:
        parts.append(oracle_text)

    # Add keywords
    keywords = card.get("keywords", [])
    if keywords and isinstance(keywords, list):
        parts.append("keywords: " + ", ".join(keywords))

    # Add colors
    colors = card.get("colors", [])
    if colors and isinstance(colors, list):
        color_names = {
            "W": "white",
            "U": "blue",
            "B": "black",
            "R": "red",
            "G": "green",
        }
        color_words = [color_names.get(c, c) for c in colors]
        parts.append("colors: " + ", ".join(color_words))

    # Join all parts with spaces to create natural language
    return " ".join(parts)


class EnhancedDocumentProcessor:
    """Enhanced document processor that creates multiple document representations for each card"""

    def __init__(self):
        # MTG-specific mappings and patterns
        self.color_names = {
            "W": "white",
            "U": "blue",
            "B": "black",
            "R": "red",
            "G": "green",
        }

        # Common MTG ability keywords and their expanded descriptions
        self.ability_expansions = {
            "flying": "Flying (This creature can't be blocked except by creatures with flying or reach)",
            "trample": "Trample (This creature can deal excess combat damage to the player or planeswalker it's attacking)",
            "vigilance": "Vigilance (Attacking doesn't cause this creature to tap)",
            "lifelink": "Lifelink (Damage dealt by this creature also causes you to gain that much life)",
            "deathtouch": "Deathtouch (Any amount of damage this deals to a creature is enough to destroy it)",
            "haste": "Haste (This creature can attack and tap as soon as it comes under your control)",
            "reach": "Reach (This creature can block creatures with flying)",
            "first strike": "First strike (This creature deals combat damage before creatures without first strike)",
            "double strike": "Double strike (This creature deals first strike and regular combat damage)",
            "hexproof": "Hexproof (This creature can't be the target of spells or abilities your opponents control)",
            "indestructible": 'Indestructible (Effects that say "destroy" don\'t destroy this creature)',
            "menace": "Menace (This creature can't be blocked except by two or more creatures)",
            "defender": "Defender (This creature can't attack)",
            "flash": "Flash (You may cast this spell any time you could cast an instant)",
        }

        # Card type categories for contextual processing
        self.creature_types = ["creature", "artifact creature", "enchantment creature"]
        self.spell_types = ["instant", "sorcery"]
        self.planeswalker_types = ["planeswalker"]

    def create_enhanced_document(self, card: Dict[str, Any]) -> Dict[str, str]:
        """Create multiple document representations for different search needs"""
        return {
            "primary_doc": self.create_primary_document(card),
            "keyword_doc": self.create_keyword_document(card),
            "context_doc": self.create_context_document(card),
        }

    def create_primary_document(self, card: Dict[str, Any]) -> str:
        """Enhanced version of current create_card_document with better MTG awareness"""
        parts = []

        # Start with the card name
        name = card.get("name", "")
        if name:
            parts.append(name)

        # Add mana cost with more natural language
        mana_cost = card.get("manaCost", "")
        if mana_cost:
            readable_cost = self._convert_mana_cost_to_text(mana_cost)
            parts.append(f"costs {readable_cost}")

        # Add type line with emphasis
        type_line = card.get("type", "")
        if type_line:
            parts.append(f"is a {type_line.lower()}")

        # Add power/toughness for creatures with context
        if card.get("power") is not None and card.get("toughness") is not None:
            power = card["power"]
            toughness = card["toughness"]
            parts.append(f"with {power} power and {toughness} toughness")

        # Add loyalty for planeswalkers
        if card.get("loyalty") is not None:
            parts.append(f"starting loyalty {card['loyalty']}")

        # Add oracle text with expanded abilities
        oracle_text = card.get("text", "")
        keywords = card.get("keywords", [])

        if oracle_text:
            # Check if oracle text is just a list of keywords
            oracle_lower = oracle_text.lower().replace(",", "").replace(".", "").strip()
            keyword_names = [k.lower() for k in keywords] if keywords else []

            # If oracle text is just keywords, expand them; otherwise expand the full text
            if oracle_lower and all(
                word in keyword_names for word in oracle_lower.split() if word
            ):
                # Oracle text is just keywords, so expand them
                if keywords and isinstance(keywords, list):
                    expanded_keywords = []
                    for keyword in keywords:
                        keyword_lower = keyword.lower()
                        if keyword_lower in self.ability_expansions:
                            expanded_keywords.append(
                                self.ability_expansions[keyword_lower]
                            )
                        else:
                            expanded_keywords.append(keyword)
                    if expanded_keywords:
                        parts.append(" ".join(expanded_keywords))
            else:
                # Oracle text has more than just keywords, expand abilities within it
                expanded_text = self._expand_ability_keywords(oracle_text)
                parts.append(expanded_text)

                # Add any additional keywords not mentioned in oracle text
                if keywords and isinstance(keywords, list):
                    additional_keywords = []
                    for keyword in keywords:
                        keyword_lower = keyword.lower()
                        if keyword_lower not in oracle_text.lower():
                            if keyword_lower in self.ability_expansions:
                                additional_keywords.append(
                                    self.ability_expansions[keyword_lower]
                                )
                            else:
                                additional_keywords.append(keyword)
                    if additional_keywords:
                        parts.append(" ".join(additional_keywords))
        elif keywords and isinstance(keywords, list):
            # No oracle text, just expand keywords
            expanded_keywords = []
            for keyword in keywords:
                keyword_lower = keyword.lower()
                if keyword_lower in self.ability_expansions:
                    expanded_keywords.append(self.ability_expansions[keyword_lower])
                else:
                    expanded_keywords.append(keyword)
            if expanded_keywords:
                parts.append(" ".join(expanded_keywords))

        # Add colors with natural language
        colors = card.get("colors", [])
        if colors and isinstance(colors, list):
            color_words = [self.color_names.get(c, c) for c in colors]
            if len(color_words) == 1:
                parts.append(f"is {color_words[0]}")
            elif len(color_words) > 1:
                parts.append(f"is {' and '.join(color_words)}")

        return " ".join(parts)

    def create_keyword_document(self, card: Dict[str, Any]) -> str:
        """Create document optimized for exact text matching and keyword search"""
        parts = []

        # Exact card name for precise matching
        name = card.get("name", "")
        if name:
            parts.append(name)

        # Exact mana cost symbols
        mana_cost = card.get("manaCost", "")
        if mana_cost:
            parts.append(mana_cost)

        # Exact type line
        type_line = card.get("type", "")
        if type_line:
            parts.append(type_line)

        # Exact oracle text without expansions
        oracle_text = card.get("text", "")
        if oracle_text:
            parts.append(oracle_text)

        # Exact keywords
        keywords = card.get("keywords", [])
        if keywords and isinstance(keywords, list):
            parts.extend(keywords)

        # Exact power/toughness
        if card.get("power") is not None and card.get("toughness") is not None:
            parts.append(f"{card['power']}/{card['toughness']}")

        # Exact loyalty
        if card.get("loyalty") is not None:
            parts.append(str(card["loyalty"]))

        # Color abbreviations and names
        colors = card.get("colors", [])
        if colors and isinstance(colors, list):
            parts.extend(colors)  # Add color abbreviations
            color_words = [self.color_names.get(c, c) for c in colors]
            parts.extend(color_words)  # Add color names

        # Rarity for filtering
        rarity = card.get("rarity", "")
        if rarity:
            parts.append(rarity)

        # Set code for filtering
        set_code = card.get("setCode", "")
        if set_code:
            parts.append(set_code)

        return " ".join(parts)

    def create_context_document(self, card: Dict[str, Any]) -> str:
        """Create document with expanded gameplay context and relationships"""
        parts = []

        # Start with basic info
        name = card.get("name", "")
        if name:
            parts.append(name)

        type_line = card.get("type", "")
        if type_line:
            parts.append(type_line)

        # Add contextual information based on card type
        if self._is_creature(card):
            parts.extend(self._add_creature_context(card))
        elif self._is_spell(card):
            parts.extend(self._add_spell_context(card))
        elif self._is_planeswalker(card):
            parts.extend(self._add_planeswalker_context(card))

        # Add oracle text
        oracle_text = card.get("text", "")
        if oracle_text:
            parts.append(oracle_text)

        # Add strategic context based on abilities and effects
        strategic_context = self._generate_strategic_context(card)
        if strategic_context:
            parts.extend(strategic_context)

        return " ".join(parts)

    def _convert_mana_cost_to_text(self, mana_cost: str) -> str:
        """Convert mana symbols to readable text"""
        if not mana_cost:
            return ""

        # Remove braces and convert symbols
        text_parts = []
        symbols = re.findall(r"\{([^}]+)\}", mana_cost)

        for symbol in symbols:
            if symbol.isdigit():
                if symbol == "0":
                    text_parts.append("zero")
                elif symbol == "1":
                    text_parts.append("one")
                else:
                    text_parts.append(f"{symbol} generic")
            elif symbol in self.color_names:
                text_parts.append(self.color_names[symbol])
            elif symbol == "X":
                text_parts.append("X")
            else:
                text_parts.append(symbol)

        return " ".join(text_parts) + " mana" if text_parts else mana_cost

    def _expand_ability_keywords(self, text: str) -> str:
        """Expand ability keywords in oracle text with their full descriptions"""
        if not text:
            return ""

        expanded_text = text
        for keyword, expansion in self.ability_expansions.items():
            # Look for the keyword at word boundaries
            pattern = r"\b" + re.escape(keyword) + r"\b"
            if re.search(pattern, expanded_text, re.IGNORECASE):
                expanded_text = re.sub(
                    pattern, expansion, expanded_text, flags=re.IGNORECASE
                )

        return expanded_text

    def _is_creature(self, card: Dict[str, Any]) -> bool:
        """Check if card is a creature"""
        type_line = card.get("type", "").lower()
        return any(creature_type in type_line for creature_type in self.creature_types)

    def _is_spell(self, card: Dict[str, Any]) -> bool:
        """Check if card is an instant or sorcery"""
        type_line = card.get("type", "").lower()
        return any(spell_type in type_line for spell_type in self.spell_types)

    def _is_planeswalker(self, card: Dict[str, Any]) -> bool:
        """Check if card is a planeswalker"""
        type_line = card.get("type", "").lower()
        return any(pw_type in type_line for pw_type in self.planeswalker_types)

    def _add_creature_context(self, card: Dict[str, Any]) -> List[str]:
        """Add creature-specific contextual information with enhanced combat and ability analysis"""
        context = []

        power = card.get("power")
        toughness = card.get("toughness")
        oracle_text = card.get("text", "").lower() if card.get("text") else ""
        keywords = [k.lower() for k in (card.get("keywords") or [])]

        # Enhanced power/toughness analysis
        if power is not None and toughness is not None:
            try:
                p_val = int(power) if power != "*" else 0
                t_val = int(toughness) if toughness != "*" else 0

                # Combat role analysis
                if p_val >= 5:
                    context.append("powerful attacker")
                elif p_val >= 3:
                    context.append("aggressive attacker")
                elif p_val >= 1:
                    context.append("modest attacker")
                else:
                    context.append("non-combat creature")

                if t_val >= 5:
                    context.append("resilient blocker")
                elif t_val >= 3:
                    context.append("durable blocker")
                elif t_val >= 1:
                    context.append("fragile blocker")

                # Size categories
                total_stats = p_val + t_val
                if total_stats >= 10:
                    context.append("massive creature")
                elif total_stats >= 7:
                    context.append("large creature")
                elif total_stats >= 4:
                    context.append("medium creature")
                else:
                    context.append("small creature")

                # Combat efficiency
                if p_val > t_val:
                    context.append("offense-focused")
                elif t_val > p_val:
                    context.append("defense-focused")
                else:
                    context.append("balanced stats")

            except (ValueError, TypeError):
                context.append("variable power and toughness")

        # Enhanced ability-based context
        if "enters the battlefield" in oracle_text:
            context.append("enters the battlefield trigger")
            if "when" in oracle_text and "enters the battlefield" in oracle_text:
                context.append("ETB value creature")

        if "when" in oracle_text and "dies" in oracle_text:
            context.append("death trigger")
            context.append("sacrifice synergy")

        if "when" in oracle_text and "attacks" in oracle_text:
            context.append("attack trigger")
            context.append("aggressive synergy")

        if "when" in oracle_text and "blocks" in oracle_text:
            context.append("block trigger")
            context.append("defensive synergy")

        if any(
            tap_indicator in oracle_text
            for tap_indicator in ["tap:", "{t}:", "tap to", "tap this"]
        ):
            context.append("activated ability")
            context.append("utility creature")

        # Combat ability analysis
        combat_abilities = [
            "flying",
            "trample",
            "menace",
            "double strike",
            "first strike",
        ]
        if any(ability in keywords for ability in combat_abilities):
            context.append("combat-focused abilities")

        evasion_abilities = [
            "flying",
            "menace",
            "unblockable",
            "shadow",
            "fear",
            "intimidate",
        ]
        if any(ability in keywords for ability in evasion_abilities):
            context.append("evasive creature")

        protection_abilities = [
            "hexproof",
            "shroud",
            "protection",
            "indestructible",
            "ward",
        ]
        if any(
            ability in keywords or ability in oracle_text
            for ability in protection_abilities
        ):
            context.append("protected creature")

        # Mana cost analysis for creatures
        mana_value = card.get("manaValue", 0)
        if isinstance(mana_value, (int, float)):
            if mana_value <= 1:
                context.append("early game creature")
            elif mana_value <= 3:
                context.append("mid-game creature")
            elif mana_value <= 5:
                context.append("late-game creature")
            else:
                context.append("expensive threat")

        # Tribal and synergy indicators
        type_line = card.get("type", "").lower()
        tribal_types = [
            "human",
            "elf",
            "goblin",
            "zombie",
            "dragon",
            "angel",
            "demon",
            "beast",
            "soldier",
        ]
        for tribal in tribal_types:
            if tribal in type_line:
                context.append(f"{tribal} tribal")
                break

        return context

    def _add_spell_context(self, card: Dict[str, Any]) -> List[str]:
        """Add spell-specific contextual information with enhanced timing and targeting analysis"""
        context = []

        type_line = card.get("type", "").lower()
        oracle_text = card.get("text", "").lower() if card.get("text") else ""
        mana_value = card.get("manaValue", 0)

        # Enhanced instant analysis
        if "instant" in type_line:
            context.append("can be cast at instant speed")
            context.append("reactive spell")
            context.append("stack interaction")

            # Instant-specific effects
            if "counter" in oracle_text:
                context.append("counterspell")
                context.append("control magic")
            if "damage" in oracle_text:
                context.append("direct damage")
                context.append("burn spell")
            if "prevent" in oracle_text:
                context.append("damage prevention")
                context.append("protection spell")
            if "draw" in oracle_text:
                context.append("instant card draw")
            if "return" in oracle_text and "hand" in oracle_text:
                context.append("bounce spell")
            if "tap" in oracle_text or "untap" in oracle_text:
                context.append("tempo spell")

            # Combat tricks
            if any(
                combat_word in oracle_text
                for combat_word in ["+", "power", "toughness", "combat", "block"]
            ):
                context.append("combat trick")

        # Enhanced sorcery analysis
        if "sorcery" in type_line:
            context.append("sorcery speed spell")
            context.append("proactive spell")
            context.append("main phase only")

            # Sorcery-specific effects
            if "destroy" in oracle_text:
                context.append("removal spell")
                if "all" in oracle_text or "each" in oracle_text:
                    context.append("mass removal")
                    context.append("board wipe")
            if "draw" in oracle_text:
                context.append("card draw")
                if "cards" in oracle_text:
                    context.append("card advantage")
            if "search" in oracle_text:
                context.append("tutor effect")
                if "library" in oracle_text:
                    context.append("library search")
            if "return" in oracle_text and "graveyard" in oracle_text:
                context.append("recursion spell")
            if "create" in oracle_text and "token" in oracle_text:
                context.append("token generation")
            if "gain control" in oracle_text:
                context.append("theft effect")
            if "extra turn" in oracle_text:
                context.append("time walk effect")

        # Enhanced targeting analysis
        if "target" in oracle_text:
            context.append("requires target")

            # Target type analysis
            if "target player" in oracle_text:
                context.append("targets player")
            if "target creature" in oracle_text:
                context.append("targets creature")
            if "target artifact" in oracle_text or "target enchantment" in oracle_text:
                context.append("targets permanent")
            if "target spell" in oracle_text:
                context.append("targets spell")

            # Multiple targets
            if "up to" in oracle_text or "any number" in oracle_text:
                context.append("flexible targeting")
        else:
            context.append("no targeting required")

        # Mana cost analysis for spells
        if isinstance(mana_value, (int, float)):
            if mana_value <= 1:
                context.append("cheap spell")
                context.append("early game spell")
            elif mana_value <= 3:
                context.append("efficient spell")
                context.append("mid-game spell")
            elif mana_value <= 5:
                context.append("expensive spell")
                context.append("late-game spell")
            else:
                context.append("high-cost spell")
                context.append("finisher spell")

        # Modal spells
        if (
            "choose one" in oracle_text
            or "choose two" in oracle_text
            or "choose three" in oracle_text
        ):
            context.append("modal spell")
            context.append("versatile effect")

        # X spells
        mana_cost = card.get("manaCost") or ""
        if "{x}" in mana_cost.lower():
            context.append("X spell")
            context.append("scalable effect")

        # Conditional effects
        if "if" in oracle_text:
            context.append("conditional effect")

        # Spell type categorization
        spell_categories = {
            "removal": ["destroy", "exile", "damage", "sacrifice"],
            "card advantage": ["draw", "search", "return", "create"],
            "disruption": ["counter", "discard", "mill"],
            "utility": ["tap", "untap", "prevent", "gain"],
            "ramp": ["add mana", "search for a land", "basic land"],
        }

        for category, keywords in spell_categories.items():
            if any(keyword in oracle_text for keyword in keywords):
                context.append(f"{category} spell")

        return context

    def _add_planeswalker_context(self, card: Dict[str, Any]) -> List[str]:
        """Add planeswalker-specific contextual information with enhanced loyalty ability descriptions"""
        context = []

        oracle_text = card.get("text", "") if card.get("text") else ""
        oracle_text_lower = oracle_text.lower()
        mana_value = card.get("manaValue", 0)

        # Enhanced loyalty analysis
        loyalty = card.get("loyalty")
        if loyalty is not None:
            try:
                loyalty_val = int(loyalty)
                if loyalty_val >= 6:
                    context.append("very high loyalty planeswalker")
                    context.append("durable planeswalker")
                elif loyalty_val >= 4:
                    context.append("high loyalty planeswalker")
                    context.append("resilient planeswalker")
                elif loyalty_val >= 3:
                    context.append("medium loyalty planeswalker")
                else:
                    context.append("low loyalty planeswalker")
                    context.append("fragile planeswalker")
            except (ValueError, TypeError):
                context.append("variable loyalty planeswalker")

        # Enhanced ability analysis with natural language descriptions
        ability_lines = oracle_text.split("\n")
        plus_abilities = []
        minus_abilities = []
        ultimate_abilities = []

        for line in ability_lines:
            line_lower = line.lower().strip()
            if line.startswith("+") or line.startswith("−") or line.startswith("-"):
                # Extract loyalty cost and effect
                if line.startswith("+"):
                    plus_abilities.append(line)
                    context.append("loyalty gaining ability")
                elif line.startswith("−") or line.startswith("-"):
                    minus_abilities.append(line)
                    context.append("loyalty costing ability")

                    # Check for ultimate abilities (high loyalty cost)
                    loyalty_cost_match = re.search(r"[−-](\d+)", line)
                    if loyalty_cost_match:
                        cost = int(loyalty_cost_match.group(1))
                        if cost >= 6:
                            ultimate_abilities.append(line)
                            context.append("ultimate ability")
                            context.append("game-ending ability")

        # Analyze ability types and effects
        if "draw" in oracle_text_lower:
            context.append("card advantage planeswalker")
        if "damage" in oracle_text_lower:
            context.append("direct damage planeswalker")
        if "destroy" in oracle_text_lower or "exile" in oracle_text_lower:
            context.append("removal planeswalker")
        if "create" in oracle_text_lower and "token" in oracle_text_lower:
            context.append("token generating planeswalker")
        if "search" in oracle_text_lower:
            context.append("tutor planeswalker")
        if "counter" in oracle_text_lower:
            context.append("control planeswalker")

        # Planeswalker protection and survivability
        if len(plus_abilities) > 0:
            context.append("self-protecting planeswalker")
        if "emblem" in oracle_text_lower:
            context.append("emblem creating planeswalker")
            context.append("permanent effect planeswalker")

        # Mana cost analysis for planeswalkers
        if isinstance(mana_value, (int, float)):
            if mana_value <= 3:
                context.append("early game planeswalker")
                context.append("aggressive planeswalker")
            elif mana_value <= 5:
                context.append("mid-game planeswalker")
                context.append("versatile planeswalker")
            else:
                context.append("late-game planeswalker")
                context.append("powerful planeswalker")

        # Analyze ability synergy and strategy
        if len(plus_abilities) >= 2:
            context.append("multiple plus abilities")
            context.append("flexible planeswalker")
        if len(minus_abilities) >= 2:
            context.append("multiple removal options")
            context.append("versatile removal")

        # Strategic role analysis
        if any(
            word in oracle_text_lower for word in ["look", "reveal", "top", "library"]
        ):
            context.append("card selection planeswalker")
        if any(word in oracle_text_lower for word in ["hand", "discard", "draw"]):
            context.append("hand manipulation planeswalker")
        if any(
            word in oracle_text_lower
            for word in ["battlefield", "permanent", "creature"]
        ):
            context.append("board control planeswalker")

        # Add natural language descriptions of key abilities
        ability_descriptions = self._generate_planeswalker_ability_descriptions(
            oracle_text
        )
        context.extend(ability_descriptions)

        return context

    def _generate_planeswalker_ability_descriptions(
        self, oracle_text: str
    ) -> List[str]:
        """Generate natural language descriptions of planeswalker abilities"""
        descriptions = []

        if not oracle_text:
            return descriptions

        oracle_lower = oracle_text.lower()

        # Common planeswalker ability patterns
        if "look at the top" in oracle_lower:
            descriptions.append("provides card selection and library manipulation")
        if "deal" in oracle_lower and "damage" in oracle_lower:
            descriptions.append("provides direct damage and creature removal")
        if "draw" in oracle_lower and "card" in oracle_lower:
            descriptions.append("provides card advantage and hand refill")
        if "create" in oracle_lower and "token" in oracle_lower:
            descriptions.append("generates creature tokens for board presence")
        if "return" in oracle_lower and "hand" in oracle_lower:
            descriptions.append("provides bounce effects and tempo plays")
        if "gain control" in oracle_lower:
            descriptions.append("steals opponent's permanents")
        if "search" in oracle_lower and "library" in oracle_lower:
            descriptions.append("tutors for specific cards")
        if "counter" in oracle_lower and "spell" in oracle_lower:
            descriptions.append("provides counterspell protection")
        if "exile" in oracle_lower:
            descriptions.append("permanently removes threats")
        if "emblem" in oracle_lower:
            descriptions.append("creates permanent ongoing effects")

        return descriptions

    def _generate_strategic_context(self, card: Dict[str, Any]) -> List[str]:
        """Generate strategic gameplay context based on card effects"""
        context = []

        oracle_text = card.get("text", "").lower() if card.get("text") else ""

        # Card advantage effects
        if any(
            phrase in oracle_text for phrase in ["draw", "search", "return", "create"]
        ):
            context.append("card advantage")

        # Removal effects
        if any(
            phrase in oracle_text
            for phrase in ["destroy", "exile", "sacrifice", "damage"]
        ):
            context.append("removal effect")

        # Ramp effects
        if any(
            phrase in oracle_text
            for phrase in ["add mana", "search for a land", "basic land"]
        ):
            context.append("mana acceleration")

        # Protection effects
        if any(
            phrase in oracle_text
            for phrase in ["prevent", "protection", "indestructible", "hexproof"]
        ):
            context.append("protective effect")

        # Synergy indicators
        keywords = card.get("keywords") or []
        if keywords:
            keyword_str = " ".join(keywords).lower()
            if any(
                tribal in keyword_str
                for tribal in ["human", "elf", "goblin", "zombie", "dragon"]
            ):
                context.append("tribal synergy")

        return context


class EmbeddingCache:
    """Caching system for embeddings to avoid regenerating identical embeddings"""

    def __init__(self, cache_dir: str = "cache/embeddings"):
        self.cache_dir = Path(cache_dir)
        self.cache_dir.mkdir(parents=True, exist_ok=True)
        self.cache_stats = {"hits": 0, "misses": 0, "saves": 0}

    def _get_cache_key(self, text: str, model_name: str, embedding_type: str) -> str:
        """Generate a cache key for the given text and model"""
        content = f"{model_name}:{embedding_type}:{text}"
        return hashlib.sha256(content.encode()).hexdigest()

    def _get_cache_path(self, cache_key: str) -> Path:
        """Get the cache file path for a given cache key"""
        return self.cache_dir / f"{cache_key}.pkl"

    def get(
        self, text: str, model_name: str, embedding_type: str
    ) -> Optional[np.ndarray]:
        """Retrieve embedding from cache if it exists"""
        cache_key = self._get_cache_key(text, model_name, embedding_type)
        cache_path = self._get_cache_path(cache_key)

        if cache_path.exists():
            try:
                with open(cache_path, "rb") as f:
                    embedding = pickle.load(f)
                self.cache_stats["hits"] += 1
                return embedding
            except Exception as e:
                print(f"Warning: Failed to load cached embedding {cache_key}: {e}")
                # Remove corrupted cache file
                try:
                    cache_path.unlink()
                except:
                    pass

        self.cache_stats["misses"] += 1
        return None

    def set(
        self, text: str, model_name: str, embedding_type: str, embedding: np.ndarray
    ) -> None:
        """Store embedding in cache"""
        cache_key = self._get_cache_key(text, model_name, embedding_type)
        cache_path = self._get_cache_path(cache_key)

        try:
            with open(cache_path, "wb") as f:
                pickle.dump(embedding, f)
            self.cache_stats["saves"] += 1
        except Exception as e:
            print(f"Warning: Failed to cache embedding {cache_key}: {e}")

    def get_stats(self) -> Dict[str, Any]:
        """Get cache statistics"""
        total_requests = self.cache_stats["hits"] + self.cache_stats["misses"]
        hit_rate = (
            self.cache_stats["hits"] / total_requests if total_requests > 0 else 0
        )

        return {
            **self.cache_stats,
            "total_requests": total_requests,
            "hit_rate": hit_rate,
        }

    def clear(self) -> None:
        """Clear all cached embeddings"""
        import shutil

        if self.cache_dir.exists():
            shutil.rmtree(self.cache_dir)
            self.cache_dir.mkdir(parents=True, exist_ok=True)
        self.cache_stats = {"hits": 0, "misses": 0, "saves": 0}


class OptimizedSentenceTransformer:
    """Optimized wrapper for SentenceTransformer with MTG-specific optimizations"""

    def __init__(self, model_name: str = "all-MiniLM-L6-v2", device: str = "cpu"):
        self.model_name = model_name
        self.device = device
        self.model = SentenceTransformer(model_name, device=device)
        self.cache = EmbeddingCache()

        # Apply MTG-specific optimizations
        self._apply_model_optimizations()

    def _apply_model_optimizations(self):
        """Apply model parameter optimizations for MTG-specific content"""
        # Set optimal batch size based on device
        if self.device == "cuda":
            self.optimal_batch_size = 64
        elif "directml" in str(self.device):
            self.optimal_batch_size = 32
        else:
            self.optimal_batch_size = 16

        # Configure model for better performance with MTG text
        if hasattr(self.model, "max_seq_length"):
            # MTG card text is typically shorter, so we can optimize for that
            self.model.max_seq_length = min(self.model.max_seq_length, 256)

    def encode_with_cache(
        self,
        texts: List[str],
        embedding_type: str = "default",
        show_progress_bar: bool = True,
    ) -> List[np.ndarray]:
        """Encode texts with caching support"""
        cached_embeddings = []
        texts_to_encode = []
        cache_indices = []

        # Check cache for each text
        for i, text in enumerate(texts):
            cached_embedding = self.cache.get(text, self.model_name, embedding_type)
            if cached_embedding is not None:
                cached_embeddings.append((i, cached_embedding))
            else:
                texts_to_encode.append(text)
                cache_indices.append(i)

        # Encode uncached texts
        new_embeddings = []
        if texts_to_encode:
            if show_progress_bar:
                print(
                    f"Encoding {len(texts_to_encode)} new {embedding_type} embeddings (cache hit rate: {self.cache.get_stats()['hit_rate']:.2%})"
                )

            new_embeddings = self.model.encode(
                texts_to_encode,
                show_progress_bar=show_progress_bar,
                device=self.device,
                convert_to_numpy=True,
                batch_size=self.optimal_batch_size,
            )

            # Cache new embeddings
            for text, embedding in zip(texts_to_encode, new_embeddings):
                self.cache.set(text, self.model_name, embedding_type, embedding)

        # Combine cached and new embeddings in correct order
        result = [None] * len(texts)

        # Place cached embeddings
        for i, embedding in cached_embeddings:
            result[i] = embedding

        # Place new embeddings
        for cache_idx, embedding in zip(cache_indices, new_embeddings):
            result[cache_idx] = embedding

        return result

    def get_cache_stats(self) -> Dict[str, Any]:
        """Get cache statistics"""
        return self.cache.get_stats()

    def clear_cache(self):
        """Clear embedding cache"""
        self.cache.clear()


def validate_embedding_quality(
    embeddings: List[np.ndarray], documents: List[str], embedding_type: str
) -> Dict[str, Any]:
    """Validate embedding quality and provide quality metrics"""
    if not embeddings or not documents:
        return {"valid": False, "error": "Empty embeddings or documents"}

    metrics = {
        "valid": True,
        "embedding_type": embedding_type,
        "count": len(embeddings),
        "dimension": len(embeddings[0]) if embeddings else 0,
        "avg_magnitude": 0.0,
        "std_magnitude": 0.0,
        "zero_embeddings": 0,
        "nan_embeddings": 0,
        "consistency_score": 1.0,
    }

    try:
        # Check for consistent dimensions
        expected_dim = len(embeddings[0]) if embeddings else 0
        dimension_mismatches = 0

        magnitudes = []
        for i, embedding in enumerate(embeddings):
            # Check dimension consistency
            current_dim = (
                len(embedding) if hasattr(embedding, "__len__") else embedding.shape[0]
            )
            if current_dim != expected_dim:
                dimension_mismatches += 1

            # Check for NaN values
            if np.any(np.isnan(embedding)):
                metrics["nan_embeddings"] += 1

            # Check for zero embeddings
            magnitude = np.linalg.norm(embedding)
            if magnitude < 1e-8:
                metrics["zero_embeddings"] += 1

            magnitudes.append(magnitude)

        # Calculate magnitude statistics
        if magnitudes:
            metrics["avg_magnitude"] = float(np.mean(magnitudes))
            metrics["std_magnitude"] = float(np.std(magnitudes))

        # Calculate consistency score
        consistency_issues = (
            dimension_mismatches
            + metrics["nan_embeddings"]
            + metrics["zero_embeddings"]
        )
        metrics["consistency_score"] = max(
            0.0, 1.0 - (consistency_issues / len(embeddings))
        )

        # Determine if embeddings are valid
        metrics["valid"] = (
            dimension_mismatches == 0
            and metrics["nan_embeddings"] == 0
            and metrics["zero_embeddings"]
            < len(embeddings) * 0.1  # Allow up to 10% zero embeddings
        )

        print(f"Embedding Quality Report for {embedding_type}:")
        print(f"  - Count: {metrics['count']}")
        print(f"  - Dimension: {metrics['dimension']}")
        print(f"  - Average Magnitude: {metrics['avg_magnitude']:.4f}")
        print(f"  - Standard Deviation: {metrics['std_magnitude']:.4f}")
        print(f"  - Zero Embeddings: {metrics['zero_embeddings']}")
        print(f"  - NaN Embeddings: {metrics['nan_embeddings']}")
        print(f"  - Consistency Score: {metrics['consistency_score']:.4f}")
        print(f"  - Valid: {metrics['valid']}")

    except Exception as e:
        metrics["valid"] = False
        metrics["error"] = str(e)
        print(f"Error validating {embedding_type} embeddings: {e}")

    return metrics


def generate_embeddings_sequential(
    model: OptimizedSentenceTransformer,
    document_sets: Dict[str, List[str]],
) -> Dict[str, List[np.ndarray]]:
    """Generate embeddings for multiple document types sequentially to avoid GPU conflicts"""
    results = {}

    def encode_document_type(
        embedding_type: str, documents: List[str]
    ) -> Tuple[str, List[np.ndarray]]:
        """Encode a specific document type"""
        print(f"Starting {embedding_type} embedding generation...")
        embeddings = model.encode_with_cache(
            documents, embedding_type=embedding_type, show_progress_bar=True
        )
        print(f"Completed {embedding_type} embedding generation")
        return embedding_type, embeddings

    # Process each document type sequentially to avoid GPU conflicts
    for doc_type, docs in document_sets.items():
        try:
            embedding_type, embeddings = encode_document_type(doc_type, docs)
            results[embedding_type] = embeddings
            print(
                f"✅ {embedding_type} embeddings completed ({len(embeddings)} embeddings)"
            )
        except Exception as e:
            print(f"❌ Error generating {doc_type} embeddings: {e}")
            # Create fallback zero embeddings
            fallback_dim = 384
            results[doc_type] = [
                np.zeros(fallback_dim) for _ in document_sets[doc_type]
            ]

    return results


def generate_embeddings_batch(
    model: SentenceTransformer,
    documents: List[str],
    batch_size: int = 32,
    device: str = "cpu",
) -> List[np.ndarray]:
    """Generate embeddings in batches for efficient GPU utilization"""
    if not documents:
        return []

    print(
        f"Generating embeddings for {len(documents)} documents in batches of {batch_size}"
    )

    all_embeddings = []
    total_batches = (len(documents) + batch_size - 1) // batch_size

    for i in range(0, len(documents), batch_size):
        batch_docs = documents[i : i + batch_size]
        batch_num = (i // batch_size) + 1

        print(
            f"Processing batch {batch_num}/{total_batches} ({len(batch_docs)} documents)"
        )

        try:
            # Generate embeddings for this batch
            batch_embeddings = model.encode(
                batch_docs,
                show_progress_bar=False,  # Disable per-batch progress bar
                device=device,
                convert_to_numpy=True,
            )

            # Validate batch embeddings
            if len(batch_embeddings) != len(batch_docs):
                print(
                    f"Warning: Batch {batch_num} embedding count mismatch: {len(batch_embeddings)} vs {len(batch_docs)}"
                )

            all_embeddings.extend(batch_embeddings)

        except Exception as e:
            print(f"Error processing batch {batch_num}: {e}")
            # Create zero embeddings as fallback
            fallback_dim = 384  # all-MiniLM-L6-v2 dimension
            for _ in batch_docs:
                all_embeddings.append(np.zeros(fallback_dim))

    print(f"Generated {len(all_embeddings)} embeddings total")
    return all_embeddings


def calculate_complexity_score(card: Dict[str, Any]) -> float:
    """Calculate a complexity score for the card (0.0-1.0)"""
    score = 0.0

    # Base complexity from mana value
    mana_value = card.get("manaValue", 0)
    if isinstance(mana_value, (int, float)):
        score += min(mana_value / 10.0, 0.3)  # Max 0.3 from mana value

    # Oracle text complexity
    oracle_text = card.get("text", "")
    if oracle_text:
        # Length-based complexity
        text_length = len(oracle_text)
        score += min(text_length / 500.0, 0.2)  # Max 0.2 from text length

        # Keyword complexity
        complex_keywords = ["when", "if", "choose", "may", "target", "search", "return"]
        keyword_count = sum(
            1 for keyword in complex_keywords if keyword in oracle_text.lower()
        )
        score += min(keyword_count / 10.0, 0.2)  # Max 0.2 from keywords

    # Ability complexity
    keywords = card.get("keywords", [])
    if keywords and isinstance(keywords, list):
        score += min(len(keywords) / 10.0, 0.2)  # Max 0.2 from abilities

    # Type complexity
    type_line = card.get("type", "")
    if type_line:
        type_count = len(type_line.split())
        score += min(type_count / 10.0, 0.1)  # Max 0.1 from type complexity

    return min(score, 1.0)


def calculate_popularity_score(card: Dict[str, Any]) -> float:
    """Calculate a popularity score for the card (0.0-1.0) based on rarity and other factors"""
    score = 0.5  # Base score

    # Rarity-based scoring
    rarity = card.get("rarity", "").lower()
    rarity_scores = {"mythic": 0.9, "rare": 0.7, "uncommon": 0.5, "common": 0.3}
    score = rarity_scores.get(rarity, 0.5)

    # Adjust for legendary status
    type_line = card.get("type", "").lower()
    if "legendary" in type_line:
        score += 0.1

    # Adjust for planeswalkers (generally popular)
    if "planeswalker" in type_line:
        score += 0.1

    return min(score, 1.0)


def generate_search_tags(card: Dict[str, Any]) -> List[str]:
    """Generate search tags for faceted search"""
    tags = []

    # Color tags
    colors = card.get("colors", [])
    if colors:
        tags.extend([f"color:{color.lower()}" for color in colors])
        if len(colors) > 1:
            tags.append("multicolor")
    else:
        tags.append("colorless")

    # Type tags
    type_line = card.get("type", "")
    if type_line:
        types = type_line.lower().split()
        for card_type in types:
            if card_type not in ["—", "-"]:  # Skip type separators
                tags.append(f"type:{card_type}")

    # Rarity tag
    rarity = card.get("rarity", "")
    if rarity:
        tags.append(f"rarity:{rarity.lower()}")

    # Mana value tags
    mana_value = card.get("manaValue", 0)
    if isinstance(mana_value, (int, float)):
        tags.append(f"mv:{int(mana_value)}")
        if mana_value <= 2:
            tags.append("low-cost")
        elif mana_value >= 6:
            tags.append("high-cost")

    # Keyword tags
    keywords = card.get("keywords") or []
    if keywords:
        tags.extend([f"keyword:{keyword.lower()}" for keyword in keywords])

    # Set tag
    set_code = card.get("setCode", "")
    if set_code:
        tags.append(f"set:{set_code.lower()}")

    return tags


def main():
    # Use GPU if available
    try:
        import torch_directml

        device = torch_directml.device()  # runs on DirectML
    except ImportError:
        device = "cuda" if torch.cuda.is_available() else "cpu"

    if device == "cuda":
        print("CUDA is available")
    else:
        print("CUDA is not available")
    print(f"Using device: {device}")

    # Initialize optimized model and document processor
    model = OptimizedSentenceTransformer("all-MiniLM-L6-v2", device)
    doc_processor = EnhancedDocumentProcessor()

    # Load data from database
    from pathlib import Path

    DB_PATH = Path(__file__).resolve().parent.parent / "Database" / "database.sqlite"
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM cards")
    rows = cursor.fetchall()
    conn.close()

    print(f"Loaded {len(rows)} cards from database")

    # Prepare documents and records
    primary_docs: List[str] = []
    keyword_docs: List[str] = []
    context_docs: List[str] = []
    records: List[dict] = []

    print("Processing cards and creating document representations...")

    for row in rows:
        card = dict(row)

        # Parse string fields that might contain multiple values
        if isinstance(card.get("keywords"), str):
            card["keywords"] = (
                [k.strip() for k in card["keywords"].split(",") if k.strip()]
                if card["keywords"]
                else []
            )

        if isinstance(card.get("colors"), str):
            card["colors"] = list(card["colors"]) if card["colors"] else []

        if isinstance(card.get("colorIdentity"), str):
            card["colorIdentity"] = (
                list(card["colorIdentity"]) if card["colorIdentity"] else []
            )

        # Skip non-English or incomplete entries
        if not card.get("name") or not isinstance(card.get("text"), (str, type(None))):
            continue

        # Create multiple document representations
        enhanced_docs = doc_processor.create_enhanced_document(card)

        primary_docs.append(enhanced_docs["primary_doc"])
        keyword_docs.append(enhanced_docs["keyword_doc"])
        context_docs.append(enhanced_docs["context_doc"])

        # Generate additional metadata
        complexity_score = calculate_complexity_score(card)
        popularity_score = calculate_popularity_score(card)
        search_tags = generate_search_tags(card)
        gameplay_context = doc_processor._generate_strategic_context(card)

        # For now, set empty image_uri since the database doesn't seem to have image_uris field
        image_uri = ""

        # Build record for LanceDB with enhanced fields
        record = {
            "name": card.get("name", ""),
            "mana_cost": card.get("manaCost") or "",
            "mana_value": card.get("manaValue") or 0,
            "type_line": card.get("type", ""),
            "oracle_text": card.get("text"),
            "image_uri": image_uri,
            "keywords": card.get("keywords") or [],
            "colors": card.get("colors") or [],
            "color_identity": card.get("colorIdentity") or [],
            "power": card.get("power"),
            "toughness": card.get("toughness"),
            "loyalty": card.get("loyalty"),
            "rarity": card.get("rarity", ""),
            "legalities": "{}",  # No legalities field in the database
            "set_name": card.get("setCode", ""),
            # Enhanced search fields
            "normalized_text": enhanced_docs["primary_doc"],  # MTG-normalized text
            "expanded_abilities": enhanced_docs["context_doc"],  # Expanded abilities
            "gameplay_context": gameplay_context,  # Strategic context
            "search_tags": search_tags,  # Search tags
            "complexity_score": complexity_score,  # Complexity score
            "popularity_score": popularity_score,  # Popularity score
        }

        records.append(record)

    print(f"Created {len(records)} card records with enhanced metadata")

    # Generate embeddings using sequential processing and caching
    print("Generating embeddings with caching and sequential processing...")

    document_sets = {
        "primary": primary_docs,
        "keyword": keyword_docs,
        "context": context_docs,
    }

    # Generate all embeddings sequentially to avoid GPU conflicts
    embedding_results = generate_embeddings_sequential(
        model, document_sets
    )

    # Extract embeddings from results
    primary_embeddings = embedding_results["primary"]
    keyword_embeddings = embedding_results["keyword"]
    context_embeddings = embedding_results["context"]

    # Validate embedding quality
    primary_quality = validate_embedding_quality(
        primary_embeddings, primary_docs, "Primary"
    )
    keyword_quality = validate_embedding_quality(
        keyword_embeddings, keyword_docs, "Keyword"
    )
    context_quality = validate_embedding_quality(
        context_embeddings, context_docs, "Context"
    )

    # Print cache statistics
    cache_stats = model.get_cache_stats()
    print(f"\nEmbedding Cache Statistics:")
    print(f"  - Total requests: {cache_stats['total_requests']}")
    print(f"  - Cache hits: {cache_stats['hits']}")
    print(f"  - Cache misses: {cache_stats['misses']}")
    print(f"  - Hit rate: {cache_stats['hit_rate']:.2%}")
    print(f"  - Embeddings saved to cache: {cache_stats['saves']}")

    # Check if all embedding generations were successful
    if not (
        primary_quality["valid"]
        and keyword_quality["valid"]
        and context_quality["valid"]
    ):
        print(
            "Warning: Some embeddings failed quality validation. Proceeding with caution."
        )

    # Combine embeddings with records
    print("Combining embeddings with card records...")
    for i, (record, primary_vec, keyword_vec, context_vec) in enumerate(
        zip(records, primary_embeddings, keyword_embeddings, context_embeddings)
    ):
        # Convert numpy arrays to lists for LanceDB
        def to_list(vec):
            if isinstance(vec, np.ndarray):
                return vec.tolist()
            else:
                return list(vec) if hasattr(vec, "__iter__") else [vec]

        # Add all vector fields
        record["vector"] = to_list(
            primary_vec
        )  # Legacy field for backward compatibility
        record["primary_vector"] = to_list(primary_vec)
        record["keyword_vector"] = to_list(keyword_vec)
        record["context_vector"] = to_list(context_vec)

    # Create LanceDB table with enhanced schema
    print("Creating LanceDB table...")
    db = lancedb.connect("C:/Users/csdj9/AppData/Roaming/desktopmtg/vectordb")
    table = db.create_table(
        "magic_cards",
        schema=MagicCard,
        mode="overwrite",
    )

    # Add records to table
    print("Adding records to database...")
    table.add(records)

    # Create indexes for all vector fields
    print("Creating vector indexes...")

    # Primary vector index (main semantic search)
    table.create_index(
        metric="cosine",
        vector_column_name="primary_vector",
        m=96,
        ef_construction=1000,
        accelerator="cuda" if torch.cuda.is_available() else None,
    )

    # Keyword vector index (exact matching)
    table.create_index(
        metric="cosine",
        vector_column_name="keyword_vector",
        m=96,
        ef_construction=1000,
        accelerator="cuda" if torch.cuda.is_available() else None,
    )

    # Context vector index (contextual search)
    table.create_index(
        metric="cosine",
        vector_column_name="context_vector",
        m=96,
        ef_construction=1000,
        accelerator="cuda" if torch.cuda.is_available() else None,
    )

    # Legacy vector index for backward compatibility
    table.create_index(
        metric="cosine",
        vector_column_name="vector",
        m=96,
        ef_construction=1000,
        accelerator="cuda" if torch.cuda.is_available() else None,
    )

    print(f"Successfully populated LanceDB with {len(records)} enhanced card records")
    print("Multiple embedding types generated:")
    print(f"  - Primary embeddings: {len(primary_embeddings)} (semantic search)")
    print(f"  - Keyword embeddings: {len(keyword_embeddings)} (exact matching)")
    print(f"  - Context embeddings: {len(context_embeddings)} (contextual search)")

    # Print final quality summary
    print("\nFinal Quality Summary:")
    print(f"  - Primary embeddings valid: {primary_quality['valid']}")
    print(f"  - Keyword embeddings valid: {keyword_quality['valid']}")
    print(f"  - Context embeddings valid: {context_quality['valid']}")

    overall_quality = (
        primary_quality["consistency_score"]
        + keyword_quality["consistency_score"]
        + context_quality["consistency_score"]
    ) / 3
    print(f"  - Overall quality score: {overall_quality:.4f}")

    if overall_quality >= 0.95:
        print("✅ Excellent embedding quality achieved!")
    elif overall_quality >= 0.85:
        print("✅ Good embedding quality achieved!")
    elif overall_quality >= 0.70:
        print("⚠️ Acceptable embedding quality achieved!")
    else:
        print("❌ Poor embedding quality - consider regenerating!")

    print("Enhanced semantic search database build complete!")


if __name__ == "__main__":
    main()
