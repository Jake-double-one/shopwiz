// Writes the skin colors from shared/skins.js into client/src/styles.css (between the markers).
// Run after changing a skin: node scripts/skins-css.js – a test checks that both agree.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { SKINS } from '../shared/skins.js';

const SHADOW = {
  light: '0 1px 2px rgba(22, 33, 27, 0.06), 0 12px 32px -18px rgba(22, 33, 27, 0.35)',
  mango: '0 1px 2px rgba(90, 50, 0, 0.08), 0 12px 32px -18px rgba(120, 60, 0, 0.35)',
  dark: '0 1px 2px rgba(0, 0, 0, 0.4), 0 16px 40px -22px rgba(0, 0, 0, 0.9)',
  amoled: '0 0 0 1px rgba(255, 255, 255, 0.04)',
};

const vars = (id, indent) =>
  Object.entries(SKINS[id])
    .filter(([k]) => k !== 'scheme')
    .map(([k, v]) => `${indent}--${k}: ${v};`)
    .concat(`${indent}--shadow: ${SHADOW[id]};`, `${indent}color-scheme: ${SKINS[id].scheme};`)
    .join('\n');

export function skinsCss() {
  return [
    '/* skins:start – generated from shared/skins.js by scripts/skins-css.js, do not edit by hand */',
    '/* no saved choice: light, or dark when the browser is dark ([data-theme="auto"]) */',
    `:root,\n[data-skin='light'] {\n${vars('light', '  ')}\n}`,
    `:root[data-theme='dark'],\n[data-skin='dark'] {\n${vars('dark', '  ')}\n}`,
    `@media (prefers-color-scheme: dark) {\n  :root[data-theme='auto'] {\n${vars('dark', '    ')}\n  }\n}`,
    `:root[data-theme='amoled'],\n[data-skin='amoled'] {\n${vars('amoled', '  ')}\n}`,
    `:root[data-theme='mango'],\n[data-skin='mango'] {\n${vars('mango', '  ')}\n}`,
    '/* skins:end */',
  ].join('\n');
}

const file = fileURLToPath(new URL('../client/src/styles.css', import.meta.url));
export const currentCss = () => readFileSync(file, 'utf8');
export const BLOCK_RE = /\/\* skins:start[\s\S]*?\/\* skins:end \*\//;

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const css = currentCss();
  if (!BLOCK_RE.test(css)) throw new Error('markers missing in styles.css');
  writeFileSync(file, css.replace(BLOCK_RE, skinsCss()));
  console.log('styles.css updated');
}
