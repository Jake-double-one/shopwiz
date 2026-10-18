<script>
  import { onMount } from 'svelte';
  import Icon from './Icon.svelte';
  import { t, relTime, clock } from '../lib/i18n.svelte.js';
  import { toast } from '../lib/toast.svelte.js';
  import { load, save } from '../lib/storage.js';
  import { admin, adminSession, passkeysPossible } from '../lib/admin.svelte.js';
  import { formatSpaceId } from '../../../shared/ids.js';
  import { parseDid } from '../../../shared/did.js';

  let { onopenspace, onexit } = $props();

  // 'off' = no administration on this server, 'offline' = no connection
  let status = $state(null);
  let data = $state(null);
  let tab = $state('spaces');
  let user = $state('');
  let password = $state('');
  let busy = $state(false);
  let error = $state('');
  let expired = $state(false);
  // an action that wants a recent login (promote, revoke, delete) – it runs again right after
  let reauth = $state(null);
  let confirm = $state(null); // 'space:<id>' | 'revoke:<did>' | 'key:<id>'
  let filter = $state('');
  let promoteDid = $state('');
  const secure = passkeysPossible();

  const isMain = $derived(adminSession.role === 'main');
  const spaces = $derived(
    (data?.spaces ?? []).filter((s) => {
      const q = filter.trim().toLowerCase();
      return !q || s.name.toLowerCase().includes(q) || s.id.toLowerCase().includes(q.replace(/[^a-z0-9]/g, ''));
    }),
  );
  // set up the passkey of this promotion on this very device? (kept next to the device's own key)
  const keyHere = $derived(status?.did ? load(`adminKey.${status.did}`, false) : false);

  function errorText(e) {
    const key = `admin.error.${e?.code}`;
    const s = t(key);
    return s === key ? t('admin.error.generic') : s;
  }

  async function loadStatus() {
    try {
      status = await admin.status();
    } catch (e) {
      status = e.status === 404 ? 'off' : 'offline';
    }
  }

  async function refresh() {
    if (!adminSession.token) return;
    try {
      data = await admin.overview();
      expired = false;
    } catch (e) {
      if (e.code === 'login') {
        data = null;
        expired = true;
      } else toast({ text: errorText(e), kind: 'alert' });
    }
  }

  onMount(async () => {
    await loadStatus();
    await refresh();
  });

  async function withBusy(fn) {
    busy = true;
    error = '';
    try {
      await fn();
    } catch (e) {
      error = errorText(e);
    } finally {
      busy = false;
    }
  }

  async function afterLogin() {
    password = '';
    expired = false;
    await loadStatus();
    await refresh();
    const r = reauth;
    reauth = null;
    if (r) await act(r.run);
  }

  const loginPassword = () => withBusy(async () => (await admin.loginPassword(user.trim(), password), await afterLogin()));
  const loginPasskey = () => withBusy(async () => (await admin.loginPasskey(), await afterLogin()));
  const setUpPasskey = () =>
    withBusy(async () => {
      const r = await admin.registerPasskey();
      if (r.did) save(`adminKey.${r.did}`, true);
      toast(t('admin.passkeyDone'));
      await afterLogin();
    });

  // the main admin's own passkey (then the password can be switched off: ADMIN_PASSWORD_LOGIN=off)
  const addMainKey = () =>
    act(async () => {
      await admin.registerPasskey();
      toast(t('admin.passkeyDone'));
    });

  /** Run an admin action; a "log in again" answer asks for the login and runs it after that. */
  async function act(fn) {
    try {
      await fn();
      confirm = null;
      await refresh();
    } catch (e) {
      if (e.code === 'reauth') reauth = { run: fn };
      else if (e.code === 'login') expired = true;
      else toast({ text: errorText(e), kind: 'alert' });
    }
  }

  async function logout() {
    await admin.logout().catch(() => {});
    data = null;
    reauth = null;
    await loadStatus();
  }

  function promote() {
    const did = parseDid(promoteDid);
    if (!did) return toast({ text: t('admin.error.invalid_did'), kind: 'alert' });
    act(async () => {
      await admin.promote(did);
      promoteDid = '';
      toast(t('admin.promotedToast', { did }));
    });
  }

  const actor = (a) => (a === 'main' ? t('admin.main') : a === 'system' ? t('admin.system') : `D-ID ${a}`);
  function logText(e) {
    const key = `admin.log.${e.action}`;
    const d = e.detail ?? {};
    const s = t(key, { did: d.did ?? '', name: d.name ?? '', id: d.id ?? '', n: String(d.count ?? 1), method: d.method ? t(`admin.method.${d.method}`) : '' });
    return s === key ? e.action : s;
  }
  const kindOf = (k) => (k.synced ? t('admin.keySynced') : t('admin.keyDevice'));
