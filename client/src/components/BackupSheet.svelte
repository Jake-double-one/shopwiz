<script>
  import { untrack } from 'svelte';
  import Sheet from './Sheet.svelte';
  import Icon from './Icon.svelte';
  import { t } from '../lib/i18n.svelte.js';
  import { api } from '../lib/api.js';
  import { toast } from '../lib/toast.svelte.js';
  import { sync } from '../lib/sync.svelte.js';
  import { deviceName, setDeviceName, suggestDeviceName } from '../lib/device.js';
  import { downloadText, slug } from '../lib/download.js';
  import { toMarkdown, parseMarkdown, docStats } from '../../../shared/backup.js';

  /** spaceId/v/list are missing when opened from the start screen (import as new ID only) */
  let { spaceId = null, v = null, list = null, onclose, onopen } = $props();

  let text = $state('');
  let fileName = $state('');
  let target = $state(untrack(() => (spaceId ? 'here' : 'new')));
  let newName = $state('');
  let busy = $state(false);
  let error = $state('');
  let fileInput = $state();
  const online = $derived(sync.status === 'online' || !spaceId);

  const doc = $derived(text.trim() ? parseMarkdown(text) : null);
  const stats = $derived(doc ? docStats(doc) : null);
  const listNames = $derived(doc ? doc.lists.map((l) => l.name).filter(Boolean) : []);

  function exportMd(onlyList) {
    const md = toMarkdown(v, { listIds: onlyList ? [list.id] : null });
    const date = new Date().toISOString().slice(0, 10);
    downloadText(`shopwiz-${slug(onlyList ? list.name : v.space?.name)}-${date}.md`, md);
  }

  async function pickFile(e) {
    const f = e.target.files?.[0];
    if (!f) return;
    error = '';
    if (f.size > 1024 * 1024) {
      error = t('backup.tooBig');
      return;
    }
    text = await f.text();
    fileName = f.name;
    if (!newName) newName = parseMarkdown(text).spaceName || f.name.replace(/\.(md|markdown|txt)$/i, '');
  }

  async function runImport() {
    if (!doc || !stats.items) return;
    busy = true;
    error = '';
    try {
      if (target === 'here') {
        const r = await api.importInto(spaceId, doc, list?.id);
        toast(t('backup.done', r.stats));
        onclose();
      } else {
        if (!deviceName()) setDeviceName(suggestDeviceName());
        const name = (newName || doc.spaceName || t('backup.defaultName')).trim().slice(0, 80);
        const firstList = doc.lists.find((l) => l.name)?.name || name;
        const r = await api.createSpace(name, deviceName(), firstList, doc);
        toast(t('backup.done', r.stats));
        onclose();
        onopen(r.id);
      }
    } catch (e) {
      error = e.code === 'offline' ? t('start.offline') : e.code === 'limit' ? t('backup.limit') : e.code === 'rate_limited' ? t('status.limited') : t('backup.failed');
    } finally {
      busy = false;
    }
  }
</script>

