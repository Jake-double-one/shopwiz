<script>
  import Icon from './Icon.svelte';
  import { t } from '../lib/i18n.svelte.js';
  import { toggleItem, setParked, editItem } from '../lib/actions.js';
  import { formatAmount, stepAmount } from '../../../shared/parse.js';

  /** inactive: row of the shadow list – tapping puts it back on the list */
  let { item, fresh = false, conflict = false, inactive = false, onedit } = $props();
  const activate = () => setParked(item, false);
  // +/- next to the amount (only shown on wide screens, see CSS)
  const stepper = $derived(!inactive && !item.checked);
  const down = $derived(stepAmount(item.qty, item.unit, -1));
  const step = (dir) => {
    const next = stepAmount(item.qty, item.unit, dir);
    if (next) editItem(item, { amount: next });
  };
  const amount = $derived(formatAmount(item.qty, item.unit));
</script>

<li class="item" class:checked={item.checked} class:inactive class:fresh data-id={item.id}>
  <span class="handle" aria-hidden="true" title={t('item.drag')}><Icon name="grip" size={16} /></span>
  {#if inactive}
    <button class="check" aria-label={t('inactive.activate', { name: item.name })} title={t('inactive.activateShort')} onclick={activate}>
      <span class="box plus"><Icon name="plus" size={16} /></span>
    </button>
  {:else}
    <button class="check" role="checkbox" aria-checked={item.checked} aria-label={item.name} onclick={() => toggleItem(item)}>
      <span class="box">{#if item.checked}<Icon name="check" size={16} />{/if}</span>
    </button>
  {/if}
  <button class="body" onclick={() => (inactive ? activate() : toggleItem(item))} tabindex="-1">
    <span class="name">
      {item.name}
      {#if fresh}<span class="badge">{t('item.new')}</span>{/if}
      {#if conflict}<span class="badge warn" title={t('conflict.title')}>!</span>{/if}
    </span>
    {#if item.note}
      <span class="meta"><span class="note-text">{item.note}</span></span>
    {/if}
  </button>
  {#if stepper}
    <span class="stepper">
      {#if down}
        <button class="step" onclick={() => step(-1)} aria-label={t('item.less', { name: item.name })} title={t('item.lessShort')}>−</button>
      {/if}
      {#if amount}<span class="amount mono">{amount}</span>{/if}
      <button class="step" onclick={() => step(1)} aria-label={t('item.more', { name: item.name })} title={t('item.moreShort')}>+</button>
    </span>
  {:else if amount}<span class="amount mono">{amount}</span>{/if}
  <button class="icon-btn edit" onclick={() => onedit(item)} aria-label={t('item.edit', { name: item.name })} title={t('item.editShort')}>
    <Icon name="more" size={18} />
  </button>
</li>

<style>
  .item {
    display: flex;
    align-items: center;
    gap: 2px;
    min-height: 44px;
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
    color: var(--control);
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
    height: 40px;
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
    border: 2px solid var(--control);
    color: #fff;
    transition: all 0.15s ease;
  }
  .check:hover .box {
    border-color: var(--dusk);
  }
  .box.plus {
    border-style: dashed;
    color: var(--muted);
  }
  .check:hover .box.plus {
    color: var(--dusk);
  }
  .inactive .name {
    color: var(--muted);
    font-weight: 400;
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
    padding: 5px 4px;
    text-align: left;
    color: var(--ink);
  }
  .name {
    font-size: 1.08rem;
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
  .stepper {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    flex: 0 0 auto;
  }
  .step {
    display: none;
    width: 28px;
    height: 28px;
    border-radius: 999px;
    border: 1px solid var(--control);
    background: var(--surface);
    color: var(--control-ink);
    font-family: var(--mono);
    font-size: 1rem;
    line-height: 1;
    padding: 0;
  }
  .step:hover {
    border-color: var(--dusk);
    color: var(--ink);
  }
  /* only where there is room – on phones the edit sheet has the stepper */
  @media (min-width: 640px) {
    .step {
      display: inline-grid;
      place-items: center;
    }
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
    height: 36px;
  }
</style>
