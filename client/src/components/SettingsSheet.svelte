<script>
  import { untrack } from 'svelte';
  import Sheet from './Sheet.svelte';
  import Icon from './Icon.svelte';
  import Prefs from './Prefs.svelte';
  import PrioIcon from './PrioIcon.svelte';
  import AiSection from './AiSection.svelte';
  import { PRIO_STYLES, setPrioStyle } from '../lib/theme.js';
  import { load } from '../lib/storage.js';
  import { prefs, setSwipe, SWIPE_MODES, setLinkDefault } from '../lib/prefs.svelte.js';
  import { t } from '../lib/i18n.svelte.js';
  import { updateSpace, renameDevice } from '../lib/actions.js';
  import { api } from '../lib/api.js';
  import { sync } from '../lib/sync.svelte.js';
  import { toast } from '../lib/toast.svelte.js';
  import { knownSpaces, forgetSpace } from '../lib/device.js';
  import { formatSpaceId } from '../../../shared/ids.js';

  let { space, spaceId, onclose, onleave, onopen, onshare, onbackup } = $props();

  let name = $state(untrack(() => space.name));
  let ttl = $state(untrack(() => space.ttlDays));
  let myName = $state(untrack(() => sync.me?.name ?? ''));
  let confirm = $state(null); // 'renew' | 'delete' | 'delete2' | 'forget'
  let typed = $state('');
  let busy = $state(false);
  let showId = $state(false);
  let prioStyle = $state(load('prioStyle', 'box'));
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

  function forget() {
    forgetSpace(spaceId);
    onleave();
  }
</script>