<Sheet title={t('backup.title')} eyebrow={v?.space?.name ?? 'ShopWiz'} {onclose}>
  {#if spaceId && v}
    <section>
      <p class="eyebrow">{t('backup.export')}</p>
      <p class="note">{t('backup.exportNote')}</p>
      <div class="stack-btn">
        <button class="btn block" onclick={() => exportMd(false)}><Icon name="copy" />{t('backup.exportAll')}</button>
        {#if list}<button class="btn block" onclick={() => exportMd(true)}><Icon name="list" />{t('backup.exportList', { name: list.name })}</button>{/if}
      </div>
    </section>
  {/if}

  <section>
    <p class="eyebrow">{t('backup.import')}</p>
    <p class="note">{t('backup.importNote')}</p>
    <input bind:this={fileInput} class="sr-only" type="file" accept=".md,.markdown,.txt,text/markdown,text/plain" onchange={pickFile} />
    <button class="btn block" onclick={() => fileInput.click()}><Icon name="folder" />{fileName || t('backup.chooseFile')}</button>
    <label class="field paste">
      <span>{t('backup.orPaste')}</span>
      <textarea data-1p-ignore data-lpignore="true" data-bwignore data-form-type="other" autocomplete="off" class="input paste-text" rows="5" bind:value={text} placeholder={'## Weekly\n- [ ] 2 Milk\n### Bakery\n- [ ] Bread'} spellcheck="false"></textarea>
    </label>

    {#if stats}
      <div class="hint dusk">
        <span class="grow">
          {t('backup.preview', stats)}
          {#if listNames.length}<br /><small>{listNames.join(' · ')}</small>{/if}
        </span>
      </div>

      {#if spaceId}
        <fieldset class="target">
          <label>
            <input type="radio" bind:group={target} value="here" />
            <span><b>{t('backup.intoThis')}</b><br /><small class="muted">{t('backup.intoThisHint', { list: list?.name ?? '' })}</small></span>
          </label>
          <label>
            <input type="radio" bind:group={target} value="new" />
            <span><b>{t('backup.asNew')}</b><br /><small class="muted">{t('backup.asNewHint')}</small></span>
          </label>
        </fieldset>
      {/if}
      {#if target === 'new'}
        <label class="field">
          <span>{t('settings.spaceName')}</span>
          <input data-1p-ignore data-lpignore="true" data-bwignore data-form-type="other" spellcheck="false" autocomplete="off" class="input" bind:value={newName} maxlength="80" placeholder={doc.spaceName || t('backup.defaultName')} />
        </label>
      {/if}
      {#if error}<p class="hint alert">{error}</p>{/if}
      <button class="btn main block" onclick={runImport} disabled={busy || !stats.items || !online}>
        <Icon name="plus" />{t('backup.importButton', { count: stats.items })}
      </button>
      {#if !online}<p class="micro">{t('backup.needsOnline')}</p>{/if}
    {:else if error}
      <p class="hint alert">{error}</p>
    {/if}

    <details class="format">
      <summary class="micro">{t('backup.format')}</summary>
      <pre class="mono">{`# ${t('backup.fmtSpace')}
## ${t('backup.fmtList')}
> ✈️ IT it        ← ${t('backup.fmtTravel')}
- [ ] Bread
### ${t('backup.fmtGroup')}
- [ ] 2 l Milk // ${t('backup.fmtNote')}
- [x] Butter      ← ${t('backup.fmtChecked')}
- [-] Feta        ← ${t('backup.fmtInactive')}
- [ ] ! Coffee → Caffè  ← ${t('backup.fmtExtra')}`}</pre>
    </details>
  </section>
</Sheet>

<style>
  section + section {
    margin-top: 18px;
    padding-top: 16px;
    border-top: 1px solid var(--line);
  }
  .stack-btn {
    display: grid;
    gap: 8px;
  }
  .stack-btn .btn,
  section > .btn {
    justify-content: flex-start;
  }
  .paste {
    margin-top: 12px;
  }
  .paste-text {
    resize: vertical;
    font-family: var(--mono);
    font-size: 0.85rem;
  }
  .target {
    border: 1px solid var(--line);
    border-radius: 14px;
    padding: 10px 14px;
    margin: 0 0 14px;
  }
  .target label {
    display: flex;
    gap: 10px;
    align-items: flex-start;
    padding: 6px 0;
  }
  .target input {
    margin-top: 4px;
    accent-color: var(--dusk);
  }
  .format {
    margin-top: 14px;
  }
  .format summary {
    cursor: pointer;
  }
  pre {
    background: var(--surface-2);
    border: 1px solid var(--line);
    border-radius: 12px;
    padding: 12px;
    font-size: 0.78rem;
    overflow-x: auto;
    white-space: pre;
  }
</style>
