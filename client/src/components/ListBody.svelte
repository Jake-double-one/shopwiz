<script>
  import Icon from './Icon.svelte';
  import ItemRow from './ItemRow.svelte';
  import GroupBlock from './GroupBlock.svelte';
  import { t } from '../lib/i18n.svelte.js';
  import { listTree, posBetween, dropPos, translationOf, listItems, viewItem, boughtAt, linkedLists } from '../lib/model.js';
  import { moveItem, moveGroup, clearChecked, clearParked, editItem, addEntry } from '../lib/actions.js';
  import { toast } from '../lib/toast.svelte.js';
  import { sortable } from '../lib/sortable.js';
  import { load, save } from '../lib/storage.js';
  import { sync } from '../lib/sync.svelte.js';
  import { prefs, setHideChecked } from '../lib/prefs.svelte.js';
  import { normalizeName } from '../../../shared/parse.js';

  /** query: search text – only matching items (also inactive ones) are shown */
  let { v, list, freshIds, query = '', onedit, onshow, ongroup, onaddto, onaddgroup } = $props();

  // travel mode: the translation under each item
  const travel = $derived(list.travel);
  const trOf = (item) => (travel ? translationOf(v, item.name, travel.lang) : '');

  const full = $derived(listTree(v, list));
  // list group: shared items carry a small chain
  const linkOn = $derived(linkedLists(v, list).length > 0);
  const q = $derived(normalizeName(query));
  const searching = $derived(!!q);
  const matches = (it) => normalizeName(it.name).includes(q) || normalizeName(it.note).includes(q) || (!!travel && normalizeName(trOf(it)).includes(q));
  // what is shown: hidden checked items and search misses are left out (drag & drop works on what is shown)
  const tree = $derived.by(() => {
    const hide = prefs.hideChecked;
    if (!q && !hide) return full;
    const keepActive = (it) => !(hide && it.checked) && (!q || matches(it));
    const keepParked = (it) => !q || matches(it);
    const prune = (groups, keep) => groups.map((n) => ({ ...n, items: n.items.filter(keep) })).filter((n) => n.items.length);
    return {
      ungrouped: full.ungrouped.filter(keepActive),
      groups: prune(full.groups, keepActive),
      shadow: q ? { ungrouped: full.shadow.ungrouped.filter(keepParked), groups: prune(full.shadow.groups, keepParked) } : full.shadow,
      parked: full.parked.filter(keepParked),
    };
  });
  const shadowEmpty = $derived(!tree.shadow.ungrouped.length && !tree.shadow.groups.length);
  const checkedCount = $derived(listItems(v, list.id).filter((i) => i.checked && !i.parked).length);
  const conflictIds = $derived(new Set(Object.values(v.conflicts).map((c) => c.itemId)));
  const empty = $derived(!full.ungrouped.length && !full.groups.length);
  const nothingShown = $derived(!tree.ungrouped.length && !tree.groups.length);
  const hits = $derived(searching ? tree.ungrouped.length + tree.groups.reduce((n, g) => n + g.items.length, 0) + tree.parked.length : 0);

  // collapsed groups are a per-device view preference
  let collapsed = $state(new Set(load('collapsed', [])));
  function toggleCollapsed(id) {
    const next = new Set(collapsed);
    next.has(id) ? next.delete(id) : next.add(id);
    collapsed = next;
    save('collapsed', [...next].slice(-500));
  }

  function itemsIn(groupId, parked = false) {
    const t = parked ? tree.shadow : tree;
    if (!groupId) return t.ungrouped;
    for (const n of t.groups) {
      if (n.group.id === groupId) return n.items;
    }
    return [];
  }

  // ----- inactive items (shadow list), collapsed by default, per device -----
  let shadowIds = $state(new Set(load('shadowOpen', [])));
  const shadowOpen = $derived(shadowIds.has(list.id) || (searching && tree.parked.length > 0));
  function toggleShadow() {
    const ids = new Set(shadowIds);
    ids.has(list.id) ? ids.delete(list.id) : ids.add(list.id);
    shadowIds = ids;
    save('shadowOpen', [...ids].slice(-100));
  }
  let shadowText = $state('');
  function addInactive(e) {
    e.preventDefault();
    const r = addEntry(list.id, shadowText, { parked: true });
    if (r.status === 'exists') toast(t('inactive.exists', { name: r.existing.name }));
    if (r.status !== 'empty') shadowText = '';
  }

  function onItemMove({ id, from, to, newIndex }) {
    const raw = sync.data.items[id];
    if (!raw) return;
    // a shared item of the list group: its place in this shop
    const item = viewItem(sync.data, list, raw);
    const groupId = to.group || null;
    const toParked = !!to.parked;
    const target = itemsIn(groupId, toParked).filter((i) => i.id !== id);
    const pos = dropPos({ ...item, parked: toParked }, target, newIndex);
    const fields = { pos };
    if ((item.groupId ?? null) !== groupId) fields.groupId = groupId;
    if (toParked !== !!item.parked) Object.assign(fields, toParked ? { parked: true, checked: false } : { parked: false });
    editItem(item, fields);
  }

  function onGroupMove({ id, newIndex }) {
    const g = sync.data.groups[id];
    if (!g) return;
    // newIndex counts the groups shown here – empty ones wait under "inactive" and must not shift it
    const siblings = tree.groups.map((n) => n.group).filter((x) => x.id !== id);
    const pos = posBetween(siblings[newIndex - 1]?.pos, siblings[newIndex]?.pos);
    moveGroup(g, pos);
  }

  const itemSort = $derived({ group: 'items', draggable: '.item', handle: '.handle', onmove: onItemMove });
  const groupSort = $derived({ group: 'groups', draggable: '.group.top', handle: '.g-top', onmove: onGroupMove });
