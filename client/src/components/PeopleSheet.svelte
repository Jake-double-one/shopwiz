<script>
  import { untrack } from 'svelte';
  import Sheet from './Sheet.svelte';
  import Icon from './Icon.svelte';
  import { t, relTime } from '../lib/i18n.svelte.js';
  import { renameDevice, kickDevice } from '../lib/actions.js';
  import { isShopping } from '../lib/model.js';

  let { devices, online, me, onclose } = $props();
  let myName = $state(untrack(() => me?.name ?? ''));
  let confirmKick = $state(null);
  const sorted = $derived([...devices].sort((a, b) => (a.devId === me?.devId ? -1 : b.devId === me?.devId ? 1 : b.lastSeenAt - a.lastSeenAt)));

  function saveName() {
    const n = myName.trim();
    if (n && n !== me?.name) renameDevice(n.slice(0, 40));
  }
</script>

<Sheet title={t('people.title')} eyebrow={t('people.count', { count: devices.length })} {onclose}>
  <ul class="people">
    {#each sorted as d (d.devId)}
      {@const isMe = d.devId === me?.devId}
      <li>
        <span class="dot" class:on={online.includes(d.devId)} title={online.includes(d.devId) ? t('people.online') : t('people.offline')}></span>
        <div class="who">
          {#if isMe}
            <input data-1p-ignore data-lpignore="true" data-bwignore data-form-type="other" autocomplete="off" class="input" bind:value={myName} onblur={saveName} onkeydown={(e) => e.key === 'Enter' && e.currentTarget.blur()} maxlength="40" aria-label={t('people.yourName')} />
            <span class="micro">{t('people.you')}</span>
          {:else}
            <span class="name">{d.name}{#if d.ai} <span class="ai-tag">{t('people.ai')}</span>{/if}</span>
            <span class="micro">
              {d.ai ? t('ai.lastUsed', { when: relTime(d.lastSeenAt) }) : online.includes(d.devId) ? t('people.online') : t('people.lastSeen', { when: relTime(d.lastSeenAt) })}
              {#if isShopping(d)} · {t('shopping.badge')}{/if}
            </span>
          {/if}
        </div>
        {#if !isMe}
          {#if confirmKick === d.devId}
            <button class="btn small danger solid" onclick={() => (kickDevice(d.devId), (confirmKick = null))}>{t('people.remove')}</button>
            <button class="btn small" onclick={() => (confirmKick = null)}>{t('cancel')}</button>
          {:else}
            <button class="icon-btn" onclick={() => (confirmKick = d.devId)} aria-label={t('people.removeName', { name: d.name })} title={t('people.removeName', { name: d.name })}>
              <Icon name="x" size={18} />
            </button>
          {/if}
        {/if}
      </li>
    {/each}
  </ul>
  <p class="note">{t('people.note')}</p>
</Sheet>

<style>
  .ai-tag {
    font-family: var(--mono);
    font-size: 0.6rem;
    letter-spacing: 0.08em;
    background: var(--dusk-soft);
    border: 1px solid var(--dusk);
    border-radius: 999px;
    padding: 1px 6px;
    vertical-align: 2px;
  }
  .people {
    list-style: none;
    padding: 0;
    margin: 0 0 14px;
  }
  .people li {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 10px 0;
    border-top: 1px solid var(--line);
  }
  .people li:first-child {
    border-top: 0;
  }
  .who {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .name {
    font-weight: 600;
    overflow-wrap: anywhere;
  }
  .micro {
    text-transform: none;
    letter-spacing: 0.02em;
  }
</style>
