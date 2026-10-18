<script>
  import Sheet from './Sheet.svelte';
  import Icon from './Icon.svelte';
  import { t, i18n } from '../lib/i18n.svelte.js';
  import { build, versionUrl } from '../lib/build.js';
  import { sync } from '../lib/sync.svelte.js';
  import { translatorChain, translatorName } from '../lib/actions.js';
  import { api } from '../lib/api.js';

  let { onclose } = $props();
  const TOPICS = ['start', 'add', 'check', 'groups', 'prio', 'shop', 'lists', 'link', 'travel', 'ai', 'offline', 'backup', 'privacy'];
  let open = $state(null);
  const builtAt = $derived(
    build.time && !Number.isNaN(Date.parse(build.time))
      ? new Intl.DateTimeFormat(i18n.lang, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(build.time))
      : '',
  );
  const versionNote = $derived(build.version === 'latest' ? t('help.versionLatest') : build.version === 'dev' ? t('help.versionDev') : '');

  // do the translation services work? (green/red dot, DeepL's quota) – checked by the server
  let services = $state(null);
  if (sync.spaceId) {
    api.translateStatus(sync.spaceId).then((r) => (services = r.services ?? [])).catch(() => (services = null));
  }
  const usage = $derived((services ?? []).filter((x) => x.usage).map((x) => ({ provider: x.provider, ...x.usage })));
  const serviceName = (p) => translatorName(p) || p;
  const problemText = (x) => t(`help.svc.${x.problem}`, { detail: x.detail ?? '' });
  const fmt = (n) => n.toLocaleString(i18n.lang);
  const pct = (u) => (u.limit ? Math.round((u.used / u.limit) * 1000) / 10 : 0).toLocaleString(i18n.lang);
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
            {#if topic === 'ai' && sync.spaceId && !sync.features.ai}<li class="off">{t('help.ai.off')}</li>{/if}
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
    {#if sync.features.admin}<p class="muted small">{t('admin.transparency')}</p>{/if}
    {#if services?.length}
      <p class="muted small services">
        {t('help.translator')}:
        {#each services as x, i (x.provider)}
          {#if i}<span aria-hidden="true">→</span>{/if}
          <span class="svc">{serviceName(x.provider)}<span class="dot" class:ok={x.ok} role="img" aria-label={x.ok ? t('help.svc.ok') : problemText(x)} title={x.ok ? t('help.svc.ok') : problemText(x)}></span></span>
        {/each}
      </p>
      {#each services.filter((x) => !x.ok) as x (x.provider)}
        <p class="small problem">{serviceName(x.provider)}: {problemText(x)}</p>
      {/each}
      {#each usage as u (u.provider)}
        <div class="usage">
          <p class="muted small">
            {t('help.usage', { service: translatorName(u.provider), used: fmt(u.used), limit: fmt(u.limit), pct: pct(u) })}
          </p>
          <div class="bar" role="progressbar" aria-valuemin="0" aria-valuemax={u.limit} aria-valuenow={u.used} aria-label={translatorName(u.provider)}>
            <span style:width="{Math.min(100, (u.used / u.limit) * 100)}%" class:warn={u.used / u.limit > 0.8}></span>
          </div>
        </div>
      {/each}
    {:else if sync.spaceId && sync.features.translators}
      <p class="muted small">{t('help.translator')}: {translatorChain() || t('help.translatorOff')}</p>
    {/if}
    <a class="btn small" href={build.repo} target="_blank" rel="noopener noreferrer"><Icon name="code" size={16} />{t('help.source')}</a>
    <p class="muted small"><a href="/licenses.txt" target="_blank" rel="noopener">{t('help.licenses')}</a></p>
  </footer>
</Sheet>

<style>
  .services {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 4px 6px;
  }
  .svc {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    color: var(--ink);
  }
  .dot {
    width: 9px;
    height: 9px;
    border-radius: 50%;
    background: var(--alert);
  }
  .dot.ok {
    background: var(--ok, #2f8a4e);
  }
  .problem {
    margin: 0 0 4px;
    color: var(--alert);
  }
  .usage {
    margin: 4px 0 8px;
  }
  .usage p {
    margin: 0 0 4px;
  }
  .bar {
    height: 6px;
    border-radius: 999px;
    background: var(--surface-2);
    border: 1px solid var(--line);
    overflow: hidden;
  }
  .bar span {
    display: block;
    height: 100%;
    background: var(--dusk);
  }
  .bar span.warn {
    background: var(--alert);
  }
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
  .body li.off {
    color: var(--muted);
    font-style: italic;
  }
  .body li::marker {
    color: var(--muted);
  }
</style>
