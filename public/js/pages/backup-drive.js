// ─── Automatic daily backup to the school's own Google Drive ───
// The owner creates a secret token here, then pastes a small Google Apps Script into their
// own Google account. Google runs it every night: it downloads the backup with the token and
// saves it in their Drive. Nothing is stored at any third party other than the school's Google account.

async function refreshDriveBackupStatus() {
  const box = document.getElementById('driveBackupStatus');
  if (!box) return;
  const st = await API.get('/backup/token');
  if (!st || st.error) { box.innerHTML = ''; return; }
  box.innerHTML = st.active ? `
    <div class="alert ${st.last_used_at ? 'alert-green' : 'alert-yellow'}">
      ${st.last_used_at ? `✅ النسخ التلقائي يعمل. آخر نسخة: <strong>${fmtDateTime(st.last_used_at)}</strong>`
        : '⏳ تم التفعيل لكن لم تصل أي نسخة بعد. تأكد من تشغيل الدالة setup في السكربت.'}
    </div>
    <div style="display:flex;gap:10px;flex-wrap:wrap">
      <button class="btn btn-outline btn-sm" onclick="startDriveBackupSetup()">إعادة الإعداد (رمز جديد)</button>
      <button class="btn btn-danger btn-sm" onclick="stopDriveBackup()">إيقاف النسخ التلقائي</button>
    </div>` : `
    <button class="btn btn-success" onclick="startDriveBackupSetup()">☁️ إعداد النسخ التلقائي إلى Google Drive</button>`;
}

async function startDriveBackupSetup() {
  if (!confirm('سيتم إنشاء رمز سري جديد، وأي سكربت نسخ قديم سيتوقف عن العمل. متابعة؟')) return;
  const res = await once('backupToken', () => API.post('/backup/token', {}));
  if (!res || !res.token) return;
  const script = driveBackupScript(location.origin, res.token);
  window._driveScript = script;
  openModal('إعداد النسخ التلقائي إلى Google Drive', `
    <div class="alert alert-yellow" role="note">السكربت التالي يحتوي على رمز سري يسمح بتنزيل كل بيانات المدرسة. لا ترسله لأحد ولا تحفظه في مكان عام. سيظهر هنا مرة واحدة فقط.</div>
    <ol class="auth-steps">
      <li>سجّل الدخول إلى حساب Google الخاص بالمدرسة (المدير أو المالك) ويفضّل أن يكون عليه التحقق بخطوتين.</li>
      <li>افتح <a href="https://script.google.com/home/projects/create" target="_blank" rel="noopener">script.google.com ← مشروع جديد</a>.</li>
      <li>احذف كل ما في المحرر، ثم اضغط الزر أدناه لنسخ السكربت والصقه مكانه.</li>
      <li>اضغط 💾 حفظ، ثم اختر الدالة <code>setup</code> من القائمة العلوية واضغط <strong>Run / تشغيل</strong>.</li>
      <li>وافق على الأذونات التي يطلبها Google (الوصول إلى Drive والبريد والاتصال بالإنترنت).</li>
      <li>ستجد مجلداً باسم <strong>School System Backups</strong> في Drive وبداخله أول نسخة. بعدها يعمل تلقائياً كل ليلة الساعة 2 صباحاً.</li>
    </ol>
    <label class="form-label" for="driveScriptText">السكربت</label>
    <textarea class="form-control" id="driveScriptText" rows="8" dir="ltr" readonly style="font-family:monospace;font-size:12px">${esc(script)}</textarea>
    <div style="display:flex;gap:10px;margin-top:12px;flex-wrap:wrap">
      <button class="btn btn-primary" onclick="copyDriveScript()">📋 نسخ السكربت</button>
      <button class="btn btn-outline" onclick="window._driveScript='';closeModal();refreshDriveBackupStatus()">تم</button>
    </div>`);
}

async function copyDriveScript() {
  try {
    await navigator.clipboard.writeText(window._driveScript || document.getElementById('driveScriptText').value);
    showToast('✅ تم نسخ السكربت', 'success');
  } catch {
    const t = document.getElementById('driveScriptText');
    t.focus(); t.select();
    showToast('اضغط Ctrl+C لنسخ النص المحدد', '');
  }
}

async function stopDriveBackup() {
  if (!confirm('إيقاف النسخ التلقائي؟ السكربت في Google سيتوقف عن العمل (النسخ السابقة تبقى في Drive).')) return;
  const res = await API.delete('/backup/token');
  if (res && res.success) { showToast('تم إيقاف النسخ التلقائي', 'success'); refreshDriveBackupStatus(); }
}

function driveBackupScript(siteUrl, token) {
  return `/**
 * Automatic daily backup of the school system to this Google Drive.
 * Setup: choose "setup" in the menu above and press Run once.
 * Keep this project private: the token below can download all school data.
 */
const SCHOOL_URL = '${siteUrl}';
const BACKUP_TOKEN = '${token}';
const FOLDER_NAME = 'School System Backups';
const KEEP_DAYS = 30;

function setup() {
  ScriptApp.getProjectTriggers().forEach(function (t) { ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('runBackup').timeBased().everyDays(1).atHour(2).inTimezone('Asia/Amman').create();
  runBackup();
}

function runBackup() {
  try {
    var res = UrlFetchApp.fetch(SCHOOL_URL + '/api/backup/auto', {
      headers: { 'X-Backup-Token': BACKUP_TOKEN }, muteHttpExceptions: true
    });
    if (res.getResponseCode() !== 200) {
      throw new Error('HTTP ' + res.getResponseCode() + ' ' + res.getContentText().slice(0, 200));
    }
    var folder = getFolder_();
    var name = 'school-backup-' + Utilities.formatDate(new Date(), 'Asia/Amman', 'yyyy-MM-dd') + '.json';
    folder.createFile(name, res.getContentText(), 'application/json');
    cleanup_(folder);
  } catch (e) {
    MailApp.sendEmail(Session.getEffectiveUser().getEmail(),
      'School system backup failed / فشل النسخ الاحتياطي',
      'The automatic backup of the school system failed:\\n\\n' + e.message +
      '\\n\\nفشل النسخ الاحتياطي التلقائي لنظام المدرسة. يرجى التواصل مع الدعم الفني.');
    throw e;
  }
}

function getFolder_() {
  var it = DriveApp.getFoldersByName(FOLDER_NAME);
  return it.hasNext() ? it.next() : DriveApp.createFolder(FOLDER_NAME);
}

function cleanup_(folder) {
  var cutoff = new Date(Date.now() - KEEP_DAYS * 24 * 60 * 60 * 1000);
  var files = folder.getFiles();
  while (files.hasNext()) {
    var f = files.next();
    if (f.getName().indexOf('school-backup-') === 0 && f.getDateCreated() < cutoff) f.setTrashed(true);
  }
}
`;
}
