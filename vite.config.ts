import { defineConfig } from 'vite'

export default defineConfig({
  // Relative asset URLs so the same build works at the site root (Docker/nginx) and under
  // a sub-path like GitHub Pages (https://marcosomma.github.io/ant-sim/).
  base: './',
  // Pre-bundle deep Babylon imports up front; discovering them lazily makes Vite
  // re-optimize mid-load and the page fails with "504 Outdated Optimize Dep".
  optimizeDeps: {
    include: ['@babylonjs/core', '@babylonjs/gui', '@babylonjs/materials/grid/gridMaterial'],
  },
  // Headless runs (scripts/headless.ts) bundle Babylon instead of resolving it from node.
  ssr: {
    noExternal: true,
  },
  server: {
    host: '0.0.0.0',
    port: 8080,
  },
  preview: {
    host: '0.0.0.0',
    port: 8080,
  },
  build: {
    target: 'es2022',
    sourcemap: true,
    outDir: 'dist',
  },
})
