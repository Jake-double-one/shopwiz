<script>
  import { onMount } from 'svelte';
  import Icon from './Icon.svelte';
  import { t } from '../lib/i18n.svelte.js';

  let { title, eyebrow = '', onclose, children, wide = false } = $props();
  let panel;
  let previous;

  onMount(() => {
    previous = document.activeElement;
    const first = panel.querySelector('[autofocus]') ?? panel.querySelector('input, select, textarea, button:not(.close)');
    (first ?? panel).focus({ preventScroll: true });
    document.body.style.overflow = 'hidden';
    // when the keyboard opens, keep the focused field visible
    const vv = window.visualViewport;
    const keepVisible = () => {
      const el = document.activeElement;
      if (el && panel.contains(el) && /INPUT|TEXTAREA|SELECT/.test(el.tagName)) el.scrollIntoView({ block: 'nearest' });
    };
    vv?.addEventListener('resize', keepVisible);
    // everything behind the dialog is unreachable for keyboard and screen readers (toasts stay usable)
    const root = document.getElementById('app');
    const overlay = panel.parentElement;
    const hidden = [...(root?.children ?? [])].filter((el) => el !== overlay && !el.contains(overlay) && !el.classList.contains('toasts') && !el.inert);
    for (const el of hidden) el.inert = true;
    return () => {
      vv?.removeEventListener('resize', keepVisible);
      for (const el of hidden) el.inert = false;
      document.body.style.overflow = '';
      previous?.focus?.({ preventScroll: true });
    };
  });

  function onkeydown(e) {
    if (e.key === 'Escape') {
      e.stopPropagation();
      onclose();
    }
    if (e.key === 'Tab') {
      const f = [...panel.querySelectorAll('button, input, select, textarea, a[href], [tabindex]:not([tabindex="-1"])')].filter((el) => !el.disabled && el.offsetParent !== null);
      if (!f.length) return;
      if (e.shiftKey && document.activeElement === f[0]) {
        e.preventDefault();
        f.at(-1).focus();
      } else if (!e.shiftKey && document.activeElement === f.at(-1)) {
        e.preventDefault();
        f[0].focus();
      }
    }
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="overlay" onmousedown={(e) => e.target === e.currentTarget && onclose()} {onkeydown}>
  <div class="panel" class:wide bind:this={panel} role="dialog" aria-modal="true" aria-label={title} tabindex="-1">
    <header>
      <div class="titles">
        {#if eyebrow}<p class="eyebrow">{eyebrow}</p>{/if}
        <h2>{title}</h2>
      </div>
      <button class="icon-btn close" onclick={onclose} aria-label={t('close')}><Icon name="x" /></button>
    </header>
    <div class="body">
      {@render children()}
    </div>
  </div>
</div>

<style>
  .overlay {
    position: fixed;
    /* keep the dialog above an on-screen keyboard (see --kb in main.js) */
    inset: 0 0 var(--kb, 0px) 0;
    z-index: 50;
    background: color-mix(in srgb, var(--ink) 35%, transparent);
    display: flex;
    align-items: flex-end;
    justify-content: center;
    animation: fade 0.15s ease;
  }
  .panel {
    background: var(--surface);
    width: 100%;
    max-width: 560px;
    max-height: min(760px, calc(100% - 16px));
    display: flex;
    flex-direction: column;
    border-radius: 22px 22px 0 0;
    border: 1px solid var(--line);
    box-shadow: var(--shadow);
    padding-bottom: env(safe-area-inset-bottom);
    animation: up 0.18s ease;
    outline: none;
  }
  .panel.wide {
    max-width: 680px;
  }
  header {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    padding: 18px 16px 6px 20px;
  }
  .titles {
    flex: 1;
    min-width: 0;
  }
  h2 {
    overflow-wrap: anywhere;
  }
  .body {
    padding: 8px 20px 22px;
    overflow-y: auto;
    overscroll-behavior: contain;
  }
  @media (min-width: 640px) {
    .overlay {
      align-items: center;
      padding: 24px;
    }
    .panel {
      border-radius: 22px;
    }
  }
  @keyframes fade {
    from {
      opacity: 0;
    }
  }
  @keyframes up {
    from {
      transform: translateY(24px);
      opacity: 0.6;
    }
  }
</style>
