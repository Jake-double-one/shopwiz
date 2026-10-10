<script>
  import Icon from './Icon.svelte';
  import { t } from '../lib/i18n.svelte.js';
  import { suggestionsFor, learnedPlacement, groupOptions, groupLabel } from '../lib/model.js';
  import { addEntry, increaseAmount, deleteSuggestion, editItem } from '../lib/actions.js';
  import { parseEntry, splitLines, formatAmount, addAmounts } from '../../../shared/parse.js';
  import { toast } from '../lib/toast.svelte.js';
  import { sync } from '../lib/sync.svelte.js';

  let { v, list, target = $bindable(null) } = $props();

  let text = $state('');
  let input;
  let active = $state(-1);
  let showSugg = $state(false);
  let dup = $state(null);
  let pasted = $state(null);

  export function focus() {
    input?.focus();
  }

  const parsed = $derived(parseEntry(text));
  const sugg = $derived(showSugg ? suggestionsFor(v, list, parsed.name || text) : []);
  const options = $derived(groupOptions(v, list));
  const learned = $derived(!target && parsed.name ? learnedPlacement(v, list, parsed.name) : null);
  const targetLabel = $derived(target ? groupLabel(v, target) : '');
  $effect(() => {
    // target group was deleted or list switched
    if (target && !options.some((o) => o.id === target)) target = null;
  });

  function submit(raw = text, opts = {}) {
    if (!parseEntry(raw).name) return;
    const r = addEntry(list.id, raw, { ...(target && { groupId: target }), ...opts });
    if (r.status === 'duplicate') {
      dup = { existing: r.existing, parsed: r.parsed, raw };
      return;
    }
    text = '';
    active = -1;
    showSugg = false;
    input?.focus();
  }

  function pick(s) {
    const amount = parsed.qty ? `${parsed.qty}${parsed.unit ? ` ${parsed.unit}` : ''} ` : '';
    submit(amount + s.name);
  }

  function onkeydown(e) {
    if (e.key === 'ArrowDown' && sugg.length) {
      e.preventDefault();
      active = (active + 1) % sugg.length;
    } else if (e.key === 'ArrowUp' && sugg.length) {
      e.preventDefault();
      active = active <= 0 ? sugg.length - 1 : active - 1;
    } else if (e.key === 'Escape') {
      showSugg = false;
      active = -1;
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (active >= 0 && sugg[active]) pick(sugg[active]);
      else submit();
    }
  }

  function onpaste(e) {
    const data = e.clipboardData?.getData('text') ?? '';
    const lines = splitLines(data);
    if (lines.length > 1) {
      e.preventDefault();
      pasted = lines.slice(0, 200);
    }
  }

  function addPasted() {
    let added = 0;
    for (const line of pasted) {
      const r = addEntry(list.id, line, { ...(target && { groupId: target }), quiet: true });
      if (r.status === 'duplicate') {
        const cur = sync.data.items[r.existing.id] ?? r.existing;
        const sum = addAmounts({ qty: cur.qty, unit: cur.unit }, { qty: r.parsed.qty, unit: r.parsed.unit });
        if (sum) editItem(cur, { amount: sum });
      }
      if (r.status !== 'empty') added++;
    }
    toast(t('toast.pasted', { count: added }));
    pasted = null;
  }
</script>

