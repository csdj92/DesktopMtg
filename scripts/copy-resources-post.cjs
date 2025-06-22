const fs = require('fs');
const path = require('path');

// Post-package resource copying script
// This runs after the package is built to copy additional resources
console.log('🔧 Copying additional resources to packaged app...');

// Find the built package directory
const outDir = path.join(__dirname, '..', 'out');
let packageDir = null;

if (fs.existsSync(outDir)) {
  const entries = fs.readdirSync(outDir);
  for (const entry of entries) {
    if (entry.includes('win32-x64') || entry.includes('darwin-x64') || entry.includes('linux-x64')) {
      packageDir = path.join(outDir, entry);
      break;
    }
  }
}

if (!packageDir || !fs.existsSync(packageDir)) {
  console.error('❌ Could not find packaged app directory');
  process.exit(1);
}

console.log('📦 Found packaged app at:', packageDir);

const resourcesDir = path.join(packageDir, 'resources');

if (!fs.existsSync(resourcesDir)) {
  console.error('❌ Resources directory not found in package');
  process.exit(1);
}

// Copy dist folder
const distSrc = path.join(__dirname, '..', 'dist');
const distDest = path.join(resourcesDir, 'dist');
if (fs.existsSync(distSrc)) {
  console.log('📁 Copying dist folder...');
  if (fs.existsSync(distDest)) {
    fs.rmSync(distDest, { recursive: true, force: true });
  }
  copyFolderRecursiveSync(distSrc, distDest);
  console.log('✅ dist folder copied');
} else {
  console.warn('⚠️  dist folder not found! Run npm run build first.');
}

// Copy scripts folder
const scriptsSrc = path.join(__dirname, '..', 'scripts');
const scriptsDest = path.join(resourcesDir, 'scripts');
if (fs.existsSync(scriptsSrc)) {
  console.log('📁 Copying scripts folder...');
  if (fs.existsSync(scriptsDest)) {
    fs.rmSync(scriptsDest, { recursive: true, force: true });
  }
  copyFolderRecursiveSync(scriptsSrc, scriptsDest);
  console.log('✅ scripts folder copied');
}

// Copy Python folder
const pythonSrc = path.join(__dirname, '..', 'python-3.8.9-embed-amd64');
const pythonDest = path.join(resourcesDir, 'python-3.8.9-embed-amd64');
if (fs.existsSync(pythonSrc)) {
  console.log('📁 Copying Python folder...');
  if (fs.existsSync(pythonDest)) {
    fs.rmSync(pythonDest, { recursive: true, force: true });
  }
  copyFolderRecursiveSync(pythonSrc, pythonDest);
  console.log('✅ Python folder copied');
}

console.log('🎉 All resources copied successfully!');

function copyFolderRecursiveSync(src, dest) {
  if (!fs.existsSync(dest)) {
    fs.mkdirSync(dest, { recursive: true });
  }
  
  const files = fs.readdirSync(src);
  
  files.forEach((file) => {
    const srcPath = path.join(src, file);
    const destPath = path.join(dest, file);
    
    if (fs.lstatSync(srcPath).isDirectory()) {
      copyFolderRecursiveSync(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  });
} 