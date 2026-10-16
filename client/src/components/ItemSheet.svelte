<script>
  import { untrack } from 'svelte';
  import Sheet from './Sheet.svelte';
  import Icon from './Icon.svelte';
  import Flag from './Flag.svelte';
  import PrioIcon from './PrioIcon.svelte';
  import { t, clock, i18n } from '../lib/i18n.svelte.js';
  import { editItem, deleteItems, setParked, setTranslation, translateNames, translatorName } from '../lib/actions.js';
  import { groupOptions, translationOf, linkedLists, boughtAt } from '../lib/model.js';
  import { sync } from '../lib/sync.svelte.js';
  import { langName } from '../../../shared/countries.js';
  import { normalizeName } from '../../../shared/parse.js';

  let { v, list, item, onclose, ontransfer } = $props();

  // editable draft, saved on close
  const initial = untrack(() => ({ ...item }));
  let name = $state(initial.name);
  let qty = $state(initial.qty);
  let unit = $state(initial.unit);
  let note = $state(initial.note);
  let prio = $state(initial.prio ?? 0);
  const options = $derived(groupOptions(v, list));

  // list group: on every list of it, or only on this one
  const partners = $derived(linkedLists(v, list));
  let shared = $state(!!initial.shared);
  const bought = $derived(boughtAt(v, list, item));

  // travel mode: translation of this name (shared by every item with the same name)
  const travel = $derived(list.travel);
  let tr = $state(untrack(() => (list.travel ? translationOf(v, initial.name, list.travel.lang) : '')));
  const stored = $derived(travel ? v.translations?.[`${normalizeName(name.trim() || item.name)}|${travel.lang}`] : null);
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
    const n = name.trim() || item.name;
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
    save();
    onclose();
  }

  function step(d) {
    const cur = Number(String(qty || '0').replace(',', '.')) || 0;
    const next = Math.max(0, Math.round((cur + d) * 1000) / 1000);
    qty = next ? String(next) : '';
  }
</script>

<Sheet title={item.name} eyebrow={t('item.editTitle')} onclose={close}>
  <form onsubmit={(e) => (e.preventDefault(), close())}>
    <label class="field">
      <span>{t('item.name')}</span>
      <input data-1p-ignore data-lpignore="true" data-bwignore data-form-type="other" spellcheck="false" autocomplete="off" class="input" bind:value={name} maxlength="120" required />
    </label>
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
          <button type="button" class="btn" onclick={() => step(-1)} aria-label="−1">−</button>
          <input data-1p-ignore data-lpignore="true" data-bwignore data-form-type="other" spellcheck="false" autocomplete="off" class="input mono" bind:value={qty} inputmode="decimal" maxlength="12" />
          <button type="button" class="btn" onclick={() => step(1)} aria-label="+1">+</button>
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
      <div class="field prio-field">
        <span class="prio-label" id="link-label"><Icon name="link" size={12} /> {t('link.appliesTo')}</span>
        <div class="prio-seg link-seg" role="radiogroup" aria-labelledby="link-label">
          <button type="button" role="radio" aria-checked={shared} class="all" onclick={() => (shared = true)}>
            <Icon name="link" size={14} />{[list.name, ...partners.map((l) => l.name)].join(' · ')}
          </button>
          <button type="button" role="radio" aria-checked={!shared} onclick={() => (shared = false)}>{t('link.onlyHere', { name: list.name })}</button>
        </div>
        {#if bought}<p class="micro bought">{t('link.boughtAt', { name: bought })}</p>{/if}
      </div>
    {/if}
    <label class="field">
      <span>{t('item.note')}</span>
      <textarea data-1p-ignore data-lpignore="true" data-bwignore data-form-type="other" autocomplete="off" class="input" bind:value={note} rows="2" maxlength="500"></textarea>
    </label>
    <label class="field">
      <span>{t('item.group')}</span>
      <select class="select input" value={item.groupId ?? ''} onchange={(e) => editItem(item, { groupId: e.target.value || null })}>
        <option value="">{t('item.noGroup')}</option>
        {#each options as o (o.id)}
          <option value={o.id}>{o.depth ? `${o.parent} › ${o.label}` : o.label}</option>
        {/each}
      </select>
    </label>
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
  </form>
</Sheet>

<style>
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
  .link-seg {
    grid-template-columns: 1fr 1fr;
  }
  .link-seg button {
    padding: 6px 8px;
    line-height: 1.25;
  }
  .link-seg button.all[aria-checked='true'] {
    background: var(--ok);
    color: var(--surface);
    font-weight: 700;
    box-shadow: none;
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
