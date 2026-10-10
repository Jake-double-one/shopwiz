<script>
  import Sheet from './Sheet.svelte';
  import Icon from './Icon.svelte';
  import { t } from '../lib/i18n.svelte.js';
  import { sync } from '../lib/sync.svelte.js';
  import { toast } from '../lib/toast.svelte.js';
  import { groupOptions } from '../lib/model.js';
  import { spotPlace } from '../lib/signals.js';

  /** shoppers: the other devices checked in at the shop */
  let { v, list, shoppers, mySpot, onclose } = $props();

  let to = $state(null); // null = everybody in the shop
  let place = $state(''); // '' = my last spot
  const places = $derived(groupOptions(v, list).map((o) => (o.depth ? `${o.parent} › ${o.label}` : o.label)));
  const autoPlace = $derived(spotPlace(mySpot));
  const comePlace = $derived(place || autoPlace);

  function send(kind) {
    const ok = sync.sendSignal({ kind, to, place: kind === 'come' ? comePlace : '' });
    if (!ok) return toast({ text: t('call.offline'), kind: 'alert' });
    const target = to ? shoppers.find((s) => s.devId === to)?.name : null;
    toast(target ? t('call.sentTo', { name: target }) : t('call.sentAll'));
    onclose();
  }
</script>

<Sheet title={t('call.title')} eyebrow={t('call.eyebrow')} {onclose}>
  <div class="to" role="group" aria-label={t('call.to')}>
    <span class="micro">{t('call.to')}</span>
    <button class="chip" aria-pressed={to === null} onclick={() => (to = null)}>{t('call.everybody')}</button>
    {#each shoppers as s (s.devId)}
      <button class="chip" aria-pressed={to === s.devId} onclick={() => (to = s.devId)}>{s.name}</button>
    {/each}
  </div>

  <div class="signals">
    <button class="btn block big" onclick={() => send('where')}>{t('call.where')}</button>
    <button class="btn block big main" onclick={() => send('come')}>
      {comePlace ? t('call.comeAt', { place: comePlace }) : t('call.come')}
    </button>
    <label class="place">
      <span class="micro">{t('call.place')}</span>
      <select class="select" bind:value={place}>
        <option value="">{autoPlace ? t('call.placeAuto', { place: autoPlace }) : t('call.placeNone')}</option>
        {#each places as p (p)}<option value={p}>{p}</option>{/each}
      </select>
    </label>
    <button class="btn block big" onclick={() => send('checkout')}>{t('call.checkout')}</button>
    <button class="btn block big" onclick={() => send('done')}>{t('call.done')}</button>
  </div>
  <p class="note small"><Icon name="screen" size={14} /> {t('call.note')}</p>
</Sheet>

<style>
  .to {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
    margin-bottom: 16px;
  }
  .signals {
    display: grid;
    gap: 10px;
  }
  .big {
    min-height: 52px;
    font-size: 1.02rem;
  }
  .place {
    display: flex;
    align-items: center;
    gap: 8px;
    margin: -4px 0 4px;
  }
  .place .select {
    flex: 1;
    min-height: 36px;
    padding: 4px 10px;
    font-size: 0.85rem;
  }
  .small {
    margin-top: 14px;
    font-size: 0.82rem;
    display: flex;
    gap: 6px;
    align-items: center;
  }
</style>
