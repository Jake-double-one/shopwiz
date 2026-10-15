<script>
  import Sheet from './Sheet.svelte';
  import { t, clock } from '../lib/i18n.svelte.js';
  import { resolveConflict, dismissConflict } from '../lib/actions.js';
  import { formatAmount } from '../../../shared/parse.js';
  import { groupLabel } from '../lib/model.js';

  let { v, conflicts, onclose } = $props();

  function show(field, value) {
    switch (field) {
      case 'amount':
        return formatAmount(value?.qty, value?.unit) || t('conflict.noAmount');
      case 'checked':
        return value ? t('conflict.checked') : t('conflict.unchecked');
      case 'parked':
        return value ? t('inactive.title') : t('conflict.onList');
      case 'groupId':
        return groupLabel(v, value) || t('item.noGroup');
      case 'note':
        return value || t('conflict.empty');
      case 'prio':
        return t(value > 0 ? 'prio.up' : value < 0 ? 'prio.down' : 'prio.normal');
      default:
        return value;
    }
  }

  function isCurrent(c, value) {
    const it = v.items[c.itemId];
    if (!it) return false;
    const bool = c.field === 'checked' || c.field === 'parked';
    const cur = c.field === 'amount' ? { qty: it.qty, unit: it.unit } : c.field === 'groupId' ? it.groupId : c.field === 'prio' ? (it.prio ?? 0) : bool ? !!it[c.field] : it[c.field];
    return JSON.stringify(cur) === JSON.stringify(bool ? !!value : value);
  }

  $effect(() => {
    if (!conflicts.length) onclose();
  });
</script>

<Sheet title={t('conflict.title')} eyebrow={t('conflict.banner', { count: conflicts.length })} {onclose}>
  <p class="note">{t('conflict.note')}</p>
  {#each conflicts as c (c.id)}
    <article class="conflict">
      <header>
        <b>{v.items[c.itemId]?.name}</b>
        <span class="micro">{t(`field.${c.field}`)}</span>
      </header>
      <div class="options">
        {#each c.options as o, i (i)}
          <button class="opt" class:current={isCurrent(c, o.value)} onclick={() => resolveConflict(c, i)}>
            <span class="val">{show(c.field, o.value)}</span>
            <span class="micro">{o.byName} · {clock(o.at)}</span>
            {#if isCurrent(c, o.value)}<span class="micro now">{t('conflict.current')}</span>{/if}
          </button>
        {/each}
      </div>
      <button class="link" onclick={() => dismissConflict(c)}>{t('conflict.keep')}</button>
    </article>
  {/each}
</Sheet>

<style>
  .conflict {
    border: 1px solid var(--line);
    border-radius: 14px;
    padding: 12px;
    margin-bottom: 12px;
  }
  header {
    display: flex;
    justify-content: space-between;
    gap: 10px;
    margin-bottom: 10px;
  }
  .options {
    display: grid;
    gap: 8px;
    margin-bottom: 10px;
  }
  .opt {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 2px;
    text-align: left;
    background: var(--surface-2);
    border: 1px solid var(--line);
    border-radius: 12px;
    padding: 10px 12px;
  }
  .opt:hover {
    border-color: var(--dusk);
  }
  .opt.current {
    border-color: var(--dusk);
    background: var(--dusk-soft);
  }
  .val {
    font-weight: 600;
    overflow-wrap: anywhere;
  }
  .now {
    color: var(--dusk);
  }
  .micro {
    text-transform: none;
    letter-spacing: 0.02em;
  }
</style>
