// Сборка интерфейса через esbuild. Результат — статические файлы в dist/, которые раздаёт локальный сервер.
import { build, context } from 'esbuild';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const watch = process.argv.includes('--watch');
const options = {
  entryPoints: ['src/client/main.tsx'],
  bundle: true,
  outdir: 'dist/assets',
  entryNames: 'app',
  jsx: 'automatic',
  minify: !watch,
  sourcemap: watch,
  target: ['es2022'],
  define: { 'process.env.NODE_ENV': JSON.stringify(watch ? 'development' : 'production') },
  logLevel: 'info',
};

mkdirSync('dist', { recursive: true });
const html = readFileSync('index.html', 'utf8')
  .replace('<script type="module" src="/src/client/main.tsx"></script>', '<link rel="stylesheet" href="/assets/app.css" />\n    <script type="module" src="/assets/app.js"></script>');
writeFileSync('dist/index.html', html);

if (watch) {
  const ctx = await context(options);
  await ctx.watch();
  console.log('esbuild: слежение за изменениями интерфейса…');
} else {
  await build(options);
}
