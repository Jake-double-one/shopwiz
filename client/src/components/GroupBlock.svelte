<script>
  import Icon from './Icon.svelte';
  import { t } from '../lib/i18n.svelte.js';

  let { group, sub = false, count = 0, collapsed = false, ontoggle, onmenu, onadd, children } = $props();
</script>

<section class="group" class:sub class:top={!sub} data-id={group.id}>
  <header>
    <span class="g-handle" class:g-top={!sub} class:g-sub={sub} aria-hidden="true" title={t('group.drag')}><Icon name="grip" size={16} /></span>
    <button class="toggle" onclick={ontoggle} aria-expanded={!collapsed}>
      <span class="chev" class:open={!collapsed}><Icon name="chevron" size={16} /></span>
      <span class="name">{group.name}</span>
      {#if count}<span class="count mono">{count}</span>{/if}
    </button>
    <button class="icon-btn" onclick={onadd} aria-label={t('group.addItemTo', { name: group.name })} title={t('group.addItemTo', { name: group.name })}>
      <Icon name="plus" size={18} />
    </button>
    <button class="icon-btn" onclick={onmenu} aria-label={t('group.menu', { name: group.name })} title={t('group.menuShort')}>
      <Icon name="more" size={18} />
    </button>
  </header>
  <div class="content" hidden={collapsed}>
    {@render children()}
  </div>
</section>

<style>
  .group {
    border-top: 1px solid var(--line);
    background: var(--surface);
  }
  .group.sub {
    margin-left: 18px;
    border-left: 2px solid var(--surface-2);
  }
  header {
    display: flex;
    align-items: center;
    gap: 2px;
    min-height: 46px;
  }
  .g-handle {
    display: grid;
    place-items: center;
    width: 26px;
    align-self: stretch;
    color: var(--control);
    cursor: grab;
    touch-action: none;
  }
  header:hover .g-handle {
    color: var(--muted);
  }
  .toggle {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 6px;
    background: none;
    border: 0;
    padding: 8px 4px;
    text-align: left;
    font-family: var(--mono);
    font-size: 0.74rem;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--ink);
    font-weight: 600;
  }
  .sub .toggle {
    color: var(--muted);
    font-weight: 500;
  }
  .name {
    overflow-wrap: anywhere;
  }
  .chev {
    display: inline-grid;
    color: var(--muted);
    transition: transform 0.15s ease;
  }
  .chev.open {
    transform: rotate(90deg);
  }
  .count {
    letter-spacing: 0;
    font-size: 0.7rem;
    color: var(--muted);
    background: var(--surface-2);
    border-radius: 999px;
    padding: 1px 8px;
    font-weight: 500;
  }
  .content {
    padding-bottom: 2px;
  }
</style>
