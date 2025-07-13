const path = require('path');
const fs = require('fs');
const { app } = require('electron');

/**
 * Returns the absolute path to the writable database in the user's AppData directory.
 * If the database doesn't exist there, it copies it from the bundled resources.
 *
 * This ensures the database is always writable by copying it to:
 * - Windows: %APPDATA%/DesktopMTG/Database/database.sqlite
 * - macOS: ~/Library/Application Support/DesktopMTG/Database/database.sqlite  
 * - Linux: ~/.config/DesktopMTG/Database/database.sqlite
 */
function resolveDatabasePath() {
  // Get the user data directory (AppData on Windows, ~/Library/Application Support on macOS, ~/.config on Linux)
  const userDataDir = app.getPath('userData');
  const userDbDir = path.join(userDataDir, 'Database');
  const userDbPath = path.join(userDbDir, 'database.sqlite');

  // If the database already exists in the user directory, use it
  if (fs.existsSync(userDbPath)) {
    console.log('[dbPathResolver] Database already exists in user directory:', userDbPath);
    return userDbPath;
  }

  // Database doesn't exist in user directory, so we need to copy it from resources
  console.log('[dbPathResolver] Database not found in user directory, copying from resources...');

  // Find the source database from bundled resources
  const sourceDbPath = findBundledDatabasePath();
  console.log('[dbPathResolver] Attempting to copy database from', sourceDbPath, 'to', userDbPath);
  
  if (!sourceDbPath) {
    console.error('[dbPathResolver] Could not find bundled database in resources!');
    // Return the user path anyway so the app can create a new database if needed
    return userDbPath;
  }

  try {
    // Ensure the user database directory exists
    fs.mkdirSync(userDbDir, { recursive: true });

    // Copy the database from resources to user directory
    fs.copyFileSync(sourceDbPath, userDbPath);
    
    console.log('[dbPathResolver] Database copy success:', fs.existsSync(userDbPath));
    return userDbPath;
  } catch (error) {
    console.error('[dbPathResolver] Failed to copy database to user directory:', error);
    // Fallback to the source path (may be read-only but better than nothing)
    return sourceDbPath;
  }
}

/**
 * Finds the bundled database in the app resources.
 * Checks multiple locations depending on how the app is packaged.
 */
function findBundledDatabasePath() {
  const candidates = [];

  // 1) When the DB is shipped via `extraResource` it lives beside Electron's
  //    resources dir (outside app.asar).
  if (process.resourcesPath) {
    candidates.push(path.join(process.resourcesPath, 'Database', 'database.sqlite'));
  }

  // 2) If asar=false Forge copies the repo into resources/app
  try {
    const appPath = app.getAppPath(); // May throw in some CLI contexts
    candidates.push(path.join(appPath, 'Database', 'database.sqlite'));
  } catch {}

  // 3) Dev / fallback – relative to the module location
  candidates.push(path.resolve(__dirname, '..', 'Database', 'database.sqlite'));

  // Pick the first one that exists
  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) {
        console.log(`Found bundled database at: ${p}`);
        return p;
      }
    } catch {}
  }

  console.warn('No bundled database found in any of the expected locations:', candidates);
  return null;
}

module.exports = { resolveDatabasePath }; 