<script>
  import Icon from './Icon.svelte';
  import { t, clock } from '../lib/i18n.svelte.js';
  import { api } from '../lib/api.js';
  import { forgetSpace, replaceKnown, deviceName } from '../lib/device.js';
  import { sync } from '../lib/sync.svelte.js';
  import { formatSpaceId } from '../../../shared/ids.js';

  let { status, deleted, spaceId, onleave, onopen } = $props();
  let busy = $state(false);
  let error = $state('');

  async function continueNew() {
    busy = true;
    error = '';
    try {
      const { id } = await api.continueSpace(spaceId, deviceName());
      // keep queued offline changes – entity ids are kept in the continued space
      replaceKnown(spaceId, id);
      sync.close();
      onopen(id);
    } catch {
      error = t('status.continueFailed');
    } finally {
      busy = false;
    }
  }

  function forget() {
    forgetSpace(spaceId);
    onleave();
  }
</script>

<main class="wrap">
  <div class="brand top">Shop<span>·</span>Wiz</div>
  <section class="card">
    <p class="eyebrow mono">{formatSpaceId(spaceId)}</p>
    {#if status === 'notfound'}
      <h2>{t('status.notfoundTitle')}</h2>
      <p class="note">{t('status.notfound')}</p>
      <div class="row wrap-row">
        <button class="btn main" onclick={forget}>{t('status.forgetBack')}</button>
      </div>
    {:else if status === 'deleted'}
      <h2>{t('status.deletedTitle')}</h2>
      <p class="note">{t('status.deleted', { name: deleted?.by ?? '?', date: deleted?.at ? clock(deleted.at) : '' })}</p>
      {#if sync.pendingCount}<p class="hint">{t('status.deletedPending', { count: sync.pendingCount })}</p>{/if}
      {#if error}<p class="hint alert">{error}</p>{/if}
      <div class="row wrap-row">
        <button class="btn main" onclick={continueNew} disabled={busy}><Icon name="plus" />{t('status.continue')}</button>
        <button class="btn" onclick={forget}>{t('status.forgetBack')}</button>
      </div>
    {:else if status === 'kicked'}
      <h2>{t('status.kickedTitle')}</h2>
      <p class="note">{t('status.kicked')}</p>
      <div class="row wrap-row">
        <button class="btn main" onclick={() => sync.open(spaceId)}>{t('status.rejoin')}</button>
        <button class="btn" onclick={forget}>{t('back')}</button>
      </div>
    {:else if status === 'full'}
      <h2>{t('status.fullTitle')}</h2>
      <p class="note">{t('status.full')}</p>
      <button class="btn" onclick={onleave}>{t('back')}</button>
    {:else}
      <h2>{t('status.limitedTitle')}</h2>
      <p class="note">{t('status.limited')}</p>
      <button class="btn" onclick={onleave}>{t('back')}</button>
    {/if}
  </section>
</main>

<style>
  .top {
    margin-bottom: 24px;
  }
</style>
