<script>
  import Icon from './Icon.svelte';
  import Scanner from './Scanner.svelte';
  import Prefs from './Prefs.svelte';
  import BackupSheet from './BackupSheet.svelte';
  import { t } from '../lib/i18n.svelte.js';
  import { api } from '../lib/api.js';
  import { knownSpaces, forgetSpace, deviceName, setDeviceName, suggestDeviceName } from '../lib/device.js';
  import { parseSpaceId, formatSpaceId } from '../../../shared/ids.js';

  let { onopen } = $props();

  let listName = $state('');
  let myName = $state(deviceName() || suggestDeviceName());
  const askName = !deviceName();
  let joinInput = $state('');
  let busy = $state(false);
  let error = $state('');
  let joinError = $state('');
  let scanning = $state(false);
  let importing = $state(false);
  let known = $state(knownSpaces());
  const canScan = typeof window !== 'undefined' && window.isSecureContext && !!navigator.mediaDevices?.getUserMedia;

  async function create(e) {
    e.preventDefault();
    const name = listName.trim();
    if (!name || busy) return;
    busy = true;
    error = '';
    try {
      if (askName) setDeviceName(myName.trim().slice(0, 40) || suggestDeviceName());
      const { id } = await api.createSpace(name, deviceName(), name);
      onopen(id);
    } catch (err) {
      error = err.code === 'offline' ? t('start.offline') : t('start.createFailed');
    } finally {
      busy = false;
    }
  }

  function join(e) {
    e?.preventDefault();
    const id = parseSpaceId(joinInput);
    if (!id) {
      joinError = t('start.invalidId');
      return;
    }
    if (askName && myName.trim()) setDeviceName(myName.trim().slice(0, 40));
    onopen(id);
  }

  function onJoinInput(e) {
    joinError = '';
    // live formatting: XXXX-XXXX-XX
    const raw = e.target.value.toUpperCase().replace(/[^0-9A-Z]/g, '');
    if (e.target.value.includes('/') || raw.length > 10) return;
    joinInput = [raw.slice(0, 4), raw.slice(4, 8), raw.slice(8, 10)].filter(Boolean).join('-');
  }

  function forget(id) {
    forgetSpace(id);
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

  <section class="card">
    <p class="eyebrow">{t('start.newEyebrow')}</p>
    <h2>{t('start.newTitle')}</h2>
    <form onsubmit={create}>
      <label class="field">
        <span>{t('start.listName')}</span>
        <input class="input" bind:value={listName} maxlength="80" placeholder={t('start.listNamePh')} required />
      </label>
      {#if askName}
        <label class="field">
          <span>{t('name.label')}</span>
          <input class="input" bind:value={myName} maxlength="40" autocomplete="nickname" />
        </label>
      {/if}
      {#if error}<p class="hint alert">{error}</p>{/if}
      <button class="btn main block" type="submit" disabled={busy || !listName.trim()}>
        <Icon name="plus" />
        {t('start.create')}
      </button>
    </form>
    <button class="link import" onclick={() => (askName && myName.trim() && setDeviceName(myName.trim().slice(0, 40)), (importing = true))}>{t('start.import')}</button>
  </section>

  <section class="card">
    <p class="eyebrow">{t('start.joinEyebrow')}</p>
    <h2>{t('start.joinTitle')}</h2>
    <form onsubmit={join}>
      <label class="field">
        <span>{t('start.idLabel')}</span>
        <div class="row">
          <input
            class="input mono id-input"
            value={joinInput}
            oninput={onJoinInput}
            onpaste={(e) => {
              const text = e.clipboardData?.getData('text') ?? '';
              const id = parseSpaceId(text);
              if (id) {
                e.preventDefault();
                joinInput = formatSpaceId(id);
              }
            }}
            placeholder="XXXX-XXXX-XX"
            autocomplete="off"
            autocapitalize="characters"
            spellcheck="false"
            inputmode="text"
            aria-invalid={!!joinError} />
          {#if canScan}
            <button type="button" class="btn" onclick={() => (scanning = true)} aria-label={t('scan.title')} title={t('scan.title')}>
              <Icon name="camera" />
            </button>
          {/if}
        </div>
      </label>
      {#if joinError}<p class="hint alert">{joinError}</p>{/if}
      <button class="btn dusk block" type="submit" disabled={!joinInput}>{t('start.join')}</button>
    </form>
  </section>

  <p class="micro privacy">{t('start.privacy')}</p>
</main>

{#if importing}
  <BackupSheet onclose={() => (importing = false)} {onopen} />
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
