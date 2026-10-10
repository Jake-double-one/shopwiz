import Sortable from 'sortablejs';

/**
 * Svelte action: makes a container sortable. The DOM move is reverted right away and
 * `onmove` is called instead – Svelte stays the only one rendering the list.
 * params: { group, draggable, handle, onmove({ id, from, to, oldIndex, newIndex }) }
 */
export function sortable(node, params) {
  let p = params;
  let next = null;
  const s = Sortable.create(node, {
    group: p.group,
    draggable: p.draggable,
    handle: p.handle,
    sort: p.sort !== false,
    animation: 150,
    delay: 120,
    delayOnTouchOnly: true,
    touchStartThreshold: 4,
    ghostClass: 'drag-ghost',
    chosenClass: 'drag-chosen',
    fallbackOnBody: true,
    swapThreshold: 0.6,
    onStart(evt) {
      // remember the exact neighbour (may be a Svelte anchor comment) to restore the DOM later
      next = evt.item.nextSibling;
      document.body.classList.add('dragging');
    },
    onEnd(evt) {
      document.body.classList.remove('dragging');
      const { item, from, to, oldIndex, newIndex } = evt;
      if (from === to && oldIndex === newIndex) return;
      // revert, so Svelte's DOM bookkeeping stays intact
      from.insertBefore(item, next && next.parentNode === from ? next : null);
      p.onmove({ id: item.dataset.id, from: from.dataset, to: to.dataset, newIndex: evt.newDraggableIndex });
    },
  });
  return {
    update(np) {
      p = np;
    },
    destroy() {
      s.destroy();
    },
  };
}
