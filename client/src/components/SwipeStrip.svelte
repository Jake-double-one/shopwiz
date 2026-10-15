<script>
  // What a swipe does, shown in the space the row leaves behind (see lib/swipe.js).
  import Icon from './Icon.svelte';

  let { dx, action, armed, label = '' } = $props();
</script>

<span class="swipe-strip {action ?? 'none'}" class:armed class:from-left={dx > 0} style:width={`${Math.abs(dx)}px`} aria-hidden="true">
  {#if action}
    <Icon name={action === 'check' ? 'check' : action === 'park' ? 'down' : 'plus'} size={18} />
    {#if Math.abs(dx) > 70}<span class="strip-label">{label}</span>{/if}
  {/if}
</span>

<style>
  .swipe-strip {
    position: absolute;
    top: 0;
    bottom: 0;
    right: 0;
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 6px;
    padding: 0 14px;
    overflow: hidden;
    white-space: nowrap;
    font-family: var(--mono);
    font-size: 0.68rem;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    font-weight: 600;
    color: var(--muted);
    background: var(--surface-2);
    transition: background 0.12s ease, color 0.12s ease;
  }
  .swipe-strip.from-left {
    right: auto;
    left: 0;
    justify-content: flex-start;
  }
  .swipe-strip.check.armed {
    background: var(--dusk);
    color: var(--on-dusk);
  }
  .swipe-strip.park.armed,
  .swipe-strip.unpark.armed {
    background: var(--sun);
    color: var(--on-sun);
  }
</style>
