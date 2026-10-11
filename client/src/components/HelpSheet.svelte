<script>
  import Sheet from './Sheet.svelte';
  import Icon from './Icon.svelte';
  import { t, i18n } from '../lib/i18n.svelte.js';
  import { build, versionUrl } from '../lib/build.js';
  import { sync } from '../lib/sync.svelte.js';
  import { translatorChain } from '../lib/actions.js';

  let { onclose } = $props();
  const TOPICS = ['start', 'add', 'check', 'groups', 'shop', 'travel', 'lists', 'offline', 'backup', 'privacy'];
  let open = $state(null);
  const builtAt = $derived(
    build.time && !Number.isNaN(Date.parse(build.time))
      ? new Intl.DateTimeFormat(i18n.lang, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(build.time))
      : '',
  );
  const versionNote = $derived(build.version === 'latest' ? t('help.versionLatest') : build.version === 'dev' ? t('help.versionDev') : '');
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

  <footer class="about">
    <p class="eyebrow">{t('help.about')}</p>
    <p class="version">
      <span>{t('help.version')}:</span>
      <a href={versionUrl()} target="_blank" rel="noopener noreferrer" class="mono">{build.version}</a>
      {#if build.sha}<span class="mono muted">· {build.sha.slice(0, 7)}</span>{/if}
    </p>
    <p class="muted small">{[versionNote, builtAt && t('help.built', { date: builtAt })].filter(Boolean).join(' · ')}</p>
    {#if sync.spaceId && sync.features.translators}
      <p class="muted small">{t('help.translator')}: {translatorChain() || t('help.translatorOff')}</p>
    {/if}
    <a class="btn small" href={build.repo} target="_blank" rel="noopener noreferrer"><Icon name="code" size={16} />{t('help.source')}</a>
    <p class="muted small"><a href="/licenses.txt" target="_blank" rel="noopener">{t('help.licenses')}</a></p>
  </footer>
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
  .about {
    margin-top: 18px;
    padding-top: 14px;
    border-top: 1px solid var(--line);
  }
  .version {
    margin: 0 0 2px;
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    align-items: baseline;
  }
  .version a {
    color: var(--dusk);
    font-weight: 600;
  }
  .small {
    font-size: 0.85rem;
    margin: 0 0 12px;
  }
  .body li::marker {
    color: var(--muted);
  }
</style>
