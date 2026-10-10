<script>
  import { onMount } from 'svelte';
  import Sheet from './Sheet.svelte';
  import { t, clock } from '../lib/i18n.svelte.js';
  import { api } from '../lib/api.js';
  import { sync } from '../lib/sync.svelte.js';
  import { restoreItems } from '../lib/actions.js';
  import { formatAmount } from '../../../shared/parse.js';

  let { spaceId, list, onclose } = $props();
  let entries = $state(null);
  let error = $state('');
  let restored = $state(new Set());

  async function loadEntries() {
    try {
      entries = (await api.activity(spaceId, list.id)).activity;
      error = '';
    } catch {
      error = t('history.offline');
    }
  }

  onMount(() => {
    loadEntries();
    let timer;
    const off = sync.on((type) => {
      if (type === 'patch') {
        clearTimeout(timer);
        timer = setTimeout(loadEntries, 600);
      }
    });
    return () => {
      off();
      clearTimeout(timer);
    };
  });

  const names = (p) => {
    const n = p.names ?? (p.name ? [p.name] : []);
    const more = (p.count ?? n.length) - n.length;
    return n.join(', ') + (more > 0 ? ` +${more}` : '');
  };

  function describe(e) {
    const p = e.payload;
    switch (e.action) {
      case 'item.add':
        return t('history.add', { name: [formatAmount(p.qty, p.unit), p.name].filter(Boolean).join(' ') });
      case 'item.park':
      case 'item.unpark':
      case 'item.check':
      case 'item.uncheck':
      case 'item.merge':
      case 'item.restore':
      case 'item.delete':
      case 'list.clearChecked':
      case 'transfer.in':
      case 'transfer.move':
      case 'transfer.copy':
        return t(`history.${e.action}`, { name: names(p), count: p.count ?? 1 });
      case 'item.edit':
        return p.from && p.from !== p.name ? t('history.rename', { from: p.from, name: p.name }) : t('history.edit', { name: p.name });
      case 'item.move':
        return t('history.move', { name: p.name, to: p.to?.group ? `${p.to.group}${p.to.subgroup ? ` › ${p.to.subgroup}` : ''}` : t('item.noGroup') });
      case 'item.editDeleted':
        return t('history.editDeleted', { name: p.name });
      case 'conflict':
        return t('history.conflict', { name: p.name, field: t(`field.${p.field}`) });
      case 'conflict.resolve':
        return t('history.conflictResolved', { name: p.name, field: t(`field.${p.field}`) });
      case 'list.rename':
        return t('history.listRename', { from: p.from, name: p.to });
      case 'list.add':
      case 'list.delete':
      case 'list.restore':
        return t(`history.${e.action}`, { name: p.name });
      case 'list.address':
        return p.address ? t('history.address', { address: p.address }) : t('history.addressRemoved');
      case 'list.groupMode':
        return t(p.mode === 'shared' ? 'history.modeShared' : 'history.modeOwn');
      case 'group.delete':
        return t('history.groupDelete', { name: p.name });
      case 'import':
        return t('history.import', { added: p.added ?? 0, skipped: p.skipped ?? 0, reactivated: p.reactivated ?? 0 });
      case 'device.kick':
        return t('history.kick', { name: p.name });
      case 'space.update':
        return p.ttlDays ? t('history.ttl', { days: p.ttlDays }) : t('history.spaceRename', { name: p.name });
      default:
        return e.action;
    }
  }

  function restorable(e) {
    const p = e.payload;
    if (e.action === 'item.editDeleted') return [p.id];
    if (['item.delete', 'transfer.move'].includes(e.action)) return p.ids ?? null;
    return null;
  }
</script>

<Sheet title={t('history.title')} eyebrow={list.name} {onclose}>
  <p class="note">{t('history.note')}</p>
  {#if error}<p class="hint">{error}</p>{/if}
  {#if entries === null && !error}
    <p class="muted">…</p>
  {:else if entries?.length === 0}
    <p class="muted">{t('history.empty')}</p>
  {:else if entries}
    <ol class="log">
      {#each entries as e (e.id)}
        {@const ids = restorable(e)}
        <li>
          <span class="when micro">{clock(e.at)}</span>
          <span class="what"><b>{e.by}</b> {describe(e)}</span>
          {#if ids?.length && !restored.has(e.id)}
            <button class="btn small" onclick={() => (restoreItems(ids), (restored = new Set([...restored, e.id])))}>{t('restore')}</button>
          {/if}
        </li>
      {/each}
    </ol>
  {/if}
</Sheet>

<style>
  .log {
    list-style: none;
    padding: 0;
    margin: 0;
  }
  .log li {
    display: grid;
    grid-template-columns: auto 1fr auto;
    gap: 4px 12px;
    align-items: baseline;
    padding: 9px 0;
    border-top: 1px solid var(--line);
    font-size: 0.92rem;
  }
  .log li:first-child {
    border-top: 0;
  }
  .when {
    white-space: nowrap;
    text-transform: none;
  }
  .what {
    overflow-wrap: anywhere;
  }
</style>
