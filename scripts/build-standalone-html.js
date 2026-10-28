// Inlines the "standalone" Angular build into one self-contained HTML file that opens from disk.
// Usage (after `ng build --configuration standalone`):
//   node scripts/build-standalone-html.js [outFile]      default: dist/pulse-app.html
const fs = require('fs');
const path = require('path');

const dir = path.join(__dirname, '..', 'dist', 'standalone', 'browser');
const out = process.argv[2] || path.join(__dirname, '..', 'dist', 'pulse-app.html');

const files = fs.readdirSync(dir);
const css = files.find((f) => /^styles-.*\.css$/.test(f));
const js = files.find((f) => /^main-.*\.js$/.test(f));
if (!css || !js) throw new Error(`Expected one styles-*.css and one main-*.js in ${dir}`);
if (files.some((f) => /^chunk-.*\.js$/.test(f))) throw new Error('Lazy chunks found; they cannot be inlined into one file.');

const cssText = fs.readFileSync(path.join(dir, css), 'utf8');
const jsText = fs.readFileSync(path.join(dir, js), 'utf8').replace(/<\/script/gi, '<\\/script');
const ico = fs.readFileSync(path.join(dir, 'favicon.ico')).toString('base64');
const sha = (process.env.GITHUB_SHA || '').slice(0, 7);

let html = fs.readFileSync(path.join(dir, 'index.html'), 'utf8')
  .replace(/<title>[^<]*<\/title>/, '<title>TruCare Pulse</title>')
  .replace(/<base href="[^"]*">/, '') // hash routing needs no base; keeping it drops the file name from the URL
  .replace('href="favicon.ico"', `href="data:image/x-icon;base64,${ico}"`)
  .replace(/<link rel="stylesheet" href="styles-[^"]+"[^>]*>(<noscript>.*?<\/noscript>)?/, () => `<style>${cssText}</style>`)
  .replace(/<script src="main-[^"]+" type="module"><\/script>/, () => `<script type="module">${jsText}</script>`);
if (sha) html = html.replace('<meta charset="utf-8">', `<meta charset="utf-8">\n  <meta name="build" content="${sha}">`);
if (html.includes(css) || html.includes(js)) throw new Error('An external reference to the build files was left in the page.');

fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, html);
console.log(`${out}  ${(fs.statSync(out).size / 1024 / 1024).toFixed(2)} MB${sha ? `  (build ${sha})` : ''}`);
