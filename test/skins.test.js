import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadSkins, parseSkin, createSkins, contrastProblems, TOKENS, BUILTIN_DIR } from '../server/skins.js';
import { buildApp } from '../server/app.js';
import { loadConfig } from '../server/config.js';

const tmp = () => mkdtempSync(join(tmpdir(), 'skins-'));

describe('skins', () => {
  it('the built-in skins are complete and readable (WCAG AA)', () => {
    const warnings = [];
    const { skins, list } = loadSkins({ log: { warn: (m) => warnings.push(m) } });
    expect(skins.map((s) => s.id)).toEqual(['dark', 'amoled', 'sunset', 'light', 'mint', 'mango']);
    expect(list.defaults).toEqual({ light: 'light', dark: 'dark' });
    expect(warnings).toEqual([]);
    for (const s of skins) expect(Object.keys(s.vars).sort()).toEqual([...TOKENS].sort());
    expect(list.skins.find((s) => s.id === 'light').names).toEqual({ '': 'Light', de: 'Hell' });
  });

  it('reads the header, refuses unsafe values and fills in missing colors', () => {
    const s = parseSkin('x', `/*\n * name: Ocean\n * name.de: Ozean\n * scheme: dark\n * order: 5\n */\n:root {\n  --bg: #0B1A2A;\n  --ink: url(evil);\n  --dusk: #12345;\n  --shadow: 0 0 2px rgba(0,0,0,.4);\n  --position: absolute;\n}\nbody { color: red }`);
    expect(s).toMatchObject({ names: { '': 'Ocean', de: 'Ozean' }, scheme: 'dark', order: 5, vars: { bg: '#0b1a2a', shadow: '0 0 2px rgba(0,0,0,.4)' } });
    expect(s.problems.join('\n')).toMatch(/--ink: "url\(evil\)"[\s\S]*--dusk[\s\S]*unknown color --position/);
    const dir = tmp();
    writeFileSync(join(dir, 'ocean.css'), `/* name: Ocean\n scheme: dark */\n:root { --bg: #0b1a2a; }`);
    writeFileSync(join(dir, 'Bad Name.css'), ':root{}');
    const warn = [];
    const { skins, css } = loadSkins({ customDir: dir, log: { warn: (m) => warn.push(m) } });
    const ocean = skins.find((x) => x.id === 'ocean');
    expect(ocean.vars.bg).toBe('#0b1a2a');
    expect(ocean.vars.ink).toBe(skins.find((x) => x.id === 'dark').vars.ink); // from the standard dark skin
    expect(warn.join('\n')).toMatch(/Bad Name.css" skipped[\s\S]*ocean": missing --surface/);
    expect(css).toContain(":root[data-theme='ocean'],\n[data-skin='ocean'] {");
    expect(css).not.toMatch(/[<>]|url\(/);
  });

  it('the example in skins/README.md can be copied as it is', () => {
    const css = readFileSync(join(BUILTIN_DIR, 'README.md'), 'utf8').match(/```css\n([\s\S]*?)```/)[1];
    const s = parseSkin('ocean', css);
    expect(s.problems).toEqual([]);
    expect(s).toMatchObject({ names: { '': 'Ocean', de: 'Ozean' }, scheme: 'dark', order: 50, default: null });
    expect(Object.keys(s.vars).sort()).toEqual([...TOKENS].sort());
    expect(contrastProblems(s.vars)).toEqual([]);
  });

  it('a file of your own with a built-in name replaces it; low contrast is reported, not refused', () => {
    const dir = tmp();
    writeFileSync(join(dir, 'mango.css'), `/* name: Mango light\n scheme: light */\n:root { --bg: #ffffff; --ink: #dddddd; }`);
    const warn = [];
    const { list } = loadSkins({ customDir: dir, log: { warn: (m) => warn.push(m) } });
    expect(list.skins.find((s) => s.id === 'mango')).toMatchObject({ names: { '': 'Mango light' }, bg: '#ffffff' });
    expect(warn.join('\n')).toMatch(/mango": low contrast: ink on bg 1\.\d\d:1/);
    expect(contrastProblems({ ink: '#000000', bg: '#ffffff' })).toEqual([]);
  });

  it('notices a new skin file while running', () => {
    const dir = tmp();
    const get = createSkins({ customDir: dir, checkMs: 0 });
    expect(get().list.skins.map((s) => s.id)).not.toContain('sea');
    writeFileSync(join(dir, 'sea.css'), `/* name: Sea\n scheme: light */\n:root { --dusk: #0b5f8a; }`);
    utimesSync(join(dir, 'sea.css'), new Date(), new Date(Date.now() + 1000));
    expect(get().list.skins.map((s) => s.id)).toContain('sea');
  });
});

describe('skins in the page', () => {
  let app;
  let base;
  let custom;
  beforeAll(async () => {
    const stat = tmp();
    writeFileSync(join(stat, 'index.html'), '<html><head><title>x</title><!--og--><!--skins--></head><body></body></html>');
    custom = tmp();
    writeFileSync(join(custom, 'night.css'), `/* name: Night</script><b>\n scheme: dark */\n:root { --bg: #050505; }`);
    app = await buildApp({ ...loadConfig({}), dataDir: ':memory:', staticDir: stat, skinsDir: custom });
    await app.listen({ port: 0, host: '127.0.0.1' });
    base = `http://127.0.0.1:${app.server.address().port}`;
  });
  afterAll(() => app.close());

  it('come with the page: colors as <style>, the list as JSON – and a name can never break out', async () => {
    const html = await (await fetch(`${base}/`)).text();
    expect(html).toContain('<style id="skins">');
    expect(html).toContain("[data-skin='night']");
    const json = html.match(/<script type="application\/json" id="skin-list">([^<]*)<\/script>/)[1];
    const list = JSON.parse(json);
    expect(list.skins.find((s) => s.id === 'night').names['']).toBe('Night</script><b>');
    expect(html.match(/<\/script>/g)).toHaveLength(1);
    const api = await (await fetch(`${base}/api/skins`)).json();
    expect(api.css).toContain(':root');
    expect(api.skins.map((s) => s.id)).toContain('night');
  });
});
