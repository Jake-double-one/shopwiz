<script>
  import { untrack } from 'svelte';
  import Sheet from './Sheet.svelte';
  import Icon from './Icon.svelte';
  import Flag from './Flag.svelte';
  import PrioIcon from './PrioIcon.svelte';
  import { t, clock, i18n } from '../lib/i18n.svelte.js';
  import { editItem, deleteItems, setParked, setTranslation, translateNames, translatorName, addEntry, increaseAmount } from '../lib/actions.js';
  import { groupOptions, translationOf, linkedLists, boughtAt, sortedLists, learnedPlacement, suggestionsFor } from '../lib/model.js';
  import { sync } from '../lib/sync.svelte.js';
  import { toast } from '../lib/toast.svelte.js';
  import { prefs } from '../lib/prefs.svelte.js';
  import { langName } from '../../../shared/countries.js';
  import { normalizeName, parseEntry, formatAmount } from '../../../shared/parse.js';

  /**
   * item: the item to edit – or null: a new item (from the app shortcut or a long press on +),
   * then prefill is what was typed already, and the list can be chosen
   */
  let { v, list: startList, item = null, prefill = '', onclose, ontransfer } = $props();
  const create = untrack(() => !item);

  // editable draft, saved on close (a new item: added with the button, closing discards it)
  const initial = untrack(() => (item ? { ...item } : { ...parseEntry(prefill), note: '', prio: 0, shared: prefs.linkDefault !== 'here' }));
  let name = $state(initial.name);
  let qty = $state(initial.qty);
  let unit = $state(initial.unit);
  let note = $state(initial.note);
  let prio = $state(initial.prio ?? 0);
  let listId = $state(untrack(() => startList.id));
  const list = $derived(create ? (v.lists[listId] ?? startList) : startList);
  const lists = $derived(sortedLists(v));
  const options = $derived(groupOptions(v, list));

  // list group: on every list of it, or only on this one
  const partners = $derived(linkedLists(v, list));
  let shared = $state(!!initial.shared);
  const bought = $derived(item ? boughtAt(v, list, item) : '');

  // ----- new item -----
  let nameInput = $state();
  let groupSel = $state(''); // '' = automatic: the group the list has learned for the name
  const learned = $derived(create && name.trim() ? learnedPlacement(v, list, name.trim()) : null);
  // names used before – the same suggestions as in the add bar, only while typing
  let nameFocus = $state(false);
  const sugg = $derived(create && nameFocus && name.trim() ? suggestionsFor(v, list, name.trim(), 5) : []);
  let dup = $state(null); // { existing, parsed, another } – the name is on the list already
  $effect(() => {
    // another list: its groups
    listId;
    untrack(() => (groupSel = ''));
  });
  const cleanQty = () => {
    const q = String(qty ?? '').replace(',', '.').trim();
    return q === '' || /^\d+(\.\d+)?$/.test(q) ? q : '';
  };
  function addNew(another = false, opts = {}) {
    const n = name.trim();
    if (!n) return nameInput?.focus();
    const q = cleanQty();
    const r = addEntry(list.id, n, {
      exact: { qty: q, unit: unit.trim().slice(0, 16) },
      prio,
      note,
      ...(groupSel && { groupId: groupSel }),
      ...(partners.length && { shared }),
      ...opts,
    });
    if (r.status === 'duplicate') {
      dup = { existing: r.existing, parsed: r.parsed, another };
      return;
    }
    if (r.status === 'empty') return nameInput?.focus();
    added(r.item?.name ?? n, another, r.status === 'added');
  }
  function added(n, another, announce = true) {
    if (travel && tr.trim()) setTranslation(n, travel.lang, tr.trim().slice(0, 120), !!fresh && tr.trim() === fresh, fresh ? freshBy : null);
    dup = null;
    if (!another) return onclose();
    if (announce) toast(t('add.added', { name: n }));
    name = qty = unit = note = tr = fresh = '';
    prio = 0;
    groupSel = '';
    shared = prefs.linkDefault !== 'here';
    nameInput?.focus();
  }

  // travel mode: translation of this name (shared by every item with the same name)
  const travel = $derived(list.travel);
  let tr = $state(untrack(() => (list.travel ? translationOf(v, initial.name, list.travel.lang) : '')));
  const stored = $derived(travel ? v.translations?.[`${normalizeName(name.trim() || (item?.name ?? ''))}|${travel.lang}`] : null);
  let translating = $state(false);
  let fresh = $state(''); // what the service answered just now – saved as a machine translation if kept as is
  let freshBy = $state(null); // …and which service it was
  // where the text in the field comes from
  const origin = $derived(
    !tr.trim() ? '' : fresh && tr === fresh ? 'fresh' : stored && tr === stored.text ? (stored.auto ? 'machine' : 'manual') : 'typing',
  );
  let trError = $state('');
  async function autoTranslate() {
    translating = true;
    trError = '';
    const n = name.trim() || (item?.name ?? '');
    if (!n) {
      translating = false;
      return nameInput?.focus();
    }
    // always ask again – the remembered one may be the reason to tap
    const r = await translateNames([n], travel.lang, { force: true });
    translating = false;
    const text = Object.values(r.translations)[0];
    if (text) {
      tr = fresh = text;
      freshBy = Object.values(r.by)[0] ?? null;
    }
    else trError = t({ quota: 'travel.errQuota', translate_limit: 'travel.errLimit', not_configured: 'travel.errOff', offline: 'travel.errOffline' }[r.error] ?? 'travel.errFailed');
  }

  function save() {
    const fields = {};
    const n = name.trim();
    if (n && n !== item.name) fields.name = n.slice(0, 120);
    const q = String(qty ?? '').replace(',', '.').trim();
    const validQty = q === '' || /^\d+(\.\d+)?$/.test(q);
    if (validQty && (q !== item.qty || unit.trim() !== item.unit)) fields.amount = { qty: q, unit: unit.trim().slice(0, 16) };
    if (note.trim() !== item.note) fields.note = note.trim();
    if (prio !== (item.prio ?? 0)) fields.prio = prio;
    if (partners.length && shared !== !!item.shared) fields.shared = shared;
    if (Object.keys(fields).length) editItem(item, fields);
    if (travel) {
      const finalName = fields.name ?? item.name;
      const text = tr.trim().slice(0, 120);
      const auto = !!fresh && text === fresh;
      const cur = stored && normalizeName(finalName) === stored.norm ? stored : null;
      if (text !== (cur?.text ?? '') || (cur && auto !== cur.auto)) setTranslation(finalName, travel.lang, text, auto, auto ? freshBy : null);
    }
  }

  function close() {
    if (!create) save();
    onclose();
  }

  function step(d) {
    const cur = Number(String(qty || '0').replace(',', '.')) || 0;
    const next = Math.max(0, Math.round((cur + d) * 1000) / 1000);
    qty = next ? String(next) : '';
  }
