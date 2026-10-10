<script>
  import { untrack } from 'svelte';
  import Sheet from './Sheet.svelte';
  import Icon from './Icon.svelte';
  import Prefs from './Prefs.svelte';
  import { t } from '../lib/i18n.svelte.js';
  import { updateSpace } from '../lib/actions.js';
  import { api } from '../lib/api.js';
  import { sync } from '../lib/sync.svelte.js';
  import { toast } from '../lib/toast.svelte.js';
  import { knownSpaces, forgetSpace } from '../lib/device.js';
  import { formatSpaceId } from '../../../shared/ids.js';

  let { space, spaceId, onclose, onleave, onopen, onshare } = $props();

  let name = $state(untrack(() => space.name));
  let ttl = $state(untrack(() => space.ttlDays));
  let confirm = $state(null); // 'renew' | 'delete' | 'delete2' | 'forget'
  let typed = $state('');
  let busy = $state(false);
  const online = $derived(sync.status === 'online');
  const others = knownSpaces().filter((s) => s.id !== spaceId);

  function saveName() {
    const n = name.trim();
    if (n && n !== space.name) updateSpace({ name: n.slice(0, 80) });
  }
  function saveTtl() {
    const d = Math.round(Number(ttl));
    if (!Number.isFinite(d)) return (ttl = space.ttlDays);
    const clamped = Math.min(367, Math.max(7, d));
    ttl = clamped;
    if (clamped !== space.ttlDays) updateSpace({ ttlDays: clamped });
  }

  async function renew() {
    busy = true;
    try {
      await api.renew(spaceId);
      confirm = null;
    } catch {
      toast({ text: t('settings.failed'), kind: 'alert' });
    } finally {
      busy = false;
    }
  }

  async function remove() {
    busy = true;
    try {
      await api.remove(spaceId);
      onclose();
    } catch {
      toast({ text: t('settings.failed'), kind: 'alert' });
    } finally {
      busy = false;
    }
  }

  function forget() {
    forgetSpace(spaceId);
    onleave();
  }
</script>

<Sheet title={t('settings.title')} eyebrow={formatSpaceId(spaceId)} {onclose}>
  <section>
    <label class="field">
      <span>{t('settings.spaceName')}</span>
      <input class="input" bind:value={name} onblur={saveName} onkeydown={(e) => e.key === 'Enter' && saveName()} maxlength="80" />
    </label>
    <label class="field">
      <span>{t('settings.ttl')}</span>
      <div class="row">
        <input class="input mono ttl" type="number" min="7" max="367" bind:value={ttl} onblur={saveTtl} onkeydown={(e) => e.key === 'Enter' && saveTtl()} />
        <span class="muted">{t('settings.days')}</span>
      </div>
    </label>
    <p class="note">{t('settings.ttlHint', { days: space.ttlDays })}</p>
  </section>

  <section>
    <p class="eyebrow">{t('settings.device')}</p>
    <Prefs />
  </section>

  <section>
    <p class="eyebrow">{t('settings.spaces')}</p>
    <div class="list">
      <button class="btn block" onclick={onshare}><Icon name="share" />{t('share.title')}</button>
      {#each others as s (s.id)}
        <button class="btn block" onclick={() => (onclose(), onopen(s.id))}><Icon name="swap" />{s.name} <span class="micro">{formatSpaceId(s.id)}</span></button>
      {/each}
      <button class="btn block" onclick={onleave}><Icon name="plus" />{t('settings.otherSpace')}</button>
    </div>
  </section>

  <section class="danger-zone">
    <p class="eyebrow">{t('settings.danger')}</p>

    {#if confirm === 'renew'}
      <div class="hint"><span class="grow">{t('settings.renewConfirm')}</span></div>
      <div class="row">
        <button class="btn main" onclick={renew} disabled={busy || !online}>{t('settings.renew')}</button>
        <button class="btn" onclick={() => (confirm = null)}>{t('cancel')}</button>
      </div>
    {:else if confirm === 'delete'}
      <div class="hint alert"><span class="grow">{t('settings.deleteConfirm1')}</span></div>
      <div class="row">
        <button class="btn danger" onclick={() => ((confirm = 'delete2'), (typed = ''))}>{t('settings.deleteNext')}</button>
        <button class="btn" onclick={() => (confirm = null)}>{t('cancel')}</button>
      </div>
    {:else if confirm === 'delete2'}
      <label class="field">
        <span>{t('settings.deleteConfirm2', { name: space.name })}</span>
        <input class="input" bind:value={typed} autocomplete="off" />
      </label>
      <div class="row">
        <button class="btn danger solid" onclick={remove} disabled={busy || !online || typed.trim().toLowerCase() !== space.name.trim().toLowerCase()}>{t('settings.deleteFinal')}</button>
        <button class="btn" onclick={() => (confirm = null)}>{t('cancel')}</button>
      </div>
    {:else if confirm === 'forget'}
      <div class="hint alert">
        <span class="grow">
          {t('settings.forgetConfirm', { id: formatSpaceId(spaceId) })}
          {#if sync.pendingCount}<br /><b>{t('settings.forgetPending', { count: sync.pendingCount })}</b>{/if}
        </span>
      </div>
      <div class="row">
        <button class="btn danger solid" onclick={forget}>{t('settings.forget')}</button>
        <button class="btn" onclick={() => (confirm = null)}>{t('cancel')}</button>
      </div>
    {:else}
      <div class="list">
        <button class="btn block" onclick={() => (confirm = 'renew')} disabled={!online}><Icon name="key" />{t('settings.renew')}</button>
        <button class="btn block" onclick={() => (confirm = 'forget')}><Icon name="logout" />{t('settings.forget')}</button>
        <button class="btn danger block" onclick={() => (confirm = 'delete')} disabled={!online}><Icon name="trash" />{t('settings.delete')}</button>
      </div>
      {#if !online}<p class="micro">{t('settings.needsOnline')}</p>{/if}
    {/if}
  </section>
</Sheet>

<style>
  section + section {
    margin-top: 18px;
    padding-top: 16px;
    border-top: 1px solid var(--line);
  }
  .ttl {
    max-width: 120px;
  }
  .list {
    display: grid;
    gap: 8px;
  }
  .list .btn {
    justify-content: flex-start;
  }
  .list .micro {
    margin-left: auto;
  }
  .row {
    flex-wrap: wrap;
  }
</style>
