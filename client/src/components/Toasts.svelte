<script>
  import { toasts, dismiss } from '../lib/toast.svelte.js';
</script>

<div class="toasts" aria-live="polite">
  {#each toasts as tst (tst.id)}
    <div class="toast" class:alert={tst.kind === 'alert'}>
      <span class="text">{tst.text}</span>
      {#if tst.action}
        <button
          class="act"
          onclick={() => {
            tst.action.run();
            dismiss(tst.id);
          }}>{tst.action.label}</button>
      {/if}
      <button class="x" onclick={() => dismiss(tst.id)} aria-label="×">×</button>
    </div>
  {/each}
</div>

<style>
  .toasts {
    position: fixed;
    left: 50%;
    transform: translateX(-50%);
    bottom: calc(var(--bar-h) + 18px + env(safe-area-inset-bottom) + var(--kb, 0px));
    z-index: 60;
    display: flex;
    flex-direction: column;
    gap: 8px;
    width: min(520px, calc(100vw - 32px));
    pointer-events: none;
  }
  /* while a dialog is open its buttons are at the bottom – show messages at the top instead */
  :global(body.sheet-open) .toasts {
    bottom: auto;
    top: calc(12px + env(safe-area-inset-top));
  }
  .toast {
    pointer-events: auto;
    display: flex;
    align-items: center;
    gap: 12px;
    background: var(--ink);
    color: var(--bg);
    border-radius: 12px;
    padding: 10px 8px 10px 14px;
    box-shadow: var(--shadow);
    font-size: 0.92rem;
    animation: in 0.18s ease;
  }
  .toast.alert {
    border-left: 4px solid var(--alert);
  }
  .text {
    flex: 1;
    min-width: 0;
  }
  .act {
    background: none;
    border: 0;
    color: var(--sun);
    font-family: var(--mono);
    font-size: 0.78rem;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    font-weight: 600;
    padding: 6px 8px;
  }
  .x {
    background: none;
    border: 0;
    color: inherit;
    opacity: 0.6;
    font-size: 1.2rem;
    padding: 2px 8px;
  }
  @keyframes in {
    from {
      transform: translateY(10px);
      opacity: 0;
    }
  }
</style>
