import { defineConfig } from 'vite';

// ブラウザ版（1つの HTML にまとめて、Artifact として公開する）
export default defineConfig({
  build: {
    outDir: 'dist-web',
    emptyOutDir: true,
    target: 'es2020',
    // 読みやすさのため縮めない（Artifact で中を確かめられるように）
    minify: false,
    assetsInlineLimit: 100_000_000,
    cssCodeSplit: false,
    modulePreload: false,
    rollupOptions: {
      input: 'web.html',
      output: { inlineDynamicImports: true },
    },
  },
});
