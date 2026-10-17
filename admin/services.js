/**
 * services.js — Cleaning Services Admin
 *
 * PERSISTENCE NOTE
 * ─────────────────────────────────────────────────────────────────────────────
 * The backend exposes:
 *   GET  /api/admin/services          → lists Service documents (name, category,
 *                                       isActive, basePrice only)
 *   PUT  /api/admin/service-work/checklists/:category
 *                                     → saves checklist tasks (enabled/disabled
 *                                       task items, not "included/excluded" text)
 *
 * There is NO existing endpoint to:
 *   • Create or update a Service document (name, price, offer price, status)
 *   • Store "What's Included" / "What's Not Included" free-text lists
 *
 * To make this page fully persistent you would need to add to the backend:
 *   POST  /api/admin/services          → create a Service
 *   PATCH /api/admin/services/:id      → update name, basePrice, isActive, etc.
 *   DELETE /api/admin/services/:id     → remove a Service
 *   A new schema field (e.g. includedItems[], excludedItems[], offerPrice,
 *   originalPrice) on the Service model, or a separate ServiceOffer model.
 *
 * Until those endpoints exist, this page:
 *   • Loads real service data from the backend (read-only).
 *   • Stores all edits (price, offer price, included/excluded items) in
 *     localStorage under the key "apnaservo_admin_services_local".
 *   • Publish/unpublish (isActive) is also stored locally only.
 *   • A yellow banner on the page makes this clear to the admin.
 * ─────────────────────────────────────────────────────────────────────────────
 */

'use strict';

// ── Auth guard ──────────────────────────────────────────────────────────────
if (!requireAuth()) throw new Error('not authenticated');

const user = getUser();
if (user) document.getElementById('topbarUser').textContent = user.name || user.email || '';

// ── Local storage helpers ────────────────────────────────────────────────────
const LOCAL_KEY = 'apnaservo_admin_services_local';

function loadLocal() {
  try { return JSON.parse(localStorage.getItem(LOCAL_KEY) || '{}'); } catch { return {}; }
}

function saveLocal(map) {
  localStorage.setItem(LOCAL_KEY, JSON.stringify(map));
}

// ── State ────────────────────────────────────────────────────────────────────
let services = [];       // merged list shown in the UI
let editingId = null;    // null = new service

// ── DOM refs ─────────────────────────────────────────────────────────────────
const listEl      = document.getElementById('serviceList');
const listAlert   = document.getElementById('listAlert');
const modal       = document.getElementById('modal');
const modalTitle  = document.getElementById('modalTitle');
const modalAlert  = document.getElementById('modalAlert');
const saveBtn     = document.getElementById('saveBtn');
const cancelBtn   = document.getElementById('cancelBtn');
const modalClose  = document.getElementById('modalClose');

// ── Fetch services from backend ───────────────────────────────────────────────
async function fetchServices() {
  try {
    const res = await apiFetch('/api/admin/services');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    return (data.rows || []).filter(r => {
      // Keep only cleaning-related categories
      const cat = String(r.category || r.serviceCategory || '').toLowerCase();
      return cat.includes('clean') || cat === 'cleaning';
    });
  } catch (err) {
    if (err.message !== 'Session expired') showListAlert('Could not load services from server: ' + err.message, 'error');
    return [];
  }
}

// ── Merge backend rows with local overrides ───────────────────────────────────
function mergeWithLocal(backendRows) {
  const local = loadLocal();
  // Start with backend rows
  const merged = backendRows.map(r => {
    const id = r.id || r._id || r.category || r.serviceCategory;
    const ov = local[id] || {};
    return {
      id,
      name:          ov.name          ?? r.name          ?? '',
      category:      r.category       || r.serviceCategory || '',
      price:         ov.price         ?? r.basePrice      ?? 0,
      originalPrice: ov.originalPrice ?? null,
      offerPrice:    ov.offerPrice    ?? null,
      active:        ov.active        ?? (r.active !== false),
      published:     ov.published     ?? (r.active !== false),
      includedItems: ov.includedItems ?? [],
      excludedItems: ov.excludedItems ?? [],
      _source: 'backend'
    };
  });
  // Add locally-created services (not from backend)
  for (const [id, ov] of Object.entries(local)) {
    if (!merged.find(s => s.id === id) && ov._localOnly) {
      merged.push({ ...ov, id, _source: 'local' });
    }
  }
  return merged;
}

