<script>
  import { onMount } from 'svelte';
  import QRCode from 'qrcode';
  import Sheet from './Sheet.svelte';
  import Icon from './Icon.svelte';
  import { t } from '../lib/i18n.svelte.js';
  import { toast } from '../lib/toast.svelte.js';
  import { formatSpaceId } from '../../../shared/ids.js';
  import { shareListText } from '../lib/actions.js';
  import { api } from '../lib/api.js';
  import { sync } from '../lib/sync.svelte.js';

  /** list: the list on screen – can be sent as plain text, too */
  let { space, spaceId, list = null, onclose } = $props();
  const url = $derived(`${location.origin}/${spaceId}`);
  let svg = $state('');
  const canShare = typeof navigator !== 'undefined' && !!navigator.share && window.isSecureContext;

  // invitations (REGISTRATIONS=invite, or an admin in "off"): the server says whether this device may
  // issue codes, and lists its open ones – an admin opening the ID has no device and sees nothing here
  const registrations = $derived(sync.features.registrations ?? 'open');
  let inviting = $state(null); // { mayInvite, invites: [{ code, expiresAt }] }
  let inviteBusy = $state(false);
  onMount(async () => {
    svg = await QRCode.toString(url, { type: 'svg', margin: 1, errorCorrectionLevel: 'M', color: { dark: '#16211B', light: '#FBFCF9' } });
    if (registrations !== 'open' && !sync.admin) api.invites(spaceId).then((r) => (inviting = r)).catch(() => {});
  });
  const daysLeft = (ts) => Math.max(1, Math.ceil((ts - Date.now()) / 86_400_000));
  async function shareInvite(code) {
    const text = t('invite.text', { code });
    const link = `${location.origin}/?invite=${code}`;
    if (canShare) {
      try {
        await navigator.share({ title: 'ShopWiz', text, url: link });
      } catch {
        /* cancelled */
      }
    } else copy(`${text} ${link}`, t('invite.copied'));
  }
  async function newInvite() {
    inviteBusy = true;
    try {
      const inv = await api.invite(spaceId);
      inviting = { ...inviting, invites: [...inviting.invites, inv] };
      await shareInvite(inv.code);
    } catch (e) {
      toast({ text: e.code === 'limit' ? t('invite.limit') : t('settings.failed'), kind: 'alert' });
    } finally {
      inviteBusy = false;
    }
  }
  async function revoke(code) {
    try {
      await api.revokeInvite(spaceId, code);
      inviting = { ...inviting, invites: inviting.invites.filter((i) => i.code !== code) };
    } catch {
      toast({ text: t('settings.failed'), kind: 'alert' });
    }
  }

  async function copy(text, msg) {
    try {
      await navigator.clipboard.writeText(text);
      toast(msg);
    } catch {
      window.prompt(t('share.copyManual'), text);
    }
  }

  // recommend ShopWiz itself: the start page, never the ID; one of a few lines, picked at random
  async function recommend() {
    const lines = t('recommend.lines').split('\n');
    const text = lines[Math.floor(Math.random() * lines.length)];
    const home = `${location.origin}/`;
    if (canShare) {
      try {
        await navigator.share({ title: 'ShopWiz', text, url: home });
      } catch {
        /* cancelled */
      }
    } else copy(`${text} ${home}`, t('recommend.copied'));
  }

  async function share() {
    try {
      await navigator.share({ title: `${space.name} · ShopWiz`, text: t('share.text', { name: space.name }), url });
    } catch {
      /* cancelled */
    }
  }
</script>

<Sheet title={t('share.title')} eyebrow={space.name} {onclose}>
  <div class="qr" aria-label={t('share.qr')} role="img">{@html svg}</div>
  <p class="id mono">{formatSpaceId(spaceId)}</p>
  <p class="note center">{t('share.note')}</p>
  <div class="actions">
    {#if canShare}
      <button class="btn main block" onclick={share}><Icon name="share" />{t('share.button')}</button>
    {/if}
    <button class="btn block" class:main={!canShare} onclick={() => copy(url, t('share.linkCopied'))}><Icon name="copy" />{t('share.copyLink')}</button>
    <button class="btn block" onclick={() => copy(formatSpaceId(spaceId), t('share.idCopied'))}><Icon name="key" />{t('share.copyId')}</button>
  </div>
  <p class="micro center warn">{t('share.warning')}</p>
  {#if list}
    <section class="as-text">
      <p class="eyebrow">{t('shareText.title')}</p>
      <p class="note">{t('shareText.note')}</p>
      <button class="btn block" onclick={() => shareListText(list)}><Icon name="list" />{t('shareText.button')}</button>
    </section>
  {/if}
  {#if registrations === 'open'}
    <section class="as-text">
      <p class="eyebrow">{t('recommend.title')}</p>
      <p class="note">{t('recommend.note')}</p>
      <button class="btn block" onclick={recommend}><Icon name="send" />{t('recommend.button')}</button>
    </section>
  {:else if inviting?.mayInvite}
    <section class="as-text">
      <p class="eyebrow">{t('invite.title')}</p>
      <p class="note">{t('invite.note')}</p>
      <button class="btn block" onclick={newInvite} disabled={inviteBusy || inviting.invites.length >= 5}><Icon name="send" />{t('invite.button')}</button>
      {#if inviting.invites.length}
        <ul class="invites">
          {#each inviting.invites as inv (inv.code)}
            <li>
              <span class="code mono">{inv.code}</span>
              <span class="micro grow">{t('invite.expires', { count: daysLeft(inv.expiresAt) })}</span>
              <button class="icon-btn" onclick={() => shareInvite(inv.code)} aria-label={t('invite.share')} title={t('invite.share')}><Icon name="share" size={18} /></button>
              <button class="icon-btn" onclick={() => revoke(inv.code)} aria-label={t('invite.revoke')} title={t('invite.revoke')}><Icon name="x" size={18} /></button>
            </li>
          {/each}
        </ul>
        <p class="micro">{t('invite.open', { count: inviting.invites.length })}</p>
      {/if}
    </section>
  {/if}
</Sheet>

<style>
  .invites {
    list-style: none;
    margin: 12px 0 4px;
    padding: 0;
    display: grid;
    gap: 6px;
  }
  .invites li {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .invites .code {
    font-weight: 600;
    letter-spacing: 0.06em;
    user-select: all;
  }
  .invites .grow {
    flex: 1;
  }
  .qr {
    width: min(260px, 70vw);
    margin: 0 auto;
    border-radius: 18px;
    overflow: hidden;
    border: 1px solid var(--line);
    background: #fbfcf9;
    aspect-ratio: 1;
  }
  .qr :global(svg) {
    width: 100%;
    height: 100%;
    display: block;
  }
  .id {
    text-align: center;
    font-size: 1.6rem;
    font-weight: 600;
    letter-spacing: 0.08em;
    margin: 14px 0 4px;
    user-select: all;
  }
  .center {
    text-align: center;
  }
  .actions {
    display: grid;
    gap: 8px;
    margin: 12px 0;
  }
  .as-text {
    margin-top: 18px;
    padding-top: 16px;
    border-top: 1px solid var(--line);
  }
  .warn {
    text-transform: none;
    letter-spacing: 0.02em;
  }
</style>
