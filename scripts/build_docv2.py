import sqlite3
import json
from typing import List, Dict, Any
import numpy as np
import lancedb
from lancedb.pydantic import LanceModel, Vector
from sentence_transformers import SentenceTransformer
import torch  # GPU detection

class MagicCard(LanceModel):
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
    vector: Vector(384)  # Changed to match all-MiniLM-L6-v2 dimensions


def create_card_document(card: dict) -> str:
    payload = {
        "name": card.get("name", ""),
        "mana_value": card.get("manaValue") or 0,
        "colors": card.get("colors") or [],
        "color_identity": card.get("colorIdentity") or [],
        "type_line": card.get("type") or "",
        "keywords": card.get("keywords") or [],
        "oracle_text": card.get("text") or "",
    }
    doc = json.dumps(payload, separators=(",", ":"))
    if card.get("power") is not None and card.get("toughness") is not None:
        doc += f" PT {card['power']}/{card['toughness']}"
    if card.get("loyalty") is not None:
        doc += f" Loyalty {card['loyalty']}"
    return doc


def main():
    # Use GPU if available
    try:
        import torch_directml
        device = torch_directml.device()          # runs on DirectML
    except ImportError:
        device = "cuda" if torch.cuda.is_available() else "cpu"
    if device == "cuda":
        print("CUDA is available")
    else:
        print("CUDA is not available")
    print(f"Using device: {device}")
    model = SentenceTransformer("all-MiniLM-L6-v2", device=device)

    from pathlib import Path
    DB_PATH = Path(__file__).resolve().parent.parent / "Database" / "database.sqlite"
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM cards")
    rows = cursor.fetchall()
    conn.close()

    docs: List[str] = []
    records: List[dict] = []

    for row in rows:
        card = dict(row)

        # Parse string fields that might contain multiple values
        if isinstance(card.get("keywords"), str):
            card["keywords"] = [k.strip() for k in card["keywords"].split(",") if k.strip()] if card["keywords"] else []
        
        if isinstance(card.get("colors"), str):
            card["colors"] = list(card["colors"]) if card["colors"] else []
            
        if isinstance(card.get("colorIdentity"), str):
            card["colorIdentity"] = list(card["colorIdentity"]) if card["colorIdentity"] else []

        # Skip non-English or incomplete entries
        if not card.get("name") or not isinstance(card.get("text"), (str, type(None))):
            continue

        # Create document for embedding
        docs.append(create_card_document(card))

        # For now, set empty image_uri since the database doesn't seem to have image_uris field
        image_uri = ""

        # Build record for LanceDB
        records.append({
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
        })

    print(f"Encoding {len(docs)} card documents...")
    embeddings = model.encode(docs, show_progress_bar=True, device=device)
    
    # Verify embedding dimensions
    if len(embeddings) > 0:
        first_embedding = embeddings[0]
        embedding_dim = len(first_embedding) if hasattr(first_embedding, '__len__') else first_embedding.shape[0]
        print(f"Embedding dimensions: {embedding_dim}")
        
        # Ensure all embeddings have consistent dimensions
        for i, embedding in enumerate(embeddings):
            current_dim = len(embedding) if hasattr(embedding, '__len__') else embedding.shape[0]
            if current_dim != embedding_dim:
                print(f"Warning: Inconsistent embedding dimension at index {i}: {current_dim} vs expected {embedding_dim}")

    for rec, vec in zip(records, embeddings):
        # Ensure vector is properly formatted as a list
        if isinstance(vec, np.ndarray):
            rec["vector"] = vec.tolist()
        else:
            rec["vector"] = list(vec) if hasattr(vec, '__iter__') else [vec]

    db = lancedb.connect("C:/Users/csdj9/AppData/Roaming/desktopmtg/vectordb")
    table = db.create_table(
        "magic_cards",
        schema=MagicCard,
        mode="overwrite",
    )

    # 1. add the rows + vectors
    table.add(records)

    # 2. now build the index
    table.create_index(
        metric="cosine",
        vector_column_name="vector",
        m=96,
        ef_construction=1000,
        accelerator="cuda" if torch.cuda.is_available() else None,
    )

    print(f"Populated LanceDB with {len(records)} cards.")


if __name__ == "__main__":
    main()