// ── Render list ───────────────────────────────────────────────────────────────
function renderList() {
  if (!services.length) {
    listEl.innerHTML = `<div class="empty-state"><p>No cleaning services found.</p><p>Click <strong>+ Add Service</strong> to create one.</p></div>`;
    return;
  }
  listEl.innerHTML = services.map(s => `
    <div class="service-row" data-id="${esc(s.id)}">
      <div style="flex:1">
        <div class="service-name">${esc(s.name)}</div>
        <div class="service-meta">
          ${s.category ? `<span>${esc(s.category)}</span> · ` : ''}
          ₹${s.price}
          ${s.offerPrice ? ` <span style="color:var(--success)">→ ₹${s.offerPrice}</span>` : ''}
          ${s.originalPrice ? ` <span style="text-decoration:line-through;color:var(--muted)">₹${s.originalPrice}</span>` : ''}
        </div>
      </div>
      <span class="badge ${s.active ? 'badge-active' : 'badge-inactive'}">${s.active ? 'Active' : 'Inactive'}</span>
      <span class="badge ${s.published ? 'badge-published' : 'badge-inactive'}">${s.published ? 'Published' : 'Unpublished'}</span>
      <div class="service-actions">
        <button class="btn btn-secondary btn-sm" onclick="openEdit('${esc(s.id)}')">Edit</button>
        <button class="btn btn-secondary btn-sm" onclick="togglePublish('${esc(s.id)}')">${s.published ? 'Unpublish' : 'Publish'}</button>
      </div>
    </div>
  `).join('');
}

// ── Publish / Unpublish ───────────────────────────────────────────────────────
function togglePublish(id) {
  const svc = services.find(s => s.id === id);
  if (!svc) return;
  svc.published = !svc.published;
  persistLocal(svc);
  renderList();
  showListAlert(`"${svc.name}" ${svc.published ? 'published' : 'unpublished'} (local only — see persistence note).`, 'info');
}

// ── Persist a service to localStorage ────────────────────────────────────────
function persistLocal(svc) {
  const local = loadLocal();
  local[svc.id] = {
    name:          svc.name,
    category:      svc.category,
    price:         svc.price,
    originalPrice: svc.originalPrice,
    offerPrice:    svc.offerPrice,
    active:        svc.active,
    published:     svc.published,
    includedItems: svc.includedItems,
    excludedItems: svc.excludedItems,
    _localOnly:    svc._source === 'local'
  };
  saveLocal(local);
}

// ── Modal helpers ─────────────────────────────────────────────────────────────
function openModal() { modal.classList.remove('hidden'); document.body.style.overflow = 'hidden'; }
function closeModal() { modal.classList.add('hidden'); document.body.style.overflow = ''; editingId = null; }

modalClose.addEventListener('click', closeModal);
cancelBtn.addEventListener('click', closeModal);
modal.addEventListener('click', e => { if (e.target === modal) closeModal(); });

document.getElementById('addBtn').addEventListener('click', () => {
  editingId = null;
  modalTitle.textContent = 'Add Service';
  clearForm();
  hideModalAlert();
  openModal();
});

function openEdit(id) {
  const svc = services.find(s => s.id === id);
  if (!svc) return;
  editingId = id;
  modalTitle.textContent = 'Edit Service';
  populateForm(svc);
  hideModalAlert();
  openModal();
}

// ── Form helpers ──────────────────────────────────────────────────────────────
function clearForm() {
  document.getElementById('fName').value = '';
  document.getElementById('fCategory').value = '';
  document.getElementById('fPrice').value = '';
  document.getElementById('fOriginalPrice').value = '';
  document.getElementById('fOfferPrice').value = '';
  document.getElementById('fActive').checked = true;
  renderChecklistItems('includedItems', []);
  renderChecklistItems('excludedItems', []);
  clearFieldErrors();
}

function populateForm(svc) {
  document.getElementById('fName').value = svc.name || '';
  document.getElementById('fCategory').value = svc.category || '';
  document.getElementById('fPrice').value = svc.price ?? '';
  document.getElementById('fOriginalPrice').value = svc.originalPrice ?? '';
  document.getElementById('fOfferPrice').value = svc.offerPrice ?? '';
  document.getElementById('fActive').checked = svc.active !== false;
  renderChecklistItems('includedItems', svc.includedItems || []);
  renderChecklistItems('excludedItems', svc.excludedItems || []);
  clearFieldErrors();
}

function clearFieldErrors() {
  ['fName','fCategory','fPrice'].forEach(id => {
    document.getElementById(id).classList.remove('error');
    document.getElementById(id + 'Err').classList.add('hidden');
  });
}

function showFieldError(fieldId, msg) {
  document.getElementById(fieldId).classList.add('error');
  const errEl = document.getElementById(fieldId + 'Err');
  errEl.textContent = msg;
  errEl.classList.remove('hidden');
}

function showModalAlert(msg, type = 'error') {
  modalAlert.className = `alert alert-${type}`;
  modalAlert.textContent = msg;
  modalAlert.classList.remove('hidden');
}

function hideModalAlert() { modalAlert.classList.add('hidden'); }