<Sheet title={t('settings.title')} eyebrow={space.name} {onclose}>
  <section>
    <label class="field">
      <span>{t('settings.spaceName')}</span>
      <input data-1p-ignore data-lpignore="true" data-bwignore data-form-type="other" spellcheck="false" autocomplete="off" class="input" bind:value={name} onblur={saveName} onkeydown={(e) => e.key === 'Enter' && saveName()} maxlength="80" />
    </label>
    <label class="field">
      <span>{t('settings.ttl')}</span>
      <div class="row">
        <input data-1p-ignore data-lpignore="true" data-bwignore data-form-type="other" spellcheck="false" autocomplete="off" class="input mono ttl" type="number" min="7" max="367" bind:value={ttl} onblur={saveTtl} onkeydown={(e) => e.key === 'Enter' && saveTtl()} />
        <span class="muted">{t('settings.days')}</span>
      </div>
    </label>
    <p class="note">{t('settings.ttlHint', { days: space.ttlDays })}</p>
  </section>

  <section>
    <p class="eyebrow">{t('settings.device')}</p>
    <label class="field">
      <span>{t('people.yourName')}</span>
      <input data-1p-ignore data-lpignore="true" data-bwignore data-form-type="other" spellcheck="false" class="input" bind:value={myName} onblur={saveMyName} onkeydown={(e) => e.key === 'Enter' && saveMyName()} maxlength="40" autocomplete="nickname" />
    </label>
    <Prefs />
    <div class="prio-style">
      <span class="ps-label" id="prio-style-label">{t('prio.style')}</span>
      <div class="ps-tiles" role="radiogroup" aria-labelledby="prio-style-label">
        {#each PRIO_STYLES as s (s)}
          <button
            type="button"
            role="radio"
            aria-checked={prioStyle === s}
            aria-label={t(`prio.style.${s}`)}
            title={t(`prio.style.${s}`)}
            class="ps-tile {s}"
            onclick={() => (prioStyle = setPrioStyle(s))}>
            <span class="ps-preview" aria-hidden="true">
              <span class="ps-box">
                {#if s === 'box'}<PrioIcon prio={1} size={12} />{/if}
                {#if s === 'badge'}<span class="ps-badge"><PrioIcon prio={1} size={9} /></span>{/if}
              </span>
              {#if s === 'gap'}<span class="ps-gap"><PrioIcon prio={1} size={11} /></span>{/if}
              <span class="ps-name">{t('prio.sample')}</span>
            </span>
          </button>
        {/each}
      </div>
    </div>
    <div class="prio-style">
      <span class="ps-label" id="swipe-label">{t('swipe.setting')}</span>
      <div class="ps-tiles" role="radiogroup" aria-labelledby="swipe-label">
        {#each SWIPE_MODES as m (m)}
          <button
            type="button"
            role="radio"
            aria-checked={prefs.swipe === m}
            aria-label={t(`swipe.mode.${m}`)}
            title={t(`swipe.mode.${m}`)}
            class="ps-tile sw-tile"
            onclick={() => setSwipe(m)}>
            {#if m === 'off'}
              <span class="sw-off" aria-hidden="true">{t('swipe.off')}</span>
            {:else}
              <span class="sw-preview" aria-hidden="true">
                <span class="sw-side {m === 'left' ? 'check' : 'park'}"><span class="sw-arrow">←</span><Icon name={m === 'left' ? 'check' : 'down'} size={14} /></span>
                <span class="sw-side {m === 'right' ? 'check' : 'park'}"><Icon name={m === 'right' ? 'check' : 'down'} size={14} /><span class="sw-arrow">→</span></span>
              </span>
              <span class="sw-caption" aria-hidden="true">
                <span>{t(m === 'left' ? 'swipe.check' : 'swipe.park')}</span><span>{t(m === 'right' ? 'swipe.check' : 'swipe.park')}</span>
              </span>
            {/if}
          </button>
        {/each}
      </div>
    </div>
    <div class="prio-style link-default">
      <span class="ps-label" id="link-default-label">{t('link.defaultSetting')}</span>
      <div role="radiogroup" aria-labelledby="link-default-label">
        <label><input type="radio" name="link-default" checked={prefs.linkDefault !== 'here'} onchange={() => setLinkDefault('all')} /><span>{t('link.defaultAll')}</span></label>
        <label><input type="radio" name="link-default" checked={prefs.linkDefault === 'here'} onchange={() => setLinkDefault('here')} /><span>{t('link.defaultHere')}</span></label>
      </div>
    </div>
  </section>

  <section>
    <p class="eyebrow">{t('settings.idTitle')}</p>
    <div class="id-row">
      <button type="button" class="id-chip mono" onclick={copyId} title={t('share.copyId')} aria-label={t('share.copyId')}>
        <span class:masked={!showId}>{showId ? formatSpaceId(spaceId) : '••••-••••-••'}</span>
        <Icon name="copy" />
      </button>
      <button type="button" class="btn" onclick={() => (showId = !showId)} aria-pressed={showId} aria-label={t(showId ? 'start.hideId' : 'start.showId')} title={t(showId ? 'start.hideId' : 'start.showId')}>
        <Icon name={showId ? 'eyeOff' : 'eye'} />
      </button>
    </div>
  </section>

  {#if sync.features.ai}
    <section><AiSection v={sync.data} {spaceId} /></section>
  {/if}

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
        <input data-1p-ignore data-lpignore="true" data-bwignore data-form-type="other" spellcheck="false" class="input" bind:value={typed} autocomplete="off" />
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
  .link-default label {
    display: flex;
    gap: 10px;
    align-items: center;
    padding: 4px 0;
  }
  .link-default input {
    accent-color: var(--ok);
  }
  section + section {
    margin-top: 18px;
    padding-top: 16px;
    border-top: 1px solid var(--line);
  }
  .prio-style {
    margin: 14px 0 0;
  }
  .ps-label {
    display: block;
    font-family: var(--mono);
    font-size: 0.68rem;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--muted);
    margin-bottom: 6px;
  }
  .ps-tiles {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 8px;
  }
  /* a tiny list row with an important item, in the current light/dark colors */
  .ps-tile {
    display: grid;
    place-items: center;
    min-height: 54px;
    padding: 8px 6px;
    border: 1px solid var(--line);
    border-radius: 12px;
    background: var(--surface);
    color: var(--ink);
  }
  .ps-tile[aria-checked='true'] {
    border-color: var(--dusk);
    box-shadow: 0 0 0 1px var(--dusk);
    background: color-mix(in srgb, var(--sun-soft) 45%, var(--surface));
  }
  .ps-preview {
    position: relative;
    display: flex;
    align-items: center;
    gap: 9px;
  }
  .ps-box {
    position: relative;
    display: grid;
    place-items: center;
    width: 20px;
    height: 20px;
    border-radius: 6px;
    border: 2px solid var(--control);
    color: var(--sun);
    flex: none;
  }
  .box .ps-box {
    border-color: var(--sun);
  }
  .ps-badge {
    position: absolute;
    top: -8px;
    right: -8px;
    display: grid;
    place-items: center;
    width: 13px;
    height: 13px;
    border-radius: 50%;
    background: var(--surface);
    box-shadow: 0 0 0 1px var(--line);
    color: var(--sun);
  }
  .ps-gap {
    display: grid;
    margin: 0 -5px 0 -6px;
    color: var(--sun);
  }
  .ps-name {
    font-weight: 650;
    font-size: 0.9rem;
  }
  .sw-tile {
    gap: 4px;
  }
  .sw-preview {
    display: flex;
    gap: 4px;
  }
  .sw-side {
    display: inline-flex;
    align-items: center;
    gap: 2px;
    padding: 2px 6px;
    border-radius: 7px;
    font-weight: 700;
  }
  .sw-side.check {
    background: var(--dusk);
    color: var(--on-dusk);
  }
  .sw-side.park {
    background: var(--sun);
    color: var(--on-sun);
  }
  .sw-caption {
    display: flex;
    justify-content: space-between;
    gap: 6px;
    width: 100%;
    font-family: var(--mono);
    font-size: 0.56rem;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--muted);
  }
  .sw-off {
    font-family: var(--mono);
    font-size: 0.72rem;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--muted);
  }
  .ttl {
    max-width: 120px;
  }
  .list {
    display: grid;
    gap: 8px;
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
