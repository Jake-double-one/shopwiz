<script>
  import { t, i18n, setLang, LANGUAGES } from '../lib/i18n.svelte.js';
  import { setTheme, THEMES } from '../lib/theme.js';
  import { load } from '../lib/storage.js';

  let { compact = false } = $props();
  let theme = $state(load('theme', 'auto'));
</script>

<div class="prefs" class:compact>
  <label class="lang">
    <span class="sr-only">{t('prefs.language')}</span>
    <select class="select small" value={i18n.lang} onchange={(e) => setLang(e.target.value)} aria-label={t('prefs.language')}>
      {#each Object.entries(LANGUAGES) as [code, l] (code)}
        <option value={code}>{compact ? code.toUpperCase() : l.name}</option>
      {/each}
    </select>
  </label>
  <div class="themeswitch" role="group" aria-label={t('prefs.theme')}>
    {#each THEMES as th (th)}
      <button type="button" aria-pressed={theme === th} onclick={() => (theme = setTheme(th))}>{t(`theme.${th}`)}</button>
    {/each}
  </div>
</div>

<style>
  .prefs {
    display: flex;
    gap: 8px;
    align-items: center;
    flex-wrap: wrap;
  }
  .select.small {
    min-height: 32px;
    padding: 4px 10px;
    border-radius: 999px;
    font-family: var(--mono);
    font-size: 0.72rem;
    width: auto;
  }
</style>