<div class="bar-wrap" class:raised={!!dup || !!pasted || sugg.length > 0}>
  {#if dup}
    <div class="pop card" role="alertdialog" aria-label={t('dup.title')}>
      <p><b>{dup.existing.name}</b> {t('dup.text', { amount: formatAmount(dup.existing.qty, dup.existing.unit) || '1×' })}</p>
      <div class="row wrap-row">
        <button
          class="btn small main"
          onclick={() => {
            increaseAmount(sync.data.items[dup.existing.id] ?? dup.existing, dup.parsed);
            dup = null;
            text = '';
            input?.focus();
          }}>{t('dup.increase')}</button>
        <button
          class="btn small"
          onclick={() => {
            const raw = dup.raw;
            dup = null;
            submit(raw, { force: true });
          }}>{t('dup.addAnyway')}</button>
        <button class="btn small" onclick={() => ((dup = null), input?.focus())}>{t('cancel')}</button>
      </div>
    </div>
  {:else if pasted}
    <div class="pop card" role="alertdialog" aria-label={t('paste.title')}>
      <p class="eyebrow">{t('paste.title')}</p>
      <ul class="paste-list">
        {#each pasted as line, i (i)}<li>{line}</li>{/each}
      </ul>
      <div class="row wrap-row">
        <button class="btn small main" onclick={addPasted}>{t('paste.add', { count: pasted.length })}</button>
        <button class="btn small" onclick={() => (pasted = null)}>{t('cancel')}</button>
      </div>
    </div>
  {:else if sugg.length}
    <ul class="sugg card" role="listbox" id="add-suggestions">
      {#each sugg as s, i (s.norm)}
        <li role="option" aria-selected={i === active} class:active={i === active}>
          <button class="pick" onmousedown={(e) => e.preventDefault()} onclick={() => pick(s)}>
            <span class="s-name">{s.name}</span>
            {#if s.placement}<span class="micro">{s.placement.group}{s.placement.subgroup ? ` › ${s.placement.subgroup}` : ''}</span>{/if}
            {#if s.onList}<span class="micro on">{t('add.onList')}</span>{:else if s.inactive}<span class="micro">{t('add.inactive')}</span>{/if}
          </button>
          <button
            class="icon-btn forget"
            onmousedown={(e) => e.preventDefault()}
            onclick={() => deleteSuggestion(s.norm)}
            aria-label={t('add.forgetSuggestion', { name: s.name })}
            title={t('add.forgetSuggestion', { name: s.name })}><Icon name="x" size={14} /></button>
        </li>
      {/each}
    </ul>
  {/if}

  <form class="bar" onsubmit={(e) => (e.preventDefault(), submit())}>
    <div class="target">
      <label class="sr-only" for="add-target">{t('add.target')}</label>
      <select id="add-target" class="target-select" class:set={!!target} value={target ?? ''} onchange={(e) => (target = e.target.value || null)}>
        <option value="">{learned ? `→ ${learned.group}${learned.subgroup ? ` › ${learned.subgroup}` : ''}` : t('add.auto')}</option>
        {#each options as o (o.id)}
          <option value={o.id}>{o.depth ? `  ${o.parent} › ${o.label}` : o.label}</option>
        {/each}
      </select>
      {#if target}
        <button type="button" class="clear" onclick={() => (target = null)} aria-label={t('add.clearTarget')}>{targetLabel} ×</button>
      {/if}
    </div>
    <div class="row">
      <input
        bind:this={input}
        class="input"
        bind:value={text}
        oninput={() => ((showSugg = true), (active = -1))}
        onfocus={() => (showSugg = true)}
        onblur={() => setTimeout(() => (showSugg = false), 150)}
        {onkeydown}
        {onpaste}
        placeholder={t('add.placeholder')}
        aria-label={t('add.placeholder')}
        aria-autocomplete="list"
        aria-controls="add-suggestions"
        autocomplete="off"
        enterkeyhint="done"
        maxlength="160" />
      <button class="btn main add" type="submit" disabled={!parsed.name} aria-label={t('add.button')}><Icon name="plus" /></button>
    </div>
  </form>
</div>

<style>
  .bar-wrap {
    position: fixed;
    left: 0;
    right: 0;
    bottom: var(--kb, 0px);
    z-index: 40;
    pointer-events: none;
  }
  /* open suggestions or prompts sit above toasts */
  .bar-wrap.raised {
    z-index: 70;
  }
  .bar,
  .pop,
  .sugg {
    pointer-events: auto;
    max-width: 780px;
    margin: 0 auto;
  }
  .bar {
    background: color-mix(in srgb, var(--bg) 88%, transparent);
    backdrop-filter: blur(10px);
    -webkit-backdrop-filter: blur(10px);
    border-top: 1px solid var(--line);
    padding: 8px 16px calc(10px + env(safe-area-inset-bottom));
  }
  @media (min-width: 812px) {
    .bar {
      border: 1px solid var(--line);
      border-bottom: 0;
      border-radius: 18px 18px 0 0;
    }
  }
  .target {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-bottom: 6px;
    min-height: 26px;
  }
  .target-select {
    font-family: var(--mono);
    font-size: 0.7rem;
    letter-spacing: 0.06em;
    color: var(--muted);
    background: none;
    border: 1px solid var(--line);
    border-radius: 999px;
    padding: 3px 8px;
    max-width: 60%;
  }
  .target-select.set {
    display: none;
  }
  .clear {
    font-family: var(--mono);
    font-size: 0.7rem;
    background: var(--dusk-soft);
    border: 1px solid var(--dusk);
    color: var(--ink);
    border-radius: 999px;
    padding: 3px 10px;
  }
  .add {
    width: 48px;
    padding: 0;
    flex: 0 0 auto;
  }
  .input {
    font-size: 1rem;
  }
  .pop,
  .sugg {
    margin-bottom: 8px;
    width: calc(100% - 32px);
  }
  .pop p {
    margin: 0 0 12px;
  }
  .paste-list {
    margin: 0 0 12px;
    padding-left: 18px;
    max-height: 30dvh;
    overflow: auto;
  }
  .sugg {
    list-style: none;
    padding: 4px;
  }
  .sugg li {
    display: flex;
    align-items: center;
    border-radius: 10px;
  }
  .sugg li.active,
  .sugg li:hover {
    background: var(--surface-2);
  }
  .pick {
    flex: 1;
    display: flex;
    align-items: baseline;
    gap: 10px;
    flex-wrap: wrap;
    background: none;
    border: 0;
    padding: 10px 12px;
    text-align: left;
  }
  .s-name {
    font-weight: 500;
  }
  .on {
    color: var(--sun);
  }
  .forget {
    width: 32px;
    height: 32px;
  }
</style>
