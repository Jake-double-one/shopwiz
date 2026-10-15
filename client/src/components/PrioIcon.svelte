<script>
  /** Arrow for important (prio 1, up) / not important (prio -1, down) */
  let { prio, size = 12 } = $props();
</script>

<svg viewBox="0 0 12 12" width={size} height={size} aria-hidden="true"
  ><path
    d={prio > 0 ? 'M6 2.2v7.6M2.6 5.4 6 2l3.4 3.4' : 'M6 2.2v7.6M2.6 6.6 6 10l3.4-3.4'}
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round" /></svg>