</script>

<main class="wrap admin">
  <header class="top">
    <span class="brand">Shop<span>·</span>Wiz</span>
    <h1 class="title"><Icon name="shield" size={18} /><span>{t('admin.title')}</span></h1>
    <button class="icon-btn" onclick={onexit} aria-label={t('admin.exit')} title={t('admin.exit')}><Icon name="x" /></button>
  </header>

  {#if status === null}
    <p class="muted">{t('status.connecting')}</p>
  {:else if status === 'off'}
    <section class="card">
      <h2>{t('admin.offTitle')}</h2>
      <p class="note">{t('admin.off')}</p>
      <button class="btn main" onclick={onexit}>{t('back')}</button>
    </section>
  {:else if status === 'offline'}
    <section class="card">
      <p class="note">{t('admin.offline')}</p>
      <button class="btn" onclick={loadStatus}>{t('admin.retry')}</button>
    </section>
  {:else if !adminSession.token}
    <!-- ----- login ----- -->
    {#if expired}<p class="hint alert"><span class="grow">{t('admin.expired')}</span></p>{/if}
    {#if !secure}
      <p class="hint alert"><span class="grow">{t('admin.needsHttps')}</span></p>
    {/if}

    {#if status.role === 'pending'}
      <section class="card promoted">
        <p class="eyebrow">D-ID {status.did}</p>
        <h2>{t('admin.promoted')}</h2>
        <p class="note">{t('admin.setUpHint', { until: clock(status.until) })}</p>
        <button class="btn main block" onclick={setUpPasskey} disabled={busy || !secure}><Icon name="key" />{t('admin.setUp')}</button>
      </section>
    {:else if status.role === 'active' && !keyHere}
      <p class="hint alert"><span class="grow">{t('admin.takenHint')}</span></p>
    {/if}

    <section class="card">
      <h2>{t('admin.login')}</h2>
      {#if secure}
        <button class="btn main block" onclick={loginPasskey} disabled={busy}><Icon name="key" />{t('admin.loginPasskey')}</button>
      {/if}
      {#if status.passwordLogin && secure}
        <p class="or micro">{t('admin.or')}</p>
        <form
          onsubmit={(e) => {
            e.preventDefault();
            loginPassword();
          }}>
          <label class="field">
            <span>{t('admin.user')}</span>
            <input class="input" bind:value={user} autocomplete="username" autocapitalize="off" spellcheck="false" maxlength="200" />
          </label>
          <label class="field">
            <span>{t('admin.password')}</span>
            <input class="input" type="password" bind:value={password} autocomplete="current-password" maxlength="1024" />
          </label>
          <button class="btn block" type="submit" disabled={busy || !user.trim() || !password}>{t('admin.loginPassword')}</button>
        </form>
      {/if}
      {#if error}<p class="hint alert err"><span class="grow">{error}</span></p>{/if}
    </section>
    <p class="note">{t('admin.memoryNote')}</p>
  {:else}
    <!-- ----- logged in ----- -->
    <div class="who">
      <span class="micro">{isMain ? t('admin.asMain') : t('admin.asDevice', { did: adminSession.did })}</span>
      <button class="icon-btn" onclick={refresh} aria-label={t('admin.refresh')} title={t('admin.refresh')}><Icon name="swap" size={18} /></button>
      <button class="btn small" onclick={logout}><Icon name="logout" size={16} />{t('admin.logout')}</button>
    </div>

    {#if reauth}
      <section class="card reauth">
        <h2>{t('admin.reauthTitle')}</h2>
        <p class="note">{t('admin.reauth')}</p>
        {#if secure && (!isMain || (data?.mainKeys ?? []).length)}
          <button class="btn main block" onclick={loginPasskey} disabled={busy}><Icon name="key" />{t('admin.loginPasskey')}</button>
        {/if}
        {#if isMain && status.passwordLogin}
          <form
            class="reauth-form"
            onsubmit={(e) => {
              e.preventDefault();
              loginPassword();
            }}>
            <label class="field">
              <span>{t('admin.password')}</span>
              <input class="input" type="password" bind:value={password} autocomplete="current-password" maxlength="1024" />
            </label>
            {#if !user}
              <label class="field">
                <span>{t('admin.user')}</span>
                <input class="input" bind:value={user} autocomplete="username" autocapitalize="off" spellcheck="false" maxlength="200" />
              </label>
            {/if}
            <button class="btn block" type="submit" disabled={busy || !user.trim() || !password}>{t('admin.confirm')}</button>
          </form>
        {/if}
        {#if error}<p class="hint alert err"><span class="grow">{error}</span></p>{/if}
        <button class="btn block cancel" onclick={() => ((reauth = null), (error = ''))}>{t('cancel')}</button>
      </section>
    {/if}

    {#if data?.alerts?.length}
      <section class="card alerts">
        <p class="eyebrow">{t('admin.alerts', { count: data.alerts.length })}</p>
        <ul class="log">
          {#each data.alerts as e (e.id)}
            <li><span class="when micro">{clock(e.at)}</span><span>{actor(e.actor)}: {logText(e)}</span></li>
          {/each}
        </ul>
        <button class="btn small" onclick={() => act(() => admin.alertsSeen())}>{t('admin.alertsSeen')}</button>
      </section>
    {/if}

    {#if data}
      <div class="tabs">
        {#each [['spaces', data.spaces.length], ['devices', data.devices.length], ['admins', data.admins.length], ['log', null]] as [k, n] (k)}
          <button class="chip" aria-pressed={tab === k} onclick={() => (tab = k)}>
            {t(`admin.tab.${k}`)}{#if n !== null} <span class="n">{n}</span>{/if}
          </button>
        {/each}
      </div>

      {#if tab === 'spaces'}
        <input class="input filter" type="search" bind:value={filter} placeholder={t('admin.filter')} aria-label={t('admin.filter')} autocomplete="off" spellcheck="false" />
        {#if !spaces.length}<p class="muted">{t('admin.none')}</p>{/if}
        <ul class="rows">
          {#each spaces as s (s.id)}
            <li class="rowcard" class:gone={s.deletedAt}>
              <div class="main-line">
                <b class="name">{s.name}</b>
                <span class="mono sid">{formatSpaceId(s.id)}</span>
              </div>
              <p class="facts">
                {[
                  t('admin.nLists', { count: s.lists }),
                  t('admin.nItems', { count: s.items }),
                  t('admin.nGroups', { count: s.groups }),
                  t('admin.nDevices', { count: s.devices }),
                  ...(s.ai ? [t('admin.aiCount', { count: s.ai })] : []),
                  `~${s.kb} KB`,
                ].join(' · ')}
              </p>
              <p class="micro dates">
                {t('admin.created', { when: clock(s.createdAt) })} · {t('admin.lastUsed', { when: relTime(s.lastActiveAt) })}
                {#if s.deletedAt} · {t('admin.deletedAt', { when: clock(s.deletedAt) })}{/if}
              </p>
              {#if confirm === `space:${s.id}`}
                <div class="hint alert"><span class="grow">{t('admin.deleteConfirm', { name: s.name })}</span></div>
                <div class="row wrap-row actions">
                  <button class="btn small danger solid" onclick={() => act(() => admin.deleteSpace(s.id))}>{t('admin.deleteFinal')}</button>
                  <button class="btn small" onclick={() => (confirm = null)}>{t('cancel')}</button>
                </div>
              {:else}
                <div class="row wrap-row actions">
                  {#if !s.deletedAt}
                    <button class="btn small main" onclick={() => onopenspace(s.id)}><Icon name="eye" size={16} />{t('admin.open')}</button>
                  {/if}
                  <button class="btn small danger" onclick={() => (confirm = `space:${s.id}`)}><Icon name="trash" size={16} />{t('admin.delete')}</button>
                </div>
              {/if}
            </li>
          {/each}
        </ul>
      {:else if tab === 'devices'}
        {#if isMain}
          <form
            class="promote"
            onsubmit={(e) => {
              e.preventDefault();
              promote();
            }}>
            <label class="field">
              <span>{t('admin.promoteLabel')}</span>
              <div class="row">
                <input class="input mono" bind:value={promoteDid} placeholder="XXXXX-XXXXX" maxlength="20" autocomplete="off" spellcheck="false" />
                <button class="btn dusk" type="submit" disabled={!parseDid(promoteDid)}>{t('admin.promoteShort')}</button>
              </div>
            </label>
            <p class="note">{t('admin.promoteHint')}</p>
          </form>
        {/if}
        {#if !data.devices.length}<p class="muted">{t('admin.none')}</p>{/if}
        <ul class="rows">
          {#each data.devices as d (d.did)}
            <li class="rowcard">
              <div class="main-line">
                <b class="name">{d.names.join(', ')}</b>
                <span class="mono sid">{d.did}</span>
              </div>
              <p class="facts">{t('admin.inSpaces', { names: d.spaces.map((s) => s.name).join(', ') || '–' })}</p>
              <p class="micro dates">
                {t('admin.lastSeen', { when: relTime(d.lastSeenAt) })}
                {#if d.admin === 'active'} · <span class="badge">{t('admin.badgeActive')}</span>{:else if d.admin === 'pending'} · <span class="badge pending">{t('admin.badgePending')}</span>{/if}
              </p>
              {#if isMain && !d.admin}
                <div class="row actions">
                  <button class="btn small dusk" onclick={() => act(() => admin.promote(d.did).then(() => toast(t('admin.promotedToast', { did: d.did }))))}><Icon name="shield" size={16} />{t('admin.promote')}</button>
                </div>
              {/if}
            </li>
          {/each}
        </ul>
      {:else if tab === 'admins'}
        <ul class="rows">
          <li class="rowcard">
            <div class="main-line"><b class="name">{t('admin.main')}</b><span class="mono sid">{t('admin.userPassword')}</span></div>
            {#if isMain}
              {#each data.mainKeys as k (k.id)}
                <p class="facts key-line">
                  <Icon name="key" size={14} />{kindOf(k)} · {t('admin.keySince', { when: clock(k.createdAt) })}{#if k.lastUsedAt} · {t('admin.lastUsed', { when: relTime(k.lastUsedAt) })}{/if}
                  {#if confirm === `key:${k.id}`}
                    <button class="btn small danger solid" onclick={() => act(() => admin.deleteKey(k.id))}>{t('admin.deleteKey')}</button>
                    <button class="btn small" onclick={() => (confirm = null)}>{t('cancel')}</button>
                  {:else}
                    <button class="link" onclick={() => (confirm = `key:${k.id}`)}>{t('admin.deleteKey')}</button>
                  {/if}
                </p>
              {/each}
              <p class="note">{data.passwordLogin ? t('admin.passwordOn') : t('admin.passwordOff')}</p>
              {#if secure}
                <div class="row actions">
                  <button class="btn small" onclick={addMainKey}><Icon name="key" size={16} />{t('admin.addMainKey')}</button>
                </div>
              {/if}
            {/if}
          </li>
          {#each data.admins as a (a.did)}
            <li class="rowcard">
              <div class="main-line">
                <b class="name">{a.names.join(', ') || t('admin.unknownDevice')}</b>
                <span class="mono sid">{a.did}</span>
              </div>
              <p class="facts">
                {#if a.state === 'pending'}
                  <span class="badge pending">{t('admin.badgePending')}</span> {t('admin.pendingUntil', { when: clock(a.until) })}
                {:else}
                  <span class="badge">{t('admin.badgeActive')}</span>
                  {#each a.keys as k (k.id)} · {kindOf(k)} · {t('admin.keySince', { when: clock(k.createdAt) })}{/each}
                {/if}
              </p>
              {#if isMain}
                {#if confirm === `revoke:${a.did}`}
                  <div class="row wrap-row actions">
                    <button class="btn small danger solid" onclick={() => act(() => admin.revoke(a.did))}>{t('admin.revoke')}</button>
                    <button class="btn small" onclick={() => (confirm = null)}>{t('cancel')}</button>
                  </div>
                {:else}
                  <div class="row actions">
                    <button class="btn small danger" onclick={() => (confirm = `revoke:${a.did}`)}>{t('admin.revoke')}</button>
                  </div>
                {/if}
              {/if}
            </li>
          {/each}
        </ul>
        <p class="note">{t('admin.adminsNote')}</p>
      {:else}
        <ul class="log">
          {#each data.log as e (e.id)}
            <li><span class="when micro">{clock(e.at)}</span><span>{actor(e.actor)}: {logText(e)}</span></li>
          {/each}
        </ul>
        {#if !data.log.length}<p class="muted">{t('admin.none')}</p>{/if}
      {/if}
    {:else}
      <p class="muted">{t('status.connecting')}</p>
    {/if}
  {/if}
</main>

<style>
  .top {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-bottom: 18px;
  }
  .title {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 8px;
    margin: 0;
    font-size: 1.05rem;
    font-weight: 650;
    color: var(--alert);
  }
  .title span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .card h2 {
    margin-bottom: 10px;
  }
  .promoted {
    border: 2px solid var(--alert);
  }
  .or {
    text-align: center;
    margin: 14px 0;
  }
  .err {
    margin: 12px 0 0;
  }
  .who {
    display: flex;
    align-items: center;
    gap: 6px;
    margin: -8px 0 14px;
  }
  .who .micro {
    flex: 1;
    min-width: 0;
    text-transform: none;
    letter-spacing: 0.04em;
    overflow-wrap: anywhere;
  }
  .who .btn {
    flex: none;
  }
  .reauth {
    border: 2px solid var(--dusk);
  }
  .reauth-form {
    margin-top: 14px;
  }
  .cancel {
    margin-top: 10px;
  }
  .tabs {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    align-items: center;
    margin-bottom: 14px;
  }
  .tabs .n {
    opacity: 0.7;
  }
  .filter {
    margin-bottom: 12px;
  }
  .rows {
    list-style: none;
    padding: 0;
    margin: 0;
    display: grid;
    gap: 10px;
  }
  .rowcard {
    background: var(--surface);
    border: 1px solid var(--line);
    border-radius: 14px;
    padding: 12px 14px;
    min-width: 0;
  }
  .rowcard.gone {
    opacity: 0.65;
  }
  .main-line {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 4px 10px;
  }
  .name {
    font-weight: 600;
    overflow-wrap: anywhere;
    min-width: 0;
  }
  .sid {
    font-size: 0.82rem;
    color: var(--muted);
    letter-spacing: 0.06em;
  }
  .facts {
    margin: 6px 0 0;
    font-size: 0.9rem;
    color: var(--muted);
    overflow-wrap: anywhere;
  }
  .key-line {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
  }
  .dates {
    margin: 4px 0 0;
    text-transform: none;
    letter-spacing: 0.02em;
  }
  .actions {
    margin-top: 10px;
  }
  .badge {
    display: inline-block;
    font-family: var(--mono);
    font-size: 0.7rem;
    letter-spacing: 0.04em;
    background: var(--alert);
    color: var(--on-alert);
    border-radius: 999px;
    padding: 1px 8px;
  }
  .badge.pending {
    background: var(--sun);
    color: var(--on-sun);
  }
  .promote {
    margin-bottom: 14px;
  }
  .promote .input {
    flex: 1;
    min-width: 0;
  }
  .promote .btn {
    flex: none;
  }
  .log {
    list-style: none;
    padding: 0;
    margin: 0 0 12px;
  }
  .log li {
    display: flex;
    gap: 10px;
    padding: 7px 0;
    border-top: 1px solid var(--line);
    font-size: 0.9rem;
    overflow-wrap: anywhere;
  }
  .log li:first-child {
    border-top: 0;
  }
  .when {
    flex: none;
    min-width: 92px;
    text-transform: none;
    letter-spacing: 0.02em;
    padding-top: 2px;
  }
  .alerts {
    border: 2px solid var(--alert);
  }
</style>
