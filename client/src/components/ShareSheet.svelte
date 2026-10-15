<script>
  import { onMount } from 'svelte';
  import QRCode from 'qrcode';
  import Sheet from './Sheet.svelte';
  import Icon from './Icon.svelte';
  import { t } from '../lib/i18n.svelte.js';
  import { toast } from '../lib/toast.svelte.js';
  import { formatSpaceId } from '../../../shared/ids.js';
  import { shareListText } from '../lib/actions.js';

  /** list: the list on screen – can be sent as plain text, too */
  let { space, spaceId, list = null, onclose } = $props();
  const url = $derived(`${location.origin}/${spaceId}`);
  let svg = $state('');
  const canShare = typeof navigator !== 'undefined' && !!navigator.share && window.isSecureContext;

  onMount(async () => {
    svg = await QRCode.toString(url, { type: 'svg', margin: 1, errorCorrectionLevel: 'M', color: { dark: '#16211B', light: '#FBFCF9' } });
  });

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
  <section class="as-text">
    <p class="eyebrow">{t('recommend.title')}</p>
    <p class="note">{t('recommend.note')}</p>
    <button class="btn block" onclick={recommend}><Icon name="send" />{t('recommend.button')}</button>
  </section>
</Sheet>

<style>
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
