<script>
  import Sheet from './Sheet.svelte';
  import Icon from './Icon.svelte';
  import { t } from '../lib/i18n.svelte.js';

  let { onclose } = $props();
  const TOPICS = ['start', 'add', 'check', 'groups', 'shop', 'lists', 'offline', 'backup', 'privacy'];
  let open = $state(null);
</script>

<Sheet title={t('help.title')} eyebrow="ShopWiz" {onclose}>
  <p class="note">{t('help.intro')}</p>
  <div class="topics">
    {#each TOPICS as topic (topic)}
      <section class="topic" class:open={open === topic}>
        <button class="head" aria-expanded={open === topic} onclick={() => (open = open === topic ? null : topic)}>
          <span class="chev"><Icon name="chevron" size={16} /></span>
          <span>{t(`help.${topic}.title`)}</span>
        </button>
        {#if open === topic}
          <ul class="body">
            {#each t(`help.${topic}.body`).split('\n') as line, i (i)}<li>{line}</li>{/each}
          </ul>
        {/if}
      </section>
    {/each}
  </div>
</Sheet>

<style>
  .topics {
    border: 1px solid var(--line);
    border-radius: 14px;
    overflow: hidden;
  }
  .topic + .topic {
    border-top: 1px solid var(--line);
  }
  .head {
    width: 100%;
    display: flex;
    align-items: center;
    gap: 8px;
    background: none;
    border: 0;
    padding: 13px 14px;
    text-align: left;
    font-weight: 600;
    color: var(--ink);
  }
  .head:hover {
    background: var(--surface-2);
  }
  .chev {
    display: inline-grid;
    color: var(--control-ink);
    transition: transform 0.15s ease;
  }
  .open .chev {
    transform: rotate(90deg);
  }
  .open .head {
    color: var(--dusk);
  }
  .body {
    margin: 0;
    padding: 0 16px 14px 38px;
    display: grid;
    gap: 8px;
    font-size: 0.93rem;
    line-height: 1.5;
    color: var(--ink);
  }
  .body li::marker {
    color: var(--muted);
  }
</style>
