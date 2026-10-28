<script>
  import { onMount } from 'svelte';
  import Icon from './Icon.svelte';
  import Scanner from './Scanner.svelte';
  import Prefs from './Prefs.svelte';
  import BackupSheet from './BackupSheet.svelte';
  import HelpSheet from './HelpSheet.svelte';
  import Sheet from './Sheet.svelte';
  import { t } from '../lib/i18n.svelte.js';
  import { api } from '../lib/api.js';
  import { knownSpaces, forgetSpace, deviceName, setDeviceName, suggestDeviceName } from '../lib/device.js';
  import { parseSpaceId, formatSpaceId, parseInviteCode, formatInviteCode, INVITE_PREFIX } from '../../../shared/ids.js';

  let { onopen } = $props();

  let listName = $state('');
  let myName = $state(deviceName() || suggestDeviceName());
  const askName = !deviceName();
  let joinInput = $state('');
  let busy = $state(false);
  let error = $state('');
  let joinError = $state('');
  let showId = $state(false);
  let scanning = $state(false);
  let importing = $state(false);
  let helping = $state(false);

  // REGISTRATIONS: what the server says about creating IDs – { registrations, firstFree, member };
  // null until it answered (offline: everything as before, the server has the last word anyway)
  let cfg = $state(null);
  // an accepted invitation code (SWIV…) – the create form is shown for it
  let invite = $state('');
  // may this device create an ID without a code?
  const mayCreate = $derived(!!cfg && (cfg.registrations === 'open' || cfg.firstFree || cfg.member || !!invite));
  // the one field takes an ID – and, when this device needs one, an invitation code
  const codeToo = $derived(!!cfg && cfg.registrations !== 'open' && !mayCreate);
  onMount(() => {
    api.config().then((c) => (cfg = c)).catch(() => (cfg = { registrations: 'open', firstFree: false, member: true }));
    // an invitation link: the code is filled in, the person only has to confirm it
    const q = new URLSearchParams(location.search).get('invite');
    const code = q && parseInviteCode(q);
    if (code) {
      joinInput = formatInviteCode(code);
      history.replaceState(null, '', '/');
    }
  });

  async function redeem(code) {
    busy = true;
    joinError = '';
    try {
      await api.checkInvite(formatInviteCode(code));
      invite = code;
      joinInput = '';
    } catch (e) {
      joinError = e.code === 'offline' ? t('start.offline') : e.status === 429 ? t('status.limited') : t('start.inviteInvalid');
    } finally {
      busy = false;
    }
  }

  // a first-time user who keeps the suggested device name is asked once whether that's fine
  const suggested = suggestDeviceName();
  let nameConfirmed = false;
  let confirmName = $state(null); // the action waiting for the answer
  let nameInput = $state();
  function withName(action) {
    const n = myName.trim();
    if (askName && !nameConfirmed && (!n || n === suggested)) {
      if (!n) myName = suggested;
      confirmName = action;
      return;
    }
    action();
  }
  let known = $state(knownSpaces());
  const canScan = typeof window !== 'undefined' && window.isSecureContext && !!navigator.mediaDevices?.getUserMedia;

  function create(e) {
    e?.preventDefault();
    if (!listName.trim() || busy) return;
    withName(doCreate);
  }

  async function doCreate() {
    const name = listName.trim();
    if (!name || busy) return;
    busy = true;
    error = '';
    try {
      if (askName) setDeviceName(myName.trim().slice(0, 40) || suggestDeviceName());
      const { id } = await api.createSpace(name, deviceName(), name, undefined, invite ? formatInviteCode(invite) : undefined);
      onopen(id);
    } catch (err) {
      if (['invite_required', 'invite_invalid', 'closed'].includes(err.code)) {
        // the server wants a code (or this one is used up): back to the one field
        invite = '';
        if (cfg) cfg = { ...cfg, firstFree: false, member: false };
        error = '';
        joinError = t(err.code === 'invite_invalid' ? 'start.inviteInvalid' : 'start.inviteRequired');
      } else error = err.code === 'offline' ? t('start.offline') : err.code === 'space_limit' ? t('start.spaceLimit', { count: err.limit }) : err.code === 'id_limit' ? t('start.idLimit', { count: err.limit }) : t('start.createFailed');
    } finally {
      busy = false;
    }
  }

  function join(e) {
    e?.preventDefault();
    const code = parseInviteCode(joinInput);
    if (code) return redeem(code);
    const id = parseSpaceId(joinInput);
    if (!id) {
      joinError = t('start.invalidId');
      return;
    }
    withName(() => {
      if (askName && myName.trim()) setDeviceName(myName.trim().slice(0, 40));
      onopen(id);
    });
  }

  function onJoinInput(e) {
    joinError = '';
    // live formatting: XXXX-XXXX-XX
    const raw = e.target.value.toUpperCase().replace(/[^0-9A-Z]/g, '');
    if (e.target.value.includes('/') || raw.length > 10) return void (joinInput = e.target.value);
    // an invitation code: SWIV-XXX-XXX
    if (raw.startsWith(INVITE_PREFIX)) return void (joinInput = [raw.slice(0, 4), raw.slice(4, 7), raw.slice(7, 10)].filter(Boolean).join('-'));
    joinInput = [raw.slice(0, 4), raw.slice(4, 8), raw.slice(8, 10)].filter(Boolean).join('-');
  }

  function forget(id) {
    forgetSpace(id);
    api.leave(id).catch(() => {}); // the server forgets this device there, too (a slot of the 10 IDs)
    known = knownSpaces();
  }
