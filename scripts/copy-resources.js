const fs = require('fs');
const path = require('path');

// Copy resources hook for Electron Forge
// This script runs after the app is copied to the build directory
module.exports = async (forgeConfig, buildPath) => {
  console.log('🔧 Copying additional resources to:', buildPath);
  
  const resourcesDir = path.join(buildPath, 'resources');
  
  // Ensure resources directory exists
  if (!fs.existsSync(resourcesDir)) {
    fs.mkdirSync(resourcesDir, { recursive: true });
  }
  
  // Copy dist folder
  const distSrc = path.join(__dirname, '..', 'dist');
  const distDest = path.join(resourcesDir, 'dist');
  if (fs.existsSync(distSrc)) {
    console.log('📁 Copying dist folder...');
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
    copyFolderRecursiveSync(scriptsSrc, scriptsDest);
    console.log('✅ scripts folder copied');
  }
  
  // Copy Python folder
  const pythonSrc = path.join(__dirname, '..', 'python-3.8.9-embed-amd64');
  const pythonDest = path.join(resourcesDir, 'python-3.8.9-embed-amd64');
  if (fs.existsSync(pythonSrc)) {
    console.log('📁 Copying Python folder...');
    copyFolderRecursiveSync(pythonSrc, pythonDest);
    console.log('✅ Python folder copied');
  }
  
  console.log('✅ All resources copied successfully!');
};

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