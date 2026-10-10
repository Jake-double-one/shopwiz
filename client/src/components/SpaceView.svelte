<script>
  import { onMount, untrack } from 'svelte';
  import Icon from './Icon.svelte';
  import ListBody from './ListBody.svelte';
  import AddBar from './AddBar.svelte';
  import StatusScreen from './StatusScreen.svelte';
  import ListPicker from './ListPicker.svelte';
  import ListMenu from './ListMenu.svelte';
  import ItemSheet from './ItemSheet.svelte';
  import GroupSheet from './GroupSheet.svelte';
  import ShareSheet from './ShareSheet.svelte';
  import SettingsSheet from './SettingsSheet.svelte';
  import PeopleSheet from './PeopleSheet.svelte';
  import ConflictSheet from './ConflictSheet.svelte';
  import HistorySheet from './HistorySheet.svelte';
  import TransferSheet from './TransferSheet.svelte';
  import BackupSheet from './BackupSheet.svelte';
  import CallSheet from './CallSheet.svelte';
  import SignalCard from './SignalCard.svelte';
  import { spotPlace } from '../lib/signals.js';
  import { sync } from '../lib/sync.svelte.js';
  import { t, relTime } from '../lib/i18n.svelte.js';
  import { load, save } from '../lib/storage.js';
  import { sortedLists, progress, isShopping, listItems } from '../lib/model.js';
  import { setShopping, restoreItems, addList } from '../lib/actions.js';
  import { navUrl } from '../lib/nav.js';
  import { toast } from '../lib/toast.svelte.js';

  let { id, onleave, onopen } = $props();

  $effect(() => {
    if (sync.spaceId !== id) sync.open(id);
  });

  const v = $derived(sync.data);
  const lists = $derived(sortedLists(v));
  // SpaceView is re-mounted for every id (see App), so reading the initial id is fine
  let listId = $state(load(`list.${untrack(() => id)}`));
  const list = $derived((listId && v.lists[listId]) || lists[0] || null);
  $effect(() => {
    if (list && list.id !== listId) listId = list.id;
  });
  $effect(() => {
    if (listId) save(`list.${sync.spaceId ?? id}`, listId);
  });

  $effect(() => {
    document.title = list ? `${list.name} · ShopWiz` : 'ShopWiz';
    return () => (document.title = 'ShopWiz');
  });

  const prog = $derived(list ? progress(v, list.id) : { done: 0, total: 0 });
  const conflicts = $derived(list ? Object.values(v.conflicts).filter((c) => c.listId === list.id && v.items[c.itemId]) : []);
  const devices = $derived(Object.values(v.devices));
  const myDevId = $derived(sync.me?.devId);
  const shoppers = $derived(devices.filter((d) => isShopping(d) && d.devId !== myDevId));
  const myShopping = $derived(isShopping(v.devices[myDevId]));
  const mySpot = $derived(v.devices[myDevId]?.spot ?? null);

  // ----- signals to find each other in the shop (never stored) -----
  let signals = $state([]);
  const dismissSignal = (id) => (signals = signals.filter((s) => s.id !== id));
  const onlineCount = $derived(sync.online.length);

  // ----- shopping mode: highlight what others add while I'm in the shop -----
  let shoppingSince = $state(load(`shopSince.${untrack(() => id)}`, 0));
  const freshIds = $derived.by(() => {
    if (!myShopping || !list) return new Set();
    const myName = sync.me?.name;
    return new Set(listItems(v, list.id).filter((i) => !i.checked && !i.parked && i.createdAt > shoppingSince && i.addedBy !== myName).map((i) => i.id));
  });
  let lastFresh = 0;
  $effect(() => {
    const n = freshIds.size;
    if (n > lastFresh) navigator.vibrate?.([60, 40, 60]);
    lastFresh = n;
  });
  function toggleShopping() {
    if (!myShopping) {
      shoppingSince = sync.now();
      save(`shopSince.${id}`, shoppingSince);
    }
    setShopping(!myShopping);
  }
  $effect(() => {
    if (myShopping && prog.total > 0 && prog.done === prog.total) {
      setShopping(false);
      toast(t('shopping.allDone'));
    }
  });

  // ----- keep screen on (optional) -----
  const canWake = typeof navigator !== 'undefined' && 'wakeLock' in navigator;
  let screenOn = $state(false);
  let wakeLock = null;
  async function requestWake() {
    try {
      wakeLock = await navigator.wakeLock.request('screen');
      screenOn = true;
    } catch {
      screenOn = false;
      toast({ text: t('screen.failed'), kind: 'alert' });
    }
  }
  async function toggleScreen() {
    if (screenOn) {
      screenOn = false;
      await wakeLock?.release().catch(() => {});
      wakeLock = null;
    } else await requestWake();
  }

  // ----- sheets -----
  /** @type {null | {kind: string, [k: string]: any}} */
  let sheet = $state(null);
  const open = (kind, extra = {}) => (sheet = { kind, ...extra });
  const closeSheet = () => (sheet = null);

  // where the add bar puts new items (null = learned placement)
  let addTarget = $state(null);
  let addBar = $state();

  // ----- sync feedback -----
  let syncingCount = 0;
  onMount(() => {
    const off = sync.on((type, d) => {
      if (type === 'signal') {
        if (signals.some((s) => s.id === d.id)) return;
        signals = [d, ...signals].slice(0, 3);
        navigator.vibrate?.([150, 80, 150, 80, 150]);
        setTimeout(() => dismissSignal(d.id), 10 * 60_000);
        return;
      }
      if (type === 'welcome') {
        syncingCount = sync.pendingCount;
      } else if (type === 'ack') {
        const r = d.result ?? {};
        if (r.merged) toast(t('toast.merged', { name: v.items[r.merged]?.name ?? d.op.name }));
        if (r.conflicts) toast({ text: t('toast.conflict'), action: { label: t('conflict.review'), run: () => open('conflicts') } });
        if (r.rejected === 'deleted') {
          toast({ text: t('toast.editDeleted', { name: r.name }), timeout: 8000, action: { label: t('restore'), run: () => restoreItems([d.op.id]) } });
        }
        if (syncingCount && sync.pendingCount === 0) {
          toast(t('toast.synced', { count: syncingCount }));
          syncingCount = 0;
        }
      } else if (type === 'rejected') {
        if (d.error !== 'notfound') toast({ text: t('toast.rejected'), kind: 'alert' });
      } else if (type === 'moved' && d.live) {
        toast(t('toast.renewed'));
      }
    });
    const onVis = () => {
      // the browser drops the wake lock when the tab is hidden – take it again
      if (document.visibilityState === 'visible' && screenOn && (!wakeLock || wakeLock.released)) requestWake();
    };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      off();
      document.removeEventListener('visibilitychange', onVis);
      wakeLock?.release().catch(() => {});
    };
  });

  const statusLabel = $derived(
    sync.status === 'online'
      ? sync.pendingCount
        ? t('status.syncing')
        : t('status.online')
      : sync.status === 'connecting'
        ? t('status.connecting')
        : t('status.offline'),
  );
