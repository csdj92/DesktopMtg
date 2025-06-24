const path = require('path');
const fs = require('fs');
const { app } = require('electron');

/**
 * Returns the absolute path to `Database/database.sqlite` no matter how the app
 * is packaged (asar on/off) or whether it is running from source.
 *
 * Resolution order:
 * 1. Extra-resource copy at `<resources>/Database/database.sqlite` (preferred – writable)
 * 2. Plain-copy inside `<resources>/app/Database/database.sqlite` when `asar=false`
 * 3. Source tree path `<repo>/Database/database.sqlite` when running in dev
 */
function resolveDatabasePath() {
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
        return p;
      }
    } catch {}
  }

  // Nothing exists yet → return first candidate so callers create it there
  return candidates[0];
}

module.exports = { resolveDatabasePath }; 