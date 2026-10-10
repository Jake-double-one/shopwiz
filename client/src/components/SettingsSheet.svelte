<script>
  import { untrack } from 'svelte';
  import Sheet from './Sheet.svelte';
  import Icon from './Icon.svelte';
  import Prefs from './Prefs.svelte';
  import { t } from '../lib/i18n.svelte.js';
  import { updateSpace, renameDevice } from '../lib/actions.js';
  import { api } from '../lib/api.js';
  import { sync } from '../lib/sync.svelte.js';
  import { toast } from '../lib/toast.svelte.js';
  import { knownSpaces, forgetSpace } from '../lib/device.js';
  import { formatSpaceId } from '../../../shared/ids.js';
  import { activateOPButton, encodeOPSaveRequest } from '@1password/save-button';
  import { i18n } from '../lib/i18n.svelte.js';

  let { space, spaceId, onclose, onleave, onopen, onshare, onbackup } = $props();

  let name = $state(untrack(() => space.name));
  let ttl = $state(untrack(() => space.ttlDays));
  let myName = $state(untrack(() => sync.me?.name ?? ''));
  let confirm = $state(null); // 'renew' | 'delete' | 'delete2' | 'forget'
  let typed = $state('');
  let busy = $state(false);
  let showId = $state(false);

  // 1Password ignores forms it didn't see typed into, but it has its own "Save in 1Password"
  // button: the extension enables it when present – then we show it instead of ours.
  let opWrap = $state();
  let hasOP = $state(false);
  const opDark = () =>
    document.documentElement.dataset.theme === 'dark' ||
    (document.documentElement.dataset.theme !== 'light' && matchMedia('(prefers-color-scheme: dark)').matches);
  const opValue = $derived(
    encodeOPSaveRequest({
      title: `ShopWiz · ${space.name}`,
      fields: [
        { autocomplete: 'username', value: space.name },
        { autocomplete: 'new-password', value: formatSpaceId(spaceId) },
      ],
      notes: `${location.origin}/${spaceId}`,
    }),
  );
  $effect(() => {
    const btn = opWrap?.querySelector('onepassword-save-button')?.shadowRoot?.querySelector('button[data-onepassword-save-button]');
    if (!btn) return;
    btn.setAttribute('value', opValue);
    const check = () => (hasOP = !btn.disabled);
    const mo = new MutationObserver(check);
    mo.observe(btn, { attributes: true, attributeFilter: ['disabled'] });
    activateOPButton();
    check();
    return () => mo.disconnect();
  });
  const online = $derived(sync.status === 'online');
  const others = knownSpaces().filter((s) => s.id !== spaceId);

  function saveName() {
    const n = name.trim();
    if (n && n !== space.name) updateSpace({ name: n.slice(0, 80) });
  }
  function saveMyName() {
    const n = myName.trim();
    if (n && n !== sync.me?.name) renameDevice(n.slice(0, 40));
    else myName = sync.me?.name ?? '';
  }
  function saveTtl() {
    const d = Math.round(Number(ttl));
    if (!Number.isFinite(d)) return (ttl = space.ttlDays);
    const clamped = Math.min(367, Math.max(7, d));
    ttl = clamped;
    if (clamped !== space.ttlDays) updateSpace({ ttlDays: clamped });
  }

  async function renew() {
    busy = true;
    try {
      await api.renew(spaceId);
      confirm = null;
    } catch {
      toast({ text: t('settings.failed'), kind: 'alert' });
    } finally {
      busy = false;
    }
  }

  async function remove() {
    busy = true;
    try {
      await api.remove(spaceId);
      onclose();
    } catch {
      toast({ text: t('settings.failed'), kind: 'alert' });
    } finally {
      busy = false;
    }
  }

  async function copyId() {
    try {
      await navigator.clipboard.writeText(formatSpaceId(spaceId));
      toast(t('share.idCopied'));
    } catch {
      window.prompt(t('share.copyManual'), formatSpaceId(spaceId));
    }
  }

  // a tiny login form: submitting it makes password managers offer to save the ID
  function savePm(e) {
    e.preventDefault();
    if (window.PasswordCredential) {
      navigator.credentials.store(new window.PasswordCredential({ id: space.name, password: formatSpaceId(spaceId), name: `ShopWiz · ${space.name}` })).catch(() => {});
    }
    toast({ text: t('settings.pmSaved') });
  }

  function forget() {
    forgetSpace(spaceId);
    onleave();
  }
