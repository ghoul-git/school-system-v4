// If a page fails to load, show an error message instead of a blank or stuck page.
function safeRender(fn) {
  return async function () {
    try {
      await fn();
    } catch (err) {
      if (err && err.message === 'Not logged in') return; // login screen already shown
      console.error('[router] page render error:', err);
      const el = document.getElementById('pageContent');
      if (el) el.innerHTML = `
        <div style="padding:40px;text-align:center;">
          <div style="font-size:48px;margin-bottom:16px;">⚠️</div>
          <div style="font-size:18px;font-weight:700;margin-bottom:8px;">تعذّر تحميل الصفحة</div>
          <div style="color:var(--text-muted);font-size:14px;">${esc(err && err.message || 'خطأ غير معروف')}</div>
          <button class="btn btn-outline" style="margin-top:16px" onclick="navigateTo(currentPage)">إعادة المحاولة</button>
        </div>`;
    }
  };
}

const pages = {
  dashboard: { title: 'لوحة التحكم', render: safeRender(renderDashboard) },
  students: { title: 'الطلاب', render: safeRender(renderStudents) },
  finance: { title: 'المالية', render: safeRender(renderFinance) },
  grades: { title: 'الدرجات', render: safeRender(renderGrades) },
  attendance: { title: 'الحضور والغياب', render: safeRender(renderAttendance) },
  reports: { title: 'التقارير', render: safeRender(renderReports) },
  settings: { title: 'الإعدادات', render: safeRender(renderSettings) }
};

let currentPage = 'dashboard';

function navigateTo(page) {
  if (!pages[page]) return;
  currentPage = page;

  document.querySelectorAll('.nav-item').forEach(el => {
    el.classList.toggle('active', el.dataset.page === page);
  });

  document.getElementById('pageTitle').textContent = pages[page].title;
  document.getElementById('pageContent').innerHTML = '<div class="loading"><div class="spinner"></div> جاري التحميل...</div>';

  pages[page].render();
}

function toggleSidebar() {
  document.getElementById('sidebar').classList.toggle('open');
}

// Nav clicks
document.querySelectorAll('.nav-item').forEach(el => {
  el.addEventListener('click', e => {
    e.preventDefault();
    navigateTo(el.dataset.page);
    if (window.innerWidth <= 768) {
      document.getElementById('sidebar').classList.remove('open');
    }
  });
});

// Date
function updateDate() {
  const now = new Date();
  document.getElementById('currentDate').textContent = now.toLocaleDateString('ar-JO', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
  });
}

// Load school name from settings
async function loadSchoolName() {
  const settings = await API.get('/settings');
  if (settings.school_name) {
    document.getElementById('sidebarSchoolName').textContent = settings.school_name;
  }
}

// ─── Login screen ────────────────────────────────────────────
function showLogin(message) {
  document.body.classList.add('logged-out');
  document.getElementById('loginError').textContent = message || '';
}

async function handleLogin(e) {
  e.preventDefault();
  const btn = document.getElementById('loginBtn');
  const err = document.getElementById('loginError');
  btn.disabled = true; err.textContent = '';
  try {
    await Auth.login(document.getElementById('loginEmail').value.trim(), document.getElementById('loginPassword').value);
    document.body.classList.remove('logged-out');
    startApp();
  } catch {
    err.textContent = 'البريد الإلكتروني أو كلمة المرور غير صحيحة';
  } finally {
    btn.disabled = false;
  }
}

function openChangePassword() {
  openModal('تغيير كلمة المرور', `
    <div class="form-group"><label class="form-label">كلمة المرور الجديدة</label>
      <input class="form-control" id="newPassword" type="password" minlength="8" placeholder="8 أحرف على الأقل"></div>
    <button class="btn btn-primary btn-full" onclick="submitChangePassword()">حفظ</button>`);
}

async function submitChangePassword() {
  const pw = document.getElementById('newPassword').value;
  if (pw.length < 8) return showToast('كلمة المرور يجب أن تكون 8 أحرف على الأقل', 'error');
  try { await Auth.changePassword(pw); closeModal(); showToast('✅ تم تغيير كلمة المرور', 'success'); }
  catch (e) { showToast(e.message, 'error'); }
}

let appStarted = false;
function startApp() {
  if (appStarted) return navigateTo(currentPage);
  appStarted = true;
  updateDate();
  loadSchoolName();
  navigateTo('dashboard');
}

// Init
(async () => {
  try {
    const session = await Auth.init();
    if (session) { document.body.classList.remove('logged-out'); startApp(); }
    else showLogin();
  } catch {
    showLogin('تعذر الاتصال بالخادم');
  }
})();
