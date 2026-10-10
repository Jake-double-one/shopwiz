<script>
  import Icon from './Icon.svelte';
  import { t, relTime } from '../lib/i18n.svelte.js';
  import { sync } from '../lib/sync.svelte.js';
  import { toast } from '../lib/toast.svelte.js';
  import { groupOptions } from '../lib/model.js';
  import { signalText, spotPlace } from '../lib/signals.js';

  let { sig, v, list, mySpot, ondismiss } = $props();
  let choosing = $state(false);
  const myPlace = $derived(spotPlace(mySpot));
  const places = $derived(groupOptions(v, list).map((o) => (o.depth ? `${o.parent} › ${o.label}` : o.label)));

  function reply(kind, place = '') {
    const res = sync.sendSignal({ kind, to: sig.from.devId, place, replyTo: sig.id });
    toast(res === 'queued' ? t('call.queued') : t('call.sentTo', { name: sig.from.name }));
    ondismiss();
  }
</script>

<div class="signal" class:all={sig.kind === 'allDone'} role="alert">
  <div class="text">
    <Icon name={sig.kind === 'allDone' ? 'cart' : 'nav'} size={18} />
    <span><b>{signalText(sig)}</b> <span class="when">· {relTime(sig.at)}</span></span>
  </div>
  {#if sig.kind === 'where'}
    {#if choosing}
      <div class="row wrap-row">
        {#each places as p (p)}
          <button class="chip" onclick={() => reply('here', p)}>{p}</button>
        {/each}
      </div>
    {/if}
    <div class="row wrap-row actions">
      {#if myPlace && !choosing}
        <button class="btn small main" onclick={() => reply('here', myPlace)}>{t('signal.replyHere', { place: myPlace })}</button>
      {/if}
      <button class="btn small" onclick={() => reply('checkout')}>{t('signal.replyCheckout')}</button>
      {#if places.length && !choosing}
        <button class="btn small" onclick={() => (choosing = true)}>{t('signal.replyChoose')}</button>
      {/if}
      <button class="btn small" onclick={ondismiss}>{t('signal.ok')}</button>
    </div>
  {:else}
    <div class="row actions">
      <button class="btn small" onclick={ondismiss}>{t('signal.ok')}</button>
    </div>
  {/if}
</div>

<style>
  .signal {
    background: var(--surface);
    border: 2px solid var(--dusk);
    border-radius: 14px;
    padding: 12px 14px;
    margin-bottom: 10px;
    box-shadow: var(--shadow);
    animation: pop 0.25s ease;
  }
  .signal.all {
    border-color: var(--sun);
  }
  .text {
    display: flex;
    gap: 8px;
    align-items: flex-start;
    color: var(--dusk);
  }
  .text b {
    color: var(--ink);
    font-weight: 600;
  }
  .when {
    color: var(--muted);
    font-size: 0.85rem;
  }
  .row {
    margin-top: 10px;
  }
  .actions {
    justify-content: flex-end;
  }
  @keyframes pop {
    from {
      transform: scale(0.97);
      opacity: 0;
    }
  }
</style>
