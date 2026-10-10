import { mount } from 'svelte';
import '@fontsource/instrument-sans/400.css';
import '@fontsource/instrument-sans/500.css';
import '@fontsource/instrument-sans/600.css';
import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/500.css';
import '@fontsource/ibm-plex-mono/600.css';
import './styles.css';
import App from './App.svelte';
import { applyTheme } from './lib/theme.js';
import { i18n } from './lib/i18n.svelte.js';

applyTheme();

// On-screen keyboards (iOS Safari in particular) cover the page instead of shrinking it.
// --kb holds the covered height so dialogs and the input bar can sit right above the keyboard.
const vv = window.visualViewport;
if (vv) {
  const update = () => {
    const kb = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
    document.documentElement.style.setProperty('--kb', `${Math.round(kb)}px`);
  };
  vv.addEventListener('resize', update);
  vv.addEventListener('scroll', update);
  update();
}
document.documentElement.lang = i18n.lang;

mount(App, { target: document.getElementById('app') });

if (import.meta.env.PROD && 'serviceWorker' in navigator && window.isSecureContext) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
}
