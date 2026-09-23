// ─── Auth (Supabase) ─────────────────────────────────────────
const Auth = {
  client: null,
  async init() {
    const cfg = await (await fetch('/api/config')).json();
    this.client = supabase.createClient(cfg.supabaseUrl, cfg.supabaseKey);
    const { data } = await this.client.auth.getSession();
    return data.session;
  },
  async token() {
    const { data } = await this.client.auth.getSession(); // refreshes automatically when needed
    return data.session?.access_token;
  },
  async login(email, password) {
    const { data, error } = await this.client.auth.signInWithPassword({ email, password });
    if (error) throw error;
    return data.session;
  },
  async logout() {
    await this.client.auth.signOut();
    location.reload();
  },
  async changePassword(password) {
    const { error } = await this.client.auth.updateUser({ password });
    if (error) throw error;
  }
};

// ─── API wrapper: adds the login token, handles expired sessions ─
const API = {
  async request(method, path, body) {
    const headers = { Authorization: `Bearer ${await Auth.token()}` };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    let res;
    try {
      res = await fetch(`/api${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    } catch {
      showToast('تعذّر الاتصال بالخادم — تحقق من الإنترنت', 'error');
      throw new Error('تعذّر الاتصال بالخادم');
    }
    if (res.status === 401) { showLogin('انتهت الجلسة، الرجاء تسجيل الدخول مجدداً'); throw new Error('Not logged in'); }
    let data;
    try { data = await res.json(); } catch { data = { error: `استجابة غير متوقعة من الخادم (${res.status})` }; }
    if (!res.ok && data && data.error) showToast(data.error, 'error');
    return data;
  },
  get(path) { return this.request('GET', path); },
  post(path, body) { return this.request('POST', path, body); },
  put(path, body) { return this.request('PUT', path, body); },
  delete(path) { return this.request('DELETE', path); }
};

// Escape text before putting it into HTML (names with ' " < & etc.)
function esc(v) {
  return String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Today's date in Jordan time as YYYY-MM-DD (not UTC)
function todayLocal() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Amman' });
}

function showToast(msg, type = '') {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = `toast show ${type}`;
  setTimeout(() => t.className = 'toast', 3000);
}

function openModal(title, bodyHtml) {
  document.getElementById('modalTitle').textContent = title;
  document.getElementById('modalBody').innerHTML = bodyHtml;
  document.getElementById('modalOverlay').classList.add('open');
}

function closeModal() {
  document.getElementById('modalOverlay').classList.remove('open');
}

function formatDate(d) {
  if (!d) return '-';
  const date = new Date(d);
  return isNaN(date.getTime()) ? '-' : date.toLocaleDateString('ar-JO-u-nu-latn');
}

function statusBadge(status) {
  const map = {
    'active': ['badge-green', 'منتظم ✓'],
    'transferred': ['badge-gray', 'منتقل'],
    'dropped': ['badge-red', 'منقطع'],
    'graduated': ['badge-blue', 'خريج']
  };
  const [cls, label] = map[status] || ['badge-gray', status];
  return `<span class="badge ${cls}">${esc(label)}</span>`;
}

function gradeBadge(letter) {
  const cls = {
    'A+': 'grade-A-plus', 'A': 'grade-A', 'B': 'grade-B',
    'C': 'grade-C', 'D': 'grade-D', 'F': 'grade-F'
  }[letter] || '';
  return `<span class="${cls}">${letter || '-'}</span>`;
}

function attendanceBadge(status) {
  const map = {
    'present': ['att-present', 'حاضر'],
    'absent': ['att-absent', 'غائب'],
    'late': ['att-late', 'متأخر'],
    'excused': ['att-excused', 'غياب بعذر']
  };
  const [cls, label] = map[status] || ['', status];
  return `<span class="${cls}">${esc(label)}</span>`;
}

// Run a save only once at a time (stops double clicks from creating duplicate payments etc.)
const _busy = new Set();
async function once(key, fn) {
  if (_busy.has(key)) return;
  _busy.add(key);
  try { return await fn(); } finally { _busy.delete(key); }
}

// Simple checks used by the student form
const isValidPhone = v => !v || /^[+\d\s\-()]{6,30}$/.test(v);
const isValidEmail = v => !v || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);

/**
 * Parse CSV text (as saved by Excel) into row objects keyed by the header row.
 * Handles quoted fields, "" escapes and a UTF-8 BOM. Headers are lower-cased, spaces → _.
 */
function parseCSV(text) {
  const rows = [];
  const lines = (text ?? '').replace(/^\uFEFF/, '').split(/\r\n|\n|\r/).filter(l => l.trim() !== '');
  if (!lines.length) return rows;
  const parseLine = (line) => {
    const cells = [];
    let cur = '', inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (inQuotes) {
        if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
        else if (c === '"') inQuotes = false;
        else cur += c;
      } else if (c === '"') inQuotes = true;
      else if (c === ',') { cells.push(cur); cur = ''; }
      else cur += c;
    }
    cells.push(cur);
    return cells.map(c => c.trim());
  };
  const headers = parseLine(lines[0]).map(h => h.toLowerCase().replace(/\s+/g, '_'));
  for (let i = 1; i < lines.length; i++) {
    const cells = parseLine(lines[i]);
    const row = {};
    headers.forEach((h, idx) => { row[h] = cells[idx] ?? ''; });
    rows.push(row);
  }
  return rows;
}

/** Read a chosen CSV file, send it to an import endpoint, and show the result. */
async function importCSVFile(event, endpoint, resultElId, label, afterImport) {
  const file = event.target.files?.[0];
  event.target.value = ''; // allow choosing the same file again
  if (!file) return;
  const resultEl = document.getElementById(resultElId);
  if (resultEl) resultEl.innerHTML = '<div class="loading"><div class="spinner"></div> جارٍ استيراد الملف…</div>';
  const rows = parseCSV(await file.text());
  if (!rows.length) {
    if (resultEl) resultEl.innerHTML = '';
    return showToast('الملف فارغ أو غير صالح', 'error');
  }
  const result = await API.post(endpoint, { rows });
  if (!result || !result.success) { if (resultEl) resultEl.innerHTML = ''; return; }
  renderImportResult(result, resultEl, label);
  showToast(`تم استيراد ${result.imported} من سجلات ${label}${result.skipped ? `، وتعذّر ${result.skipped}` : ''}`, result.skipped ? 'error' : 'success');
  if (afterImport) afterImport();
}

/** Show how many rows were imported and the first problems (with line numbers). */
function renderImportResult(result, container, label) {
  if (!container) return;
  const errorRows = (result.errors ?? []).slice(0, 10);
  container.innerHTML = `
    <div class="alert ${result.skipped ? 'alert-yellow' : 'alert-green'}">
      تم استيراد <strong>${result.imported}</strong> من سجلات ${esc(label)}${result.skipped ? `، وتعذّر استيراد <strong>${result.skipped}</strong> سجل` : ''}.
      ${errorRows.length ? `
        <ul style="margin-top:8px; padding-right:18px;">
          ${errorRows.map(e => `<li>السطر ${e.row}: ${esc(e.reason)}</li>`).join('')}
        </ul>
        ${result.errors.length > errorRows.length ? `<div>...و${result.errors.length - errorRows.length} أخطاء أخرى.</div>` : ''}
      ` : ''}
    </div>`;
}

/** Buttons + hidden file input for a CSV import (template download + upload). */
function importControls(kind, handler) {
  return `
    <a class="btn btn-outline btn-sm" href="/templates/${kind}_template.csv" download>⬇ نموذج الاستيراد (CSV)</a>
    <button class="btn btn-outline btn-sm" onclick="document.getElementById('${kind}ImportInput').click()">📥 استيراد من Excel/CSV</button>
    <input type="file" id="${kind}ImportInput" accept=".csv,text/csv" style="display:none" onchange="${handler}(event)">`;
}
