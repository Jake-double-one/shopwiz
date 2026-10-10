import { t } from './i18n.svelte.js';

/** Where someone is, as text: "Fridge › Dairy" or, for items without group, the item itself. */
export const spotPlace = (spot) => spot?.group || spot?.item || '';

/** Human text for an incoming signal. */
export function signalText(sig) {
  const name = sig.from?.name ?? '?';
  const place = sig.place || sig.item || '';
  const last = sig.place && sig.item ? t('signal.last', { item: sig.item }) : '';
  switch (sig.kind) {
    case 'where':
      return t('signal.where', { name });
    case 'come':
      return place ? `${t('signal.comeAt', { name, place })}${last}` : t('signal.come', { name });
    case 'here':
      return place ? `${t('signal.hereAt', { name, place })}${last}` : t('signal.here', { name });
    case 'checkout':
      return t('signal.checkout', { name });
    case 'done':
      return t('signal.done', { name });
    case 'allDone':
      return t('signal.allDone', { list: sig.place });
    default:
      return '';
  }
}
