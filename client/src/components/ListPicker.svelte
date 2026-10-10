<script>
  import Sheet from './Sheet.svelte';
  import Icon from './Icon.svelte';
  import { t } from '../lib/i18n.svelte.js';
  import { sortedLists, progress } from '../lib/model.js';
  import { addList } from '../lib/actions.js';

  let { v, current, onpick, onclose } = $props();
  const lists = $derived(sortedLists(v));
  let name = $state('');
  let shared = $state(false);

  function create(e) {
    e.preventDefault();
    const n = name.trim();
    if (!n) return;
    onpick(addList(n.slice(0, 80), shared ? 'shared' : 'own'));
  }
</script>

<Sheet title={t('lists.title')} eyebrow={v.space?.name} {onclose}>
  <ul class="lists">
    {#each lists as l (l.id)}
      {@const p = progress(v, l.id)}
      <li>
        <button class="pick" class:current={l.id === current.id} onclick={() => onpick(l.id)} aria-current={l.id === current.id}>
          <span class="name">{l.name}</span>
          <span class="mono count">{p.done}/{p.total}</span>
          {#if l.id === current.id}<Icon name="check" size={18} />{/if}
        </button>
      </li>
    {/each}
  </ul>
  <form onsubmit={create} class="new">
    <p class="eyebrow">{t('lists.new')}</p>
    <div class="row">
      <input class="input" bind:value={name} maxlength="80" placeholder={t('lists.newPh')} aria-label={t('lists.new')} />
      <button class="btn main" type="submit" disabled={!name.trim()} aria-label={t('lists.create')}><Icon name="plus" /></button>
    </div>
    <label class="check-row">
      <input type="checkbox" bind:checked={shared} />
      <span>{t('lists.sharedGroups')}</span>
    </label>
  </form>
</Sheet>

<style>
  .lists {
    list-style: none;
    margin: 0 0 18px;
    padding: 0;
  }
  .lists li + li {
    border-top: 1px solid var(--line);
  }
  .pick {
    width: 100%;
    display: flex;
    align-items: center;
    gap: 10px;
    background: none;
    border: 0;
    padding: 12px 4px;
    text-align: left;
  }
  .pick .name {
    flex: 1;
    font-weight: 500;
    overflow-wrap: anywhere;
  }
  .pick.current .name {
    font-weight: 600;
  }
  .pick:hover .name {
    color: var(--dusk);
  }
  .count {
    font-size: 0.8rem;
    color: var(--muted);
  }
  .check-row {
    display: flex;
    gap: 8px;
    align-items: center;
    margin-top: 10px;
    font-size: 0.9rem;
    color: var(--muted);
  }
</style>
