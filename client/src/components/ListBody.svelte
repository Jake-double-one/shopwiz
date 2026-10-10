<script>
  import Icon from './Icon.svelte';
  import ItemRow from './ItemRow.svelte';
  import GroupBlock from './GroupBlock.svelte';
  import { t } from '../lib/i18n.svelte.js';
  import { listTree, posBetween, groupSet } from '../lib/model.js';
  import { moveItem, moveGroup, clearChecked } from '../lib/actions.js';
  import { sortable } from '../lib/sortable.js';
  import { load, save } from '../lib/storage.js';
  import { sync } from '../lib/sync.svelte.js';

  let { v, list, freshIds, onedit, ongroup, onaddto, onaddgroup } = $props();

  const tree = $derived(listTree(v, list));
  const checkedCount = $derived(Object.values(v.items).filter((i) => i.listId === list.id && i.checked).length);
  const conflictIds = $derived(new Set(Object.values(v.conflicts).map((c) => c.itemId)));
  const empty = $derived(!tree.ungrouped.length && !tree.groups.length);

  // collapsed groups are a per-device view preference
  let collapsed = $state(new Set(load('collapsed', [])));
  function toggleCollapsed(id) {
    const next = new Set(collapsed);
    next.has(id) ? next.delete(id) : next.add(id);
    collapsed = next;
    save('collapsed', [...next].slice(-500));
  }

  function itemsIn(groupId) {
    if (!groupId) return tree.ungrouped;
    for (const n of tree.groups) {
      if (n.group.id === groupId) return n.items;
      for (const s of n.subs) if (s.group.id === groupId) return s.items;
    }
    return [];
  }

  function onItemMove({ id, to, newIndex }) {
    const item = sync.data.items[id];
    if (!item) return;
    const groupId = to.group || null;
    const target = itemsIn(groupId).filter((i) => i.id !== id);
    const pos = posBetween(target[newIndex - 1]?.pos, target[newIndex]?.pos);
    moveItem(item, groupId, pos);
  }

  function onGroupMove({ id, to, newIndex }) {
    const g = sync.data.groups[id];
    if (!g) return;
    const parentId = to.parent || null;
    const siblings = groupSet(sync.data, list)
      .filter((x) => (x.parentId ?? null) === parentId && x.id !== id)
      .sort((a, b) => a.pos - b.pos);
    const pos = posBetween(siblings[newIndex - 1]?.pos, siblings[newIndex]?.pos);
    if ((g.parentId ?? null) !== parentId) sync.send({ k: 'group.update', id, pos, parentId });
    else moveGroup(g, pos);
  }

  const itemSort = $derived({ group: 'items', draggable: '.item', handle: '.handle', onmove: onItemMove });
  const groupSort = $derived({ group: 'groups', draggable: '.group.top', handle: '.g-top', onmove: onGroupMove });
  const subSort = $derived({ group: 'subgroups', draggable: '.group.sub', handle: '.g-sub', onmove: onGroupMove });
</script>

{#if empty}
  <div class="empty card">
    <p class="eyebrow">{t('list.emptyEyebrow')}</p>
    <p>{t('list.empty')}</p>
    <button class="btn small" onclick={onaddgroup}><Icon name="folder" size={16} />{t('group.add')}</button>
  </div>
{/if}

<div class="sheet card" class:hidden={empty}>
  <ul class="items ungrouped" data-group="" use:sortable={itemSort} class:empty-drop={!tree.ungrouped.length}>
    {#each tree.ungrouped as item (item.id)}
      <ItemRow {item} fresh={freshIds.has(item.id)} conflict={conflictIds.has(item.id)} {onedit} />
    {/each}
  </ul>
  {#if !tree.ungrouped.length && tree.groups.length}
    <p class="drop-hint micro">{t('list.ungroupedHint')}</p>
  {/if}

  <div class="groups" data-parent="" use:sortable={groupSort}>
    {#each tree.groups as node (node.group.id)}
      <GroupBlock
        group={node.group}
        count={node.items.filter((i) => !i.checked).length + node.subs.reduce((n, s) => n + s.items.filter((i) => !i.checked).length, 0)}
        collapsed={collapsed.has(node.group.id)}
        ontoggle={() => toggleCollapsed(node.group.id)}
        onmenu={() => ongroup(node.group)}
        onadd={() => onaddto(node.group.id)}>
        <ul class="items" data-group={node.group.id} use:sortable={itemSort}>
          {#each node.items as item (item.id)}
            <ItemRow {item} fresh={freshIds.has(item.id)} conflict={conflictIds.has(item.id)} {onedit} />
          {/each}
        </ul>
        <div class="subs" data-parent={node.group.id} use:sortable={subSort}>
          {#each node.subs as sub (sub.group.id)}
            <GroupBlock
              group={sub.group}
              sub
              count={sub.items.filter((i) => !i.checked).length}
              collapsed={collapsed.has(sub.group.id)}
              ontoggle={() => toggleCollapsed(sub.group.id)}
              onmenu={() => ongroup(sub.group)}
              onadd={() => onaddto(sub.group.id)}>
              <ul class="items" data-group={sub.group.id} use:sortable={itemSort}>
                {#each sub.items as item (item.id)}
                  <ItemRow {item} fresh={freshIds.has(item.id)} conflict={conflictIds.has(item.id)} {onedit} />
                {/each}
              </ul>
            </GroupBlock>
          {/each}
        </div>
      </GroupBlock>
    {/each}
  </div>
</div>

<div class="footer row wrap-row">
  <button class="btn small" onclick={onaddgroup}><Icon name="folder" size={16} />{t('group.add')}</button>
  {#if checkedCount}
    <button class="btn small" onclick={() => clearChecked(list.id)}><Icon name="trash" size={16} />{t('list.clearChecked', { count: checkedCount })}</button>
  {/if}
</div>

<style>
  .sheet {
    padding: 4px 6px;
    overflow: hidden;
  }
  .hidden {
    display: none;
  }
  .items {
    list-style: none;
    margin: 0;
    padding: 0;
    min-height: 8px;
  }
  .items.empty-drop {
    min-height: 14px;
  }
  .drop-hint {
    text-align: center;
    margin: 0;
    padding: 2px 0 6px;
    opacity: 0.7;
  }
  .groups,
  .subs {
    min-height: 2px;
  }
  .empty {
    text-align: center;
  }
  .empty p:not(.eyebrow) {
    color: var(--muted);
    margin: 0 0 14px;
  }
  .footer {
    margin-top: 12px;
    justify-content: center;
  }
  :global(.drag-ghost) {
    opacity: 0.35;
    background: var(--dusk-soft) !important;
  }
  :global(.drag-chosen) {
    box-shadow: var(--shadow);
  }
</style>
