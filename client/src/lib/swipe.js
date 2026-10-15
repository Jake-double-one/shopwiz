// Svelte action: swipe a row sideways with a finger (touch / pen only, never the mouse).
// params: { enabled, actionFor(dir: 'left' | 'right') → action | null, onrun(action), onchange({ dx, action, armed, swiping, settling }) }
// Vertical moves are left to the browser (the row needs `touch-action: pan-y pinch-zoom`).

export function swipeable(node, params) {
  let p = params;
  let g = null;
  let swallowClick = false;
  let timer = null;
  const limit = () => Math.min(140, Math.max(80, node.offsetWidth * 0.28));
  const report = (dx, swiping, settling = false) => {
    const action = dx ? p.actionFor(dx > 0 ? 'right' : 'left') : null;
    const armed = !!action && Math.abs(dx) >= limit();
    p.onchange?.({ dx, action, armed, swiping, settling });
    return { action, armed };
  };

  function down(e) {
    swallowClick = false; // a new touch is a new tap
    if (!p.enabled || e.pointerType === 'mouse' || !e.isPrimary || e.target.closest('.handle, input, textarea')) return;
    g = { x: e.clientX, y: e.clientY, id: e.pointerId, axis: null, armed: false, run: null };
  }
  function move(e) {
    if (!g || e.pointerId !== g.id) return;
    const mx = e.clientX - g.x;
    const my = e.clientY - g.y;
    if (!g.axis) {
      if (Math.abs(mx) < 10 && Math.abs(my) < 10) return;
      g.axis = Math.abs(mx) > Math.abs(my) * 1.2 ? 'x' : 'y';
      if (g.axis === 'y') return (g = null);
      try {
        node.setPointerCapture(e.pointerId);
      } catch {
        /* pointer already gone */
      }
    }
    // no action that way → it only gives a little
    const dx = p.actionFor(mx > 0 ? 'right' : 'left') ? mx : Math.sign(mx) * Math.min(Math.abs(mx) * 0.25, 24);
    const { action, armed } = report(dx, true);
    g.run = armed ? action : null;
    if (armed !== g.armed) {
      g.armed = armed;
      if (armed) navigator.vibrate?.(10);
    }
  }
  function up(e) {
    if (!g || e.pointerId !== g.id) return;
    const { axis, run } = g;
    g = null;
    if (axis !== 'x') return;
    // a click right after the swipe belongs to it – but only right after
    swallowClick = true;
    setTimeout(() => (swallowClick = false), 400);
    report(0, false, true);
    clearTimeout(timer);
    timer = setTimeout(() => p.onchange?.({ dx: 0, action: null, armed: false, swiping: false, settling: false }), 200);
    if (run) p.onrun(run);
  }
  function cancel() {
    if (!g) return;
    g = null;
    report(0, false);
  }
  function click(e) {
    if (!swallowClick) return;
    swallowClick = false;
    e.stopPropagation();
    e.preventDefault();
  }

  node.addEventListener('pointerdown', down);
  node.addEventListener('pointermove', move);
  node.addEventListener('pointerup', up);
  node.addEventListener('pointercancel', cancel);
  node.addEventListener('click', click, true);
  return {
    update(np) {
      p = np;
    },
    destroy() {
      clearTimeout(timer);
      node.removeEventListener('pointerdown', down);
      node.removeEventListener('pointermove', move);
      node.removeEventListener('pointerup', up);
      node.removeEventListener('pointercancel', cancel);
      node.removeEventListener('click', click, true);
    },
  };
}
