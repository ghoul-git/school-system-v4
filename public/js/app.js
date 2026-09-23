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
  students: { title: 'الطلاب', render: safeRender(renderStudents), perm: 'students.view' },
  finance: { title: 'المالية', render: safeRender(renderFinance), perm: 'finance' },
  grades: { title: 'الدرجات', render: safeRender(renderGrades), perm: 'academics' },
  attendance: { title: 'الحضور والغياب', render: safeRender(renderAttendance), perm: 'academics' },
  reports: { title: 'التقارير', render: safeRender(renderReports), perm: 'finance' },
  staff: { title: 'الموظفون والصلاحيات', render: safeRender(renderStaff), perm: 'staff' },
  activity: { title: 'سجل النشاط', render: safeRender(renderActivity), perm: 'audit' },
  settings: { title: 'الإعدادات', render: safeRender(renderSettings), perm: 'settings' }
};

let currentPage = 'dashboard';

function navigateTo(page) {
  if (!pages[page]) return;
  if (pages[page].perm && !can(pages[page].perm)) page = 'dashboard';
  currentPage = page;

  document.querySelectorAll('.nav-item').forEach(el => {
    el.classList.toggle('active', el.dataset.page === page);
    if (el.dataset.page === page) el.setAttribute('aria-current', 'page'); else el.removeAttribute('aria-current');
  });
  document.title = `${pages[page].title} — نظام إدارة المدرسة`;

  document.getElementById('pageTitle').textContent = pages[page].title;
  document.getElementById('pageContent').innerHTML = '<div class="loading"><div class="spinner"></div> جاري التحميل...</div>';

  Promise.resolve(pages[page].render()).then(() => {
    const el = document.getElementById('pageContent');
    applyPerms(el);
    enhanceA11y(el);
  });
}

function toggleSidebar() {
  document.getElementById('sidebar').classList.toggle('open');
}

// Nav clicks
document.querySelectorAll('.nav-item').forEach(el => {
  el.addEventListener('click', e => {
    e.preventDefault();
    navigateTo(el.dataset.page);
    document.getElementById('pageContent').focus({ preventScroll: true });
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
  backToLogin();
  document.getElementById('loginError').textContent = message || '';
}

async function handleLogin(e) {
  e.preventDefault();
  const btn = document.getElementById('loginBtn');
  const err = document.getElementById('loginError');
  btn.disabled = true; err.textContent = '';
  try {
    await Auth.login(document.getElementById('loginEmail').value.trim(), document.getElementById('loginPassword').value);
  } catch (ex) {
    btn.disabled = false;
    err.textContent = /confirm/i.test(ex?.message || '') ? 'لم يتم تأكيد البريد الإلكتروني بعد — افتح رابط التأكيد في بريدك'
      : /rate|too many/i.test(ex?.message || '') ? 'محاولات كثيرة. انتظر قليلاً ثم حاول مجدداً'
      : 'البريد الإلكتروني أو كلمة المرور غير صحيحة';
    return;
  }
  try {
    await continueAuth();
  } catch {
    err.textContent = 'تعذّر إكمال تسجيل الدخول. حاول مجدداً.';
  } finally {
    btn.disabled = false;
  }
}

function openChangePassword() {
  openModal('تغيير كلمة المرور', `
    <div class="form-group"><label class="form-label">كلمة المرور الجديدة</label>
      <input class="form-control" id="newPassword" type="password" minlength="10" autocomplete="new-password" placeholder="10 أحرف على الأقل، حروف وأرقام"></div>
    <button class="btn btn-primary btn-full" onclick="submitChangePassword()">حفظ</button>`);
}

async function submitChangePassword() {
  const pw = document.getElementById('newPassword').value;
  const problem = passwordProblem(pw);
  if (problem) return showToast(problem, 'error');
  try { await Auth.changePassword(pw); closeModal(); showToast('✅ تم تغيير كلمة المرور', 'success'); }
  catch (e) { showToast(e.message, 'error'); }
}

let appStarted = false;
async function startApp() {
  if (appStarted) return navigateTo(currentPage);
  appStarted = true;
  updateDate();
  loadSchoolName();
  navigateTo('dashboard');
  await ensureTermsAccepted();
}

// Each staff member must accept the current Terms + Privacy Policy once (recorded with date and version).
async function ensureTermsAccepted() {
  const version = (window.BUSINESS || {}).termsVersion || 'v1';
  const st = await API.get(`/terms/status?version=${encodeURIComponent(version)}`);
  if (!st || st.accepted) return;
  openModal('الموافقة على الشروط وسياسة الخصوصية', `
    <p style="margin-bottom:12px">قبل استخدام النظام، يرجى قراءة المستندات التالية:</p>
    <ul style="margin:0 20px 14px 0;line-height:2">
      <li><a href="/legal/terms.html" target="_blank" rel="noopener">شروط الخدمة</a></li>
      <li><a href="/legal/privacy.html" target="_blank" rel="noopener">سياسة الخصوصية</a></li>
    </ul>
    <div class="check-row" style="margin-bottom:16px">
      <input type="checkbox" id="termsAgree" onchange="document.getElementById('termsAcceptBtn').disabled = !this.checked">
      <label for="termsAgree">قرأت شروط الخدمة وسياسة الخصوصية وأوافق عليها، وأتعهّد بعدم إدخال بيانات أي طالب قبل الحصول على موافقة ولي أمره.</label>
    </div>
    <div style="display:flex;gap:10px;flex-wrap:wrap">
      <button class="btn btn-primary" id="termsAcceptBtn" disabled onclick="acceptTerms('${version}')">متابعة</button>
      <button class="btn btn-outline" onclick="Auth.logout()">لا أوافق — تسجيل الخروج</button>
    </div>`, { locked: true });
}

async function acceptTerms(version) {
  if (!document.getElementById('termsAgree').checked) return;
  const res = await once('terms', () => API.post('/terms/accept', { version, agreed: true }));
  if (res && res.success) { closeModal(true); showToast('✅ شكراً، تم تسجيل موافقتك', 'success'); }
}

// Company line on the login screen (from business.js)
(function () {
  const B = window.BUSINESS || {};
  const el = document.getElementById('loginCompany');
  if (el) el.textContent = B.companyName ? `© ${new Date().getFullYear()} ${B.companyName}` : '';
})();
showCookieNotice();

// Init
(async () => {
  let msg = '';
  try { msg = sessionStorage.getItem('logout_msg') || ''; sessionStorage.removeItem('logout_msg'); } catch {}
  try {
    const session = await Auth.init();
    if (session) await continueAuth();
    else showLogin(msg);
  } catch {
    showLogin('تعذر الاتصال بالخادم');
  }
})();
