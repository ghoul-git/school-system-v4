// ─── Roles, sign-up, two-step login (2FA), joining with a PIN, auto-logout ───
// The server and database enforce every rule below; this file only decides what to show.

let ROLE = null;
let ME = null;
const ROLE_LABELS = { owner: 'مالك / مدير', accountant: 'محاسب', secretary: 'سكرتير' };
const PERMS = {
  owner: ['*'],
  accountant: ['students.view', 'finance', 'reports.finance'],
  secretary: ['students.view', 'students.edit', 'academics', 'reports.academic']
};
function can(perm) {
  const list = PERMS[ROLE] || [];
  return list.includes('*') || list.includes(perm);
}
// Remove anything marked data-perm="x" (or "x|y" = any of them) the current role may not use.
function applyPerms(root) {
  (root || document).querySelectorAll('[data-perm]').forEach(el => {
    if (!el.dataset.perm.split('|').some(can)) el.remove();
  });
}

// ─── Login / sign-up screen ───
function showAuthTab(which) {
  const login = which === 'login';
  document.getElementById('loginForm').hidden = !login;
  document.getElementById('signupForm').hidden = login;
  document.getElementById('tabLogin').setAttribute('aria-selected', String(login));
  document.getElementById('tabSignup').setAttribute('aria-selected', String(!login));
  document.getElementById(login ? 'loginEmail' : 'signupEmail').focus();
}

function passwordProblem(pw) {
  if (pw.length < 10) return 'كلمة المرور يجب أن تكون 10 أحرف على الأقل';
  if (!/[A-Za-z؀-ۿ]/.test(pw) || !/\d/.test(pw)) return 'كلمة المرور يجب أن تحتوي على حروف وأرقام';
  return '';
}

async function handleSignup(e) {
  e.preventDefault();
  const email = document.getElementById('signupEmail').value.trim();
  const pw = document.getElementById('signupPassword').value;
  const pw2 = document.getElementById('signupPassword2').value;
  const err = document.getElementById('signupError');
  err.textContent = '';
  const problem = passwordProblem(pw) || (pw !== pw2 ? 'كلمتا المرور غير متطابقتين' : '');
  if (problem) { err.textContent = problem; return; }
  const btn = document.getElementById('signupBtn');
  btn.disabled = true;
  try {
    const { data, error } = await Auth.client.auth.signUp({ email, password: pw, options: { emailRedirectTo: location.origin } });
    if (error) throw error;
    if (!data.session) {
      err.textContent = '';
      renderAuthStep(`
        <h2 class="auth-step-title">تحقق من بريدك الإلكتروني</h2>
        <p>أرسلنا رابط تأكيد إلى <strong dir="ltr">${esc(email)}</strong>. افتح الرابط ثم عد وسجّل الدخول.</p>
        <button class="btn btn-primary btn-full" onclick="backToLogin()">العودة لتسجيل الدخول</button>`);
      return;
    }
    window._freshLogin = true;
    await continueAuth();
  } catch (ex) {
    err.textContent = /already registered|already exists/i.test(ex.message || '') ? 'هذا البريد مسجّل مسبقاً — استخدم تسجيل الدخول' : 'تعذّر إنشاء الحساب: ' + (ex.message || '');
  } finally {
    btn.disabled = false;
  }
}

function renderAuthStep(html) {
  document.getElementById('authForms').hidden = true;
  const step = document.getElementById('authStep');
  step.hidden = false;
  step.innerHTML = html;
  enhanceA11y(step);
  (step.querySelector('input') || step.querySelector('button'))?.focus();
}
function backToLogin() {
  document.getElementById('authStep').hidden = true;
  document.getElementById('authStep').innerHTML = '';
  document.getElementById('authForms').hidden = false;
  showAuthTab('login');
}

// After email + password: 2FA first, then the school PIN (if not joined yet), then the app.
async function continueAuth() {
  document.body.classList.add('logged-out');
  const { data: aal, error } = await Auth.client.auth.mfa.getAuthenticatorAssuranceLevel();
  if (error) throw error;
  if (aal.currentLevel !== 'aal2') return aal.nextLevel === 'aal2' ? showMfaVerify() : showMfaEnroll();
  const me = await API.get('/me');
  if (!me || me.error) throw new Error(me?.error || 'تعذّر التحقق من الحساب');
  if (!me.role) return showPinStep(me.email);
  enterApp(me);
}