</script>

<Sheet title={t('settings.title')} eyebrow={space.name} {onclose}>
  <section>
    <label class="field">
      <span>{t('settings.spaceName')}</span>
      <input data-1p-ignore data-lpignore="true" data-bwignore data-form-type="other" autocomplete="off" class="input" bind:value={name} onblur={saveName} onkeydown={(e) => e.key === 'Enter' && saveName()} maxlength="80" />
    </label>
    <label class="field">
      <span>{t('settings.ttl')}</span>
      <div class="row">
        <input data-1p-ignore data-lpignore="true" data-bwignore data-form-type="other" autocomplete="off" class="input mono ttl" type="number" min="7" max="367" bind:value={ttl} onblur={saveTtl} onkeydown={(e) => e.key === 'Enter' && saveTtl()} />
        <span class="muted">{t('settings.days')}</span>
      </div>
    </label>
    <p class="note">{t('settings.ttlHint', { days: space.ttlDays })}</p>
  </section>

  <section>
    <p class="eyebrow">{t('settings.device')}</p>
    <label class="field">
      <span>{t('people.yourName')}</span>
      <input data-1p-ignore data-lpignore="true" data-bwignore data-form-type="other" class="input" bind:value={myName} onblur={saveMyName} onkeydown={(e) => e.key === 'Enter' && saveMyName()} maxlength="40" autocomplete="nickname" />
    </label>
    <Prefs />
  </section>

  <section>
    <p class="eyebrow">{t('settings.idTitle')}</p>
    <!-- a tiny login form: submitting it makes password managers offer to save the ID -->
    <form class="pm" onsubmit={savePm} action="#">
      <input class="sr-only" type="text" name="username" autocomplete="username" value={space.name} readonly tabindex="-1" aria-hidden="true" />
      <input class="sr-only" type="password" name="password" autocomplete="new-password" value={formatSpaceId(spaceId)} readonly tabindex="-1" aria-hidden="true" />
      <div class="id-row">
        <button type="button" class="id-chip mono" onclick={copyId} title={t('share.copyId')} aria-label={t('share.copyId')}>
          <span class:masked={!showId}>{showId ? formatSpaceId(spaceId) : '••••-••••-••'}</span>
          <Icon name="copy" />
        </button>
        <button type="button" class="btn" onclick={() => (showId = !showId)} aria-pressed={showId} aria-label={t(showId ? 'start.hideId' : 'start.showId')} title={t(showId ? 'start.hideId' : 'start.showId')}>
          <Icon name={showId ? 'eyeOff' : 'eye'} />
        </button>
      </div>
      <div class="op" class:waiting={!hasOP} bind:this={opWrap} aria-hidden={!hasOP}>
        <onepassword-save-button data-onepassword-type="login" value={opValue} lang={i18n.lang} data-theme={opDark() ? 'dark' : 'light'} padding="none"></onepassword-save-button>
      </div>
      {#if !hasOP}
        <button class="btn block" type="submit"><Icon name="key" />{t('settings.pmSave')}</button>
      {/if}
      <p class="note">{t('settings.pmHint')}</p>
    </form>
  </section>

  <section>
    <p class="eyebrow">{t('settings.spaces')}</p>
    <div class="list">
      <button class="btn block" onclick={onshare}><Icon name="share" />{t('share.title')}</button>
      <button class="btn block" onclick={onbackup}><Icon name="copy" />{t('backup.title')}</button>
      {#each others as s (s.id)}
        <button class="btn block" onclick={() => (onclose(), onopen(s.id))}><Icon name="swap" />{s.name} <span class="micro">{formatSpaceId(s.id)}</span></button>
      {/each}
      <button class="btn block" onclick={onleave}><Icon name="plus" />{t('settings.otherSpace')}</button>
    </div>
  </section>

  <section class="danger-zone">
    <p class="eyebrow">{t('settings.danger')}</p>

    {#if confirm === 'renew'}
      <div class="hint"><span class="grow">{t('settings.renewConfirm')}</span></div>
      <div class="row">
        <button class="btn main" onclick={renew} disabled={busy || !online}>{t('settings.renew')}</button>
        <button class="btn" onclick={() => (confirm = null)}>{t('cancel')}</button>
      </div>
    {:else if confirm === 'delete'}
      <div class="hint alert"><span class="grow">{t('settings.deleteConfirm1')}</span></div>
      <div class="row">
        <button class="btn danger" onclick={() => ((confirm = 'delete2'), (typed = ''))}>{t('settings.deleteNext')}</button>
        <button class="btn" onclick={() => (confirm = null)}>{t('cancel')}</button>
      </div>
    {:else if confirm === 'delete2'}
      <label class="field">
        <span>{t('settings.deleteConfirm2', { name: space.name })}</span>
        <input data-1p-ignore data-lpignore="true" data-bwignore data-form-type="other" class="input" bind:value={typed} autocomplete="off" />
      </label>
      <div class="row">
        <button class="btn danger solid" onclick={remove} disabled={busy || !online || typed.trim().toLowerCase() !== space.name.trim().toLowerCase()}>{t('settings.deleteFinal')}</button>
        <button class="btn" onclick={() => (confirm = null)}>{t('cancel')}</button>
      </div>
    {:else if confirm === 'forget'}
      <div class="hint alert">
        <span class="grow">
          {t('settings.forgetConfirm', { id: formatSpaceId(spaceId) })}
          {#if sync.pendingCount}<br /><b>{t('settings.forgetPending', { count: sync.pendingCount })}</b>{/if}
        </span>
      </div>
      <div class="row">
        <button class="btn danger solid" onclick={forget}>{t('settings.forget')}</button>
        <button class="btn" onclick={() => (confirm = null)}>{t('cancel')}</button>
      </div>
    {:else}
      <div class="list">
        <button class="btn block" onclick={() => (confirm = 'renew')} disabled={!online}><Icon name="key" />{t('settings.renew')}</button>
        <button class="btn block" onclick={() => (confirm = 'forget')}><Icon name="logout" />{t('settings.forget')}</button>
        <button class="btn danger block" onclick={() => (confirm = 'delete')} disabled={!online}><Icon name="trash" />{t('settings.delete')}</button>
      </div>
      {#if !online}<p class="micro">{t('settings.needsOnline')}</p>{/if}
    {/if}
  </section>
</Sheet>

<style>
  section + section {
    margin-top: 18px;
    padding-top: 16px;
    border-top: 1px solid var(--line);
  }
  .ttl {
    max-width: 120px;
  }
  .list {
    display: grid;
    gap: 8px;
  }
  .pm {
    display: grid;
    gap: 8px;
  }
  .op.waiting {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
    pointer-events: none;
  }
  .pm .note {
    margin: 0;
  }
  .pm .btn.block {
    justify-content: flex-start;
  }
  .id-row {
    display: flex;
    gap: 8px;
  }
  .id-chip {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    padding: 10px 14px;
    border: 1px solid var(--line);
    border-radius: 12px;
    background: var(--surface-2);
    min-height: 44px;
    font-weight: 500;
    color: var(--ink);
    font-size: 1.25rem;
    letter-spacing: 0.08em;
    cursor: pointer;
  }
  .id-chip :global(svg) {
    flex: none;
    opacity: 0.7;
  }
  .id-chip .masked {
    letter-spacing: 0.12em;
  }
  .list .btn {
    justify-content: flex-start;
  }
  .list .micro {
    margin-left: auto;
  }
  .row {
    flex-wrap: wrap;
  }
</style>
