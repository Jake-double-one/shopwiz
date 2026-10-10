<script>
  import Icon from './Icon.svelte';
  import { t } from '../lib/i18n.svelte.js';
  import { toggleItem } from '../lib/actions.js';
  import { formatAmount } from '../../../shared/parse.js';
  import { sync } from '../lib/sync.svelte.js';

  let { item, fresh = false, conflict = false, onedit } = $props();
  const amount = $derived(formatAmount(item.qty, item.unit));
  const myName = $derived(sync.me?.name);
  const by = $derived(item.checked ? (item.checkedBy && item.checkedBy !== myName ? `✓ ${item.checkedBy}` : '') : item.addedBy && item.addedBy !== myName ? t('item.by', { name: item.addedBy }) : '');
</script>

<li class="item" class:checked={item.checked} class:fresh data-id={item.id}>
  <span class="handle" aria-hidden="true" title={t('item.drag')}><Icon name="grip" size={16} /></span>
  <button class="check" role="checkbox" aria-checked={item.checked} aria-label={item.name} onclick={() => toggleItem(item)}>
    <span class="box">{#if item.checked}<Icon name="check" size={16} />{/if}</span>
  </button>
  <button class="body" onclick={() => toggleItem(item)} tabindex="-1">
    <span class="name">
      {item.name}
      {#if fresh}<span class="badge">{t('item.new')}</span>{/if}
      {#if conflict}<span class="badge warn" title={t('conflict.title')}>!</span>{/if}
    </span>
    {#if item.note || by}
      <span class="meta">
        {#if item.note}<span class="note-text">{item.note}</span>{/if}
        {#if by}<span class="by">{by}</span>{/if}
      </span>
    {/if}
  </button>
  {#if amount}<span class="amount mono">{amount}</span>{/if}
  <button class="icon-btn edit" onclick={() => onedit(item)} aria-label={t('item.edit', { name: item.name })} title={t('item.editShort')}>
    <Icon name="more" size={18} />
  </button>
</li>

<style>
  .item {
    display: flex;
    align-items: center;
    gap: 2px;
    min-height: 52px;
    padding: 2px 4px 2px 0;
    border-top: 1px solid var(--line);
    background: var(--surface);
    transition: opacity 0.2s ease;
  }
  .item:first-child {
    border-top: 0;
  }
  .handle {
    display: grid;
    place-items: center;
    width: 26px;
    align-self: stretch;
    color: var(--line);
    cursor: grab;
    touch-action: none;
    flex: 0 0 auto;
  }
  .item:hover .handle {
    color: var(--muted);
  }
  .check {
    display: grid;
    place-items: center;
    width: 40px;
    height: 44px;
    background: none;
    border: 0;
    padding: 0;
    flex: 0 0 auto;
  }
  .box {
    display: grid;
    place-items: center;
    width: 24px;
    height: 24px;
    border-radius: 8px;
    border: 2px solid var(--line);
    color: #fff;
    transition: all 0.15s ease;
  }
  .check:hover .box {
    border-color: var(--dusk);
  }
  .checked .box {
    background: var(--dusk);
    border-color: var(--dusk);
  }
  :global(:root[data-theme='dark']) .checked .box {
    color: #10102a;
  }
  .body {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 1px;
    background: none;
    border: 0;
    padding: 8px 4px;
    text-align: left;
    color: var(--ink);
  }
  .name {
    font-weight: 500;
    overflow-wrap: anywhere;
  }
  .checked .name {
    text-decoration: line-through;
    text-decoration-color: var(--muted);
    color: var(--muted);
    font-weight: 400;
  }
  .meta {
    display: flex;
    flex-wrap: wrap;
    gap: 2px 10px;
    font-size: 0.8rem;
    color: var(--muted);
  }
  .note-text {
    white-space: pre-line;
    overflow-wrap: anywhere;
  }
  .by {
    font-family: var(--mono);
    font-size: 0.68rem;
    letter-spacing: 0.04em;
  }
  .amount {
    font-size: 0.85rem;
    font-weight: 500;
    color: var(--ink);
    background: var(--surface-2);
    border: 1px solid var(--line);
    border-radius: 999px;
    padding: 2px 9px;
    white-space: nowrap;
    flex: 0 0 auto;
  }
  .checked .amount {
    color: var(--muted);
  }
  .checked {
    opacity: 0.72;
  }
  .badge {
    display: inline-block;
    margin-left: 6px;
    font-family: var(--mono);
    font-size: 0.6rem;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    background: var(--sun);
    color: #201503;
    border-radius: 999px;
    padding: 1px 7px;
    vertical-align: 2px;
    text-decoration: none;
  }
  .badge.warn {
    background: var(--alert);
    color: #fff;
  }
  .fresh {
    background: color-mix(in srgb, var(--sun-soft) 55%, var(--surface));
  }
  .edit {
    width: 36px;
    height: 40px;
  }
</style>
