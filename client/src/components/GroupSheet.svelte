<script>
  import { untrack } from 'svelte';
  import Sheet from './Sheet.svelte';
  import Icon from './Icon.svelte';
  import { t } from '../lib/i18n.svelte.js';
  import { addGroup, renameGroup, deleteGroup } from '../lib/actions.js';
  import { findGroupByName } from '../lib/model.js';

  let { v, list, group = null, onclose, ontransfer, oncreated } = $props();
  let name = $state(untrack(() => group?.name ?? ''));
  let error = $state('');

  function submit(e) {
    e.preventDefault();
    const n = name.trim().slice(0, 60);
    if (!n) return;
    const existing = findGroupByName(v, list, n, null);
    if (existing && existing.id !== group?.id) {
      error = t('group.exists', { name: n });
      return;
    }
    if (group) {
      if (n !== group.name) renameGroup(group, n);
      onclose();
    } else {
      const id = addGroup(list, n);
      onclose();
      oncreated?.(id, n);
    }
  }
</script>

<Sheet
  title={group ? group.name : t('group.new')}
  eyebrow={t('group.eyebrow')}
  {onclose}>
  <form onsubmit={submit}>
    <label class="field">
      <span>{t('group.name')}</span>
      <!-- svelte-ignore a11y_autofocus -->
      <input data-1p-ignore data-lpignore="true" data-bwignore data-form-type="other" spellcheck="false" autocomplete="off" class="input" bind:value={name} oninput={() => (error = '')} maxlength="60" required autofocus placeholder={t('group.namePh')} />
    </label>
    {#if error}<p class="hint alert">{error}</p>{/if}
    <button class="btn main block" type="submit">{group ? t('save') : t('group.create')}</button>
  </form>

  {#if group}
    <div class="more">
      <button class="btn block" onclick={() => ontransfer(group)}><Icon name="send" />{t('transfer.group')}</button>
      <button class="btn danger block" onclick={() => (deleteGroup(group), onclose())}><Icon name="trash" />{t('group.delete')}</button>
      <p class="micro">{t('group.deleteHint')}</p>
    </div>
  {/if}
</Sheet>

<style>
  .more {
    display: grid;
    gap: 8px;
    margin-top: 20px;
    padding-top: 16px;
    border-top: 1px solid var(--line);
  }
  .more .btn {
    justify-content: flex-start;
  }
  .more .danger {
    margin-top: 6px;
  }
</style>
