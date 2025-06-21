import os
import json
import sqlite3
import requests
import time
from pathlib import Path
from typing import Dict, Any, Optional
import gzip
from datetime import datetime

# Configuration
SCRYFALL_BULK_API = 'https://api.scryfall.com/bulk-data'
# Allow the parent process to override the target data directory so that the
# Python builder can write directly into Electron's `app.getPath('userData')`.
# This avoids mismatches like "desktopmtg" vs. the application name directory.
env_override = os.environ.get('DESKTOPMTG_DATA_DIR') or os.environ.get('DATA_DIR_OVERRIDE')

if env_override:
    DATA_DIR = Path(env_override)
else:
    if os.name == 'nt':  # Windows
        DATA_DIR = Path.home() / 'AppData' / 'Roaming' / 'desktopmtg' / 'scryfall-data'
    elif os.uname().sysname == 'Darwin':  # macOS
        DATA_DIR = Path.home() / 'Library' / 'Application Support' / 'desktopmtg' / 'scryfall-data'
    else:  # Linux
        DATA_DIR = Path.home() / '.local' / 'share' / 'desktopmtg' / 'scryfall-data'

CARDS_FILE = DATA_DIR / 'cards.json'
DATABASE_FILE = DATA_DIR / 'cards.db'
METADATA_FILE = DATA_DIR / 'metadata.json'

