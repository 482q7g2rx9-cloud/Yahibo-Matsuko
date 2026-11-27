import { defineConfig } from 'vite';

// Tauri から使う設定（https://v2.tauri.app/start/frontend/vite/）
const host = process.env.TAURI_DEV_HOST;

// フォント（Fontsource）は woff2 だけを使う（どの WebView も woff2 を読めるので、古い woff を同梱しない）
const woff2Only = {
  name: 'woff2-only',
  enforce: 'pre' as const,
  transform(code: string, id: string) {
    if (id.includes('@fontsource') && id.endsWith('.css')) return code.replace(/,\s*url\([^)]*\.woff\)\s*format\(['"]woff['"]\)/g, '');
    return null;
  },
};

export default defineConfig({
  plugins: [woff2Only],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host ? { protocol: 'ws', host, port: 1421 } : undefined,
    watch: { ignored: ['**/src-tauri/**'] },
  },
  envPrefix: ['VITE_', 'TAURI_ENV_*'],
  build: {
    // Windows は WebView2（Chromium）、macOS は Safari 13 以降の WebKit
    target: process.env.TAURI_ENV_PLATFORM === 'windows' ? 'chrome105' : 'safari14',
    minify: !process.env.TAURI_ENV_DEBUG ? 'esbuild' : false,
    sourcemap: !!process.env.TAURI_ENV_DEBUG,
    chunkSizeWarningLimit: 1500,
  },
});
