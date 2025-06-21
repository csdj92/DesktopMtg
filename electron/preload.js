// The preload script runs before the renderer process is loaded.
// It has access to both DOM APIs and Node.js environment.
// We can expose privileged APIs to the renderer process here.

console.log('Preload script loaded.');

// All of the Node.js APIs are available in the preload process.
// It has the same sandbox as a Chrome extension.
window.addEventListener('DOMContentLoaded', () => {
  const replaceText = (selector, text) => {
    const element = document.getElementById(selector)
    if (element) {
      element.innerText = text
    }
  }

  for (const type of ['chrome', 'node', 'electron']) {
    replaceText(`${type}-version`, process.versions[type])
  }
}) 