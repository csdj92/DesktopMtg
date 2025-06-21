import lancedb
from sentence_transformers import SentenceTransformer
import json

def load_search_model():
    """Load the same embedding model used to create the database"""
    print("Loading embedding model...")
    model = SentenceTransformer('sentence-transformers/all-MiniLM-L6-v2')
    print("Model loaded.")
    return model

def connect_to_vectordb():
    """Connect to the LanceDB vector database"""
    print("Connecting to vector database...")
    db = lancedb.connect("C:/Users/csdj9/AppData/Roaming/desktopmtg/vectordb")
    table = db.open_table("magic_cards")
    print("Connected to database.")
    return table

def search_cards(query, model, table, limit=500):
    """
    Search for cards using semantic similarity
    
    Args:
        query (str): The search query
        model: The SentenceTransformer model
        table: The LanceDB table
        limit (int): Number of results to return
    
    Returns:
        List of matching cards with unique names
    """
    print(f"Searching for: '{query}'")
    
    # Convert the query to an embedding
    query_embedding = model.encode([query])
    
    # Search through a large number of cards to get comprehensive results
    # Using a high limit instead of unlimited to avoid potential LanceDB issues
    search_limit = max(limit * 50, 1000000)  # Search through many more candidates
    raw_results = table.search(query_embedding[0]).limit(search_limit).to_list()
    
    # Ensure results are sorted by distance (best matches first)
    raw_results.sort(key=lambda x: x['_distance'])
    
    # Filter for unique card names, keeping the best match for each name
    seen_names = set()
    unique_results = []
    
    for card in raw_results:
        card_name = card['name']
        if card_name not in seen_names:
            seen_names.add(card_name)
            unique_results.append(card)
            
            # Stop once we have enough unique results
            if len(unique_results) >= limit:
                break
    
    return unique_results

def display_results(results):
    """Display search results in a readable format"""
    if not results:
        print("No results found.")
        return
    
    print(f"\nFound {len(results)} results:")
    print("=" * 80)
    
    for i, card in enumerate(results, 1):
        print(f"\n{i}. {card['name']}")
        print(f"   Mana Cost: {card['mana_cost']}")
        print(f"   Type: {card['type_line']}")
        if card['oracle_text']:
            # Truncate long text for display
            text = card['oracle_text']
            if len(text) > 200:
                text = text[:200] + "..."
            print(f"   Text: {text}")
        print(f"   Distance Score: {card['_distance']:.4f}")
        print("-" * 40)

def main():
    """Main interactive search function"""
    # Initialize components
    model = load_search_model()
    table = connect_to_vectordb()
    
    print("\nMagic Card Vector Search")
    print("Type your search queries below. Type 'quit' to exit.")
    print("Examples:")
    print("  - 'flying creatures'")
    print("  - 'red burn spells'")
    print("  - 'artifact that draws cards'")
    print("  - 'counterspell blue instant'")
    
    while True:
        try:
            query = input("\nEnter search query: ").strip()
            
            if query.lower() in ['quit', 'exit', 'q']:
                print("Goodbye!")
                break
            
            if not query:
                print("Please enter a search query.")
                continue
            
            # Perform search
            results = search_cards(query, model, table, limit=100)
            display_results(results)
            
        except KeyboardInterrupt:
            print("\nGoodbye!")
            break
        except Exception as e:
            print(f"Error: {e}")

def quick_search(query, num_results=500):
    """
    Quick search function for testing specific queries
    
    Args:
        query (str): Search query
        num_results (int): Number of results to return
    """
    model = load_search_model()
    table = connect_to_vectordb()
    results = search_cards(query, model, table, limit=num_results)
    display_results(results)
    return results

if __name__ == "__main__":
    # You can either run the interactive search or test with a specific query
    
    # Option 1: Interactive search
    main()
    
    # Option 2: Quick test (uncomment the lines below to test)
    # print("Testing quick search...")
    # quick_search("lightning bolt red instant", 5) 