</script>

<Sheet title={create ? t('add.newTitle') : item.name} eyebrow={create ? list.name : t('item.editTitle')} onclose={close}>
  <form onsubmit={(e) => (e.preventDefault(), create ? addNew(false) : close())}>
    <label class="field">
      <span>{t('item.name')}</span>
      <!-- svelte-ignore a11y_autofocus -->
      <input data-1p-ignore data-lpignore="true" data-bwignore data-form-type="other" spellcheck="false" autocomplete="off" class="input" bind:this={nameInput} bind:value={name} maxlength="120" required autofocus={create} onfocus={() => (nameFocus = true)} onblur={() => setTimeout(() => (nameFocus = false), 150)} />
    </label>
    {#if sugg.length}
      <ul class="sugg card" aria-label={t('add.suggestions')}>
        {#each sugg as s (s.norm)}
          <li>
            <button type="button" class="pick" onmousedown={(e) => e.preventDefault()} onclick={() => ((name = s.name), (nameFocus = false))}>
              <span class="s-name">{s.name}</span>
              {#if s.placement}<span class="micro">{s.placement.group}</span>{/if}
              {#if s.onList}<span class="micro on">{t('add.onList')}</span>{:else if s.inactive}<span class="micro">{t('add.inactive')}</span>{/if}
            </button>
          </li>
        {/each}
      </ul>
    {/if}
    {#if travel}
      <div class="field tr-field">
        <label for="tr-input"><Flag country={travel.country} size={13} /> {t('travel.field', { lang: langName(travel.lang, i18n.lang) })}</label>
        <div class="row">
          <input id="tr-input" lang={travel.lang} data-1p-ignore data-lpignore="true" data-bwignore data-form-type="other" autocomplete="off" class="input tr-input" bind:value={tr} maxlength="120" placeholder={t('travel.fieldPh')} />
          {#if sync.features.translate}
            <button type="button" class="btn" onclick={autoTranslate} disabled={translating || sync.status !== 'online'} title={t('travel.auto')}>
              <Icon name="swap" size={18} /><span class="auto-label">{translating ? '…' : t('travel.auto')}</span>
            </button>
          {/if}
        </div>
        {#if trError}<p class="micro tr-note alert-text">{trError}</p>
        {:else if origin === 'fresh'}<p class="micro tr-note">{t('travel.fromService', { service: translatorName(freshBy) || '?' })}</p>
        {:else if origin === 'machine'}<p class="micro tr-note">{stored.by ? t('travel.machineBy', { service: translatorName(stored.by) }) : t('travel.machine')}</p>
        {:else if origin === 'manual'}<p class="micro tr-note">{t('travel.manual')}</p>{/if}
      </div>
    {/if}
    <div class="amount">
      <label class="field qty">
        <span>{t('item.qty')}</span>
        <div class="row">
          <button type="button" class="btn" onclick={() => step(-1)} aria-label={t('item.lessShort')}>−</button>
          <input data-1p-ignore data-lpignore="true" data-bwignore data-form-type="other" spellcheck="false" autocomplete="off" class="input mono" bind:value={qty} inputmode="decimal" maxlength="12" aria-label={t('item.qty')} />
          <button type="button" class="btn" onclick={() => step(1)} aria-label={t('item.moreShort')}>+</button>
        </div>
      </label>
      <label class="field unit">
        <span>{t('item.unit')}</span>
        <input data-1p-ignore data-lpignore="true" data-bwignore data-form-type="other" spellcheck="false" autocomplete="off" class="input" bind:value={unit} maxlength="16" placeholder="g, kg, l, …" />
      </label>
    </div>
    <div class="field prio-field">
      <span class="prio-label" id="prio-label">{t('prio.label')}</span>
      <div class="prio-seg" role="radiogroup" aria-labelledby="prio-label">
        {#each [0, 1, -1] as p (p)}
          <button type="button" role="radio" aria-checked={prio === p} class:up={p > 0} class:down={p < 0} onclick={() => (prio = p)}>
            {#if p}<PrioIcon prio={p} size={13} />{/if}{t(p > 0 ? 'prio.up' : p < 0 ? 'prio.down' : 'prio.normal')}
          </button>
        {/each}
      </div>
    </div>
    {#if partners.length}
      <!-- one switch: on = on the other lists of the list group as well, off = only here -->
      <div class="field link-field">
        <label class="link-switch" class:on={shared} title={partners.map((l) => l.name).join(' · ')}>
          <input type="checkbox" role="switch" bind:checked={shared} aria-describedby="link-names" />
          <Icon name="link" size={16} />
          <span>{partners.length === 1 ? t('link.alsoAt', { name: partners[0].name }) : t('link.wholeGroup')}</span>
        </label>
        <span class="sr-only" id="link-names">{partners.map((l) => l.name).join(', ')}</span>
        {#if bought}<p class="micro bought">{t('link.boughtAt', { name: bought })}</p>{/if}
      </div>
    {/if}
    {#if !create}
      <label class="field">
        <span>{t('item.note')}</span>
        <textarea data-1p-ignore data-lpignore="true" data-bwignore data-form-type="other" autocomplete="off" class="input" bind:value={note} rows="2" maxlength="500"></textarea>
      </label>
    {/if}
    <label class="field">
      <span>{t('item.group')}</span>
      {#if create}
        <select class="select input" bind:value={groupSel}>
          <option value="">{learned ? `→ ${learned.group}${learned.subgroup ? ` › ${learned.subgroup}` : ''}` : t('add.auto')}</option>
          {#each options as o (o.id)}
            <option value={o.id}>{o.depth ? `${o.parent} › ${o.label}` : o.label}</option>
          {/each}
        </select>
      {:else}
        <select class="select input" value={item.groupId ?? ''} onchange={(e) => editItem(item, { groupId: e.target.value || null })}>
          <option value="">{t('item.noGroup')}</option>
          {#each options as o (o.id)}
            <option value={o.id}>{o.depth ? `${o.parent} › ${o.label}` : o.label}</option>
          {/each}
        </select>
      {/if}
    </label>
    {#if create}
      {#if dup}
        <div class="hint" role="alert">
          <span class="grow"><b>{dup.existing.name}</b> {t('dup.text', { amount: formatAmount(dup.existing.qty, dup.existing.unit) || '1×' })}</span>
        </div>
        <div class="row wrap-row">
          <button type="button" class="btn main" onclick={() => (increaseAmount(sync.data.items[dup.existing.id] ?? dup.existing, dup.parsed), added(dup.existing.name, dup.another, false))}>{t('dup.increase')}</button>
          <button type="button" class="btn" onclick={() => addNew(dup.another, { force: true })}>{t('dup.addAnyway')}</button>
          <button type="button" class="btn" onclick={() => (dup = null)}>{t('cancel')}</button>
        </div>
      {:else}
        <div class="row wrap-row">
          <button type="submit" class="btn main"><Icon name="plus" size={18} />{t('add.button')}</button>
          <button type="button" class="btn" onclick={() => addNew(true)}><Icon name="plus" size={18} />{t('add.another')}</button>
        </div>
      {/if}
      <!-- less often needed: below the buttons (the target list is named at the top) -->
      <label class="field after">
        <span>{t('item.note')}</span>
        <textarea data-1p-ignore data-lpignore="true" data-bwignore data-form-type="other" autocomplete="off" class="input" bind:value={note} rows="2" maxlength="500"></textarea>
      </label>
      {#if lists.length > 1}
        <label class="field">
          <span>{t('add.toList')}</span>
          <select class="select input" bind:value={listId}>
            {#each lists as l (l.id)}<option value={l.id}>{l.name}</option>{/each}
          </select>
        </label>
      {/if}
    {:else}
    <p class="micro meta">
      {#if item.addedBy}{t('item.addedBy', { name: item.addedBy, date: clock(item.createdAt) })}{/if}
      {#if item.checked && item.checkedBy} · {t('item.checkedBy', { name: item.checkedBy })}{/if}
    </p>
    <div class="row wrap-row">
      <button type="submit" class="btn main">{t('done')}</button>
      <button type="button" class="btn" onclick={() => (save(), setParked(item, !item.parked), onclose())}>
        <Icon name={item.parked ? 'plus' : 'folder'} size={18} />{item.parked ? t('inactive.activateShort') : t('inactive.park')}
      </button>
      <button type="button" class="btn" onclick={() => (save(), ontransfer(item))}><Icon name="send" size={18} />{t('transfer.short')}</button>
      <button type="button" class="btn danger" onclick={() => (deleteItems([item]), onclose())}><Icon name="trash" size={18} />{t('delete')}</button>
    </div>
    {/if}
  </form>
</Sheet>

<style>
  .after {
    margin-top: 20px;
  }
  .sugg {
    list-style: none;
    margin: -8px 0 14px;
    padding: 4px;
  }
  .sugg .pick {
    display: flex;
    align-items: baseline;
    gap: 10px;
    width: 100%;
    min-height: 40px;
    padding: 8px 10px;
    border: 0;
    border-radius: 10px;
    background: none;
    color: var(--ink);
    text-align: left;
  }
  .sugg .pick:hover {
    background: var(--surface-2);
  }
  .s-name {
    flex: 1;
    min-width: 0;
  }
  .sugg .micro {
    margin: 0;
  }
  .sugg .on {
    color: var(--dusk);
  }
  .amount {
    display: grid;
    grid-template-columns: 1.4fr 1fr;
    gap: 10px;
  }
  .qty .row {
    gap: 6px;
  }
  .qty .btn {
    width: 44px;
    padding: 0;
    flex: 0 0 auto;
    font-size: 1.2rem;
  }
  .qty input {
    text-align: center;
    min-width: 0;
  }
  textarea {
    resize: vertical;
  }
  .prio-field {
    margin-bottom: 14px;
  }
  .prio-label {
    display: block;
    font-family: var(--mono);
    font-size: 0.68rem;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--muted);
    margin-bottom: 6px;
  }
  .prio-seg {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    border: 1px solid var(--line);
    border-radius: 12px;
    overflow: hidden;
  }
  .prio-seg button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    min-height: 44px;
    border: 0;
    border-left: 1px solid var(--line);
    background: var(--surface);
    color: var(--muted);
    font-weight: 500;
    padding: 0 6px;
  }
  .prio-seg button:first-child {
    border-left: 0;
  }
  .prio-seg button[aria-checked='true'] {
    background: var(--surface-2);
    color: var(--ink);
    box-shadow: inset 0 -2px 0 var(--dusk);
  }
  .prio-seg button.up[aria-checked='true'] {
    background: color-mix(in srgb, var(--sun-soft) 60%, var(--surface));
    box-shadow: inset 0 -2px 0 var(--sun);
  }
  .link-field {
    margin-bottom: 14px;
  }
  .link-switch {
    display: flex;
    align-items: center;
    gap: 10px;
    min-height: 48px;
    padding: 8px 12px;
    border: 1px solid var(--line);
    border-radius: 12px;
    background: var(--surface);
    color: var(--muted);
    cursor: pointer;
  }
  .link-switch span {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  /* on: strong green, like the chain in the add bar */
  .link-switch.on {
    background: var(--ok);
    border-color: var(--ok);
    color: var(--surface);
    font-weight: 700;
  }
  .link-switch input {
    order: 3;
    width: 2.6em;
    height: 1.5em;
    margin: 0;
    appearance: none;
    border-radius: 999px;
    background: var(--line);
    position: relative;
    flex: none;
    cursor: pointer;
  }
  .link-switch input::after {
    content: '';
    position: absolute;
    top: 0.2em;
    left: 0.2em;
    width: 1.1em;
    height: 1.1em;
    border-radius: 50%;
    background: var(--surface);
    transition: transform 0.15s ease;
  }
  .link-switch input:checked {
    background: color-mix(in srgb, var(--surface) 35%, var(--ok));
  }
  .link-switch input:checked::after {
    transform: translateX(1.1em);
  }
  .link-switch input:focus-visible {
    outline: 2px solid var(--surface);
    outline-offset: 2px;
  }
  .bought {
    margin: 6px 0 0;
    color: var(--ok);
    font-weight: 700;
    text-transform: none;
    letter-spacing: 0.02em;
  }
  .prio-seg button.up :global(svg) {
    color: var(--sun);
  }
  .tr-field {
    margin-bottom: 14px;
  }
  .tr-field label {
    display: flex;
    align-items: center;
    gap: 6px;
    font-family: var(--mono);
    font-size: 0.68rem;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--muted);
    margin-bottom: 6px;
  }
  .tr-input {
    font-style: italic;
    min-width: 0;
    flex: 1;
  }
  .tr-note {
    margin: 6px 0 0;
    text-transform: none;
    letter-spacing: 0.02em;
  }
  .alert-text {
    color: var(--alert);
  }
  @media (max-width: 400px) {
    .auto-label {
      display: none;
    }
  }
  .meta {
    margin: 0 0 14px;
    text-transform: none;
    letter-spacing: 0.02em;
  }
</style>
