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
    const res = await fetch(`/api${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    if (res.status === 401) { showLogin('انتهت الجلسة، الرجاء تسجيل الدخول مجدداً'); throw new Error('Not logged in'); }
    const data = await res.json();
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
  return new Date(d).toLocaleDateString('ar-JO');
}

function statusBadge(status) {
  const map = {
    'active': ['badge-green', 'منظم ✓'],
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
