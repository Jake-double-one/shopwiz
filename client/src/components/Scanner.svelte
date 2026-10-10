<script>
  import { onMount } from 'svelte';
  import Sheet from './Sheet.svelte';
  import { t } from '../lib/i18n.svelte.js';
  import { parseSpaceId } from '../../../shared/ids.js';

  let { onresult, onclose } = $props();
  let video = $state();
  let error = $state('');
  let hint = $state('');

  onMount(() => {
    let stream;
    let stopped = false;
    let raf;
    let detector = null;
    let jsQR = null;
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });

    async function start() {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
      } catch {
        error = t('scan.denied');
        return;
      }
      if (stopped) return stream.getTracks().forEach((tr) => tr.stop());
      video.srcObject = stream;
      await video.play().catch(() => {});
      if ('BarcodeDetector' in window) {
        try {
          const formats = await window.BarcodeDetector.getSupportedFormats();
          if (formats.includes('qr_code')) detector = new window.BarcodeDetector({ formats: ['qr_code'] });
        } catch {
          detector = null;
        }
      }
      if (!detector) jsQR = (await import('jsqr')).default;
      tick();
    }

    async function tick() {
      if (stopped) return;
      if (video.readyState >= 2) {
        let text = null;
        try {
          if (detector) {
            const codes = await detector.detect(video);
            text = codes[0]?.rawValue ?? null;
          } else {
            const w = video.videoWidth;
            const h = video.videoHeight;
            const scale = Math.min(1, 640 / Math.max(w, h));
            canvas.width = Math.round(w * scale);
            canvas.height = Math.round(h * scale);
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
            const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
            text = jsQR(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' })?.data ?? null;
          }
        } catch {
          text = null;
        }
        if (text) {
          const id = parseSpaceId(text);
          if (id) {
            stopped = true;
            navigator.vibrate?.(60);
            onresult(id);
            return;
          }
          hint = t('scan.notShopwiz');
        }
      }
      raf = setTimeout(() => requestAnimationFrame(tick), 120);
    }

    start();
    return () => {
      stopped = true;
      clearTimeout(raf);
      stream?.getTracks().forEach((tr) => tr.stop());
    };
  });
</script>

<Sheet title={t('scan.title')} {onclose}>
  {#if error}
    <p class="hint alert">{error}</p>
  {:else}
    <div class="frame">
      <!-- svelte-ignore a11y_media_has_caption -->
      <video bind:this={video} playsinline muted></video>
      <div class="target"></div>
    </div>
    <p class="note center">{hint || t('scan.note')}</p>
  {/if}
</Sheet>

<style>
  .frame {
    position: relative;
    border-radius: 18px;
    overflow: hidden;
    background: #000;
    aspect-ratio: 1;
    max-height: 60dvh;
    margin: 0 auto 12px;
  }
  video {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }
  .target {
    position: absolute;
    inset: 18%;
    border: 3px solid var(--sun);
    border-radius: 18px;
    box-shadow: 0 0 0 999px rgba(0, 0, 0, 0.35);
  }
  .center {
    text-align: center;
  }
</style>
