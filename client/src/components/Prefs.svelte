<script>
  import { onMount } from 'svelte';
  import Icon from './Icon.svelte';
  import { t, i18n, setLang, LANGUAGES } from '../lib/i18n.svelte.js';
  import { setTheme, currentSkin, savedSkin, onSchemeChange, SKIN_IDS } from '../lib/theme.js';

  /** compact: the start screen – small color dots instead of preview tiles */
  let { compact = false } = $props();
  let skin = $state(currentSkin());
  // nothing picked yet: the shown skin follows the browser's light/dark
  onMount(() => onSchemeChange(() => !savedSkin() && (skin = currentSkin())));
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
      {#each SKIN_IDS as s (s)}
        <button type="button" role="radio" class="swatch" data-skin={s} aria-checked={skin === s} aria-label={t(`theme.${s}`)} title={t(`theme.${s}`)} onclick={() => (skin = setTheme(s))}>
          <span class="dot-accent"></span>
        </button>
      {/each}
    </div>
  {/if}
</div>

{#if !compact}
  <div class="skins">
    <span class="skins-label" id="skin-label">{t('prefs.theme')}</span>
    <div class="tiles" role="radiogroup" aria-labelledby="skin-label">
      {#each SKIN_IDS as s (s)}
        <button type="button" role="radio" class="tile" data-skin={s} aria-checked={skin === s} onclick={() => (skin = setTheme(s))}>
          <span class="preview" aria-hidden="true">
            <span class="box on"><Icon name="check" size={12} /></span>
            <span class="line"><span class="word done">{t('prefs.sample1')}</span></span>
            <span class="box"></span>
            <span class="line"><span class="word">{t('prefs.sample2')}</span><span class="amount">2×</span></span>
          </span>
          <span class="name">{t(`theme.${s}`)}</span>
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
  /* start screen: one dot per skin, painted in its own colors */
  .swatches {
    display: inline-flex;
    gap: 6px;
    padding: 3px;
    border: 1px solid var(--line);
    border-radius: 999px;
    background: var(--surface-2);
  }
  .swatch {
    display: grid;
    place-items: center;
    width: 26px;
    height: 26px;
    padding: 0;
    border-radius: 50%;
    border: 1px solid var(--line);
    background: var(--bg);
  }
  .swatch[aria-checked='true'] {
    outline: 2px solid var(--page-dusk);
    outline-offset: 1px;
  }
  .dot-accent {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: var(--dusk);
  }
  /* settings: a tiny list in every skin */
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
    margin-bottom: 6px;
  }
  .tiles {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 8px;
  }
  @media (min-width: 560px) {
    .tiles {
      grid-template-columns: repeat(4, 1fr);
    }
  }
  .tile {
    display: grid;
    gap: 8px;
    padding: 10px;
    border: 1px solid var(--line);
    border-radius: 12px;
    background: var(--bg);
    color: var(--ink);
    text-align: left;
  }
  /* the picked one: the outline in the colors of the page around it */
  .tile[aria-checked='true'] {
    outline: 2px solid var(--page-dusk);
    outline-offset: 2px;
  }
  .preview {
    display: grid;
    grid-template-columns: auto 1fr;
    align-items: center;
    gap: 6px 8px;
    padding: 8px 10px;
    border-radius: 8px;
    background: var(--surface);
    box-shadow: var(--shadow);
  }
  .box {
    display: grid;
    place-items: center;
    width: 16px;
    height: 16px;
    border-radius: 5px;
    border: 2px solid var(--control);
    color: var(--on-dusk);
  }
  .box.on {
    background: var(--dusk);
    border-color: var(--dusk);
  }
  .line {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 6px;
    min-width: 0;
    font-size: 0.82rem;
    font-weight: 600;
  }
  .word {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .word.done {
    color: var(--muted);
    text-decoration: line-through;
    font-weight: 400;
  }
  .amount {
    font-family: var(--mono);
    font-size: 0.66rem;
    padding: 0 5px;
    border-radius: 999px;
    background: var(--surface-2);
  }
  .name {
    font-family: var(--mono);
    font-size: 0.68rem;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--muted);
  }
</style>