async function showMfaEnroll() {
  const mfa = Auth.client.auth.mfa;
  // Clear half-finished attempts so the new QR code is the only one.
  const { data: list } = await mfa.listFactors();
  for (const f of (list?.all || []).filter(f => f.status !== 'verified')) await mfa.unenroll({ factorId: f.id });
  const { data, error } = await mfa.enroll({ factorType: 'totp', friendlyName: 'School ' + new Date().toISOString().slice(0, 16) });
  if (error) { renderAuthStep(`<p class="login-error">تعذّر بدء التحقق بخطوتين: ${esc(error.message)}</p><button class="btn btn-outline btn-full" onclick="Auth.logout()">تسجيل الخروج</button>`); return; }
  renderAuthStep(`
    <h2 class="auth-step-title">تفعيل التحقق بخطوتين</h2>
    <p class="auth-step-text">لحماية بيانات الطلاب، يحتاج كل حساب إلى رمز من هاتفك عند الدخول. يتم ذلك مرة واحدة:</p>
    <ol class="auth-steps">
      <li>ثبّت تطبيق <strong>Google Authenticator</strong> أو <strong>Microsoft Authenticator</strong> على هاتفك.</li>
      <li>في التطبيق اضغط «+» ثم امسح هذا الرمز:
        <img class="mfa-qr" src="${esc(data.totp.qr_code)}" alt="رمز QR لإضافة حسابك إلى تطبيق المصادقة" width="180" height="180">
        <details><summary>لا تستطيع المسح؟ أدخل المفتاح يدوياً</summary><code class="mfa-secret" dir="ltr">${esc(data.totp.secret)}</code></details>
      </li>
      <li>اكتب الرمز المكوّن من 6 أرقام الظاهر في التطبيق:</li>
    </ol>
    <form onsubmit="submitMfaCode(event, '${esc(data.id)}', true)">
      <div class="form-group"><label class="form-label" for="mfaCode">رمز التحقق</label>
        <input class="form-control mfa-code" id="mfaCode" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" required dir="ltr"></div>
      <div class="login-error" id="mfaError" role="alert"></div>
      <button class="btn btn-primary btn-full" id="mfaBtn" type="submit">تفعيل ومتابعة</button>
    </form>
    <button class="btn btn-link btn-full" onclick="Auth.logout()">تسجيل الخروج</button>`);
}

async function showMfaVerify() {
  const { data } = await Auth.client.auth.mfa.listFactors();
  const factor = (data?.totp || [])[0];
  if (!factor) return showMfaEnroll();
  renderAuthStep(`
    <h2 class="auth-step-title">رمز التحقق</h2>
    <p class="auth-step-text">افتح تطبيق المصادقة على هاتفك واكتب الرمز الحالي (6 أرقام).</p>
    <form onsubmit="submitMfaCode(event, '${esc(factor.id)}', false)">
      <div class="form-group"><label class="form-label" for="mfaCode">رمز التحقق</label>
        <input class="form-control mfa-code" id="mfaCode" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" required dir="ltr"></div>
      <div class="login-error" id="mfaError" role="alert"></div>
      <button class="btn btn-primary btn-full" id="mfaBtn" type="submit">دخول</button>
    </form>
    <p class="auth-step-help">فقدت هاتفك؟ اطلب من مالك المدرسة إعادة ضبط التحقق بخطوتين لحسابك من صفحة «الموظفون».</p>
    <button class="btn btn-link btn-full" onclick="Auth.logout()">تسجيل الخروج</button>`);
}

async function submitMfaCode(e, factorId, isNew) {
  e.preventDefault();
  const code = document.getElementById('mfaCode').value.replace(/\s/g, '');
  const err = document.getElementById('mfaError');
  if (!/^\d{6}$/.test(code)) { err.textContent = 'الرمز يتكون من 6 أرقام'; return; }
  const btn = document.getElementById('mfaBtn');
  btn.disabled = true; err.textContent = '';
  try {
    const { error } = await Auth.client.auth.mfa.challengeAndVerify({ factorId, code });
    if (error) throw error;
    if (isNew) API.post('/events', { action: 'mfa_enrolled' }).catch(() => {});
    await continueAuth();
  } catch {
    err.textContent = 'الرمز غير صحيح أو انتهت صلاحيته. جرّب الرمز الجديد في التطبيق.';
    btn.disabled = false;
  }
}