</script>

{#if searching && !hits}
  <p class="search-none card">{t('search.none', { query })}</p>
{/if}
{#if empty && !searching}
  <div class="empty card">
    <p class="eyebrow">{t('list.emptyEyebrow')}</p>
    <p>{t('list.empty')}</p>
    <button class="btn small" onclick={onaddgroup}><Icon name="folder" size={16} />{t('group.add')}</button>
  </div>
{/if}

{#if !empty && nothingShown && !searching && prefs.hideChecked}
  <div class="hint dusk all-hidden">
    <Icon name="check" size={18} />
    <span class="grow">{t('hideChecked.allHidden', { count: checkedCount })}</span>
    <button class="link" onclick={() => setHideChecked(false)}>{t('hideChecked.show')}</button>
  </div>
{/if}
<div class="sheet card" class:hidden={nothingShown}>
  <ul class="items ungrouped" data-group="" data-empty="" use:sortable={itemSort} class:empty-drop={!tree.ungrouped.length}>
    {#each tree.ungrouped as item (item.id)}
      <ItemRow {item} fresh={freshIds.has(item.id)} conflict={conflictIds.has(item.id)} translation={trOf(item)} country={travel?.country} trLang={travel?.lang} linked={linkOn && item.shared} bought={boughtAt(v, list, item)} {onedit} {onshow} />
    {/each}
  </ul>
  {#if !tree.ungrouped.length && tree.groups.length}
    <p class="drop-hint micro">{t('list.ungroupedHint')}</p>
  {/if}

  <div class="groups" class:first={!tree.ungrouped.length} data-parent="" use:sortable={groupSort}>
    {#each tree.groups as node (node.group.id)}
      <GroupBlock
        group={node.group}
        count={node.items.filter((i) => !i.checked).length}
        collapsed={!searching && collapsed.has(node.group.id)}
        ontoggle={() => toggleCollapsed(node.group.id)}
        onmenu={() => ongroup(node.group)}
        onadd={() => onaddto(node.group.id)}>
        <ul class="items" data-group={node.group.id} data-empty={t('group.empty')} use:sortable={itemSort}>
          {#each node.items as item (item.id)}
            <ItemRow {item} fresh={freshIds.has(item.id)} conflict={conflictIds.has(item.id)} translation={trOf(item)} country={travel?.country} trLang={travel?.lang} linked={linkOn && item.shared} bought={boughtAt(v, list, item)} {onedit} {onshow} />
          {/each}
        </ul>
      </GroupBlock>
    {/each}
  </div>
</div>

<div class="footer row wrap-row">
  <!-- an empty list has the button in its empty card already -->
  {#if !empty}<button class="btn small" onclick={onaddgroup}><Icon name="folder" size={16} />{t('group.add')}</button>{/if}
  {#if checkedCount && prefs.hideChecked && !nothingShown}
    <button class="btn small" onclick={() => setHideChecked(false)}><Icon name="eye" size={16} />{t('hideChecked.showCount', { count: checkedCount })}</button>
  {/if}
  {#if checkedCount}
    <button class="btn small" onclick={() => clearChecked(list.id)}><Icon name="down" size={16} />{t('list.clearChecked', { count: checkedCount })}</button>
  {/if}
</div>

<section class="shadow card" aria-label={t('inactive.title')}>
  <button class="shadow-head" onclick={toggleShadow} aria-expanded={shadowOpen}>
    <span class="chev" class:open={shadowOpen}><Icon name="chevron" size={16} /></span>
    <span class="title">{t('inactive.title')}</span>
    {#if tree.parked.length}<span class="count mono">{tree.parked.length}</span>{/if}
  </button>
  {#if shadowOpen}
    <p class="hint-text">{t('inactive.hint')}</p>
    <form class="row add-inactive" onsubmit={addInactive}>
      <input data-1p-ignore data-lpignore="true" data-bwignore data-form-type="other" spellcheck="false" autocomplete="off" class="input" bind:value={shadowText} placeholder={t('inactive.addPh')} aria-label={t('inactive.add')} maxlength="160" />
      <button class="btn" type="submit" disabled={!shadowText.trim()} aria-label={t('inactive.add')}><Icon name="plus" /></button>
    </form>
    <ul class="items shadow-items" data-parked="1" data-group="" data-empty={shadowEmpty ? t('inactive.empty') : ''} use:sortable={itemSort}>
      {#each tree.shadow.ungrouped as item (item.id)}
        <ItemRow {item} inactive conflict={conflictIds.has(item.id)} linked={linkOn && item.shared} {onedit} />
      {/each}
    </ul>
    {#each tree.shadow.groups as node (node.group.id)}
      <section class="s-group">
        <header class="s-head">
          <span class="s-name">{node.group.name}</span>
          <button class="icon-btn" onclick={() => ongroup(node.group)} aria-label={t('group.menu', { name: node.group.name })} title={t('group.menuShort')}>
            <Icon name="more" size={18} />
          </button>
        </header>
        <ul class="items shadow-items" data-parked="1" data-group={node.group.id} data-empty={t('inactive.emptyGroup')} use:sortable={itemSort}>
          {#each node.items as item (item.id)}
            <ItemRow {item} inactive conflict={conflictIds.has(item.id)} linked={linkOn && item.shared} {onedit} />
          {/each}
        </ul>
      </section>
    {/each}
    {#if tree.parked.length}
      <div class="row shadow-foot">
        <button class="btn small danger" onclick={() => clearParked(list.id)}><Icon name="trash" size={16} />{t('inactive.clear')}</button>
      </div>
    {/if}
  {/if}
</section>


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
    display: none;
    text-align: center;
    margin: 0;
    padding: 2px 0 6px;
    opacity: 0.7;
  }
  :global(body.dragging) .drop-hint {
    display: block;
  }
  /* empty groups stay a visible drop target */
  .items:not([data-empty='']):empty {
    min-height: 40px;
    display: grid;
    place-items: center;
  }
  .items:not(.ungrouped):not([data-empty='']):empty::before {
    content: attr(data-empty);
    font-family: var(--mono);
    font-size: 0.62rem;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--muted);
    opacity: 0.7;
  }
  .ungrouped:empty {
    min-height: 0;
  }
  /* nothing above the first group → no extra line under the card border */
  .groups.first > :global(.group:first-child) {
    border-top: 0;
  }
  :global(body.dragging) .ungrouped:empty {
    min-height: 40px;
    background: var(--surface-2);
    border-radius: 10px;
  }
  .groups {
    min-height: 2px;
  }
  .empty {
    text-align: center;
  }
  .search-none {
    text-align: center;
    color: var(--muted);
    margin: 0 0 12px;
  }
  .all-hidden {
    margin-bottom: 12px;
  }
  .empty p:not(.eyebrow) {
    color: var(--muted);
    margin: 0 0 14px;
  }
  .footer {
    margin: 12px 0 4px;
    justify-content: center;
  }
  .shadow {
    margin-top: 16px;
    padding: 4px 6px;
    background: color-mix(in srgb, var(--surface) 55%, var(--bg));
    box-shadow: none;
  }
  .shadow-head {
    width: 100%;
    display: flex;
    align-items: center;
    gap: 6px;
    min-height: 40px;
    background: none;
    border: 0;
    padding: 6px 8px;
    text-align: left;
    font-family: var(--mono);
    font-size: 0.74rem;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--muted);
    font-weight: 600;
  }
  .shadow-head:hover {
    color: var(--ink);
  }
  .shadow-head .chev {
    display: inline-grid;
    transition: transform 0.15s ease;
  }
  .shadow-head .chev.open {
    transform: rotate(90deg);
  }
  .shadow-head .count {
    letter-spacing: 0;
    font-size: 0.7rem;
    background: var(--surface-2);
    border-radius: 999px;
    padding: 1px 8px;
  }
  .hint-text {
    margin: 0 10px 10px;
    font-size: 0.85rem;
    color: var(--muted);
  }
  .add-inactive {
    margin: 0 8px 8px;
  }
  .add-inactive .btn {
    width: 44px;
    padding: 0;
    flex: 0 0 auto;
  }
  :global(body.dragging) .shadow-items:empty {
    min-height: 36px;
    background: var(--surface-2);
    border-radius: 10px;
  }
  .s-group {
    border-top: 1px solid var(--line);
  }
  .s-group .items:empty {
    place-items: center start;
    padding: 0 12px 8px 30px;
  }
  .s-head {
    display: flex;
    align-items: center;
    min-height: 34px;
    padding-left: 30px;
  }
  .s-name {
    flex: 1;
    min-width: 0;
    font-family: var(--mono);
    font-size: 0.7rem;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--muted);
    font-weight: 600;
    overflow-wrap: anywhere;
  }
  .shadow-foot {
    justify-content: flex-end;
    padding: 8px;
  }
  :global(.drag-ghost) {
    opacity: 0.35;
    background: var(--dusk-soft) !important;
  }
  :global(.drag-chosen) {
    box-shadow: var(--shadow);
  }
</style>
