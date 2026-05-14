/*! Property of EQ — all rights reserved. Unauthorised use prohibited. */
// ─────────────────────────────────────────────────────────────
// scripts/site-reports-shared.js  —  EQ Solves Field
// Shared helpers for the Site Reports module family: Prestart
// (site-reports.js), Toolbox (toolbox.js), Diary (diary.js), and
// Weekly Report (weekly.js when it ships).
//
// Extracted in v3.4.76 from the copy-pasted helpers that had
// accumulated in site-reports.js (v3.4.69) and toolbox.js
// (v3.4.75). With four workflows planned, the duplication cost
// was about to compound 4× — refactor now so Diary + Weekly
// start lean.
//
// Surface:
//   SiteReportsShared.createPhotoController(config)
//   SiteReportsShared.createSignatureController(config)
//   SiteReportsShared.createOfflineQueue(config)
//   SiteReportsShared.injectMobileStyle(prefix)
//
// Each controller is bound to a single workflow at construction
// time. Workflow modules keep tiny shim functions with their
// global names (addToolboxPhoto, etc.) so inline onclick=""
// attributes continue to work without DOM-attribute refactors.
//
// Load order: BEFORE site-reports.js, toolbox.js, diary.js.
// Depends on: utils.js (esc, showToast), supabase.js (sbFetch),
//             app-state.js (TENANT, currentPage).
// ─────────────────────────────────────────────────────────────

