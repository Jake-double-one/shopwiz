<script>
  import { onMount } from 'svelte';
  import Start from './components/Start.svelte';
  import SpaceView from './components/SpaceView.svelte';
  import Toasts from './components/Toasts.svelte';
  import NamePrompt from './components/NamePrompt.svelte';
  import AdminView from './components/AdminView.svelte';
  import { adminSession } from './lib/admin.svelte.js';
  import { parseSpaceId } from '../../shared/ids.js';
  import { currentSpace, deviceName, clearCurrent } from './lib/device.js';
  import { sync } from './lib/sync.svelte.js';
  import { takeShare, takeAddShortcut } from './lib/share.svelte.js';

  function fromPath() {
    const seg = location.pathname.replace(/^\/+|\/+$/g, '');
    return seg && !seg.includes('/') ? parseSpaceId(seg) : null;
  }

  let spaceId = $state(null);
  let needName = $state(false);
  let pendingId = null;
  // the administration (/admin) and an ID opened from it: { id, token } – the URL stays /admin,
  // so reloading never opens that ID as this device
  let adminView = $state(false);
  let adminSpace = $state(null);

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

  function openAdmin() {
    sync.close();
    spaceId = null;
    adminSpace = null;
    adminView = true;
    if (location.pathname !== '/admin') history.pushState(null, '', '/admin');
  }
  function exitAdmin() {
    sync.close();
    adminSpace = null;
    adminView = false;
    show(currentSpace());
  }
  function openAdminSpace(id) {
    if (!adminSession.token) return;
    adminSpace = { id, token: adminSession.token };
    history.pushState({ adminSpace: id }, '', '/admin');
  }
  function leaveAdminSpace() {
    sync.close();
    adminSpace = null;
    if (history.state?.adminSpace) history.replaceState(null, '', '/admin');
  }

  onMount(() => {
    if (location.pathname === '/admin') {
      adminView = true;
      history.replaceState(null, '', '/admin');
    } else {
      // shared from another app: it goes to the list that was open last
      const initial = takeShare() || takeAddShortcut() ? currentSpace() : (fromPath() ?? currentSpace());
      show(initial, { replace: true });
    }
    const onPop = () => {
      if (location.pathname === '/admin') {
        const id = history.state?.adminSpace ?? null;
        if (id !== (adminSpace?.id ?? null)) {
          sync.close();
          adminSpace = id && adminSession.token ? { id, token: adminSession.token } : null;
        }
        if (!adminView) {
          sync.close();
          spaceId = null;
          adminView = true;
        }
        return;
      }
      if (adminView) {
        sync.close();
        adminView = false;
        adminSpace = null;
      }
      const id = fromPath();
      if (id !== spaceId) {
        if (!id) sync.close();
        show(id, { replace: true });
      }
    };
    window.addEventListener('popstate', onPop);
    const off = sync.on((type, d) => {
      if (type === 'moved' && adminView) {
        // renewed while an admin looks at it: follow, but the address stays /admin
        if (adminSpace) adminSpace = { ...adminSpace, id: d.to };
      } else if (type === 'moved') {
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

{#if adminView}
  {#if adminSpace}
    {#key adminSpace}
      <SpaceView id={adminSpace.id} admin={adminSpace.token} onleave={leaveAdminSpace} onopen={null} />
    {/key}
  {:else}
    <AdminView onopenspace={openAdminSpace} onexit={exitAdmin} />
  {/if}
{:else if needName}
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

{#if adminView}
  <!-- the administration is shown above -->
{:else if spaceId}
  {#key spaceId}
    <SpaceView id={spaceId} onleave={leave} onopen={(id) => show(id)} onadmin={openAdmin} />
  {/key}
{:else if !needName}
  <Start onopen={(id) => show(id)} />
{/if}

<Toasts />
