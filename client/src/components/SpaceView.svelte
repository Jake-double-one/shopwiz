<script>
  import { onMount, untrack } from 'svelte';
  import Icon from './Icon.svelte';
  import ListBody from './ListBody.svelte';
  import ShowCard from './ShowCard.svelte';
  import FocusView from './FocusView.svelte';
  import AddBar from './AddBar.svelte';
  import { shared } from '../lib/share.svelte.js';
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
  import HelpSheet from './HelpSheet.svelte';
  import SignalCard from './SignalCard.svelte';
  import { spotPlace } from '../lib/signals.js';
  import { sync } from '../lib/sync.svelte.js';
  import { t, relTime, clock } from '../lib/i18n.svelte.js';
  import { load, save } from '../lib/storage.js';
  import { sortedLists, progress, isShopping, listItems, listTree, translationOf, viewItem, linkedLists, showsItem } from '../lib/model.js';
  import { setShopping, restoreItems, addList, finishShopping, pendingLinks, undoLink } from '../lib/actions.js';
  import { prefs, setHideChecked, setFocus } from '../lib/prefs.svelte.js';
  import { navUrl } from '../lib/nav.js';
  import { toast, dismissNotices } from '../lib/toast.svelte.js';

  // admin: the administration's session – this ID is opened as "Admin" and nothing of it stays on the device
  let { id, onleave, onopen, admin = null, onadmin = null } = $props();

  $effect(() => {
    if (sync.spaceId !== id || sync.admin !== admin) sync.open(id, { admin });
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
    if (listId && !admin) save(`list.${sync.spaceId ?? id}`, listId);
  });

  $effect(() => {
    // opened by an admin: no list name in the title – titles end up in the browser's history
    document.title = admin ? 'Admin · ShopWiz' : list ? `${list.name} · ShopWiz` : 'ShopWiz';
    return () => (document.title = 'ShopWiz');
  });

  const prog = $derived(list ? progress(v, list.id) : { done: 0, total: 0 });
  const conflicts = $derived(list ? Object.values(v.conflicts).filter((c) => v.items[c.itemId] && showsItem(v, list, v.items[c.itemId])) : []);
  const devices = $derived(Object.values(v.devices));
  const myDevId = $derived(sync.me?.devId);

  // participants in one line: an admin who is in the ID (red, always first), me, then who is online; the rest as "+N"
  const adminHere = $derived(sync.online.includes('admin'));
  const peopleOrder = $derived([
    ...(adminHere ? [{ devId: 'admin', name: t('admin.chip'), admin: true }] : []),
    ...[...devices].sort((a, b) => (b.devId === myDevId) - (a.devId === myDevId) || sync.online.includes(b.devId) - sync.online.includes(a.devId)),
  ]);
  let peopleEl = $state();
  let measureEl = $state();
  let peopleFit = $state(99);
  function fitPeople() {
    if (!peopleEl || !measureEl) return;
    const chips = [...measureEl.children];
    const more = chips.pop()?.getBoundingClientRect().width ?? 40;
    const gap = 6;
    let room = peopleEl.clientWidth - 18 - gap; // the people icon
    let n = 0;
    for (const [i, c] of chips.entries()) {
      const w = c.getBoundingClientRect().width + gap;
      const rest = i < chips.length - 1 ? more + gap : 0;
      if (w + rest > room) break;
      room -= w;
      n++;
    }
    peopleFit = Math.max(1, n);
  }
  $effect(() => {
    peopleOrder;
    if (!peopleEl) return;
    fitPeople();
    const ro = new ResizeObserver(fitPeople);
    ro.observe(peopleEl);
    if (measureEl) ro.observe(measureEl); // web fonts arriving change the widths
    return () => ro.disconnect();
  });
  // check-ins run out by themselves – look again every 30 s
  let clockNow = $state(Date.now());
  onMount(() => {
    const timer = setInterval(() => (clockNow = Date.now()), 30_000);
    return () => clearInterval(timer);
  });
  const shoppers = $derived(devices.filter((d) => isShopping(d, clockNow) && d.devId !== myDevId));
  const myShopping = $derived(isShopping(v.devices[myDevId], clockNow));
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
  // everything checked → offer to finish (checked items become inactive, check-in and screen-on end)
  const allDone = $derived(prog.total > 0 && prog.done === prog.total);
  // only the moment the last item gets checked counts – not switching to a list that is already done
  let wasAllDone = { listId: null, done: false };
  $effect(() => {
    const listId = list?.id ?? null;
    if (allDone && myShopping && wasAllDone.listId === listId && !wasAllDone.done) {
      toast({ text: t('shopping.allDone'), timeout: 10000, action: { label: t('shopping.finish'), run: () => finish(listId) } });
    }
    wasAllDone = { listId, done: allDone };
  });
  /** listId: the list that got done – not whatever list is shown when the button is tapped */
  async function finish(listId = list?.id) {
    if (!listId) return;
    finishShopping(listId, { checkOut: myShopping });
    if (screenOn) await toggleScreen();
  }

  // ----- search -----
  let searching = $state(false);
  let query = $state('');
  let searchInput = $state();
  function openSearch() {
    searching = true;
    setTimeout(() => searchInput?.focus(), 0);
  }
  function closeSearch() {
    searching = false;
    query = '';
  }
  // another list starts without a search
  const shownListId = $derived(list?.id);
  $effect(() => {
    shownListId;
    untrack(closeSearch);
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
  const open = (kind, extra = {}) => {
    dismissNotices();
    // a dialog can't show under the focus mode – leave it first
    if (prefs.focus) setFocus(false);
    sheet = { kind, listId: list?.id ?? null, ...extra };
  };
  // the list, group or item a dialog was opened for was deleted (maybe on another device) → close it
  $effect(() => {
    const s = sheet;
    if (!s) return;
    const gone =
      (s.kind === 'listMenu' && s.listId !== list?.id) ||
      (s.kind === 'group' && s.groupId && !v.groups[s.groupId]) ||
      (s.kind === 'item' && !v.items[s.itemId]);
    if (!gone) return;
    untrack(() => {
      sheet = null;
      if (s.kind === 'item') toast(t('toast.goneMeanwhile'));
    });
  });
  const closeSheet = () => (sheet = null);
  // app shortcut "Add item": the "new item" dialog right away, on the list opened last
  $effect(() => {
    if (shared.addDialog && list) {
      shared.addDialog = false;
      // the focus mode would cover the dialog
      untrack(() => (setFocus(false), open('add')));
    }
  });

  // one-time "new here?" hint, per device
  let helpHint = $state(!untrack(() => admin) && !load('helpSeen', false));

  // the main admin made this device an admin: a one-time notice (it has 24 hours for its passkey)
  let adminNoticeSeen = $state(load('adminNotice', 0));
  const adminNotice = $derived(!admin && sync.adminState?.role === 'pending' && sync.adminState.since !== adminNoticeSeen ? sync.adminState : null);
  function dismissAdminNotice() {
    adminNoticeSeen = adminNotice?.since ?? 0;
    save('adminNotice', adminNoticeSeen);
  }
  function openHelp() {
    helpHint = false;
    if (!admin) save('helpSeen', true);
    open('help');
  }
  function dismissHint() {
    helpHint = false;
    save('helpSeen', true);
  }

  // travel mode: show a translation big to shop staff, swipe through the others
  let showing = $state(null); // { entries, start }
  function showTranslation(item) {
    const lang = list?.travel?.lang;
    if (!lang) return;
    const tree = listTree(v, list);
    const entries = [...tree.ungrouped, ...tree.groups.flatMap((n) => n.items)]
      .map((it) => ({ item: it, text: translationOf(v, it.name, lang) }))
      .filter((e) => e.text);
    const start = Math.max(0, entries.findIndex((e) => e.item.id === item.id));
    showing = { entries, start };
  }

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
        if (d.op.k === 'list.link' && pendingLinks.delete(d.id) && r.linked) {
          toast({
            text: r.mergedItems ? t('link.merged', { count: r.mergedItems }) : t('link.done', { count: r.linked }),
            action: { label: t('undo'), run: () => undoLink(d.id) },
          });
        }
        if (r.conflicts) toast({ text: t('toast.conflict'), action: { label: t('conflict.review'), run: () => open('conflicts') } });
        if (r.rejected === 'deleted') {
          toast({ text: t('toast.editDeleted', { name: r.name }), action: { label: t('restore'), run: () => restoreItems([d.op.id]) } });
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

{#if ['notfound', 'deleted', 'kicked', 'limited', 'full', 'idLimit', 'adminEnded'].includes(sync.status)}
  <StatusScreen status={sync.status} deleted={sync.deleted} spaceId={id} {onleave} {onopen} {admin} />
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
  <main class="wrap" inert={prefs.focus}>
    {#if admin}
      <div class="admin-bar" role="status">
        <Icon name="key" size={18} />
        <span class="grow">{t('admin.viewing')}</span>
        <button class="btn small" onclick={onleave}>{t('admin.back')}</button>
      </div>
    {/if}
    <header class="top">
      <button class="space" onclick={() => open('settings')} title={t('settings.title')}>
        <span class="brand">Shop<span>·</span>Wiz</span>
        <span class="space-name">{v.space?.name}</span>
      </button>
      <span class="status" title={statusLabel}>
        <span class="dot" class:on={sync.status === 'online' && !sync.pendingCount} class:warn={sync.status !== 'online' || sync.pendingCount}></span>
        <span class="sr-only">{statusLabel}</span>
      </span>
      <button class="icon-btn" onclick={openHelp} aria-label={t('help.title')} title={t('help.button')}><Icon name="help" /></button>
      <button class="icon-btn" onclick={() => open('share')} aria-label={t('share.title')} title={t('share.title')}><Icon name="share" /></button>
      <button class="icon-btn" onclick={() => open('settings')} aria-label={t('settings.title')} title={t('settings.title')}><Icon name="settings" /></button>
    </header>

    {#if adminNotice}
      <div class="signal-like admin-notice" role="alert">
        <div class="an-text">
          <Icon name="key" size={18} />
          <span><b>{t('admin.promoted')}</b> {t('admin.promotedHint', { until: clock(adminNotice.until) })}</span>
        </div>
        <div class="row an-actions">
          {#if onadmin}<button class="btn small main" onclick={() => (dismissAdminNotice(), onadmin())}>{t('admin.setUp')}</button>{/if}
          <button class="btn small" onclick={dismissAdminNotice}>{t('signal.ok')}</button>
        </div>
      </div>
    {/if}

    {#if helpHint}
      <div class="hint dusk help-hint">
        <Icon name="help" size={18} />
        <span class="grow">{t('help.hint')}</span>
        <button class="link" onclick={openHelp}>{t('help.hintOpen')}</button>
        <button class="icon-btn small-x" onclick={dismissHint} aria-label={t('help.hintClose')} title={t('help.hintClose')}><Icon name="x" size={16} /></button>
      </div>
    {/if}

    <section class="list-head">
      <div class="row title-row">
        <button class="list-title" onclick={() => open('lists')} aria-haspopup="dialog">
          <span class="name">{list.name}</span>
          {#if list.linkId && linkedLists(v, list).length}
            <span class="linked" title={t('link.withNames', { names: linkedLists(v, list).map((l) => l.name).join(', ') })}><Icon name="link" size={18} /><span class="sr-only">{t('link.withNames', { names: linkedLists(v, list).map((l) => l.name).join(', ') })}</span></span>
          {/if}
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
        <button class="icon-btn" onclick={() => (searching ? closeSearch() : openSearch())} aria-pressed={searching} aria-label={t('search.button')} title={t('search.button')}><Icon name="search" /></button>
        <button class="icon-btn" onclick={() => open('listMenu')} aria-label={t('list.menu')} title={t('list.menu')}><Icon name="more" /></button>
      </div>
      <div class="progress">
        <div class="rail-track" aria-hidden="true">
          <div class="rail-fill" style:width={prog.total ? `${(prog.done / prog.total) * 100}%` : '0%'}></div>
        </div>
        <span class="mono count">{prog.done} / {prog.total}</span>
      </div>

      <div class="row people-row">
        <button class="people" bind:this={peopleEl} onclick={() => open('people')} aria-label={t('people.title')}>
          <Icon name="users" size={18} />
          {#each peopleOrder.slice(0, peopleFit) as d (d.devId)}
            <span class="person" class:me={d.devId === myDevId} class:admin={d.admin} title={d.name}>
              <span class="dot" class:on={sync.online.includes(d.devId)}></span><span class="pname">{d.name}</span>
            </span>
          {/each}
          {#if peopleOrder.length > peopleFit}<span class="person more">+{peopleOrder.length - peopleFit}</span>{/if}
          <!-- all chips once more, invisible, to measure how many fit into one line -->
          <span class="people-measure" bind:this={measureEl} aria-hidden="true">
            {#each peopleOrder as d (d.devId)}
              <span class="m-person"><span class="dot"></span><span class="pname">{d.name}</span></span>
            {/each}
            <span class="m-person">+{peopleOrder.length}</span>
          </span>
        </button>
        <div class="toggles">
          {#if !admin && myShopping && shoppers.length}
            <button class="chip call" onclick={() => open('call')} title={t('call.title')} aria-label={t('call.title')}>
              <Icon name="nav" size={16} />
              <span class="label">{t('call.button')}</span>
            </button>
          {/if}
          {#if !admin}
            <button class="chip main" aria-pressed={myShopping} onclick={toggleShopping} title={t('shopping.hint')}>
              <Icon name="cart" size={16} />
              <span class="label">{t('shopping.toggle')}</span>
            </button>
          {/if}
          <button class="icon-btn" onclick={() => setFocus(true)} aria-label={t('focus.button')} title={t('focus.button')}><Icon name="focus" /></button>
          <button class="icon-btn" aria-pressed={prefs.hideChecked} onclick={() => setHideChecked(!prefs.hideChecked)} aria-label={t('hideChecked.toggle')} title={t('hideChecked.toggle')}>
            <Icon name={prefs.hideChecked ? 'eyeOff' : 'eye'} />
          </button>
          {#if canWake}
            <button class="icon-btn" aria-pressed={screenOn} onclick={toggleScreen} aria-label={t('screen.toggle')} title={t('screen.toggle')}>
              <Icon name="screen" />
            </button>
          {/if}
        </div>
      </div>
    </section>

    {#if searching}
      <form class="search" role="search" onsubmit={(e) => e.preventDefault()}>
        <Icon name="search" size={18} />
        <input
          bind:this={searchInput}
          bind:value={query}
          class="search-input"
          type="search"
          enterkeyhint="search"
          placeholder={t('search.placeholder', { list: list.name })}
          aria-label={t('search.button')}
          maxlength="80"
          autocomplete="off"
          data-1p-ignore
          data-lpignore="true"
          data-bwignore
          data-form-type="other"
          onkeydown={(e) => e.key === 'Escape' && closeSearch()} />
        <button type="button" class="icon-btn" onclick={closeSearch} aria-label={t('search.close')} title={t('search.close')}><Icon name="x" size={18} /></button>
      </form>
    {/if}

    {#if allDone && !searching}
      <div class="hint dusk done-card">
        <Icon name="check" size={18} />
        <span class="grow">{t('shopping.doneTitle')}</span>
        <button class="btn small main" onclick={() => finish()}>{t('shopping.finish')}</button>
      </div>
    {/if}

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
      remember={!admin}
      {v}
      {list}
      {freshIds}
      {query}
      onedit={(item) => open('item', { itemId: item.id })}
      onshow={showTranslation}
      ongroup={(group) => open('group', { groupId: group.id })}
      onaddto={(groupId) => {
        addTarget = groupId;
        addBar?.focus();
      }}
      onaddgroup={() => open('group', { create: true })} />
  </main>

  <div class="addbar-wrap" inert={prefs.focus}><AddBar bind:this={addBar} {v} {list} bind:target={addTarget} ondetails={(text) => open('add', { text })} /></div>

  {#if prefs.focus && list}
    <FocusView {v} {list} onclose={() => setFocus(false)} {screenOn} ontogglescreen={canWake ? toggleScreen : null}>
      {#if signals.length}
        <div class="signals focus-signals">
          {#each signals as sig (sig.id)}
            <SignalCard {sig} {v} {list} {mySpot} ondismiss={() => dismissSignal(sig.id)} />
          {/each}
        </div>
      {/if}
    </FocusView>
  {/if}
  {#if showing && list?.travel}
    <ShowCard entries={showing.entries} start={showing.start} country={list.travel.country} lang={list.travel.lang} onclose={() => (showing = null)} />
  {/if}
  {#if sheet?.kind === 'lists'}
    <ListPicker {v} current={list} onpick={(lid) => ((listId = lid), closeSheet())} onclose={closeSheet} />
  {:else if sheet?.kind === 'listMenu'}
    <ListMenu {v} {list} {lists} onclose={closeSheet} onopen={open} onswitch={(lid) => (listId = lid)} />
  {:else if sheet?.kind === 'add'}
    <ItemSheet {v} {list} prefill={sheet.text ?? ''} onclose={closeSheet} />
  {:else if sheet?.kind === 'item' && v.items[sheet.itemId]}
    <ItemSheet {v} {list} item={viewItem(v, list, v.items[sheet.itemId])} onclose={closeSheet} ontransfer={(item) => open('transfer', { itemIds: [item.id], label: item.name })} />
  {:else if sheet?.kind === 'group'}
    <GroupSheet
      {v}
      {list}
      group={sheet.groupId ? v.groups[sheet.groupId] : null}
      onclose={closeSheet}
      ontransfer={(g) => open('transfer', { groupId: g.id, fromListId: list.id, label: g.name })}
      oncreated={(gid, name) => {
        // a new group is empty, so it would sit in the inactive part – aim the input at it instead
        addTarget = gid;
        toast(t('toast.groupCreated', { name }));
        setTimeout(() => addBar?.focus(), 50);
      }} />
  {:else if sheet?.kind === 'share'}
    <ShareSheet space={v.space} spaceId={sync.spaceId} {list} onclose={closeSheet} />
  {:else if sheet?.kind === 'settings'}
    <SettingsSheet space={v.space} spaceId={sync.spaceId} onclose={closeSheet} {onleave} {onopen} {admin} {onadmin} onshare={() => open('share')} onbackup={() => open('backup')} />
  {:else if sheet?.kind === 'people'}
    <PeopleSheet {devices} online={sync.online} me={sync.me} spaceId={sync.spaceId} onclose={closeSheet} />
  {:else if sheet?.kind === 'conflicts'}
    <ConflictSheet {v} {conflicts} onclose={closeSheet} />
  {:else if sheet?.kind === 'history'}
    <HistorySheet spaceId={sync.spaceId} {list} onclose={closeSheet} />
  {:else if sheet?.kind === 'help'}
    <HelpSheet onclose={closeSheet} />
  {:else if sheet?.kind === 'call'}
    <CallSheet {v} {list} {shoppers} {mySpot} onclose={closeSheet} />
  {:else if sheet?.kind === 'backup'}
    <BackupSheet spaceId={sync.spaceId} {v} {list} onclose={closeSheet} {onopen} />
  {:else if sheet?.kind === 'transfer'}
    <TransferSheet spaceId={sync.spaceId} itemIds={sheet.itemIds} groupId={sheet.groupId} fromListId={sheet.fromListId} label={sheet.label} onclose={closeSheet} />
  {/if}
{/if}

<style>
  .search {
    display: flex;
    align-items: center;
    gap: 8px;
    margin: 0 0 12px;
    padding: 0 4px 0 12px;
    background: var(--surface);
    border: 1px solid var(--line);
    border-radius: 12px;
    color: var(--muted);
  }
  .search:focus-within {
    border-color: var(--dusk);
  }
  .search-input {
    flex: 1;
    min-width: 0;
    min-height: 44px;
    border: 0;
    background: none;
    color: var(--ink);
    font: inherit;
    outline: none;
  }
  .search-input::-webkit-search-cancel-button {
    display: none;
  }
  .addbar-wrap {
    display: contents;
  }
  .focus-signals {
    max-width: 640px;
    margin: 0 auto 16px;
  }
  .done-card .btn {
    flex: none;
  }
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
  .list-title .linked {
    display: inline-grid;
    place-items: center;
  }
  .list-title .linked :global(svg) {
    color: var(--ok);
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
    position: relative;
    display: flex;
    align-items: center;
    gap: 6px;
    background: none;
    border: 0;
    padding: 4px 0;
    color: var(--muted);
    min-width: 0;
    flex: 1 1 220px;
    flex-wrap: nowrap;
    overflow: hidden;
  }
  .people-measure {
    position: absolute;
    left: 0;
    top: 0;
    display: flex;
    gap: 6px;
    visibility: hidden;
    pointer-events: none;
    white-space: nowrap;
  }
  .person.more {
    flex: none;
  }
  .person,
  .m-person {
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
  /* an admin in the ID: red, so nobody overlooks it */
  .person.admin {
    border-color: var(--alert);
    background: var(--alert);
    color: var(--on-alert);
    font-weight: 600;
  }
  .people:hover .person.admin {
    color: var(--on-alert);
  }
  .person.admin .dot {
    background: var(--on-alert);
  }
  .admin-bar {
    display: flex;
    align-items: center;
    gap: 10px;
    margin: 0 0 12px;
    padding: 8px 8px 8px 12px;
    border-radius: 12px;
    background: var(--alert);
    color: var(--on-alert);
    font-weight: 600;
    font-size: 0.9rem;
  }
  .admin-bar .grow {
    flex: 1;
    min-width: 0;
  }
  .admin-bar .btn {
    flex: none;
  }
  .admin-notice {
    background: var(--surface);
    border: 2px solid var(--alert);
    border-radius: 14px;
    padding: 12px 14px;
    margin-bottom: 10px;
    box-shadow: var(--shadow);
  }
  .an-text {
    display: flex;
    gap: 8px;
    align-items: flex-start;
    color: var(--alert);
  }
  .an-text span {
    color: var(--muted);
  }
  .an-text b {
    color: var(--ink);
    font-weight: 600;
  }
  .an-actions {
    margin-top: 10px;
    justify-content: flex-end;
  }
  .people:hover .person {
    color: var(--ink);
  }
  .help-hint {
    flex-wrap: wrap;
  }
  .small-x {
    width: 30px;
    height: 30px;
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
