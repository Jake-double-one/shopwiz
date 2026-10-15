// View preferences of this device (never synced).
import { load, save } from './storage.js';

/** Swipe on an item: 'right' = right checks off, left moves to inactive; 'left' = the other way round; 'off' */
export const SWIPE_MODES = ['right', 'left', 'off'];

export const prefs = $state({
  swipe: SWIPE_MODES.includes(load('swipe')) ? load('swipe') : 'right',
  hideChecked: !!load('hideChecked', false),
  focus: !!load('focus', false),
});

/** Focus mode: only the list – categories and items to check off, nothing else */
export function setFocus(on) {
  prefs.focus = !!on;
  save('focus', prefs.focus);
}

export function setSwipe(mode) {
  prefs.swipe = SWIPE_MODES.includes(mode) ? mode : 'right';
  save('swipe', prefs.swipe);
}

export function setHideChecked(on) {
  prefs.hideChecked = !!on;
  save('hideChecked', prefs.hideChecked);
}

/** What a swipe in direction dir ('left' | 'right') does: 'check' | 'park' | null */
export function swipeAction(dir, mode = prefs.swipe) {
  if (mode === 'off') return null;
  return dir === mode ? 'check' : 'park';
}