(function () {
  'use strict';

  // ══════════════════════════════════════════════════════════
  // PHOTO CONTROLLER
  // ══════════════════════════════════════════════════════════
  //
  // config: {
  //   getDraft:      () => draft,            // current draft ref
  //   onChange:      () => void,             // re-render trigger
  //   prefix:        'prestart' | 'toolbox' | 'diary',
  //   maxPhotos:     8,
  //   maxDim:        1600,
  //   quality:       0.7,
  //   callbackNames: { add, remove, setCaption, lightbox }
  // }
  //
  function createPhotoController(config) {
    const cfg = Object.assign({
      maxPhotos: 8,
      maxDim:    1600,
      quality:   0.7,
    }, config || {});

    function add(fileInput) {
      const draft = cfg.getDraft();
      if (!draft) return;
      if (!fileInput.files || !fileInput.files[0]) return;
      if ((draft.photos || []).length >= cfg.maxPhotos) {
        if (typeof showToast === 'function') showToast('Max ' + cfg.maxPhotos + ' photos');
        return;
      }
      const file = fileInput.files[0];
      if (!/^image\//.test(file.type)) {
        if (typeof showToast === 'function') showToast('Image files only');
        return;
      }
      _resizeImageToBase64(file, function (base64) {
        if (!base64) {
          if (typeof showToast === 'function') showToast('Photo too large or unreadable');
          return;
        }
        if (!Array.isArray(draft.photos)) draft.photos = [];
        draft.photos.push({
          id:       'p_' + Date.now() + '_' + Math.floor(Math.random() * 1000),
          caption:  '',
          base64:   base64,
          taken_at: new Date().toISOString(),
          taken_by: (typeof currentManagerName !== 'undefined' && currentManagerName) || null,
        });
        fileInput.value = '';
        cfg.onChange();
      });
    }

    function remove(i) {
      const draft = cfg.getDraft();
      if (!draft || !draft.photos) return;
      draft.photos.splice(i, 1);
      cfg.onChange();
    }

    function setCaption(i, caption) {
      // Deliberately no re-render — would lose textarea focus mid-typing.
      const draft = cfg.getDraft();
      if (!draft || !draft.photos || !draft.photos[i]) return;
      draft.photos[i].caption = caption;
    }

    function lightbox(i) {
      const draft = cfg.getDraft();
      if (!draft || !draft.photos || !draft.photos[i]) return;
      const p = draft.photos[i];
      const overlay = document.createElement('div');
      overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.92);display:flex;align-items:center;justify-content:center;z-index:9999;padding:20px;cursor:zoom-out';
      overlay.onclick = function () { overlay.remove(); };
      const img = document.createElement('img');
      img.src = p.base64;
      img.style.cssText = 'max-width:100%;max-height:90vh;object-fit:contain';
      overlay.appendChild(img);
      document.body.appendChild(overlay);
    }

    function _resizeImageToBase64(file, callback) {
      const reader = new FileReader();
      reader.onload = function (e) {
        const img = new Image();
        img.onload = function () {
          let width = img.width;
          let height = img.height;
          const max = cfg.maxDim;
          if (width > max || height > max) {
            const scale = Math.min(max / width, max / height);
            width  = Math.round(width * scale);
            height = Math.round(height * scale);
          }
          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, width, height);
          try { callback(canvas.toDataURL('image/jpeg', cfg.quality)); }
          catch (err) { callback(null); }
        };
        img.onerror = function () { callback(null); };
        img.src = e.target.result;
      };
      reader.onerror = function () { callback(null); };
      reader.readAsDataURL(file);
    }

    function renderList(draft) {
      const photos = (draft && draft.photos) || [];
      const cb = cfg.callbackNames;
      const grid = photos.map(function (p, i) {
        const cap = p.caption
          ? '<div style="position:absolute;bottom:0;left:0;right:0;background:rgba(0,0,0,.65);color:#fff;font-size:9px;padding:2px 4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + esc(p.caption) + '</div>'
          : '';
        return '<div style="position:relative;width:84px;height:84px;border-radius:6px;overflow:hidden;border:1px solid var(--border);background:var(--surface-2);cursor:pointer;flex-shrink:0">'
          + '<img src="' + esc(p.base64) + '" style="width:100%;height:100%;object-fit:cover" onclick="' + cb.lightbox + '(' + i + ')">'
          + '<button onclick="' + cb.remove + '(' + i + ');event.stopPropagation()" title="Remove" style="position:absolute;top:2px;right:2px;background:rgba(0,0,0,.6);color:#fff;border:none;border-radius:50%;width:20px;height:20px;cursor:pointer;font-size:11px;line-height:1;display:flex;align-items:center;justify-content:center">✕</button>'
          + cap
        + '</div>';
      }).join('');
      const addBtn = photos.length < cfg.maxPhotos
        ? '<label style="width:84px;height:84px;border:1px dashed var(--border);border-radius:6px;display:flex;flex-direction:column;align-items:center;justify-content:center;cursor:pointer;background:var(--surface);font-size:10px;color:var(--ink-3);user-select:none;flex-shrink:0">'
          + '<span style="font-size:22px;line-height:1">📷</span>'
          + '<span style="margin-top:2px">Add photo</span>'
          + '<input type="file" accept="image/*" capture="environment" onchange="' + cb.add + '(this)" style="display:none">'
        + '</label>'
        : '';
      const captionInputs = photos.length
        ? '<div style="margin-top:8px;display:grid;grid-template-columns:1fr 1fr;gap:6px">'
          + photos.map(function (p, i) {
            return '<input type="text" placeholder="Caption photo ' + (i + 1) + '" value="' + esc(p.caption || '') + '" oninput="' + cb.setCaption + '(' + i + ', this.value)" style="padding:6px 8px;border:1px solid var(--border);border-radius:6px;font-size:11px;font-family:inherit">';
          }).join('')
        + '</div>'
        : '';
      return '<div style="display:flex;flex-wrap:wrap;gap:6px">' + grid + addBtn + '</div>' + captionInputs;
    }

    return { add: add, remove: remove, setCaption: setCaption, lightbox: lightbox, renderList: renderList, maxPhotos: cfg.maxPhotos };
  }

  // ══════════════════════════════════════════════════════════
  // SIGNATURE CONTROLLER
  // ══════════════════════════════════════════════════════════
  //
  // config: {
  //   getDraft:      () => draft,
  //   attendanceKey: 'crew' | 'attendance' | 'attendees',  // array on draft
  //   onChange:      () => void,
  //   prefix:        'prestart' | 'toolbox' | 'diary',
  //   workflowLabel: 'Prestart Crew' | 'Toolbox' | 'Diary',
  // }
  //
  function createSignatureController(config) {
    const cfg = Object.assign({}, config || {});
    const modalId  = 'modal-' + cfg.prefix + '-signature';
    const canvasId = cfg.prefix + '-sig-canvas';
    const titleId  = cfg.prefix + '-sig-title';
    const saveBtnId = cfg.prefix + '-sig-save-btn';

    let canvasState = null;

    function openModal(attendeeIndex) {
      const draft = cfg.getDraft();
      if (!draft) return;
      const list = draft[cfg.attendanceKey];
      if (!list || !list[attendeeIndex]) return;
      if (list[attendeeIndex].signed_at) return; // idempotent (v3.4.54)

      const name = list[attendeeIndex].name;
      let modal = document.getElementById(modalId);
      if (!modal) {
        modal = document.createElement('div');
        modal.className = 'modal-overlay';
        modal.id = modalId;
        modal.innerHTML =
            '<div class="modal" style="max-width:480px;width:92vw">'
          +   '<div class="modal-header">'
          +     '<h3 id="' + titleId + '" style="margin:0">Sign — </h3>'
          +     '<button class="modal-close" data-sig-close="1">✕</button>'
          +   '</div>'
          +   '<div class="modal-body" style="padding:14px">'
          +     '<div style="font-size:11px;color:var(--ink-3);margin-bottom:6px">Sign with your finger or mouse — stamps signed_at + signed_by onto the record.</div>'
          +     '<canvas id="' + canvasId + '" style="width:100%;height:200px;background:#fff;border:1px solid var(--border);border-radius:8px;touch-action:none;display:block"></canvas>'
          +     '<div style="display:flex;gap:8px;align-items:center;margin-top:12px">'
          +       '<button class="btn btn-secondary btn-sm" data-sig-clear="1">Clear</button>'
          +       '<div style="flex:1"></div>'
          +       '<button class="btn btn-secondary btn-sm" data-sig-close="1">Cancel</button>'
          +       '<button class="btn" id="' + saveBtnId + '">Save signature</button>'
          +     '</div>'
          +   '</div>'
          + '</div>';
        document.body.appendChild(modal);
        // Wire close/clear via data attributes (event delegation)
        modal.addEventListener('click', function (e) {
          const t = e.target;
          if (t.dataset && t.dataset.sigClose) closeModal();
          if (t.dataset && t.dataset.sigClear) clearCanvas();
        });
      }

      document.getElementById(titleId).textContent = 'Sign — ' + name;
      const saveBtn = document.getElementById(saveBtnId);
      if (saveBtn) saveBtn.onclick = function () { saveSignature(attendeeIndex); };
      // The modal-opening global is window.openModal (utils.js). Our factory's
      // own openModal is the entry point that ends up here, so we call the
      // global one by its window-qualified name to avoid the self-reference.
      if (typeof window.openModal === 'function') window.openModal(modalId);
      setTimeout(initCanvas, 30);
    }

    function initCanvas() {
      const canvas = document.getElementById(canvasId);
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      canvas.width  = rect.width  * dpr;
      canvas.height = rect.height * dpr;
      const ctx = canvas.getContext('2d');
      ctx.scale(dpr, dpr);
      ctx.lineWidth   = 2.2;
      ctx.lineCap     = 'round';
      ctx.lineJoin    = 'round';
      ctx.strokeStyle = '#1A1A2E';
      canvasState = { canvas: canvas, ctx: ctx, drawing: false, hasInk: false };

      function pos(evt) {
        const r = canvas.getBoundingClientRect();
        const t = evt.touches ? evt.touches[0] : evt;
        return { x: t.clientX - r.left, y: t.clientY - r.top };
      }
      function start(evt) { evt.preventDefault(); canvasState.drawing = true; const p = pos(evt); ctx.beginPath(); ctx.moveTo(p.x, p.y); }
      function move(evt)  { if (!canvasState.drawing) return; evt.preventDefault(); const p = pos(evt); ctx.lineTo(p.x, p.y); ctx.stroke(); canvasState.hasInk = true; }
      function end(evt)   { if (evt) evt.preventDefault(); canvasState.drawing = false; }
      canvas.addEventListener('mousedown',  start);
      canvas.addEventListener('mousemove',  move);
      canvas.addEventListener('mouseup',    end);
      canvas.addEventListener('mouseleave', end);
      canvas.addEventListener('touchstart', start);
      canvas.addEventListener('touchmove',  move);
      canvas.addEventListener('touchend',   end);
    }

    function clearCanvas() {
      if (!canvasState) return;
      const c = canvasState.canvas;
      canvasState.ctx.clearRect(0, 0, c.width, c.height);
      canvasState.hasInk = false;
    }

    function saveSignature(attendeeIndex) {
      if (!canvasState || !canvasState.hasInk) {
        if (typeof showToast === 'function') showToast('Sign first — empty signatures don\'t count');
        return;
      }
      const dataUri = canvasState.canvas.toDataURL('image/png');
      const draft = cfg.getDraft();
      if (!draft) return;
      const list = draft[cfg.attendanceKey];
      if (!list || !list[attendeeIndex]) return;
      list[attendeeIndex].signature_image = dataUri;
      list[attendeeIndex].signed_at = new Date().toISOString();
      list[attendeeIndex].signed_by = (typeof currentManagerName !== 'undefined' && currentManagerName) || null;
      closeModal();
      cfg.onChange();
    }

    function closeModal() {
      if (typeof window.closeModal === 'function') window.closeModal(modalId);
      canvasState = null;
    }

    return { openModal: openModal, clearCanvas: clearCanvas, saveSignature: saveSignature, closeModal: closeModal };
  }

  // ══════════════════════════════════════════════════════════
  // OFFLINE QUEUE
  // ══════════════════════════════════════════════════════════
  //
  // config: {
  //   storageKey:     'eq_toolbox_offline_queue_v1',
  //   pillElementId:  'toolbox-offline-pill',
  //   pageName:       'toolbox',           // STATE.currentPage value for replay re-render
  //   reloadAndRender: async () => { await load(); render(); },
  //   table:           'toolbox_talks',    // PostgREST table name
  // }
  //
  // KNOWN LIMITATION (flagged in 2026-05-14 review):
  // localStorage is synchronous, capped at ~5-10MB, and can throw in
  // private mode. With 8-photo records at ~1.2MB each, a small queue
  // can fill the bucket. Migrate to IndexedDB before customer #2.
  //
  function createOfflineQueue(config) {
    const cfg = Object.assign({}, config || {});

    function readQueue() {
      try { return JSON.parse(localStorage.getItem(cfg.storageKey) || '[]'); }
      catch (e) { return []; }
    }
    function writeQueue(items) {
      try { localStorage.setItem(cfg.storageKey, JSON.stringify(items || [])); }
      catch (e) { console.warn('EQ[' + cfg.pageName + '] queue write failed (storage full?):', e); }
    }

    function enqueue(method, path, payload, localId) {
      const queue = readQueue();
      queue.push({
        qid:       'q_' + Date.now() + '_' + Math.floor(Math.random() * 1000),
        localId:   localId,
        queued_at: new Date().toISOString(),
        tenant:    (typeof TENANT !== 'undefined' && TENANT.ORG_SLUG) || 'unknown',
        method:    method,
        path:      path,
        payload:   payload,
      });
      writeQueue(queue);
      updateBadge();
    }

    function updateBadge() {
      const myTenant = (typeof TENANT !== 'undefined' && TENANT.ORG_SLUG) || 'unknown';
      const queue = readQueue().filter(function (q) { return q.tenant === myTenant; });
      const el = document.getElementById(cfg.pillElementId);
      if (el) {
        if (queue.length) {
          el.style.display = '';
          el.textContent = '⏳ ' + queue.length + ' offline write' + (queue.length === 1 ? '' : 's') + ' pending';
        } else {
          el.style.display = 'none';
        }
      }
    }

    async function replay() {
      if (!navigator.onLine) return;
      const all = readQueue();
      if (!all.length) return;
      const myTenant = (typeof TENANT !== 'undefined' && TENANT.ORG_SLUG) || 'unknown';
      const remaining = [];
      let synced = 0;
      for (const item of all) {
        if (item.tenant !== myTenant) { remaining.push(item); continue; }
        try {
          await sbFetch(item.path, item.method, item.payload, 'return=minimal');
          synced++;
        } catch (e) {
          console.warn('EQ[' + cfg.pageName + '] replay failed for', item.qid, e && e.message || e);
          remaining.push(item);
        }
      }
      writeQueue(remaining);
      updateBadge();
      if (synced > 0) {
        if (typeof showToast === 'function') showToast('Synced ' + synced + ' offline ' + cfg.pageName + ' record' + (synced === 1 ? '' : 's'));
        if (typeof cfg.reloadAndRender === 'function') {
          await cfg.reloadAndRender();
        }
      }
    }

    // Unified persist — common path for all workflows. Returns the
    // written row (or a synthetic {id, _offline:true} when queued).
    async function persist(record, currentId, payload) {
      const method = currentId ? 'PATCH' : 'POST';
      const path = currentId
        ? cfg.table + '?id=eq.' + encodeURIComponent(currentId)
        : cfg.table;

      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        const localId = currentId || ('local_' + Date.now() + '_' + Math.floor(Math.random() * 1000));
        enqueue(method, path, payload, localId);
        if (typeof showToast === 'function') showToast('Offline — saved locally, will sync when connected');
        return { id: localId, _offline: true };
      }

      try {
        const ret = await sbFetch(path, method, payload, 'return=representation');
        if (Array.isArray(ret) && ret[0]) return ret[0];
        return currentId ? { id: currentId } : { id: null };
      } catch (e) {
        const localId = currentId || ('local_' + Date.now() + '_' + Math.floor(Math.random() * 1000));
        enqueue(method, path, payload, localId);
        if (typeof showToast === 'function') showToast('Network hiccup — saved locally, will sync');
        return { id: localId, _offline: true };
      }
    }

    function startReplayListener(initialDelayMs) {
      if (typeof window === 'undefined') return;
      window.addEventListener('online', replay);
      setTimeout(replay, initialDelayMs || 1500);
    }

    return {
      enqueue:             enqueue,
      replay:              replay,
      updateBadge:         updateBadge,
      persist:             persist,
      startReplayListener: startReplayListener,
    };
  }

  // ══════════════════════════════════════════════════════════
  // MOBILE STYLE INJECTION
  // ══════════════════════════════════════════════════════════
  //
  // Each workflow's modal collapses to full-screen below 640px and
  // its two-column grids re-stack to one column. Signature canvas
  // gets a bigger touch target on mobile.
  //
  function injectMobileStyle(prefix) {
    const id = prefix + '-mvp-style';
    if (document.getElementById(id)) return;
    const s = document.createElement('style');
    s.id = id;
    const formBodyId = prefix + '-form-body';
    const modalRootId = 'modal-' + prefix;
    const sigModalId = 'modal-' + prefix + '-signature';
    s.textContent = ''
      + '@media (max-width: 640px) {'
      +   '#' + modalRootId + ' .modal { max-width:100vw !important; width:100vw !important; height:100vh !important; max-height:100vh !important; border-radius:0 !important; }'
      +   '#' + formBodyId + ' div[style*="grid-template-columns:1fr 1fr"],'
      +   '#' + formBodyId + ' div[style*="grid-template-columns: 1fr 1fr"]'
      +   ' { grid-template-columns:1fr !important; }'
      +   '#' + sigModalId + ' .modal { max-width:100vw !important; width:100vw !important; }'
      +   '#' + sigModalId + ' canvas { height:260px !important; }'
      + '}';
    document.head.appendChild(s);
  }

  // ── Export ─────────────────────────────────────────────────
  window.SiteReportsShared = {
    createPhotoController:     createPhotoController,
    createSignatureController: createSignatureController,
    createOfflineQueue:        createOfflineQueue,
    injectMobileStyle:         injectMobileStyle,
  };
})();
