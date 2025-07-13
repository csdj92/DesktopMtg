import fs from 'fs';
import path from 'path';

// 1) Define project-level cache path and set env BEFORE importing transformers
const CACHE_ROOT = path.join(process.cwd(), 'cache');
process.env.HF_HOME = CACHE_ROOT;
process.env.TRANSFORMERS_CACHE = CACHE_ROOT;

(async () => {
  // 2) Now import transformers so it picks up the env vars
  const { pipeline, env } = await import('@xenova/transformers');

  console.log('[download-model] Initialising… (cache =', env.cacheDir, ')');
  const embedder = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
  await embedder('Hello world!'); // force weight download

  // 3) Find the model folder inside the resolved cache dir
  const entries = fs.readdirSync(env.cacheDir, { withFileTypes: true });
  const modelFolder = entries.find(e => e.isDirectory() && e.name.includes('all-MiniLM-L6-v2'))?.name;
  if (!modelFolder) {
    console.error('[download-model] Could not find model inside', env.cacheDir);
    process.exit(1);
  }

  const srcDir = path.join(env.cacheDir, modelFolder);
  const destDir = path.join(CACHE_ROOT, modelFolder);
  if (fs.existsSync(destDir)) {
    console.log('[download-model] Model already present in ./cache – nothing to do');
    return;
  }

  // 4) Copy recursively
  const copyRec = (src, dst) => {
    fs.mkdirSync(dst, { recursive: true });
    for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
      const s = path.join(src, entry.name);
      const d = path.join(dst, entry.name);
      entry.isDirectory() ? copyRec(s, d) : fs.copyFileSync(s, d);
    }
  };
  copyRec(srcDir, destDir);
  console.log('[download-model] Model copied to', destDir);
})(); 