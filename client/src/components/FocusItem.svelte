<script>
  // One row of the focus mode: tap or swipe (if turned on) to check off.
  import Icon from './Icon.svelte';
  import SwipeStrip from './SwipeStrip.svelte';
  import { t } from '../lib/i18n.svelte.js';
  import { toggleItem, setParked } from '../lib/actions.js';
  import { formatAmount } from '../../../shared/parse.js';
  import { prefs, swipeAction } from '../lib/prefs.svelte.js';
  import { swipeable } from '../lib/swipe.js';

  let { item } = $props();
  const amount = $derived(formatAmount(item.qty, item.unit));

  let sw = $state({ dx: 0, action: null, armed: false, swiping: false, settling: false });
  const run = (a) => (a === 'check' ? toggleItem(item) : setParked(item, true, { undo: true }));
  const swipeParams = $derived({ enabled: prefs.swipe !== 'off', actionFor: (dir) => swipeAction(dir), onrun: run, onchange: (s) => (sw = s) });
  const label = $derived(sw.action === 'check' ? t(item.checked ? 'swipe.uncheck' : 'swipe.check') : t('swipe.park'));
</script>

<li use:swipeable={swipeParams} class:swipe-on={prefs.swipe !== 'off'} class:moving={sw.swiping || sw.settling} class:settling={sw.settling} style:--dx={sw.dx ? `${sw.dx}px` : null}>
  {#if sw.dx}<SwipeStrip dx={sw.dx} action={sw.action} armed={sw.armed} {label} />{/if}
  <button class="row" class:done={item.checked} role="checkbox" aria-checked={item.checked} onclick={() => toggleItem(item)}>
    <span class="box">{#if item.checked}<Icon name="check" size={20} />{/if}</span>
    <span class="text">
      {#if amount}<span class="amount">{amount}</span>{/if}
      <span class="name">{item.name}</span>
    </span>
  </button>
</li>

<style>
  li {
    position: relative;
  }
  li.swipe-on {
    touch-action: pan-y pinch-zoom;
  }
  li.moving {
    overflow: hidden;
  }
  li.moving .row {
    transform: translateX(var(--dx, 0px));
  }
  li.settling .row {
    transition: transform 0.18s ease;
  }
  /* black and white like the rest of the focus mode */
  li :global(.swipe-strip) {
    background: var(--f-bg);
    color: var(--f-dim);
  }
  li :global(.swipe-strip.armed) {
    background: var(--f-ink);
    color: var(--f-bg);
  }
  .row {
    display: flex;
    align-items: center;
    gap: 14px;
    width: 100%;
    min-height: 54px;
    padding: 8px 0;
    border: 0;
    background: var(--f-bg);
    color: var(--f-ink);
    text-align: left;
    font: inherit;
  }
  .box {
    display: grid;
    place-items: center;
    flex: none;
    width: 28px;
    height: 28px;
    border: 2px solid var(--f-ink);
    border-radius: 8px;
  }
  .done .box {
    background: var(--f-ink);
    color: var(--f-bg);
  }
  .text {
    font-size: 1.3rem;
    line-height: 1.25;
    font-weight: 600;
    overflow-wrap: anywhere;
  }
  .amount {
    font-weight: 400;
    margin-right: 6px;
  }
  .done .text {
    color: var(--f-dim);
    text-decoration: line-through;
    font-weight: 400;
  }
</style>
