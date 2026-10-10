<script>
  import { untrack } from 'svelte';
  import Sheet from './Sheet.svelte';
  import Icon from './Icon.svelte';
  import { t, clock } from '../lib/i18n.svelte.js';
  import { editItem, deleteItems } from '../lib/actions.js';
  import { groupOptions } from '../lib/model.js';

  let { v, list, item, onclose, ontransfer } = $props();

  // editable draft, saved on close
  const initial = untrack(() => ({ ...item }));
  let name = $state(initial.name);
  let qty = $state(initial.qty);
  let unit = $state(initial.unit);
  let note = $state(initial.note);
  const options = $derived(groupOptions(v, list));

  function save() {
    const fields = {};
    const n = name.trim();
    if (n && n !== item.name) fields.name = n.slice(0, 120);
    const q = String(qty ?? '').replace(',', '.').trim();
    const validQty = q === '' || /^\d+(\.\d+)?$/.test(q);
    if (validQty && (q !== item.qty || unit.trim() !== item.unit)) fields.amount = { qty: q, unit: unit.trim().slice(0, 16) };
    if (note.trim() !== item.note) fields.note = note.trim();
    if (Object.keys(fields).length) editItem(item, fields);
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
      <input class="input" bind:value={name} maxlength="120" required />
    </label>
    <div class="amount">
      <label class="field qty">
        <span>{t('item.qty')}</span>
        <div class="row">
          <button type="button" class="btn" onclick={() => step(-1)} aria-label="−1">−</button>
          <input class="input mono" bind:value={qty} inputmode="decimal" maxlength="12" />
          <button type="button" class="btn" onclick={() => step(1)} aria-label="+1">+</button>
        </div>
      </label>
      <label class="field unit">
        <span>{t('item.unit')}</span>
        <input class="input" bind:value={unit} maxlength="16" placeholder="g, kg, l, …" />
      </label>
    </div>
    <label class="field">
      <span>{t('item.note')}</span>
      <textarea class="input" bind:value={note} rows="2" maxlength="500"></textarea>
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
  .meta {
    margin: 0 0 14px;
    text-transform: none;
    letter-spacing: 0.02em;
  }
</style>
