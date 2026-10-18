<script>
  import Sheet from './Sheet.svelte';
  import Icon from './Icon.svelte';
  import { t } from '../lib/i18n.svelte.js';
  import { api } from '../lib/api.js';
  import { toast } from '../lib/toast.svelte.js';
  import { knownSpaces } from '../lib/device.js';
  import { parseSpaceId, formatSpaceId } from '../../../shared/ids.js';

  let { spaceId, itemIds = null, groupId = null, fromListId = null, label, onclose } = $props();

  const known = knownSpaces();
  let targetInput = $state('');
  let target = $state(null); // { id, name, lists }
  let listId = $state('');
  let mode = $state('copy');
  let busy = $state(false);
  let error = $state('');

  async function choose(id) {
    error = '';
    const parsed = parseSpaceId(id);
    if (!parsed) {
      error = t('start.invalidId');
      return;
    }
    busy = true;
    try {
      target = await api.lists(parsed);
      listId = target.lists[0]?.id ?? '';
    } catch (e) {
      error = e.code === 'offline' ? t('start.offline') : e.status === 429 ? t('status.limited') : t('transfer.notFound');
    } finally {
      busy = false;
    }
  }

  async function send() {
    if (!target || !listId) return;
    busy = true;
    error = '';
    try {
      const r = await api.transfer(spaceId, { to: target.id, listId, itemIds, groupId, fromListId, mode });
      toast(t(mode === 'move' ? 'transfer.moved' : 'transfer.copied', { count: r.count, name: target.name }));
      onclose();
    } catch (e) {
      error = e.code === 'offline' ? t('start.offline') : t('transfer.failed');
    } finally {
      busy = false;
    }
  }
</script>

<Sheet title={t('transfer.title')} eyebrow={label} {onclose}>
  {#if !target}
    <p class="note">{t('transfer.note')}</p>
    <div class="known">
      <button class="btn block" onclick={() => choose(spaceId)} disabled={busy}><Icon name="list" />{t('transfer.thisSpace')}</button>
      {#each known.filter((s) => s.id !== spaceId) as s (s.id)}
        <button class="btn block" onclick={() => choose(s.id)} disabled={busy}><Icon name="swap" />{s.name} <span class="micro">{formatSpaceId(s.id)}</span></button>
      {/each}
    </div>
    <form onsubmit={(e) => (e.preventDefault(), choose(targetInput))}>
      <label class="field">
        <span>{t('transfer.otherId')}</span>
        <div class="row">
          <input data-1p-ignore data-lpignore="true" data-bwignore data-form-type="other" class="input mono" bind:value={targetInput} placeholder="XXXX-XXXX-XX" autocomplete="off" spellcheck="false" />
          <button class="btn dusk" type="submit" disabled={busy || !targetInput.trim()}>{t('transfer.next')}</button>
        </div>
      </label>
    </form>
  {:else}
    <p class="eyebrow">{target.name} · {formatSpaceId(target.id)}</p>
    <label class="field">
      <span>{t('transfer.targetList')}</span>
      <select class="select input" bind:value={listId}>
        {#each target.lists as l (l.id)}<option value={l.id}>{l.name}</option>{/each}
      </select>
    </label>
    <div class="themeswitch mode" role="group" aria-label={t('transfer.mode')}>
      <button type="button" aria-pressed={mode === 'copy'} onclick={() => (mode = 'copy')}>{t('transfer.copy')}</button>
      <button type="button" aria-pressed={mode === 'move'} onclick={() => (mode = 'move')}>{t('transfer.move')}</button>
    </div>
    <p class="note">{t(mode === 'move' ? 'transfer.moveHint' : 'transfer.copyHint')}</p>
    <div class="row">
      <button class="btn main" onclick={send} disabled={busy || !listId}><Icon name="send" />{t(mode === 'move' ? 'transfer.move' : 'transfer.copy')}</button>
      <button class="btn" onclick={() => (target = null)}>{t('back')}</button>
    </div>
  {/if}
  {#if error}<p class="hint alert">{error}</p>{/if}
</Sheet>

<style>
  .known {
    display: grid;
    gap: 8px;
    margin-bottom: 16px;
  }
  .known .btn {
    justify-content: flex-start;
  }
  .known .micro {
    margin-left: auto;
  }
  .mode {
    margin-bottom: 8px;
  }
</style>
