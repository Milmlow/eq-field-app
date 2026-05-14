/*! Property of EQ — all rights reserved. Unauthorised use prohibited. */
// ─────────────────────────────────────────────────────────────
// scripts/virtual-table.js — EQ Solves Field
// EQ Virtual Table — minimal vanilla-JS row virtualisation for
// big-list <table>s. MIT-clean, no third-party deps.
//
// Why this exists (v3.5.4 / FINDING #S2):
//   At Melbourne scale (~577 people) the Contacts page builds a
//   full <tbody> innerHTML on every render. That's ~600 rows of
//   DOM at once — visible chunk on first paint (~100–300ms freeze)
//   plus the memory cost of 600 button event paths. This shim
//   renders only the visible window plus a buffer above/below,
//   and swaps rows on scroll via rAF-throttled listener.
//
// Design (mirrors clusterize.js semantics but is our own code):
//   - Caller owns the outer scrollable container and the <tbody>.
//   - Caller passes an array of pre-rendered <tr> HTML strings.
//   - We render two padding <tr> blocks (top + bottom) at
//     computed heights so the scrollbar matches the true row count.
//   - On scroll, we slice the rows array to the visible window
//     and rebuild the <tbody> innerHTML.
//
// Threshold: callers should only mount this when row count > ~150.
// Below that the innerHTML path is faster (no scroll math overhead).
// ─────────────────────────────────────────────────────────────

window.EQVirtualTable = (function () {
  function mount(opts) {
    const scrollEl = opts.scrollEl;
    const tbodyEl  = opts.tbodyEl;
    const rowHeight = opts.rowHeight || 36;
    const colspan   = opts.colspan   || 1;
    const buffer    = opts.bufferRows || 20;
    let rows = Array.isArray(opts.rows) ? opts.rows : [];

    if (!scrollEl || !tbodyEl) {
      console.warn('EQVirtualTable.mount: scrollEl + tbodyEl required');
      return { update: function(){}, destroy: function(){} };
    }

    let frame = null;
    let destroyed = false;

    function render() {
      frame = null;
      if (destroyed) return;
      const total = rows.length;
      const scrollTop = scrollEl.scrollTop;
      const visH = scrollEl.clientHeight || (rowHeight * 20);
      const startIdx = Math.max(0, Math.floor(scrollTop / rowHeight) - buffer);
      const endIdx   = Math.min(total, startIdx + Math.ceil(visH / rowHeight) + buffer * 2);
      const topPadPx = startIdx * rowHeight;
      const botPadPx = Math.max(0, (total - endIdx) * rowHeight);

      const padTop = '<tr aria-hidden="true" class="eqvt-pad"><td colspan="' + colspan + '" style="padding:0;border:0;height:' + topPadPx + 'px"></td></tr>';
      const padBot = '<tr aria-hidden="true" class="eqvt-pad"><td colspan="' + colspan + '" style="padding:0;border:0;height:' + botPadPx + 'px"></td></tr>';

      tbodyEl.innerHTML = padTop + rows.slice(startIdx, endIdx).join('') + padBot;
    }

    function schedule() {
      if (frame || destroyed) return;
      frame = requestAnimationFrame(render);
    }

    scrollEl.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule, { passive: true });
    render();

    return {
      update: function (newRows, opts2) {
        rows = Array.isArray(newRows) ? newRows : [];
        if (opts2 && opts2.resetScroll) scrollEl.scrollTop = 0;
        render();
      },
      destroy: function () {
        destroyed = true;
        scrollEl.removeEventListener('scroll', schedule);
        window.removeEventListener('resize', schedule);
        if (frame) { cancelAnimationFrame(frame); frame = null; }
      }
    };
  }

  return { mount: mount };
})();
