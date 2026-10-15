// The skins (color themes) of ShopWiz. The tokens are written into styles.css as CSS variables;
// this file is the single source for the values that are also needed in JS and in the tests.
// Without a saved choice the page follows the browser: "dark" or "light".

export const SKINS = {
  dark: {
    scheme: 'dark',
    bg: '#101714', surface: '#18211d', 'surface-2': '#212c27', ink: '#e6ede5', muted: '#93a497', line: '#2b3831',
    dusk: '#9a91ff', 'dusk-soft': '#2a2a54', sun: '#f0b429', 'sun-soft': '#46351a', alert: '#f08a6b', ok: '#6fcf97',
    control: '#71857a', 'control-ink': '#c3d0c6', 'on-dusk': '#10102a', 'on-sun': '#201503', 'on-alert': '#1c0a04',
    'focus-bg': '#000000', 'focus-ink': '#ffffff', 'focus-dim': '#7a7a7a',
  },
  amoled: {
    scheme: 'dark',
    bg: '#000000', surface: '#0b0d0c', 'surface-2': '#161a18', ink: '#eef3ee', muted: '#9aab9f', line: '#232a26',
    dusk: '#a59dff', 'dusk-soft': '#1d1b40', sun: '#f2b93a', 'sun-soft': '#3a2c10', alert: '#ff9478', ok: '#74d49c',
    control: '#73867b', 'control-ink': '#cbd6ce', 'on-dusk': '#0c0a24', 'on-sun': '#201503', 'on-alert': '#1c0a04',
    'focus-bg': '#000000', 'focus-ink': '#ffffff', 'focus-dim': '#7a7a7a',
  },
  light: {
    scheme: 'light',
    bg: '#e9ede6', surface: '#fbfcf9', 'surface-2': '#e1e7dd', ink: '#16211b', muted: '#5c6b60', line: '#cad4c5',
    dusk: '#4b45a8', 'dusk-soft': '#dedcf3', sun: '#d9920b', 'sun-soft': '#f6e4be', alert: '#a33a22', ok: '#2f7d4f',
    control: '#83928a', 'control-ink': '#3f4e44', 'on-dusk': '#ffffff', 'on-sun': '#201503', 'on-alert': '#ffffff',
    'focus-bg': '#ffffff', 'focus-ink': '#000000', 'focus-dim': '#8a8a8a',
  },
  cream: {
    scheme: 'light',
    bg: '#f4ede0', surface: '#fffbf3', 'surface-2': '#ece3d2', ink: '#2a2119', muted: '#67584a', line: '#ddd1bc',
    dusk: '#15666a', 'dusk-soft': '#d3e7e3', sun: '#e3a23c', 'sun-soft': '#f7e3c0', alert: '#a33a22', ok: '#2f7d4f',
    control: '#9a8b73', 'control-ink': '#4b3f32', 'on-dusk': '#ffffff', 'on-sun': '#241605', 'on-alert': '#ffffff',
    'focus-bg': '#fffaf0', 'focus-ink': '#1e1712', 'focus-dim': '#8c7f6d',
  },
};

/** Order in the settings: the dark ones, then the light ones */
export const SKIN_IDS = ['dark', 'amoled', 'light', 'cream'];
export const DEFAULT_SKIN = { dark: 'dark', light: 'light' };

/** WCAG contrast ratio of two #rrggbb colors */
export function contrast(a, b) {
  const lum = (hex) => {
    const [r, g, bl] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m);
  return (x + 0.05) / (y + 0.05);
}
