const sqlite3 = require('sqlite3').verbose();
const { open } = require('sqlite');
const path = require('path');

async function testNewMethods() {
    const DATABASE_FILE = "C:\Users\csdj9\AppData\Roaming\desktopmtg\Database\database.sqlite";
    console.log('Testing new stats methods with database at:', DATABASE_FILE);

    try {
        const db = await open({
            filename: DATABASE_FILE,
            driver: sqlite3.Database
        });

        // Check if user_collections table exists
        const tables = await db.all("SELECT name FROM sqlite_master WHERE type='table'");
        const hasUserCollections = tables.some(table => table.name === 'user_collections');

        console.log('Available tables:', tables.map(t => t.name).join(', '));
        console.log('Has user_collections table:', hasUserCollections);

        if (hasUserCollections) {
            // Check user_collections structure
            const ucColumns = await db.all('PRAGMA table_info(user_collections)');
            console.log('user_collections columns:', ucColumns.map(c => c.name).join(', '));

            // Check if there's any data
            const ucCount = await db.get('SELECT COUNT(*) as count FROM user_collections');
            console.log('user_collections count:', ucCount.count);

            if (ucCount.count > 0) {
                // Test the rarity breakdown query manually
                console.log('\nTesting rarity breakdown query...');
                const rarityQuery = `
          SELECT 
            c.rarity,
            COUNT(*) as unique_count,
            SUM(uc.total_quantity) as total_quantity,
            SUM(uc.foil_quantity) as foil_quantity,
            SUM(uc.normal_quantity) as normal_quantity
          FROM cards c
          JOIN (
            SELECT 
              cardName,
              setCode,
              collectorNumber,
              SUM(CASE WHEN foil = 'foil' THEN quantity ELSE 0 END) as foil_quantity,
              SUM(CASE WHEN foil = 'normal' THEN quantity ELSE 0 END) as normal_quantity,
              SUM(quantity) as total_quantity
            FROM user_collections 
            GROUP BY cardName, setCode, collectorNumber
          ) uc ON lower(uc.cardName) = lower(c.name) 
             AND lower(uc.setCode) = lower(c.setCode) 
             AND uc.collectorNumber = c.number
          GROUP BY c.rarity
          LIMIT 5
        `;

                const rarityResults = await db.all(rarityQuery);
                console.log('Rarity results:', rarityResults);
            } else {
                console.log('No data in user_collections table to test with');
            }
        } else {
            console.log('No user_collections table found - methods will return null when no collection data exists');
        }

        await db.close();
        console.log('Test completed');

    } catch (error) {
        console.error('Test error:', error);
    }
}

testNewMethods();