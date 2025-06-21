import sqlite3
import json
import numpy as np
import lancedb
from lancedb.pydantic import LanceModel, Vector
from sentence_transformers import SentenceTransformer

# --- Step 1: Define the data schema for LanceDB ---
# This tells our vector database what kind of data we're going to store.
# It includes the card's information and its vector embedding.
class MagicCard(LanceModel):
    name: str
    mana_cost: str
    type_line: str
    oracle_text: str | None = None
    image_uri: str
    # The vector will have 384 dimensions, which matches our chosen model.
    vector: Vector(384) 

def create_card_document(card: dict) -> str:
    """
    Takes a card's JSON object and creates a clean, semantically rich
    text document for the embedding model.
    """
    # We focus on the fields that describe the card's function and identity.
    # Fields like TCGPlayer ID, set name, or legality formats are "noise"
    # for a semantic model and can reduce search quality.
    parts = [
        f"Name: {card.get('name', '')}",
        f"Mana Cost: {card.get('mana_cost', '')}",
        f"Type: {card.get('type_line', '')}",
        f"Text: {card.get('oracle_text', '')}"
    ]

    # Handle keywords, which are very important for meaning
    # We need to convert the list of keywords into a clean string.
    keywords = card.get('keywords', [])
    if keywords and isinstance(keywords, str):
        try:
            # Handle cases where keywords might be stored as a JSON string
            keywords = json.loads(keywords)
        except json.JSONDecodeError:
            keywords = [] # If it's not valid JSON, treat as empty
            
    if keywords:
        parts.append(f"Keywords: {', '.join(keywords)}")

    # Add Power/Toughness for creatures
    if card.get('power') is not None and card.get('toughness') is not None:
        parts.append(f"Power: {card['power']}. Toughness: {card['toughness']}.")

    # Add Loyalty for planeswalkers
    if card.get('loyalty') is not None:
        parts.append(f"Loyalty: {card['loyalty']}.")

    # Join all the parts into a single string.
    return ". ".join(filter(None, parts))

def main():
    """
    Main function to read from SQLite, generate embeddings,
    and save to a LanceDB vector database.
    """
    # --- Step 2: Load the Embedding Model ---
    # We use SentenceTransformer, which is the correct tool for this job.
    # 'all-MiniLM-L6-v2' is a fantastic, lightweight model. It's fast and effective.
    # Using an 8B parameter model locally is extremely resource-intensive (requires >32GB RAM + GPU).
    print("Loading embedding model... (This may take a moment)")
    model = SentenceTransformer('sentence-transformers/all-MiniLM-L6-v2')
    print("Model loaded.")

    # --- Step 3: Read data from the SQLite database ---
    print("Connecting to SQLite database: cardsupdated.db")
    conn = sqlite3.connect('C:/Users/csdj9/AppData/Roaming/desktopmtg/scryfall-data/cardsupdated.db')
    # This is a crucial step! It makes the database return dictionary-like rows
    # so we can access columns by name (e.g., card['name']).
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()

    # Fetch all English cards from the database
    cursor.execute("SELECT * FROM cards WHERE lang = 'en'")
    all_english_cards = cursor.fetchall()
    conn.close()
    print(f"Found {len(all_english_cards)} English cards in the database.")

    # --- Step 4: Prepare the data for embedding and storage ---
    card_documents_for_embedding = []
    card_data_for_lancedb = []

    print("Preparing card data...")
    for card_row in all_english_cards:
        # Convert the SQLite Row object to a standard Python dictionary
        card_dict = dict(card_row)
        
        # We only process cards that have an English image URI
        image_uris = card_dict.get('image_uris')
        if image_uris:
            try:
                # Assuming image_uris is a JSON string, parse it
                uris = json.loads(image_uris)
                image_uri = uris.get('normal', '')
            except (json.JSONDecodeError, AttributeError):
                image_uri = ''
        else:
            image_uri = ''

        if not image_uri:
            continue # Skip cards without a normal image

        # Create the clean text document for the embedding model
        card_documents_for_embedding.append(create_card_document(card_dict))
        
        # Prepare the data we want to save in LanceDB
        card_data_for_lancedb.append({
            "name": card_dict.get('name', ''),
            "mana_cost": card_dict.get('mana_cost', ''),
            "type_line": card_dict.get('type_line', ''),
            "oracle_text": card_dict.get('oracle_text', ''),
            "image_uri": image_uri
        })

    # --- Step 5: Generate the Embeddings ---
    print(f"Generating embeddings for {len(card_documents_for_embedding)} cards. This will take some time...")
    # The 'encode' method takes our list of text documents and returns a list of vectors.
    # show_progress_bar=True will display a helpful progress bar in your terminal.
    embeddings = model.encode(card_documents_for_embedding, show_progress_bar=True)
    print("Embeddings generated successfully.")

    # --- Step 6: Store Everything in LanceDB ---
    # Add the generated vector to each card's data
    for i, card_data in enumerate(card_data_for_lancedb):
        card_data['vector'] = embeddings[i]

    print("Connecting to LanceDB and creating table...")
    db = lancedb.connect("C:/Users/csdj9/AppData/Roaming/desktopmtg/vectordb")
    # This will create a new table named 'magic_cards'.
    # mode="overwrite" means it will delete the table if it already exists,
    # ensuring you start fresh each time you run the script.
    table = db.create_table("magic_cards", schema=MagicCard, mode="overwrite")

    # Add all the data (card info + vectors) to the LanceDB table.
    # LanceDB is optimized for this and can add many records at once.
    table.add(card_data_for_lancedb)
    print(f"Successfully created and populated the 'magic_cards' table in LanceDB.")
    print("Your vector database is ready for searching!")

if __name__ == "__main__":
    main()