</script>

<main class="wrap start">
  <div class="top">
    <div class="brand">Shop<span>·</span>Wiz</div>
    <Prefs compact />
  </div>

  <section class="lede">
    <h1 class="hero">{t('start.title')}</h1>
    <p class="muted">{t('start.lede')}</p>
    <button class="chip help" onclick={() => (helping = true)}><Icon name="help" size={16} />{t('help.title')}</button>
  </section>

  {#if known.length}
    <section class="card">
      <p class="eyebrow">{t('start.recent')}</p>
      <ul class="known">
        {#each known as s (s.id)}
          <li>
            <button class="open" onclick={() => onopen(s.id)}>
              <span class="name">{s.name}</span>
              <span class="micro">{formatSpaceId(s.id)}</span>
            </button>
            <button class="icon-btn" onclick={() => forget(s.id)} aria-label={t('start.forget', { name: s.name })} title={t('start.forget', { name: s.name })}>
              <Icon name="x" size={18} />
            </button>
          </li>
        {/each}
      </ul>
    </section>
  {/if}

  {#if cfg && mayCreate}
  <section class="card">
    <p class="eyebrow">{t('start.newEyebrow')}</p>
    <h2>{t('start.newTitle')}</h2>
    {#if invite}
      <p class="hint ok">{t('start.invited', { code: formatInviteCode(invite) })}</p>
    {:else if cfg.registrations !== 'open' && cfg.firstFree}
      <p class="hint">{t('start.firstFree')}</p>
    {/if}
    <form onsubmit={create}>
      <label class="field">
        <span>{t('start.listName')}</span>
        <input data-1p-ignore data-lpignore="true" data-bwignore data-form-type="other" spellcheck="false" autocomplete="off" class="input" bind:value={listName} maxlength="80" placeholder={t('start.listNamePh')} required />
      </label>
      {#if askName}
        <label class="field">
          <span>{t('name.label')}</span>
          <input data-1p-ignore data-lpignore="true" data-bwignore data-form-type="other" spellcheck="false" class="input" bind:this={nameInput} bind:value={myName} maxlength="40" autocomplete="nickname" />
        </label>
      {/if}
      {#if error}<p class="hint alert">{error}</p>{/if}
      <button class="btn main block" type="submit" disabled={busy || !listName.trim()}>
        <Icon name="plus" />
        {t('start.create')}
      </button>
    </form>
    <button
      class="link import"
      onclick={() =>
        withName(() => {
          if (askName && myName.trim()) setDeviceName(myName.trim().slice(0, 40));
          importing = true;
        })}>{t('start.import')}</button>
  </section>
  {/if}

  {#if cfg}
  <section class="card">
    <p class="eyebrow">{t(codeToo ? 'start.codeEyebrow' : 'start.joinEyebrow')}</p>
    <h2>{t(codeToo ? 'start.codeTitle' : 'start.joinTitle')}</h2>
    {#if codeToo}
      <p class="note">{t(cfg.registrations === 'off' ? 'start.closed' : 'start.inviteNote')}</p>
    {/if}
    <form onsubmit={join}>
      <!-- the ID works like a password: let password managers save and fill it -->
      <input class="sr-only" type="text" name="username" autocomplete="username" tabindex="-1" aria-hidden="true" />
      <label class="field">
        <span>{t(codeToo ? 'start.codeLabel' : 'start.idLabel')}</span>
        <div class="row">
          <input
            class="input mono id-input"
            type={showId ? 'text' : 'password'}
            name="password"
            aria-label={t(codeToo ? 'start.codeLabel' : 'start.idLabel')}
            value={joinInput}
            oninput={onJoinInput}
            onpaste={(e) => {
              const text = e.clipboardData?.getData('text') ?? '';
              const id = parseSpaceId(text);
              const code = parseInviteCode(text);
              if (id || code) {
                e.preventDefault();
                joinInput = id ? formatSpaceId(id) : formatInviteCode(code);
              }
            }}
            placeholder={codeToo ? 'XXXX-XXXX-XX · SWIV-XXX-XXX' : 'XXXX-XXXX-XX'}
            autocomplete="current-password"
            autocapitalize="characters"
            spellcheck="false"
            inputmode="text"
            aria-invalid={!!joinError} />
          <button type="button" class="btn" onclick={() => (showId = !showId)} aria-pressed={showId} aria-label={t(showId ? 'start.hideId' : 'start.showId')} title={t(showId ? 'start.hideId' : 'start.showId')}>
            <Icon name={showId ? 'eyeOff' : 'eye'} />
          </button>
          {#if canScan}
            <button type="button" class="btn" onclick={() => (scanning = true)} aria-label={t('scan.title')} title={t('scan.title')}>
              <Icon name="camera" />
            </button>
          {/if}
        </div>
      </label>
      {#if joinError}<p class="hint alert">{joinError}</p>{/if}
      <button class="btn dusk block" type="submit" disabled={!joinInput || busy}>{t(parseInviteCode(joinInput) ? 'start.redeem' : 'start.join')}</button>
    </form>
  </section>
  {/if}

  <p class="micro privacy">{t('start.privacy')}</p>
</main>

{#if helping}
  <HelpSheet onclose={() => (helping = false)} />
{/if}

{#if confirmName}
  <Sheet title={t('name.confirmTitle', { name: myName.trim() })} eyebrow={t('name.eyebrow')} onclose={() => (confirmName = null)}>
    <p class="note">{t('name.confirmText')}</p>
    <div class="row wrap-row">
      <button
        class="btn main"
        onclick={() => {
          const action = confirmName;
          nameConfirmed = true;
          confirmName = null;
          action();
        }}>{t('name.confirmYes')}</button>
      <button
        class="btn"
        onclick={() => {
          confirmName = null;
          setTimeout(() => {
            nameInput?.focus();
            nameInput?.select();
          }, 50);
        }}>{t('name.confirmChange')}</button>
    </div>
  </Sheet>
{/if}

{#if importing}
  <BackupSheet onclose={() => (importing = false)} {onopen} invite={invite ? formatInviteCode(invite) : ''} />
{/if}

{#if scanning}
  <Scanner
    onclose={() => (scanning = false)}
    onresult={(id) => {
      scanning = false;
      joinInput = formatSpaceId(id);
      join();
    }} />
{/if}

<style>
  .start {
    padding-bottom: 48px;
  }
  .top {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-bottom: clamp(18px, 4vw, 28px);
  }
  .top .brand {
    margin-right: auto;
  }
  .help {
    margin-top: 14px;
    border-color: var(--dusk);
    color: var(--dusk);
    font-weight: 600;
    font-size: 0.85rem;
    padding: 8px 14px;
  }
  .lede {
    margin-bottom: 26px;
  }
  .lede p {
    max-width: 56ch;
    margin: 0;
  }
  .id-input {
    font-size: 1.2rem;
  }
  .known {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .known li {
    display: flex;
    align-items: center;
    gap: 4px;
    border-top: 1px solid var(--line);
  }
  .known li:first-child {
    border-top: 0;
  }
  .open {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 2px;
    background: none;
    border: 0;
    padding: 10px 0;
    text-align: left;
  }
  .open .name {
    font-weight: 600;
    overflow-wrap: anywhere;
  }
  .open:hover .name {
    color: var(--dusk);
  }
  .import {
    display: block;
    margin: 14px auto 0;
    font-size: 0.9rem;
  }
  .privacy {
    text-align: center;
    margin-top: 24px;
    line-height: 1.6;
  }
</style>
