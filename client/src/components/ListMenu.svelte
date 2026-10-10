<script>
  import { untrack } from 'svelte';
  import Sheet from './Sheet.svelte';
  import Icon from './Icon.svelte';
  import { t } from '../lib/i18n.svelte.js';
  import { renameList, setGroupMode, deleteList, clearChecked } from '../lib/actions.js';
  import { sync } from '../lib/sync.svelte.js';

  let { v, list, lists, onclose, onopen, onswitch } = $props();
  let name = $state(untrack(() => list.name));
  let confirmDelete = $state(false);
  const checked = $derived(Object.values(v.items).filter((i) => i.listId === list.id && i.checked).length);
  const online = $derived(sync.status === 'online');

  function saveName() {
    const n = name.trim();
    if (n && n !== list.name) renameList(list, n.slice(0, 80));
  }

  function remove() {
    const other = lists.find((l) => l.id !== list.id);
    deleteList(list, (id) => onswitch(id));
    if (other) onswitch(other.id);
    onclose();
  }
</script>

<Sheet title={list.name} eyebrow={t('list.menu')} {onclose}>
  <form onsubmit={(e) => (e.preventDefault(), saveName(), onclose())}>
    <label class="field">
      <span>{t('list.name')}</span>
      <input class="input" bind:value={name} onblur={saveName} maxlength="80" required />
    </label>
  </form>

  <div class="actions">
    <button class="btn block" onclick={() => onopen('group', { create: true })}><Icon name="folder" />{t('group.add')}</button>
    <button class="btn block" onclick={() => onopen('history')}><Icon name="history" />{t('history.title')}</button>
    {#if checked}
      <button class="btn block" onclick={() => (clearChecked(list.id), onclose())}><Icon name="trash" />{t('list.clearChecked', { count: checked })}</button>
    {/if}
  </div>

  <fieldset class="mode">
    <legend class="eyebrow">{t('list.groupMode')}</legend>
    <label>
      <input type="radio" name="mode" checked={list.groupMode !== 'shared'} disabled={!online} onchange={() => setGroupMode(list, 'own')} />
      <span><b>{t('list.modeOwn')}</b><br /><small class="muted">{t('list.modeOwnHint')}</small></span>
    </label>
    <label>
      <input type="radio" name="mode" checked={list.groupMode === 'shared'} disabled={!online} onchange={() => setGroupMode(list, 'shared')} />
      <span><b>{t('list.modeShared')}</b><br /><small class="muted">{t('list.modeSharedHint')}</small></span>
    </label>
    {#if !online}<p class="micro">{t('list.modeOffline')}</p>{/if}
  </fieldset>

  {#if lists.length > 1}
    {#if confirmDelete}
      <div class="hint alert">
        <span class="grow">{t('list.deleteConfirm', { name: list.name })}</span>
      </div>
      <div class="row">
        <button class="btn danger solid" onclick={remove}>{t('delete')}</button>
        <button class="btn" onclick={() => (confirmDelete = false)}>{t('cancel')}</button>
      </div>
    {:else}
      <button class="btn danger block" onclick={() => (confirmDelete = true)}><Icon name="trash" />{t('list.delete')}</button>
    {/if}
  {:else}
    <p class="micro">{t('list.lastList')}</p>
  {/if}
</Sheet>

<style>
  .actions {
    display: grid;
    gap: 8px;
    margin-bottom: 18px;
  }
  .actions .btn {
    justify-content: flex-start;
  }
  .mode {
    border: 1px solid var(--line);
    border-radius: 14px;
    padding: 12px 14px;
    margin: 0 0 18px;
  }
  .mode label {
    display: flex;
    gap: 10px;
    align-items: flex-start;
    padding: 6px 0;
  }
  .mode input {
    margin-top: 4px;
    accent-color: var(--dusk);
  }
</style>
