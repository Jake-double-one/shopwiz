import { describe, it, expect } from 'vitest';
import { SKINS, SKIN_IDS, DEFAULT_SKIN, contrast } from '../shared/skins.js';
import { skinsCss, currentCss, BLOCK_RE } from '../scripts/skins-css.js';

describe('skins', () => {
  it('styles.css carries exactly the colors of shared/skins.js', () => {
    expect(currentCss().match(BLOCK_RE)?.[0]).toBe(skinsCss());
  });

  it('every skin is readable (WCAG AA) and has every color', () => {
    const keys = Object.keys(SKINS.light);
    const low = [];
    for (const id of SKIN_IDS) {
      const s = SKINS[id];
      expect(Object.keys(s).sort(), id).toEqual([...keys].sort());
      // text on its backgrounds: at least 4.5:1
      for (const [a, b] of [['ink', 'bg'], ['ink', 'surface'], ['ink', 'surface-2'], ['ink', 'dusk-soft'], ['ink', 'sun-soft'], ['muted', 'bg'], ['muted', 'surface'],
        ['dusk', 'surface'], ['dusk', 'bg'], ['alert', 'surface'], ['on-dusk', 'dusk'], ['on-sun', 'sun'], ['on-alert', 'alert'], ['focus-ink', 'focus-bg']]) {
        if (contrast(s[a], s[b]) < 4.5) low.push(`${id}: ${a} on ${b} ${contrast(s[a], s[b]).toFixed(2)}`);
      }
      // checkbox borders and other controls: at least 3:1
      if (contrast(s.control, s.surface) < 3) low.push(`${id}: control on surface ${contrast(s.control, s.surface).toFixed(2)}`);
    }
    expect(low).toEqual([]);
  });

  it('the standard skins for a light and a dark browser exist', () => {
    expect(SKINS[DEFAULT_SKIN.light].scheme).toBe('light');
    expect(SKINS[DEFAULT_SKIN.dark].scheme).toBe('dark');
  });
});
