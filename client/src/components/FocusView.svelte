<script>
  // Focus mode: only the list – categories and items to check off, nothing else.
  // Black on white or white on black, following the light/dark skin.
  import { onMount } from 'svelte';
  import Icon from './Icon.svelte';
  import { t } from '../lib/i18n.svelte.js';
  import { listTree, boughtAt } from '../lib/model.js';
  import FocusItem from './FocusItem.svelte';
  import { prefs, setHideChecked, setFocusSize, FOCUS_SIZES } from '../lib/prefs.svelte.js';
  import { setFocusBars } from '../lib/theme.js';

  /** children: calls from the others in the shop still show up; ontogglescreen: keep the screen on (if the browser can) */
  let { v, list, onclose, screenOn = false, ontogglescreen = null, children } = $props();

  const tree = $derived(listTree(v, list));
  const shown = (items) => (prefs.hideChecked ? items.filter((i) => !i.checked) : items);
  const blocks = $derived(
    [{ id: '', name: '', items: shown(tree.ungrouped) }, ...tree.groups.map((n) => ({ id: n.group.id, name: n.group.name, items: shown(n.items) }))].filter((b) => b.items.length),
  );

  // text size of the focus mode only – in the shop other things count (arm's length, a trolley)
  const sizeIdx = $derived(FOCUS_SIZES.indexOf(prefs.focusSize));
  const resize = (d) => setFocusSize(FOCUS_SIZES[sizeIdx + d]);

  let root = $state();
  onMount(() => {
    root?.focus();
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    // status and navigation bar in the same black / white
    setFocusBars(true);
    return () => {
      document.body.style.overflow = prev;
      setFocusBars(false);
    };
  });
</script>

<div class="focus" style:--f-scale={prefs.focusSize} role="dialog" aria-modal="true" aria-label={t('focus.title', { list: list.name })} tabindex="-1" bind:this={root} onkeydown={(e) => e.key === 'Escape' && onclose()}>
  <div class="banner">
    <button class="exit" onclick={onclose}><Icon name="x" size={18} />{t('focus.exit')}</button>
    <button class="screen size" disabled={sizeIdx <= 0} onclick={() => resize(-1)} aria-label={t('focus.smaller')} title={t('focus.smaller')}><span aria-hidden="true">A<span class="pm">−</span></span></button>
    <button class="screen size big" disabled={sizeIdx >= FOCUS_SIZES.length - 1} onclick={() => resize(1)} aria-label={t('focus.larger')} title={t('focus.larger')}><span aria-hidden="true">A<span class="pm">+</span></span></button>
    <button class="screen" aria-pressed={prefs.hideChecked} onclick={() => setHideChecked(!prefs.hideChecked)} aria-label={t('hideChecked.toggle')} title={t('hideChecked.toggle')}>
      <Icon name={prefs.hideChecked ? 'eyeOff' : 'eye'} />
    </button>
    {#if ontogglescreen}
      <button class="screen" aria-pressed={screenOn} onclick={ontogglescreen} aria-label={t('screen.toggle')} title={t('screen.toggle')}><Icon name="screen" /></button>
    {/if}
  </div>
  {@render children?.()}
  {#each blocks as b (b.id)}
    <section>
      {#if b.name}<h2>{b.name}</h2>{/if}
      <ul>
        {#each b.items as it (it.id)}
          <FocusItem item={it} bought={boughtAt(v, list, it)} />
        {/each}
      </ul>
    </section>
  {:else}
    <p class="empty">{t('focus.empty')}</p>
  {/each}
</div>

<style>
  .focus {
    --f-bg: var(--focus-bg);
    --f-ink: var(--focus-ink);
    --f-dim: var(--focus-dim);
    position: fixed;
    inset: 0;
    z-index: 55;
    overflow-y: auto;
    overscroll-behavior: contain;
    background: var(--f-bg);
    color: var(--f-ink);
    padding: 0 20px max(40px, env(safe-area-inset-bottom));
    outline: none;
  }
  /* the way out: a banner across the top (plus "keep the screen on") */
  .banner {
    position: sticky;
    top: 0;
    z-index: 1;
    display: flex;
    align-items: stretch;
    width: calc(100% + 40px);
    margin: 0 -20px 18px;
    padding-top: env(safe-area-inset-top);
    border-bottom: 1px solid var(--f-dim);
    background: var(--f-bg);
  }
  .exit {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    min-height: 52px;
    padding: 10px 16px;
    border: 0;
    background: none;
    color: var(--f-ink);
    font-family: var(--mono);
    font-size: 0.78rem;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    font-weight: 700;
    text-align: center;
    line-height: 1.25;
  }
  .screen {
    display: grid;
    place-items: center;
    width: 56px;
    border: 0;
    border-left: 1px solid var(--f-dim);
    background: none;
    color: var(--f-dim);
  }
  .screen.size {
    width: 48px;
    font-weight: 700;
    font-size: 1rem;
    color: var(--f-ink);
  }
  .screen.size.big {
    font-size: 1.3rem;
  }
  .screen.size:disabled {
    opacity: 0.3;
  }
  .pm {
    font-size: 0.8em;
  }
  .screen[aria-pressed='true'] {
    background: var(--f-ink);
    color: var(--f-bg);
  }
  section {
    max-width: 640px;
    margin: 0 auto;
  }
  section + section {
    margin-top: 22px;
  }
  h2 {
    margin: 0 0 4px;
    font-family: var(--mono);
    font-size: calc(0.78rem * var(--f-scale, 1));
    letter-spacing: 0.16em;
    text-transform: uppercase;
    font-weight: 700;
    color: var(--f-ink);
  }
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .empty {
    margin: 30vh 0 0;
    text-align: center;
    font-size: 1.2rem;
    color: var(--f-dim);
  }
</style>