class MTGDatabaseBuilder:
    def __init__(self):
        self.session = requests.Session()
        self.session.headers.update({
            'User-Agent': 'DesktopMTG/1.0 Python Builder',
            'Accept': 'application/json'
        })
        
    def get_bulk_data_info(self) -> Dict[str, Any]:
        """Get information about available bulk data"""
        print("📡 Fetching bulk data information from Scryfall...")
        
        response = self.session.get(SCRYFALL_BULK_API, timeout=30)
        response.raise_for_status()
        
        bulk_data = response.json()
        
        # Find the "all_cards" bulk data
        all_cards = next((item for item in bulk_data['data'] if item['type'] == 'all_cards'), None)
        if not all_cards:
            raise ValueError("All cards bulk data not found")
            
        print(f"📋 Found bulk data: {all_cards['name']}")
        print(f"📦 Size: {all_cards['size'] / 1024 / 1024:.1f} MB")
        print(f"📅 Updated: {all_cards['updated_at']}")
        
        return all_cards
        
    def download_bulk_data(self, bulk_info: Dict[str, Any]) -> None:
        """Download bulk data file"""
        if CARDS_FILE.exists():
            print(f"📁 Cards file already exists: {CARDS_FILE}")
            return
            
        print(f"⬇️ Downloading bulk data from {bulk_info['download_uri']}")
        
        response = self.session.get(bulk_info['download_uri'], stream=True, timeout=300)
        response.raise_for_status()
        
        total_size = int(response.headers.get('content-length', 0))
        downloaded = 0
        
        with open(CARDS_FILE, 'wb') as f:
            for chunk in response.iter_content(chunk_size=8192):
                if chunk:
                    f.write(chunk)
                    downloaded += len(chunk)
                    
                    # Progress update every 10MB
                    if downloaded % (10 * 1024 * 1024) < 8192:
                        progress = (downloaded / total_size * 100) if total_size else 0
                        print(f"📥 Progress: {progress:.1f}% ({downloaded / 1024 / 1024:.1f} MB)")
        
        print(f"✅ Download complete: {CARDS_FILE}")
        
    def _apply_sqlite_optimizations(self, conn: sqlite3.Connection) -> None:
        """Apply PRAGMA settings that speed up bulk inserts. These settings should only
        be used while **building** the database – they trade resiliency for speed.
        """
        cursor = conn.cursor()
        # Disable the rollback journal & fsync ‑ we don't need durability while
        # the database is being built and no other process is using it.
        pragmas = [
            "PRAGMA journal_mode=OFF",        # no rollback journal
            "PRAGMA synchronous=OFF",        # don't fsync every write
            "PRAGMA temp_store=MEMORY",      # keep temp data in RAM
            "PRAGMA cache_size=-32768"        # ~32 MB page cache (negative = KB)
        ]
        for pragma in pragmas:
            cursor.execute(pragma)
        conn.commit()
    
    def _create_indexes(self, conn: sqlite3.Connection) -> None:
        """Create indexes after the bulk insert step for much faster overall build."""
        cursor = conn.cursor()
        indexes = [
            'CREATE INDEX idx_name            ON cards(name)',
            'CREATE INDEX idx_name_lower      ON cards(lower(name))',
            'CREATE INDEX idx_oracle_id       ON cards(oracle_id)',
            'CREATE INDEX idx_set            ON cards(set_code)',
            'CREATE INDEX idx_type           ON cards(type_line)',
            'CREATE INDEX idx_rarity         ON cards(rarity)',
            'CREATE INDEX idx_colors         ON cards(colors)',
            'CREATE INDEX idx_color_identity ON cards(color_identity)',
            'CREATE INDEX idx_cmc            ON cards(cmc)'
        ]
        for index in indexes:
            cursor.execute(index)
        conn.commit()
        print("✅ Indexes created")
        
    def create_database(self) -> sqlite3.Connection:
        """Create an empty SQLite database ready for card data."""
        print(f"🗄️ Creating database: {DATABASE_FILE}")
        
        # Remove any previous database build
        if DATABASE_FILE.exists():
            DATABASE_FILE.unlink()
            
        conn = sqlite3.connect(DATABASE_FILE)
        self._apply_sqlite_optimizations(conn)
        cursor = conn.cursor()
        
        # (Only the table is created here – indexes are deferred until after data
        #  has been loaded to drastically improve performance.)
        cursor.execute('''
            CREATE TABLE cards (
                id TEXT PRIMARY KEY,
                oracle_id TEXT,
                lang TEXT NOT NULL,
                name TEXT NOT NULL,
                mana_cost TEXT,
                cmc REAL,
                type_line TEXT,
                oracle_text TEXT,
                power TEXT,
                toughness TEXT,
                colors TEXT,
                color_identity TEXT,
                keywords TEXT,
                legalities TEXT,
                produced_mana TEXT,
                card_faces TEXT,
                set_id TEXT,
                set_code TEXT,
                set_name TEXT,
                set_type TEXT,
                collector_number TEXT,
                rarity TEXT,
                released_at TEXT,
                artist TEXT,
                border_color TEXT,
                frame TEXT,
                image_status TEXT,
                image_uris TEXT,
                layout TEXT,
                reserved INTEGER,
                foil INTEGER,
                nonfoil INTEGER,
                digital INTEGER,
                reprint INTEGER,
                story_spotlight INTEGER,
                full_art INTEGER,
                textless INTEGER,
                tcgplayer_id INTEGER,
                mtgo_id INTEGER,
                arena_id INTEGER,
                prices TEXT,
                data TEXT
            )
        ''')
        conn.commit()
        print("✅ Table created (indexes deferred)")
        return conn
        
    def process_cards(self, conn: sqlite3.Connection) -> int:
        """Process cards from JSON file and insert into the detailed database schema"""
        print(f"🔄 Processing cards from {CARDS_FILE}")
        
        cursor = conn.cursor()
        
        # Prepare insert statement to match the new schema
        insert_sql = '''
            INSERT OR REPLACE INTO cards (
                id, oracle_id, lang, name, mana_cost, cmc, type_line, oracle_text, 
                power, toughness, colors, color_identity, keywords, legalities, 
                produced_mana, card_faces, set_id, set_code, set_name, set_type, 
                collector_number, rarity, released_at, artist, border_color, frame, 
                image_status, image_uris, layout, reserved, foil, nonfoil, digital, 
                reprint, story_spotlight, full_art, textless, tcgplayer_id, mtgo_id, 
                arena_id, prices, data
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        '''
        
        card_count = 0
        english_cards = 0
        non_english_cards = 0
        batch_size = 5000  # Larger batch gives better throughput with the explicit transaction
        batch = []
        
        start_time = time.time()
        
        # Begin a single transaction – this is much faster than committing after
        # every batch while still ensuring we don't use autocommit for each row.
        conn.execute('BEGIN')
        
        with open(CARDS_FILE, 'r', encoding='utf-8') as f:
            cards_data = json.load(f)
            total_cards = len(cards_data)
            print(f"📊 Total cards to process: {total_cards:,}")
            
            for i, card in enumerate(cards_data):
                card_lang = card.get('lang', 'en')
                
                if card_lang == 'en':
                    english_cards += 1
                else:
                    non_english_cards += 1
                    # Skip non-English cards entirely
                    continue
                
                # Prepare card data tuple matching the schema
                card_row = (
                    card.get('id'),
                    card.get('oracle_id'),
                    card_lang,
                    card.get('name'),
                    card.get('mana_cost'),
                    card.get('cmc', 0.0),
                    card.get('type_line'),
                    card.get('oracle_text'),
                    card.get('power'),
                    card.get('toughness'),
                    json.dumps(card.get('colors', [])),
                    json.dumps(card.get('color_identity', [])),
                    json.dumps(card.get('keywords', [])),
                    json.dumps(card.get('legalities', {})),
                    json.dumps(card.get('produced_mana', [])),
                    json.dumps(card.get('card_faces', [])),
                    card.get('set_id'),
                    card.get('set'),
                    card.get('set_name'),
                    card.get('set_type'),
                    card.get('collector_number'),
                    card.get('rarity'),
                    card.get('released_at'),
                    card.get('artist'),
                    card.get('border_color'),
                    card.get('frame'),
                    card.get('image_status'),
                    json.dumps(card.get('image_uris', {})),
                    card.get('layout'),
                    int(card.get('reserved', False)),
                    int(card.get('foil', False)),
                    int(card.get('nonfoil', False)),
                    int(card.get('digital', False)),
                    int(card.get('reprint', False)),
                    int(card.get('story_spotlight', False)),
                    int(card.get('full_art', False)),
                    int(card.get('textless', False)),
                    card.get('tcgplayer_id'),
                    card.get('mtgo_id'),
                    card.get('arena_id'),
                    json.dumps(card.get('prices', {})),
                    json.dumps(card) # Keep the full JSON as a fallback
                )
                
                batch.append(card_row)
                
                if len(batch) >= batch_size:
                    batch_len = len(batch)
                    cursor.executemany(insert_sql, batch)
                    batch.clear()
                    card_count += batch_len
                    progress = (i + 1) / total_cards * 100
                    elapsed = time.time() - start_time
                    rate = card_count / elapsed if elapsed > 0 else 0
                    print(f"🚀 Progress: {progress:.1f}% ({card_count:,}/{total_cards:,} cards) - {rate:.0f} cards/sec", end='\r')
            
            if batch:
                batch_len = len(batch)
                cursor.executemany(insert_sql, batch)
                card_count += batch_len
        
        # Commit the big transaction once all inserts are done
        conn.commit()
        
        print() # Newline after progress bar
        elapsed = time.time() - start_time
        print(f"✅ Processed {card_count:,} cards in {elapsed:.1f} seconds")
        print(f"🌍 Language breakdown: {english_cards:,} English, {non_english_cards:,} non-English")
        
        if non_english_cards > 0:
            print(f"ℹ️ Non-English cards are included. You can filter by the 'lang' column.")
        
        return card_count
        
    def save_metadata(self, bulk_info: Dict[str, Any], card_count: int) -> None:
        """Save metadata about the build"""
        metadata = {
            **bulk_info,
            'card_count': card_count,
            'database_built_at': datetime.now().isoformat(),
            'built_with': 'Python Builder v2.0'
        }
        
        with open(METADATA_FILE, 'w') as f:
            json.dump(metadata, f, indent=2)
            
        print(f"💾 Metadata saved: {METADATA_FILE}")
        
    def build_database(self) -> None:
        """Main build process"""
        print("🏗️ Starting MTG Card Database Build")
        print(f"📂 Data directory: {DATA_DIR}")
        
        DATA_DIR.mkdir(parents=True, exist_ok=True)
        
        try:
            bulk_info = self.get_bulk_data_info()
            self.download_bulk_data(bulk_info)
            conn = self.create_database()
            card_count = self.process_cards(conn)
            conn.close()
            self.save_metadata(bulk_info, card_count)
            
            print(f"🎉 Database build complete!")
            print(f"📊 Total cards: {card_count:,}")
            print(f"🗄️ Database: {DATABASE_FILE}")
            print(f"📦 Size: {DATABASE_FILE.stat().st_size / 1024 / 1024:.1f} MB")
            
            if CARDS_FILE.exists():
                CARDS_FILE.unlink()
                print(f"🧹 Cleaned up temporary JSON file")
                
            # Create indexes **after** data is loaded – re-open connection
            conn = sqlite3.connect(DATABASE_FILE)
            self._apply_sqlite_optimizations(conn)  # same pragmas during indexing
            self._create_indexes(conn)
            conn.close()
            
        except Exception as e:
            print(f"❌ Error during build: {e}")
            raise

def main():
    """Command line entry point"""
    print("🃏 MTG Card Database Builder")
    print("=" * 40)
    
    builder = MTGDatabaseBuilder()
    builder.build_database()

if __name__ == '__main__':
    main()
