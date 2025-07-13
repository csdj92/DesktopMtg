const path = require('path');
const fs = require('fs');
const fsp = require('fs').promises;
const { app } = require('electron');

/**
 * Resolves the path to the writable model cache directory.
 * If the cache doesn't exist in the user's data directory, it's
 * copied from the read-only bundled application resources.
 * This ensures the AI model is always loaded from a writable location.
 */
async function resolveCachePath() {
  if (!app) {
    throw new Error('Electron app object is not available. This must be run in the main process.');
  }

  const userDataDir = app.getPath('userData');
  const userCacheDir = path.join(userDataDir, 'cache');

  // If the cache already exists in the user's writable directory, we're done.
  if (fs.existsSync(userCacheDir)) {
    console.log('[cacheResolver] Model cache found in user data directory:', userCacheDir);
    return userCacheDir;
  }

  console.log('[cacheResolver] Model cache not found in user directory. Copying from app resources...');

  // Find the source cache in the bundled, read-only resources.
  const sourceCacheDir = findBundledCachePath();

  if (!sourceCacheDir) {
    console.error('[cacheResolver] Could not find the bundled model cache to copy from.');
    // Still return the target path, so the app can attempt to create it.
    await fsp.mkdir(userCacheDir, { recursive: true });
    return userCacheDir;
  }

  console.log(`[cacheResolver] Attempting to copy from source: ${sourceCacheDir}`);
  console.log(`[cacheResolver] To destination: ${userCacheDir}`);
  try {
    console.log(`[cacheResolver] Copying from ${sourceCacheDir} to ${userCacheDir}`);
    // Ensure the target directory exists.
    await fsp.mkdir(userCacheDir, { recursive: true });
    // Recursively copy the entire directory.
    await fsp.cp(sourceCacheDir, userCacheDir, { recursive: true });
    console.log('[cacheResolver] Successfully copied model cache.');
    return userCacheDir;
  } catch (error) {
    console.error('[cacheResolver] CRITICAL: Failed to copy model cache to writable location:', error);
    // Fallback to the read-only path. This will likely fail but is better than crashing.
    return sourceCacheDir;
  }
}

/**
 * Finds the bundled model cache in the app resources.
 * Checks multiple locations to handle packaged and development environments.
 */
function findBundledCachePath() {
  const candidates = [
    // Packaged app location (e.g., extraResources)
    path.join(process.resourcesPath, 'cache'),
    // Development environment fallback
    path.resolve(__dirname, '..', 'cache')
  ];

  for (const candidatePath of candidates) {
    if (fs.existsSync(candidatePath)) {
      console.log(`[cacheResolver] Found bundled cache at: ${candidatePath}`);
      return candidatePath;
    }
  }

  console.warn('[cacheResolver] Bundled cache not found in any expected locations:', candidates);
  return null;
}

module.exports = { resolveCachePath };