function showPinStep(email) {
  renderAuthStep(`
    <h2 class="auth-step-title">ربط حسابك بالمدرسة</h2>
    <p class="auth-step-text">أنت مسجّل باسم <strong dir="ltr">${esc(email || '')}</strong>. أدخل رمز الانضمام (8 أرقام) الذي أعطاك إياه مالك أو مدير المدرسة. الرمز يحدّد صلاحياتك.</p>
    <form onsubmit="submitPin(event)">
      <div class="form-group"><label class="form-label" for="joinPin">رمز الانضمام</label>
        <input class="form-control mfa-code" id="joinPin" inputmode="numeric" autocomplete="off" maxlength="9" required dir="ltr"></div>
      <div class="login-error" id="pinError" role="alert"></div>
      <button class="btn btn-primary btn-full" id="pinBtn" type="submit">انضمام</button>
    </form>
    <p class="auth-step-help">لا تملك رمزاً؟ اطلبه من مالك المدرسة. صلاحية الرمز 48 ساعة ويُستخدم مرة واحدة.</p>
    <button class="btn btn-link btn-full" onclick="Auth.logout()">تسجيل الخروج</button>`);
}

async function submitPin(e) {
  e.preventDefault();
  const pin = document.getElementById('joinPin').value.replace(/\s/g, '');
  const err = document.getElementById('pinError');
  if (!/^\d{8}$/.test(pin)) { err.textContent = 'الرمز يتكون من 8 أرقام'; return; }
  const btn = document.getElementById('pinBtn');
  btn.disabled = true; err.textContent = '';
  const res = await API.request('POST', '/staff/redeem', { pin }, { quiet: true }).catch(() => null);
  btn.disabled = false;
  if (!res || !res.success) { err.textContent = res?.error || 'تعذّر التحقق من الرمز'; return; }
  showToast(`✅ تم ربط حسابك بالمدرسة بصلاحية: ${ROLE_LABELS[res.role] || res.role}`, 'success');
  window._freshLogin = true;
  await continueAuth();
}

// ─── Inside the app ───
function enterApp(me) {
  ME = me; ROLE = me.role;
  document.body.dataset.role = ROLE;
  applyPerms(document.getElementById('sidebar'));
  const who = document.getElementById('sidebarUser');
  if (who) who.innerHTML = `<span dir="ltr">${esc(me.email || '')}</span><br><span class="badge badge-blue">${esc(ROLE_LABELS[ROLE] || ROLE)}</span>`;
  document.getElementById('authStep').hidden = true;
  document.getElementById('authForms').hidden = false;
  document.body.classList.remove('logged-out');
  if (window._freshLogin) { window._freshLogin = false; API.post('/events', { action: 'login' }).catch(() => {}); }
  IdleLogout.start();
  startApp();
}

// ─── Automatic logout after 30 minutes without activity ───
const IdleLogout = {
  LIMIT: 30 * 60 * 1000, WARN: 60 * 1000, last: Date.now(), timer: null, warned: false,
  start() {
    if (this.timer) return;
    const bump = () => { this.last = Date.now(); if (this.warned) this.clearWarn(); };
    ['mousemove', 'keydown', 'click', 'touchstart', 'scroll'].forEach(ev => document.addEventListener(ev, bump, { passive: true }));
    this.timer = setInterval(() => this.check(), 15000);
  },
  check() {
    const idle = Date.now() - this.last;
    if (idle >= this.LIMIT) { clearInterval(this.timer); this.timer = null; Auth.logout('تم تسجيل خروجك تلقائياً بعد 30 دقيقة دون نشاط'); }
    else if (idle >= this.LIMIT - this.WARN && !this.warned) {
      this.warned = true;
      const t = document.getElementById('idleWarning');
      if (t) t.hidden = false;
    }
  },
  clearWarn() { this.warned = false; const t = document.getElementById('idleWarning'); if (t) t.hidden = true; }
};
