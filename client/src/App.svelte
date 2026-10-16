<script>
  import { onMount } from 'svelte';
  import Start from './components/Start.svelte';
  import SpaceView from './components/SpaceView.svelte';
  import Toasts from './components/Toasts.svelte';
  import NamePrompt from './components/NamePrompt.svelte';
  import { parseSpaceId } from '../../shared/ids.js';
  import { currentSpace, deviceName, clearCurrent } from './lib/device.js';
  import { sync } from './lib/sync.svelte.js';
  import { takeShare } from './lib/share.svelte.js';

  function fromPath() {
    const seg = location.pathname.replace(/^\/+|\/+$/g, '');
    return seg && !seg.includes('/') ? parseSpaceId(seg) : null;
  }

  let spaceId = $state(null);
  let needName = $state(false);
  let pendingId = null;

  function show(id, { replace = false } = {}) {
    const url = id ? `/${id}` : '/';
    if (location.pathname !== url) history[replace ? 'replaceState' : 'pushState'](null, '', url);
    if (id && !deviceName()) {
      pendingId = id;
      needName = true;
      spaceId = null;
      return;
    }
    spaceId = id;
  }

  function leave() {
    clearCurrent();
    sync.close();
    show(null);
  }

  onMount(() => {
    // shared from another app: it goes to the list that was open last
    const initial = takeShare() ? currentSpace() : (fromPath() ?? currentSpace());
    show(initial, { replace: true });
    const onPop = () => {
      const id = fromPath();
      if (id !== spaceId) {
        if (!id) sync.close();
        show(id, { replace: true });
      }
    };
    window.addEventListener('popstate', onPop);
    const off = sync.on((type, d) => {
      if (type === 'moved') {
        spaceId = d.to;
        history.replaceState(null, '', `/${d.to}`);
      }
    });
    return () => {
      window.removeEventListener('popstate', onPop);
      off();
    };
  });
</script>

{#if needName}
  <NamePrompt
    ondone={() => {
      needName = false;
      show(pendingId, { replace: true });
    }}
    oncancel={() => {
      needName = false;
      show(null, { replace: true });
    }} />
{/if}

{#if spaceId}
  {#key spaceId}
    <SpaceView id={spaceId} onleave={leave} onopen={(id) => show(id)} />
  {/key}
{:else if !needName}
  <Start onopen={(id) => show(id)} />
{/if}

<Toasts />
