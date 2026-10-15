<script>
  import Sheet from './Sheet.svelte';
  import { t } from '../lib/i18n.svelte.js';
  import { setDeviceName, suggestDeviceName } from '../lib/device.js';

  let { ondone, oncancel } = $props();
  let name = $state(suggestDeviceName());

  function submit(e) {
    e.preventDefault();
    const n = name.trim();
    if (!n) return;
    setDeviceName(n.slice(0, 40));
    ondone();
  }
</script>

<Sheet title={t('name.title')} eyebrow={t('name.eyebrow')} onclose={oncancel}>
  <form onsubmit={submit}>
    <p class="note">{t('name.note')}</p>
    <label class="field">
      <span>{t('name.label')}</span>
      <!-- svelte-ignore a11y_autofocus -->
      <input data-1p-ignore data-lpignore="true" data-bwignore data-form-type="other" spellcheck="false" class="input" bind:value={name} maxlength="40" autofocus autocomplete="nickname" required />
    </label>
    <button class="btn main block" type="submit">{t('name.continue')}</button>
  </form>
</Sheet>
