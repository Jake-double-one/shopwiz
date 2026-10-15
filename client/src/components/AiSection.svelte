<script>
  import Icon from './Icon.svelte';
  import { t, relTime } from '../lib/i18n.svelte.js';
  import { sync } from '../lib/sync.svelte.js';
  import { api } from '../lib/api.js';
  import { toast } from '../lib/toast.svelte.js';
  import { updateSpace, kickDevice } from '../lib/actions.js';

  /** AI assistants of this ID: permission, connected ones, connecting a new one */
  let { v, spaceId } = $props();

  const KINDS = ['claude', 'chatgpt', 'grok', 'siri', 'other'];
  const NAMES = { claude: 'Claude', chatgpt: 'ChatGPT', grok: 'Grok', siri: 'Siri' };
  const online = $derived(sync.status === 'online');
  const assistants = $derived(Object.values(v.devices).filter((d) => d.ai));

  let picking = $state(null); // kind being connected
  let otherName = $state('');
  let busy = $state(false);
  let created = $state(null); // { kind, name, key } – the key is shown only now
  let confirmRemove = $state(null);

  const origin = location.origin;
  const mcpUrl = $derived(created ? `${origin}/mcp/${created.key}` : '');
  const restUrl = `${origin}/api/v1/lists/default/items`;

  async function connect(kind) {
    const name = kind === 'other' ? otherName.trim() : NAMES[kind];
    if (!name) return;
    busy = true;
    try {
      const r = await api.connectAi(spaceId, name);
      created = { kind, name: r.name, key: r.key };
      picking = null;
      otherName = '';
    } catch (e) {
      toast({ text: e.code === 'disabled' ? t('ai.disabled') : t('settings.failed'), kind: 'alert' });
    } finally {
      busy = false;
    }
  }

  async function copy(text) {
    try {
      await navigator.clipboard.writeText(text);
      toast(t('ai.copied'));
    } catch {
      window.prompt(t('share.copyManual'), text);
    }
  }
</script>

<div class="ai">
  <p class="eyebrow">{t('ai.title')}</p>
  <label class="switch-row">
    <input type="checkbox" checked={!!v.space?.aiWrite} disabled={!online} onchange={(e) => updateSpace({ aiWrite: e.currentTarget.checked })} />
    <span><b>{t('ai.write')}</b><br /><small class="muted">{v.space?.aiWrite ? t('ai.writeOn') : t('ai.writeOff')}</small></span>
  </label>

  {#if assistants.length}
    <ul class="assistants">
      {#each assistants as a (a.devId)}
        <li>
          <span class="badge-ai">{t('people.ai')}</span>
          <span class="grow"><b>{a.name}</b> <span class="micro">{t('ai.lastUsed', { when: relTime(a.lastSeenAt) })}</span></span>
          {#if confirmRemove === a.devId}
            <button class="btn small danger solid" onclick={() => (kickDevice(a.devId), (confirmRemove = null))}>{t('ai.remove')}</button>
            <button class="btn small" onclick={() => (confirmRemove = null)}>{t('cancel')}</button>
          {:else}
            <button class="btn small" onclick={() => (confirmRemove = a.devId)} disabled={!online}>{t('ai.remove')}</button>
          {/if}
        </li>
      {/each}
    </ul>
  {/if}

  {#if created}
    <div class="created">
      <p><b>{t('ai.connected', { name: created.name })}</b></p>
      <p class="hint alert"><span class="grow">{t('ai.keyOnce')}</span></p>
      {#if created.kind === 'siri'}
        <p class="micro label">{t('ai.restUrl')}</p>
        <button class="copyline mono" onclick={() => copy(restUrl)}><span>{restUrl}</span><Icon name="copy" size={16} /></button>
        <p class="micro label">{t('ai.restKey')}</p>
        <button class="copyline mono" onclick={() => copy(`Bearer ${created.key}`)}><span>Bearer {created.key}</span><Icon name="copy" size={16} /></button>
        <ol class="steps">
          <li>{t('ai.siri.1')}</li>
          <li>{t('ai.siri.2')}</li>
          <li>{t('ai.siri.3')}</li>
          <li>{t('ai.siri.4')}</li>
        </ol>
      {:else}
        <p class="micro label">{t('ai.mcpUrl')}</p>
        <button class="copyline mono" onclick={() => copy(mcpUrl)}><span>{mcpUrl}</span><Icon name="copy" size={16} /></button>
        <p class="note">{t(`ai.howto.${created.kind}`)}</p>
        {#if created.kind === 'other'}
          <p class="micro label">{t('ai.restKey')}</p>
          <button class="copyline mono" onclick={() => copy(`Bearer ${created.key}`)}><span>Bearer {created.key}</span><Icon name="copy" size={16} /></button>
          <p class="note">{t('ai.howto.rest', { url: `${origin}/api/v1/openapi.json` })}</p>
        {/if}
      {/if}
      <button class="btn small" onclick={() => (created = null)}>{t('done')}</button>
    </div>
  {:else if picking === 'other'}
    <form class="row other" onsubmit={(e) => (e.preventDefault(), connect('other'))}>
      <input class="input" bind:value={otherName} maxlength="40" placeholder={t('ai.otherPh')} aria-label={t('ai.otherPh')} data-1p-ignore data-lpignore="true" data-bwignore data-form-type="other" autocomplete="off" />
      <button class="btn main" type="submit" disabled={busy || !otherName.trim()}>{t('ai.connect')}</button>
      <button class="btn" type="button" onclick={() => (picking = null)}>{t('cancel')}</button>
    </form>
  {:else}
    <p class="micro label">{t('ai.add')}</p>
    <div class="kinds">
      {#each KINDS as k (k)}
        <button class="chip" disabled={busy || !online} onclick={() => (k === 'other' ? (picking = 'other') : connect(k))}>{k === 'other' ? t('ai.other') : NAMES[k]}</button>
      {/each}
    </div>
    <p class="note">{t('ai.note')}</p>
  {/if}
</div>

<style>
  .ai {
    display: grid;
    gap: 10px;
  }
  .ai .eyebrow {
    margin: 0;
  }
  .switch-row {
    display: flex;
    gap: 10px;
    align-items: flex-start;
  }
  .switch-row input {
    margin-top: 4px;
    accent-color: var(--dusk);
  }
  .assistants {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 6px;
  }
  .assistants li {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
  }
  .grow {
    flex: 1;
    min-width: 0;
  }
  .badge-ai {
    font-family: var(--mono);
    font-size: 0.6rem;
    letter-spacing: 0.08em;
    background: var(--dusk-soft);
    border: 1px solid var(--dusk);
    border-radius: 999px;
    padding: 1px 6px;
  }
  .kinds {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .label {
    margin: 4px 0 0;
    text-transform: none;
    letter-spacing: 0.02em;
  }
  .created {
    display: grid;
    gap: 8px;
    border: 1px solid var(--line);
    border-radius: 14px;
    padding: 12px;
  }
  .created p {
    margin: 0;
  }
  .copyline {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    text-align: left;
    font-size: 0.78rem;
    padding: 10px 12px;
    border: 1px solid var(--line);
    border-radius: 10px;
    background: var(--surface-2);
    color: var(--ink);
  }
  .copyline span {
    flex: 1;
    min-width: 0;
    overflow-wrap: anywhere;
  }
  .steps {
    margin: 0;
    padding-left: 1.2em;
    font-size: 0.9rem;
    display: grid;
    gap: 4px;
  }
  .other .input {
    flex: 1;
    min-width: 0;
  }
  .note {
    margin: 0;
  }
</style>
