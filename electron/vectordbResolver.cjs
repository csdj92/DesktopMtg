const path = require('path');
const fs = require('fs');
const fsp = require('fs').promises;
const { app } = require('electron');

/**
 * Resolves the path to the writable vector database directory.
 * If the database doesn't exist in the user's data directory, it's
 * copied from the read-only bundled application resources.
 * This ensures the vector database is always in a writable location.
 */
async function resolveVectorDbPath() {
  if (!app) {
    throw new Error('Electron app object is not available. This must be run in the main process.');
  }

  const userDataDir = app.getPath('userData');
  const userVectorDbDir = path.join(userDataDir, 'vectordb');

  // If the vector DB already exists in the user's writable directory, we're done.
  if (fs.existsSync(userVectorDbDir)) {
    console.log('[vectorDbResolver] Vector DB found in user data directory:', userVectorDbDir);
    return userVectorDbDir;
  }

  console.log('[vectorDbResolver] Vector DB not found in user directory. Copying from app resources...');

  // Find the source vector DB in the bundled, read-only resources.
  const sourceVectorDbDir = findBundledVectorDbPath();

  if (!sourceVectorDbDir) {
    console.error('[vectorDbResolver] Could not find the bundled vector DB to copy from.');
    // Still return the target path, so the app can attempt to create it.
    await fsp.mkdir(userVectorDbDir, { recursive: true });
    return userVectorDbDir;
  }

  console.log(`[vectorDbResolver] Attempting to copy from source: ${sourceVectorDbDir}`);
  console.log(`[vectorDbResolver] To destination: ${userVectorDbDir}`);
  try {
    console.log(`[vectorDbResolver] Copying from ${sourceVectorDbDir} to ${userVectorDbDir}`);
    // Ensure the target directory exists.
    await fsp.mkdir(userVectorDbDir, { recursive: true });
    // Recursively copy the entire directory.
    await fsp.cp(sourceVectorDbDir, userVectorDbDir, { recursive: true });
    console.log('[vectorDbResolver] Successfully copied vector DB.');
    return userVectorDbDir;
  } catch (error) {
    console.error('[vectorDbResolver] CRITICAL: Failed to copy vector DB to writable location:', error);
    // Fallback to the read-only path. This will likely fail later but is better than crashing.
    return sourceVectorDbDir;
  }
}

/**
 * Finds the bundled vector database in the app resources.
 * Checks multiple locations to handle packaged and development environments.
 */
function findBundledVectorDbPath() {
  const candidates = [
    // Packaged app location (e.g., extraResources)
    path.join(process.resourcesPath, 'vectordb'),
    // Development environment fallback
    path.resolve(__dirname, '..', 'vectordb')
  ];

  for (const candidatePath of candidates) {
    if (fs.existsSync(candidatePath)) {
      console.log(`[vectorDbResolver] Found bundled vector DB at: ${candidatePath}`);
      return candidatePath;
    }
  }

  console.warn('[vectorDbResolver] Bundled vector DB not found in any expected locations:', candidates);
  return null;
}

module.exports = { resolveVectorDbPath };