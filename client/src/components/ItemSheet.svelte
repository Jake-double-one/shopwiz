<script>
  import { untrack } from 'svelte';
  import Sheet from './Sheet.svelte';
  import Icon from './Icon.svelte';
  import Flag from './Flag.svelte';
  import { t, clock, i18n } from '../lib/i18n.svelte.js';
  import { editItem, deleteItems, setParked, setTranslation, translateNames } from '../lib/actions.js';
  import { groupOptions, translationOf } from '../lib/model.js';
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
  const options = $derived(groupOptions(v, list));

  // travel mode: translation of this name (shared by every item with the same name)
  const travel = $derived(list.travel);
  let tr = $state(untrack(() => (list.travel ? translationOf(v, initial.name, list.travel.lang) : '')));
  const stored = $derived(travel ? v.translations?.[`${normalizeName(name.trim() || item.name)}|${travel.lang}`] : null);
  let translating = $state(false);
  let trError = $state('');
  async function autoTranslate() {
    translating = true;
    trError = '';
    const n = name.trim() || item.name;
    const r = await translateNames([n], travel.lang);
    translating = false;
    const text = Object.values(r.translations)[0];
    if (text) tr = text;
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
    if (Object.keys(fields).length) editItem(item, fields);
    if (travel) {
      const finalName = fields.name ?? item.name;
      const text = tr.trim().slice(0, 120);
      if (text !== translationOf(v, finalName, travel.lang)) setTranslation(finalName, travel.lang, text);
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
      <input data-1p-ignore data-lpignore="true" data-bwignore data-form-type="other" autocomplete="off" class="input" bind:value={name} maxlength="120" required />
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
        {:else if stored?.auto && tr === stored.text}<p class="micro tr-note">{t('travel.machine')}</p>{/if}
      </div>
    {/if}
    <div class="amount">
      <label class="field qty">
        <span>{t('item.qty')}</span>
        <div class="row">
          <button type="button" class="btn" onclick={() => step(-1)} aria-label="−1">−</button>
          <input data-1p-ignore data-lpignore="true" data-bwignore data-form-type="other" autocomplete="off" class="input mono" bind:value={qty} inputmode="decimal" maxlength="12" />
          <button type="button" class="btn" onclick={() => step(1)} aria-label="+1">+</button>
        </div>
      </label>
      <label class="field unit">
        <span>{t('item.unit')}</span>
        <input data-1p-ignore data-lpignore="true" data-bwignore data-form-type="other" autocomplete="off" class="input" bind:value={unit} maxlength="16" placeholder="g, kg, l, …" />
      </label>
    </div>
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
