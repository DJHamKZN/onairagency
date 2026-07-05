/** Tailwind build config for OnAir landing page.
 *  Compiles the utilities actually used in index.html + js/*.js into css/tailwind.css,
 *  replacing the Tailwind Play CDN (which is not meant for production).
 *  Rebuild:  npm run build:css   (see package.json)
 */
module.exports = {
  content: ['./index.html', './js/**/*.js'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        display: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'monospace'],
      },
      zIndex: { 15: '15', 20: '20', 90: '90', 100: '100' },
    },
  },
  plugins: [],
};
