import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react-swc'
import path from 'path'
import renderer from 'vite-plugin-electron-renderer'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    renderer({
      nodeIntegration: true,
      resolve: {
        ' @xenova/transformers': {
          type: 'cjs'
        },
        '@lancedb/lancedb': {
          type: 'cjs'
        }
      }
    })
  ],
  base: './',
  build: {
    outDir: 'dist',
    // Ensure assets are inlined or use consistent paths
    assetsDir: 'assets',
    rollupOptions: {
      output: {
        // Ensure consistent file naming
        entryFileNames: 'assets/[name]-[hash].js',
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash].[ext]'
      }
    }
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  esbuild: {
    jsx: 'automatic'
  },
  // Add specific settings for production build
  define: {
    'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV || 'production')
  }
})
