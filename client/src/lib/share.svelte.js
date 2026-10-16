// Text shared to the installed app ("Share → ShopWiz" on a web page, a recipe, a note).
// The add bar picks it up and offers to add one item per line.
import { splitLines } from '../../../shared/parse.js';

export const shared = $state({ lines: null });

/** Called on start: /share?title=…&text=…&url=… (see share_target in the manifest) → true if it was a share */
export function takeShare() {
  if (location.pathname !== '/share') return false;
  const p = new URLSearchParams(location.search);
  const lines = splitLines(p.get('text') || p.get('title') || '')
    // a page link that comes along is no item
    .filter((l) => !/^https?:\/\/\S+$/i.test(l))
    .slice(0, 200);
  if (lines.length) shared.lines = lines;
  return true;
}
