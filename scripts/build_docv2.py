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
    mana_cost: str
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
    vector: Vector(768)  # type: ignore


def create_card_document(card: dict) -> str:
    payload = {
        "name": card.get("name", ""),
        "mana_value": card.get("convertedManaCost") or card.get("cmc") or 0,
        "colors": card.get("colors") or [],
        "color_identity": card.get("colorIdentity") or [],
        "type_line": card.get("type_line") or card.get("type") or "",
        "keywords": card.get("keywords") or [],
        "oracle_text": card.get("oracle_text") or card.get("text") or "",
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
    model = SentenceTransformer("all-mpnet-base-v2", device=device)

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

        # Parse JSON-encoded fields
        for field in ["keywords", "colors", "colorIdentity", "legalities"]:
            val = card.get(field)
            if isinstance(val, str):
                try:
                    card[field] = json.loads(val)
                except json.JSONDecodeError:
                    card[field] = [] if field != "legalities" else {}

        # Skip non-English or incomplete entries
        if not card.get("name") or not isinstance(card.get("oracle_text"), (str, type(None))):
            continue

        # Create document for embedding
        docs.append(create_card_document(card))

        # Extract image_uri (normal size) if available
        image_uri = ""
        img_uris_field = card.get("image_uris")
        if img_uris_field:
            if isinstance(img_uris_field, str):
                try:
                    img_uris = json.loads(img_uris_field)
                except json.JSONDecodeError:
                    img_uris = {}
            elif isinstance(img_uris_field, dict):
                img_uris = img_uris_field
            else:
                img_uris = {}
            image_uri = img_uris.get("normal") or img_uris.get("large") or img_uris.get("small") or ""

        # Build record for LanceDB
        records.append({
            "name": card.get("name", ""),
            "mana_cost": card.get("mana_cost", ""),
            "mana_value": card.get("convertedManaCost") or card.get("cmc") or 0,
            "type_line": card.get("type_line") or card.get("type") or "",
            "oracle_text": card.get("oracle_text"),
            "image_uri": image_uri,
            "keywords": card.get("keywords") or [],
            "colors": card.get("colors") or [],
            "color_identity": card.get("colorIdentity") or [],
            "power": card.get("power"),
            "toughness": card.get("toughness"),
            "loyalty": card.get("loyalty"),
            "rarity": card.get("rarity", ""),
            "legalities": json.dumps(card.get("legalities", {})),
            "set_name": card.get("set_name", ""),
        })

    print(f"Encoding {len(docs)} card documents...")
    embeddings = model.encode(docs, show_progress_bar=True, device=device)

    for rec, vec in zip(records, embeddings):
        rec["vector"] = vec.tolist() if isinstance(vec, np.ndarray) else vec

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
        m=32,
        ef_construction=200,
        accelerator="cuda" if torch.cuda.is_available() else None,
    )

    print(f"Populated LanceDB with {len(records)} cards.")


if __name__ == "__main__":
    main()
