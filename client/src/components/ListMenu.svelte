<script>
  import { untrack } from 'svelte';
  import Sheet from './Sheet.svelte';
  import Icon from './Icon.svelte';
  import { t } from '../lib/i18n.svelte.js';
  import Flag from './Flag.svelte';
  import { renameList, setGroupMode, deleteList, clearChecked, shareListText, setAddress, setPrioShortcuts, setTravel, missingTranslations, translatedNames, clearTranslations, translateNames, translatorChain, linkLists, unlinkList } from '../lib/actions.js';
  import { listItems, linkedLists } from '../lib/model.js';
  import { sync } from '../lib/sync.svelte.js';
  import { i18n } from '../lib/i18n.svelte.js';
  import { toast } from '../lib/toast.svelte.js';
  import { COUNTRIES, COUNTRY_LANGS, LANGS, detectCountry, countryName, langName } from '../../../shared/countries.js';

  let { v, list, lists, onclose, onopen, onswitch } = $props();
  let name = $state(untrack(() => list.name));
  let address = $state(untrack(() => list.address ?? ''));
  let confirmDelete = $state(false);
  const checked = $derived(listItems(v, list.id).filter((i) => i.checked && !i.parked).length);
  const online = $derived(sync.status === 'online');

  // ----- list group (Listenverbund): shared items in several shops -----
  const others = $derived(lists.filter((l) => l.id !== list.id));
  const partners = $derived(linkedLists(v, list));
  const isLinked = (other) => partners.some((p) => p.id === other.id);
  let asking = $state(null); // list waiting for "share existing items?"
  function toggleLink(e, other) {
    const on = e.currentTarget.checked;
    e.currentTarget.checked = isLinked(other);
    if (on) {
      // the question only matters when there is something to share
      if (listItems(v, list.id).some((i) => !i.shared) || listItems(v, other.id).some((i) => !i.shared)) asking = other;
      else linkLists(list, other, true);
    } else {
      unlinkList(other);
      toast(t('link.left', { name: other.name }));
    }
  }
  function confirmLink(share) {
    linkLists(list, asking, share);
    asking = null;
  }
  function leave() {
    unlinkList(list);
    toast(t('link.left', { name: list.name }));
  }

  // ----- travel mode: show items in the language of the shop's country -----
  const travel = $derived(list.travel);
  let picking = $state(false); // turned on, but the country couldn't be read from the address
  let pickCountry = $state('');
  const countries = $derived(COUNTRIES.map((c) => ({ code: c, name: countryName(c, i18n.lang) })).sort((a, b) => a.name.localeCompare(b.name, i18n.lang)));
  const langsFor = (country) => {
    const own = COUNTRY_LANGS[country] ?? [];
    return [...own, ...LANGS.filter((l) => !own.includes(l))].map((l) => ({ code: l, name: langName(l, i18n.lang), own: own.includes(l) }));
  };
  const missing = $derived(travel ? missingTranslations(list) : []);
  const translated = $derived(travel ? translatedNames(list) : []);
  let confirmClear = $state(false);
  function clearAll() {
    clearTranslations(translated, travel.lang);
    confirmClear = false;
    toast(t('travel.cleared', { count: translated.length }));
  }
  let translating = $state(false);

  function toggleTravel(on) {
    if (!on) {
      picking = false;
      return setTravel(list, null);
    }
    const country = detectCountry(address);
    if (country) setTravel(list, { country, lang: COUNTRY_LANGS[country][0] });
    else picking = true;
  }
  function chooseCountry(country) {
    if (!country) return;
    picking = false;
    setTravel(list, { country, lang: COUNTRY_LANGS[country][0] });
  }
  async function translateAll() {
    translating = true;
    const lang = travel.lang;
    const names = missing;
    const r = await translateNames(names, lang);
    translating = false;
    const done = Object.keys(r.translations).length;
    if (r.error) {
      const key = { quota: 'travel.errQuota', translate_limit: 'travel.errLimit', not_configured: 'travel.errOff', offline: 'travel.errOffline' }[r.error] ?? 'travel.errFailed';
      toast({ text: `${done ? t('travel.translated', { count: done }) + ' ' : ''}${t(key)}`, kind: 'alert' });
    } else toast(t('travel.translated', { count: done }));
  }

  function saveAddress() {
    const a = address.trim().slice(0, 300);
    if (a !== (list.address ?? '')) setAddress(list, a);
  }

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
  <form onsubmit={(e) => (e.preventDefault(), saveName(), saveAddress(), onclose())}>
    <label class="field">
      <span>{t('list.name')}</span>
      <input data-1p-ignore data-lpignore="true" data-bwignore data-form-type="other" spellcheck="false" autocomplete="off" class="input" bind:value={name} onblur={saveName} maxlength="80" required />
    </label>
    <label class="field">
      <span>{t('list.address')}</span>
      <input data-1p-ignore data-lpignore="true" data-bwignore data-form-type="other" spellcheck="false" class="input" bind:value={address} onblur={saveAddress} maxlength="300" placeholder={t('list.addressPh')} autocomplete="street-address" />
    </label>
    <p class="micro addr-hint">{t('list.addressHint')}</p>
  </form>

  <label class="switch-row shortcuts">
    <input type="checkbox" checked={!!list.prioShortcuts} onchange={(e) => setPrioShortcuts(list, e.currentTarget.checked)} />
    <span><b>{t('prio.shortcuts')}</b><br /><small class="muted">{t('prio.shortcutsHint')}</small></span>
  </label>

  {#if others.length}
    <fieldset class="mode link-group">
      <legend class="eyebrow"><Icon name="link" size={14} /> {t('link.title')}</legend>
      <p class="micro">{t('link.hint')}</p>
      {#each others as o (o.id)}
        <label class="switch-row">
          <input type="checkbox" checked={isLinked(o)} disabled={!online || !!asking} onchange={(e) => toggleLink(e, o)} />
          <span><b>{o.name}</b>{#if o.linkId && !isLinked(o)}<br /><small class="muted">{t('link.otherGroup', { names: linkedLists(v, o).map((l) => l.name).join(', ') })}</small>{/if}</span>
        </label>
      {/each}
      {#if asking}
        <div class="hint ask" role="group" aria-label={t('link.ask')}>
          <span><b>{t('link.ask')}</b><br /><small>{t('link.askHint', { a: list.name, b: asking.name })}</small></span>
        </div>
        <div class="row wrap-row">
          <button class="btn main" onclick={() => confirmLink(true)}>{t('link.askYes')}</button>
          <button class="btn" onclick={() => confirmLink(false)}>{t('link.askNo')}</button>
          <button class="btn" onclick={() => (asking = null)}>{t('cancel')}</button>
        </div>
      {/if}
      {#if partners.length}
        <button class="btn block" disabled={!online} onclick={leave}><Icon name="x" />{t('link.leave')}</button>
        <p class="micro">{t('link.leaveHint')}</p>
      {/if}
      {#if !online}<p class="micro">{t('link.offline')}</p>{/if}
    </fieldset>
  {/if}

  <fieldset class="mode travel">
    <legend class="eyebrow">{t('travel.title')}</legend>
    <label class="switch-row">
      <input type="checkbox" checked={!!travel || picking} onchange={(e) => toggleTravel(e.currentTarget.checked)} />
      <span><b>{t('travel.toggle')}</b><br /><small class="muted">{t('travel.hint')}</small></span>
    </label>
    {#if picking && !travel}
      <label class="field">
        <span>{t('travel.noCountry')}</span>
        <select class="select" bind:value={pickCountry} onchange={() => chooseCountry(pickCountry)}>
          <option value="">{t('travel.chooseCountry')}</option>
          {#each countries as c (c.code)}<option value={c.code}>{c.name}</option>{/each}
        </select>
      </label>
    {:else if travel}
      <div class="travel-now">
        <Flag country={travel.country} size={20} />
        <span><b>{countryName(travel.country, i18n.lang)}</b> · {langName(travel.lang, i18n.lang)}</span>
      </div>
      <div class="row wrap-row pickers">
        <label class="field grow">
          <span>{t('travel.country')}</span>
          <select class="select" value={travel.country} onchange={(e) => chooseCountry(e.currentTarget.value)}>
            {#each countries as c (c.code)}<option value={c.code}>{c.name}</option>{/each}
          </select>
        </label>
        <label class="field grow">
          <span>{t('travel.lang')}</span>
          <select class="select" value={travel.lang} onchange={(e) => setTravel(list, { country: travel.country, lang: e.currentTarget.value })}>
            {#each langsFor(travel.country) as l (l.code)}<option value={l.code}>{l.name}{l.own ? ' ★' : ''}</option>{/each}
          </select>
        </label>
      </div>
      {#if sync.features.translate}
        {#if missing.length}
          <button class="btn block main" onclick={translateAll} disabled={translating || !online}>
            <Icon name="swap" />{translating ? t('travel.translating') : t('travel.translateAll', { count: missing.length })}
          </button>
          {#if !online}<p class="micro">{t('travel.needsOnline')}</p>{/if}
        {:else}
          <p class="micro">{t('travel.allDone')}</p>
        {/if}
        <p class="micro">{t('travel.autoNote', { service: translatorChain() })}</p>
      {:else}
        <p class="micro">{t('travel.manualOnly')}</p>
      {/if}
      {#if translated.length}
        {#if confirmClear}
          <div class="hint alert"><span class="grow">{t('travel.clearConfirm', { count: translated.length })}</span></div>
          <div class="row">
            <button class="btn danger solid" onclick={clearAll}>{t('travel.clear', { count: translated.length })}</button>
            <button class="btn" onclick={() => (confirmClear = false)}>{t('cancel')}</button>
          </div>
        {:else}
          <button class="btn block" onclick={() => (confirmClear = true)}><Icon name="trash" />{t('travel.clear', { count: translated.length })}</button>
        {/if}
      {/if}
    {/if}
  </fieldset>

  <div class="actions">
    <button class="btn block" onclick={() => onopen('group', { create: true })}><Icon name="folder" />{t('group.add')}</button>
    <button class="btn block" onclick={() => shareListText(list)}><Icon name="share" />{t('shareText.button')}</button>
    <button class="btn block" onclick={() => onopen('history')}><Icon name="history" />{t('history.title')}</button>
    <button class="btn block" onclick={() => onopen('backup')}><Icon name="copy" />{t('backup.title')}</button>
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
  .addr-hint {
    margin: -6px 0 16px;
    text-transform: none;
    letter-spacing: 0.02em;
  }
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
  .shortcuts {
    display: flex;
    gap: 10px;
    align-items: flex-start;
    margin: 0 0 16px;
  }
  .shortcuts input {
    margin-top: 4px;
    accent-color: var(--dusk);
  }
  .link-group {
    display: grid;
    gap: 4px;
  }
  .link-group legend {
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }
  .link-group .switch-row {
    display: flex;
    gap: 10px;
    align-items: flex-start;
    padding: 4px 0;
  }
  .link-group .switch-row input {
    margin-top: 4px;
    accent-color: var(--ok);
  }
  .link-group .micro {
    margin: 0 0 6px;
    text-transform: none;
    letter-spacing: 0.02em;
  }
  .link-group .ask {
    margin-top: 6px;
  }
  .link-group .row {
    gap: 8px;
    margin-bottom: 6px;
  }
  .link-group .btn.block {
    margin-top: 8px;
  }
  .travel {
    display: grid;
    gap: 10px;
  }
  .travel label.field {
    display: block;
    margin: 0;
    padding: 0;
  }
  .travel-now {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .pickers {
    gap: 10px;
  }
  .pickers .grow {
    flex: 1 1 140px;
    min-width: 0;
  }
  .travel .micro {
    margin: 0;
    text-transform: none;
    letter-spacing: 0.02em;
  }
  .mode input {
    margin-top: 4px;
    accent-color: var(--dusk);
  }
</style>
