<script>
  import { onMount, untrack } from 'svelte';
  import Icon from './Icon.svelte';
  import Flag from './Flag.svelte';
  import { t, i18n } from '../lib/i18n.svelte.js';
  import { formatAmount } from '../../../shared/parse.js';
  import { countryName } from '../../../shared/countries.js';

  /** Big translation to show shop staff. entries: [{ item, text }] of the list, start: index */
  let { entries, start = 0, country, lang, onclose } = $props();
  let i = $state(untrack(() => start));
  const e = $derived(entries[Math.min(i, entries.length - 1)]);
  const amount = $derived(e ? formatAmount(e.item.qty, e.item.unit) : '');
  let closeBtn = $state();

  onMount(() => {
    closeBtn?.focus();
    const key = (ev) => {
      if (ev.key === 'Escape') onclose();
      if (ev.key === 'ArrowRight') next(1);
      if (ev.key === 'ArrowLeft') next(-1);
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  });
  function next(d) {
    i = (i + d + entries.length) % entries.length;
  }
  // swipe left / right on phones
  let x0 = null;
  const down = (ev) => (x0 = ev.clientX);
  const up = (ev) => {
    if (x0 !== null && Math.abs(ev.clientX - x0) > 50 && entries.length > 1) next(ev.clientX < x0 ? 1 : -1);
    x0 = null;
  };
</script>

{#if e}
  <div class="show" role="dialog" tabindex="-1" aria-modal="true" aria-label={t('travel.showTitle')} onpointerdown={down} onpointerup={up}>
    <div class="top">
      <span class="where"><Flag {country} size={22} label={countryName(country, i18n.lang)} /></span>
      <button class="icon-btn" bind:this={closeBtn} onclick={onclose} aria-label={t('close')}><Icon name="x" size={24} /></button>
    </div>
    <div class="card">
      <p class="big" {lang}>{e.text}</p>
      {#if amount}<p class="amount mono">{amount}</p>{/if}
      <p class="orig">{e.item.name}</p>
    </div>
    {#if entries.length > 1}
      <div class="nav">
        <button class="btn" onclick={() => next(-1)} aria-label={t('travel.prev')}><Icon name="chevron" size={20} /></button>
        <span class="mono count">{i + 1} / {entries.length}</span>
        <button class="btn" onclick={() => next(1)} aria-label={t('travel.next')}><Icon name="chevron" size={20} /></button>
      </div>
    {/if}
  </div>
{/if}

<style>
  .show {
    position: fixed;
    inset: 0;
    z-index: 80;
    display: flex;
    flex-direction: column;
    background: var(--bg);
    padding: max(16px, env(safe-area-inset-top)) 16px max(20px, env(safe-area-inset-bottom));
    touch-action: pan-y;
  }
  .top {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  .card {
    flex: 1;
    display: flex;
    flex-direction: column;
    justify-content: center;
    align-items: center;
    text-align: center;
    gap: 14px;
  }
  .big {
    margin: 0;
    font-size: clamp(2.6rem, 12vw, 5.5rem);
    line-height: 1.08;
    font-weight: 600;
    overflow-wrap: anywhere;
    color: var(--ink);
  }
  .amount {
    margin: 0;
    font-size: clamp(1.4rem, 6vw, 2.2rem);
    background: var(--surface-2);
    border: 1px solid var(--line);
    border-radius: 999px;
    padding: 4px 18px;
  }
  .orig {
    margin: 0;
    color: var(--muted);
    font-size: 1.1rem;
  }
  .nav {
    display: flex;
    justify-content: center;
    align-items: center;
    gap: 18px;
  }
  .nav .btn:first-child :global(svg) {
    transform: rotate(180deg);
  }
  .count {
    color: var(--muted);
  }
</style>
