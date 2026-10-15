<script>
  import { onMount } from 'svelte';
  import { t, i18n, setLang, LANGUAGES } from '../lib/i18n.svelte.js';
  import { setTheme, currentSkin, savedSkin, onSchemeChange, skinList, onSkinList, skinName } from '../lib/theme.js';

  /** compact: the start screen – small swatches without names */
  let { compact = false } = $props();
  let skin = $state(currentSkin());
  let skins = $state(skinList());
  onMount(() => {
    const offScheme = onSchemeChange(() => !savedSkin() && (skin = currentSkin()));
    const offList = onSkinList(() => ((skins = skinList()), (skin = currentSkin())));
    return () => (offScheme(), offList());
  });
  const pick = (id) => (skin = setTheme(id));
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
  {#if compact}
    <div class="swatches" role="radiogroup" aria-label={t('prefs.theme')}>
      {#each skins as s (s.id)}
        <button type="button" role="radio" class="swatch small" style:--sw-bg={s.bg} style:--sw-accent={s.accent} aria-checked={skin === s.id} aria-label={skinName(s, i18n.lang)} title={skinName(s, i18n.lang)} onclick={() => pick(s.id)}></button>
      {/each}
    </div>
  {/if}
</div>

{#if !compact}
  <div class="skins">
    <span class="skins-label" id="skin-label">{t('prefs.theme')}</span>
    <div class="grid" role="radiogroup" aria-labelledby="skin-label">
      {#each skins as s (s.id)}
        <button type="button" role="radio" class="skin" aria-checked={skin === s.id} onclick={() => pick(s.id)}>
          <span class="swatch" style:--sw-bg={s.bg} style:--sw-accent={s.accent} aria-hidden="true"></span>
          <span class="name">{skinName(s, i18n.lang)}</span>
        </button>
      {/each}
    </div>
  </div>
{/if}

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
  /* a skin at a glance: background top left, accent bottom right, split along the diagonal */
  .swatch {
    display: block;
    width: 52px;
    height: 52px;
    padding: 0;
    border-radius: 12px;
    border: 1px solid var(--line);
    background: linear-gradient(to top left, var(--sw-accent) 0 50%, var(--sw-bg) 50% 100%);
    box-shadow: inset 0 0 0 1px rgba(127, 127, 127, 0.15);
  }
  .swatch.small {
    width: 26px;
    height: 26px;
    border-radius: 7px;
  }
  .swatches {
    display: inline-flex;
    gap: 6px;
    padding: 3px 4px;
    border: 1px solid var(--line);
    border-radius: 10px;
    background: var(--surface-2);
  }
  .swatch.small[aria-checked='true'],
  .skin[aria-checked='true'] .swatch {
    outline: 2px solid var(--dusk);
    outline-offset: 2px;
  }
  /* settings: swatches with their names */
  .skins {
    margin-top: 14px;
  }
  .skins-label {
    display: block;
    font-family: var(--mono);
    font-size: 0.68rem;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--muted);
    margin-bottom: 8px;
  }
  .grid {
    display: flex;
    flex-wrap: wrap;
    gap: 12px 10px;
  }
  .skin {
    display: grid;
    justify-items: center;
    gap: 6px;
    width: 72px;
    padding: 4px 0;
    border: 0;
    background: none;
    color: var(--muted);
  }
  .skin[aria-checked='true'] {
    color: var(--ink);
  }
  .name {
    font-family: var(--mono);
    font-size: 0.66rem;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    text-align: center;
    overflow-wrap: anywhere;
  }
</style>