</script>

{#if ['notfound', 'deleted', 'kicked', 'limited'].includes(sync.status)}
  <StatusScreen status={sync.status} deleted={sync.deleted} spaceId={id} {onleave} {onopen} />
{:else if sync.ready && !list}
  <main class="wrap">
    <div class="loading">
      <div class="brand">Shop<span>·</span>Wiz</div>
      <p class="muted">{t('list.none')}</p>
      <button class="btn main" onclick={() => (listId = addList(v.space?.name || 'ShopWiz'))}>{t('lists.create')}</button>
    </div>
  </main>
{:else if !sync.ready}
  <main class="wrap">
    <div class="loading">
      <div class="brand">Shop<span>·</span>Wiz</div>
      <p class="muted">{sync.status === 'offline' ? t('status.offlineNoCache') : t('status.connecting')}</p>
      {#if sync.status === 'offline'}
        <button class="btn" onclick={onleave}>{t('back')}</button>
      {/if}
    </div>
  </main>
{:else}
  <main class="wrap">
    <header class="top">
      <button class="space" onclick={() => open('settings')} title={t('settings.title')}>
        <span class="brand">Shop<span>·</span>Wiz</span>
        <span class="space-name">{v.space?.name}</span>
      </button>
      <span class="status" title={statusLabel}>
        <span class="dot" class:on={sync.status === 'online' && !sync.pendingCount} class:warn={sync.status !== 'online' || sync.pendingCount}></span>
        <span class="sr-only">{statusLabel}</span>
      </span>
      <button class="icon-btn" onclick={() => open('share')} aria-label={t('share.title')} title={t('share.title')}><Icon name="share" /></button>
      <button class="icon-btn" onclick={() => open('settings')} aria-label={t('settings.title')} title={t('settings.title')}><Icon name="settings" /></button>
    </header>

    <section class="list-head">
      <div class="row title-row">
        <button class="list-title" onclick={() => open('lists')} aria-haspopup="dialog">
          <span class="name">{list.name}</span>
          <Icon name="down" size={22} />
        </button>
        {#if list.address}
          {@const href = navUrl(list.address)}
          <a
            class="nav-btn"
            {href}
            target={href.startsWith('http') ? '_blank' : undefined}
            rel="noopener noreferrer"
            title={`${t('list.navigate')}: ${list.address}`}
            aria-label={`${t('list.navigate')}: ${list.address}`}>
            <Icon name="nav" size={18} />
            <span class="nav-label">{t('list.navigate')}</span>
          </a>
        {/if}
        <button class="icon-btn" onclick={() => open('listMenu')} aria-label={t('list.menu')} title={t('list.menu')}><Icon name="more" /></button>
      </div>
      <div class="progress">
        <div class="rail-track" aria-hidden="true">
          <div class="rail-fill" style:width={prog.total ? `${(prog.done / prog.total) * 100}%` : '0%'}></div>
        </div>
        <span class="mono count">{prog.done} / {prog.total}</span>
      </div>

      <div class="row people-row">
        <button class="people" onclick={() => open('people')} aria-label={t('people.title')}>
          <Icon name="users" size={18} />
          {#each devices.slice(0, 4) as d (d.devId)}
            <span class="person" class:me={d.devId === myDevId} title={d.name}>
              <span class="dot" class:on={sync.online.includes(d.devId)}></span><span class="pname">{d.name}</span>
            </span>
          {/each}
          {#if devices.length > 4}<span class="person">+{devices.length - 4}</span>{/if}
        </button>
        <div class="toggles">
          {#if myShopping && shoppers.length}
            <button class="chip call" onclick={() => open('call')} title={t('call.title')} aria-label={t('call.title')}>
              <Icon name="nav" size={16} />
              <span class="label">{t('call.button')}</span>
            </button>
          {/if}
          <button class="chip main" aria-pressed={myShopping} onclick={toggleShopping} title={t('shopping.hint')}>
            <Icon name="cart" size={16} />
            <span class="label">{t('shopping.toggle')}</span>
          </button>
          {#if canWake}
            <button class="icon-btn" aria-pressed={screenOn} onclick={toggleScreen} aria-label={t('screen.toggle')} title={t('screen.toggle')}>
              <Icon name="screen" />
            </button>
          {/if}
        </div>
      </div>
    </section>

    {#if sync.status !== 'online'}
      <div class="hint">
        <Icon name="offline" size={18} />
        <span class="grow">
          {#if sync.pendingCount}{t('status.offlinePending', { count: sync.pendingCount })}{:else}{t('status.offlineHint')}{/if}
        </span>
      </div>
    {/if}
    {#each shoppers as s (s.devId)}
      <div class="hint dusk">
        <Icon name="cart" size={18} />
        <span class="grow">
          <b>{s.name}</b>
          {#if spotPlace(s.spot)}{t('shopping.isAt', { place: spotPlace(s.spot), when: relTime(s.spot.at) })}{:else}{t('shopping.isShopping')}{/if}
        </span>
      </div>
    {/each}
    {#if myShopping && freshIds.size}
      <div class="hint dusk"><Icon name="plus" size={18} /><span class="grow">{t('shopping.fresh', { count: freshIds.size })}</span></div>
    {/if}
    {#if conflicts.length}
      <div class="hint">
        <Icon name="alert" size={18} />
        <span class="grow">{t('conflict.banner', { count: conflicts.length })}</span>
        <button class="link" onclick={() => open('conflicts')}>{t('conflict.review')}</button>
      </div>
    {/if}

    {#if signals.length}
      <div class="signals">
        {#each signals as sig (sig.id)}
          <SignalCard {sig} {v} {list} {mySpot} ondismiss={() => dismissSignal(sig.id)} />
        {/each}
      </div>
    {/if}

    <ListBody
      {v}
      {list}
      {freshIds}
      onedit={(item) => open('item', { itemId: item.id })}
      ongroup={(group) => open('group', { groupId: group.id })}
      onaddto={(groupId) => {
        addTarget = groupId;
        addBar?.focus();
      }}
      onaddgroup={() => open('group', { create: true })} />
  </main>

  <AddBar bind:this={addBar} {v} {list} bind:target={addTarget} />

  {#if sheet?.kind === 'lists'}
    <ListPicker {v} current={list} onpick={(lid) => ((listId = lid), closeSheet())} onclose={closeSheet} />
  {:else if sheet?.kind === 'listMenu'}
    <ListMenu {v} {list} {lists} onclose={closeSheet} onopen={open} onswitch={(lid) => (listId = lid)} />
  {:else if sheet?.kind === 'item' && v.items[sheet.itemId]}
    <ItemSheet {v} {list} item={v.items[sheet.itemId]} onclose={closeSheet} ontransfer={(item) => open('transfer', { itemIds: [item.id], label: item.name })} />
  {:else if sheet?.kind === 'group'}
    <GroupSheet
      {v}
      {list}
      group={sheet.groupId ? v.groups[sheet.groupId] : null}
      parentId={sheet.parentId ?? null}
      onclose={closeSheet}
      onsub={(g) => open('group', { create: true, parentId: g.id })}
      ontransfer={(g) => open('transfer', { groupId: g.id, label: g.name })}
      oncreated={(gid, name) => {
        // a new group is empty, so it would sit in the inactive part – aim the input at it instead
        addTarget = gid;
        toast(t('toast.groupCreated', { name }));
        setTimeout(() => addBar?.focus(), 50);
      }} />
  {:else if sheet?.kind === 'share'}
    <ShareSheet space={v.space} spaceId={sync.spaceId} onclose={closeSheet} />
  {:else if sheet?.kind === 'settings'}
    <SettingsSheet space={v.space} spaceId={sync.spaceId} onclose={closeSheet} {onleave} {onopen} onshare={() => open('share')} onbackup={() => open('backup')} />
  {:else if sheet?.kind === 'people'}
    <PeopleSheet {devices} online={sync.online} me={sync.me} onclose={closeSheet} {onleave} />
  {:else if sheet?.kind === 'conflicts'}
    <ConflictSheet {v} {conflicts} onclose={closeSheet} />
  {:else if sheet?.kind === 'history'}
    <HistorySheet spaceId={sync.spaceId} {list} onclose={closeSheet} />
  {:else if sheet?.kind === 'call'}
    <CallSheet {v} {list} {shoppers} {mySpot} onclose={closeSheet} />
  {:else if sheet?.kind === 'backup'}
    <BackupSheet spaceId={sync.spaceId} {v} {list} onclose={closeSheet} {onopen} />
  {:else if sheet?.kind === 'transfer'}
    <TransferSheet spaceId={sync.spaceId} itemIds={sheet.itemIds} groupId={sheet.groupId} label={sheet.label} onclose={closeSheet} />
  {/if}
{/if}

<style>
  .loading {
    display: grid;
    gap: 14px;
    justify-items: start;
    padding-top: 30vh;
  }
  .top {
    display: flex;
    align-items: center;
    gap: 4px;
    margin-bottom: 14px;
  }
  .space {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: baseline;
    gap: 10px;
    background: none;
    border: 0;
    padding: 6px 0;
    text-align: left;
  }
  .space-name {
    font-family: var(--mono);
    font-size: 0.72rem;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--muted);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .space:hover .space-name {
    color: var(--ink);
  }
  .status {
    display: inline-grid;
    place-items: center;
    width: 28px;
    height: 40px;
  }
  .list-head {
    margin-bottom: 14px;
  }
  .title-row {
    align-items: center;
  }
  .list-title {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 6px;
    background: none;
    border: 0;
    padding: 0;
    text-align: left;
    color: var(--ink);
  }
  .list-title .name {
    font-family: var(--mono);
    font-weight: 600;
    font-size: clamp(1.6rem, 6.5vw, 2.4rem);
    line-height: 1.08;
    letter-spacing: -0.02em;
    overflow-wrap: anywhere;
  }
  .list-title :global(svg) {
    flex: 0 0 auto;
    color: var(--muted);
  }
  .nav-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    flex: 0 0 auto;
    min-width: 40px;
    height: 40px;
    padding: 0 10px;
    border-radius: 12px;
    border: 1px solid var(--line);
    background: var(--surface);
    color: var(--dusk);
    font-weight: 500;
    font-size: 0.9rem;
    text-decoration: none;
  }
  .nav-btn:hover {
    border-color: var(--dusk);
  }
  /* phones: arrow only */
  @media (max-width: 639px) {
    .nav-btn {
      padding: 0;
      width: 40px;
    }
    .nav-label {
      display: none;
    }
  }
  .progress {
    display: flex;
    align-items: center;
    gap: 12px;
    margin: 12px 0;
  }
  .progress .rail-track {
    flex: 1;
  }
  .count {
    font-size: 0.85rem;
    font-variant-numeric: tabular-nums;
    color: var(--muted);
  }
  .people-row {
    justify-content: space-between;
    flex-wrap: wrap;
  }
  .people {
    display: flex;
    align-items: center;
    gap: 6px;
    background: none;
    border: 0;
    padding: 4px 0;
    color: var(--muted);
    min-width: 0;
    flex-wrap: wrap;
  }
  .person {
    font-family: var(--mono);
    font-size: 0.72rem;
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 3px 8px;
    border: 1px solid var(--line);
    border-radius: 999px;
    max-width: 170px;
    min-width: 0;
    white-space: nowrap;
  }
  /* long device names end in … instead of being cut off */
  .pname {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .person.me {
    border-color: var(--dusk);
  }
  .people:hover .person {
    color: var(--ink);
  }
  /* incoming signals stay visible while scrolling */
  .signals {
    position: sticky;
    top: 8px;
    z-index: 30;
  }
  .chip.call {
    border-color: var(--dusk);
    color: var(--dusk);
  }
  @media (max-width: 639px) {
    .chip.call .label {
      display: none;
    }
  }
  .toggles {
    display: flex;
    align-items: center;
    gap: 4px;
    margin-left: auto;
  }
  @media (max-width: 380px) {
    .toggles .label {
      display: none;
    }
  }
</style>