function showListAlert(msg, type = 'info') {
  listAlert.className = `alert alert-${type}`;
  listAlert.textContent = msg;
  listAlert.classList.remove('hidden');
  clearTimeout(listAlert._timer);
  listAlert._timer = setTimeout(() => listAlert.classList.add('hidden'), 6000);
}

// ── Checklist item rendering ──────────────────────────────────────────────────
function renderChecklistItems(containerId, items) {
  const container = document.getElementById(containerId);
  container.innerHTML = '';
  items.forEach((text, i) => addChecklistRow(containerId, text));
}

function addChecklistRow(containerId, value = '') {
  const container = document.getElementById(containerId);
  const row = document.createElement('div');
  row.className = 'checklist-item';
  row.innerHTML = `
    <input type="text" placeholder="Enter item…" value="${esc(value)}">
    <button type="button" class="btn-icon" title="Remove" aria-label="Remove item">×</button>
  `;
  row.querySelector('.btn-icon').addEventListener('click', () => row.remove());
  container.appendChild(row);
  row.querySelector('input').focus();
}

document.getElementById('addIncluded').addEventListener('click', () => addChecklistRow('includedItems'));
document.getElementById('addExcluded').addEventListener('click', () => addChecklistRow('excludedItems'));

function collectChecklistItems(containerId) {
  return [...document.getElementById(containerId).querySelectorAll('input[type=text]')]
    .map(i => i.value.trim()).filter(Boolean);
}

// ── Validate & save ───────────────────────────────────────────────────────────
saveBtn.addEventListener('click', async () => {
  clearFieldErrors();
  hideModalAlert();

  const name     = document.getElementById('fName').value.trim();
  const category = document.getElementById('fCategory').value.trim().toLowerCase().replace(/\s+/g, '_');
  const price    = parseFloat(document.getElementById('fPrice').value);
  const origP    = document.getElementById('fOriginalPrice').value.trim();
  const offerP   = document.getElementById('fOfferPrice').value.trim();
  const active   = document.getElementById('fActive').checked;

  let valid = true;
  if (!name) { showFieldError('fName', 'Service name is required.'); valid = false; }
  if (!category) { showFieldError('fCategory', 'Category slug is required.'); valid = false; }
  if (isNaN(price) || price < 0) { showFieldError('fPrice', 'Enter a valid price (0 or more).'); valid = false; }
  if (!valid) return;

  // Duplicate category check (only for new services)
  if (!editingId && services.find(s => s.category === category)) {
    showFieldError('fCategory', 'A service with this category slug already exists.');
    return;
  }

  const includedItems = collectChecklistItems('includedItems');
  const excludedItems = collectChecklistItems('excludedItems');

  const svcData = {
    name,
    category,
    price,
    originalPrice: origP ? parseFloat(origP) : null,
    offerPrice:    offerP ? parseFloat(offerP) : null,
    active,
    published:     active,
    includedItems,
    excludedItems
  };

  saveBtn.disabled = true;
  saveBtn.innerHTML = '<span class="spinner"></span> Saving…';

  try {
    if (editingId) {
      // Update existing
      const idx = services.findIndex(s => s.id === editingId);
      services[idx] = { ...services[idx], ...svcData };
      persistLocal(services[idx]);
    } else {
      // Create new (local only)
      const id = 'local_' + Date.now();
      const newSvc = { id, _source: 'local', ...svcData };
      services.push(newSvc);
      persistLocal(newSvc);
    }

    renderList();
    closeModal();
    showListAlert(
      `"${name}" saved locally. ⚠️ Changes are not persisted to the database — a backend endpoint is needed (see persistence note in services.js).`,
      'info'
    );
  } catch (err) {
    showModalAlert('Unexpected error: ' + err.message);
  } finally {
    saveBtn.disabled = false;
    saveBtn.textContent = 'Save Service';
  }
});

// ── Escape HTML ───────────────────────────────────────────────────────────────
function esc(str) {
  return String(str ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ── Init ──────────────────────────────────────────────────────────────────────
async function init() {
  // Show persistence disclaimer banner
  const banner = document.createElement('div');
  banner.className = 'alert alert-info';
  banner.style.cssText = 'margin:16px 0 0;';
  banner.innerHTML = `
    <strong>⚠️ Demo / Local Data Mode:</strong>
    Service names and categories are loaded from the backend (read-only).
    Price, offer price, and included/excluded items are stored in your browser's
    <code>localStorage</code> only — they are <strong>not saved to the database</strong>.
    To persist changes, add <code>POST/PATCH /api/admin/services</code> endpoints
    and extend the <code>Service</code> model with <code>offerPrice</code>,
    <code>originalPrice</code>, <code>includedItems</code>, and <code>excludedItems</code> fields.
  `;
  document.querySelector('.page').prepend(banner);

  listEl.innerHTML = '<div class="empty-state"><p>Loading…</p></div>';
  const backendRows = await fetchServices();
  services = mergeWithLocal(backendRows);
  renderList();
}

init();
