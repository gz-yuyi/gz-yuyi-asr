import { defineConfig } from 'vite';
import { resolve } from 'node:path';
import { singleFileHtmlPlugin } from './plugins/single-file-html.js';

export default defineConfig({
  base: './',
  plugins: [singleFileHtmlPlugin()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    cssCodeSplit: false,
    modulePreload: false,
    minify: false,
    rollupOptions: {
      input: {
        'test-console': resolve(__dirname, 'test-console.html'),
      },
      output: {
        inlineDynamicImports: true,
      },
    },
  },
});
