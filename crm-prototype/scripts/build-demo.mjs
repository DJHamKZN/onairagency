// Сборка веб-демо для публикации на claude.ai: один HTML-фрагмент (стили встроены) и app.js.
import { build } from 'esbuild';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

mkdirSync('dist-demo', { recursive: true });
await build({
  entryPoints: ['src/browser/main.tsx'],
  bundle: true,
  outfile: 'dist-demo/app.js',
  format: 'iife',
  jsx: 'automatic',
  minify: true,
  target: ['es2022'],
  platform: 'browser',
  define: { 'process.env.NODE_ENV': '"production"' },
  logLevel: 'info',
});
const css = readFileSync('src/client/styles.css', 'utf8');
writeFileSync('dist-demo/index.html', `<title>ON AIR CRM</title>
<style>
${css}
</style>
<div id="root"></div>
<script src="app.js" charset="utf-8"></script>
`);
console.log('dist-demo/index.html, dist-demo/app.js');
