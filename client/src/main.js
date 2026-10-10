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
document.documentElement.lang = i18n.lang;

mount(App, { target: document.getElementById('app') });

if (import.meta.env.PROD && 'serviceWorker' in navigator && window.isSecureContext) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
}
