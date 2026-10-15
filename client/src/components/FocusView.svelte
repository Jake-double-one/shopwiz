<script>
  // Focus mode: only the list – categories and items to check off, nothing else.
  // Black on white or white on black, following the light/dark skin.
  import { onMount } from 'svelte';
  import Icon from './Icon.svelte';
  import { t } from '../lib/i18n.svelte.js';
  import { listTree } from '../lib/model.js';
  import FocusItem from './FocusItem.svelte';
  import { prefs } from '../lib/prefs.svelte.js';
  import { setFocusBars } from '../lib/theme.js';

  /** children: calls from the others in the shop still show up; ontogglescreen: keep the screen on (if the browser can) */
  let { v, list, onclose, screenOn = false, ontogglescreen = null, children } = $props();

  const tree = $derived(listTree(v, list));
  const shown = (items) => (prefs.hideChecked ? items.filter((i) => !i.checked) : items);
  const blocks = $derived(
    [{ id: '', name: '', items: shown(tree.ungrouped) }, ...tree.groups.map((n) => ({ id: n.group.id, name: n.group.name, items: shown(n.items) }))].filter((b) => b.items.length),
  );

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

<div class="focus" role="dialog" aria-modal="true" aria-label={t('focus.title', { list: list.name })} tabindex="-1" bind:this={root} onkeydown={(e) => e.key === 'Escape' && onclose()}>
  <div class="banner">
    <button class="exit" onclick={onclose}><Icon name="x" size={18} />{t('focus.exit')}</button>
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
          <FocusItem item={it} />
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
    padding: max(18px, env(safe-area-inset-top)) 20px max(40px, env(safe-area-inset-bottom));
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
    margin: calc(-1 * max(18px, env(safe-area-inset-top))) -20px 18px;
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
    font-size: 0.78rem;
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
