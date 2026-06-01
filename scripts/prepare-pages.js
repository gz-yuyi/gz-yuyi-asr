import { copyFileSync, cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const pagesDir = resolve(root, 'dist-pages');
const docsDist = resolve(root, 'docs/.vitepress/dist');
const consoleHtml = resolve(root, 'dist/test-console.html');

function ensureFile(path) {
  if (!existsSync(path)) {
    throw new Error(`Missing required build artifact: ${path}`);
  }
}

ensureFile(resolve(docsDist, 'index.html'));
ensureFile(consoleHtml);

rmSync(pagesDir, { force: true, recursive: true });
cpSync(docsDist, pagesDir, { recursive: true });

const consoleTarget = resolve(pagesDir, 'console/index.html');
mkdirSync(dirname(consoleTarget), { recursive: true });
copyFileSync(consoleHtml, consoleTarget);

const legacyConsoleTarget = resolve(pagesDir, 'test-console.html');
copyFileSync(consoleHtml, legacyConsoleTarget);

writeFileSync(resolve(pagesDir, '.nojekyll'), '');
