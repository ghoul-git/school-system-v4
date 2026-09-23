// ─── Activity log (owner only): who did what, and when ───
const ACTION_LABELS = {
  insert: 'إضافة', update: 'تعديل', delete: 'حذف', login: 'تسجيل دخول', logout: 'تسجيل خروج',
  view_student: 'عرض ملف طالب', export_student: 'تصدير بيانات طالب', backup_download: 'تنزيل نسخة احتياطية',
  auto_backup: 'نسخ احتياطي تلقائي (Google Drive)', erase: 'حذف نهائي بطلب ولي الأمر', mfa_reset: 'إعادة ضبط التحقق بخطوتين',
  mfa_enrolled: 'تفعيل التحقق بخطوتين', print_report: 'طباعة تقرير',
  backup_token_created: 'تفعيل النسخ التلقائي', backup_token_revoked: 'إيقاف النسخ التلقائي'
};
const TABLE_LABELS = {
  students: 'طالب', payments: 'دفعة', grades: 'درجة', attendance: 'حضور', subjects: 'مادة', academic_plan: 'خطة دراسية',
  settings: 'الإعدادات', staff: 'موظف', staff_invites: 'رمز انضمام', data_requests: 'طلب ولي أمر'
};
const ACT_PAGE = 50;
let _actOffset = 0, _actRows = [];

async function renderActivity() {
  const el = document.getElementById('pageContent');
  el.innerHTML = `
    <div class="page-header">
      <div>
        <div class="page-heading">سجل النشاط</div>
        <div class="page-subheading">كل إضافة أو تعديل أو حذف أو دخول يُسجَّل تلقائياً ولا يمكن لأحد تعديله أو حذفه.</div>
      </div>
      <button class="btn btn-outline btn-sm" onclick="showErrorLog()">⚙️ أخطاء النظام</button>
    </div>
    <div class="card">
      <div class="card-body" style="padding-bottom:0">
        <div class="search-bar" style="flex-wrap:wrap">
          <div class="form-group"><label class="form-label" for="act_from">من</label><input type="date" class="form-control" id="act_from"></div>
          <div class="form-group"><label class="form-label" for="act_to">إلى</label><input type="date" class="form-control" id="act_to"></div>
          <div class="form-group"><label class="form-label" for="act_user">المستخدم (البريد)</label><input class="form-control" id="act_user" dir="ltr"></div>
          <div class="form-group"><label class="form-label" for="act_student">رقم الطالب</label><input class="form-control" id="act_student" dir="ltr"></div>
          <div class="form-group"><label class="form-label" for="act_table">النوع</label>
            <select class="form-control" id="act_table"><option value="">الكل</option>
              ${Object.entries(TABLE_LABELS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></div>
          <div class="form-group" style="align-self:flex-end"><button class="btn btn-primary" onclick="loadActivity(0)">بحث</button></div>
        </div>
      </div>
      <div id="activityTable"><div class="loading"><div class="spinner"></div></div></div>
    </div>`;
  await loadActivity(0);
}

async function loadActivity(offset) {
  _actOffset = Math.max(0, offset);
  const q = new URLSearchParams({ limit: ACT_PAGE, offset: _actOffset });
  const v = id => document.getElementById(id)?.value.trim();
  if (v('act_from')) q.set('from', v('act_from'));
  if (v('act_to')) q.set('to', v('act_to'));
  if (v('act_user')) q.set('user', v('act_user'));
  if (v('act_student')) q.set('student_id', v('act_student'));
  if (v('act_table')) q.set('table', v('act_table'));
  const data = await API.get('/audit?' + q);
  const box = document.getElementById('activityTable');
  if (!box || !data || data.error) return;
  _actRows = data.rows || [];
  const total = data.total ?? _actRows.length;
  box.innerHTML = !_actRows.length
    ? `<div class="empty-state"><div class="empty-state-icon">🕵️</div><div class="empty-state-text">لا يوجد نشاط مطابق</div></div>`
    : `<div class="table-wrapper"><table>
        <thead><tr><th>الوقت</th><th>المستخدم</th><th>الدور</th><th>الإجراء</th><th>على</th><th>التفاصيل</th></tr></thead>
        <tbody>${_actRows.map((r, i) => `
          <tr>
            <td style="white-space:nowrap">${fmtDateTime(r.at)}</td>
            <td dir="ltr" style="text-align:right">${esc(r.user_email || '-')}</td>
            <td>${esc(ROLE_LABELS[r.role] || r.role || '-')}</td>
            <td>${esc(ACTION_LABELS[r.action] || r.action)}</td>
            <td>${esc(TABLE_LABELS[r.table_name] || r.table_name || '')} ${r.student_id ? `<span class="form-hint">طالب ${esc(r.student_id)}</span>` : (r.row_key ? `<span class="form-hint" dir="ltr">${esc(r.row_key)}</span>` : '')}</td>
            <td>${r.old_data || r.new_data ? `<button class="btn btn-outline btn-sm" onclick="showActivityDetail(${i})">عرض</button>` : '-'}</td>
          </tr>`).join('')}
        </tbody></table></div>
      <div class="card-body" style="display:flex;justify-content:space-between;align-items:center;gap:10px">
        <span class="form-hint">${_actOffset + 1}–${_actOffset + _actRows.length} من ${total}</span>
        <div style="display:flex;gap:8px">
          <button class="btn btn-outline btn-sm" ${_actOffset === 0 ? 'disabled' : ''} onclick="loadActivity(${_actOffset - ACT_PAGE})">الأحدث</button>
          <button class="btn btn-outline btn-sm" ${_actOffset + ACT_PAGE >= total ? 'disabled' : ''} onclick="loadActivity(${_actOffset + ACT_PAGE})">الأقدم</button>
        </div>
      </div>`;
  enhanceA11y(box);
}

function showActivityDetail(i) {
  const r = _actRows[i];
  if (!r) return;
  const oldD = r.old_data || {}, newD = r.new_data || {};
  const keys = [...new Set([...Object.keys(oldD), ...Object.keys(newD)])].filter(k => !['id', 'created_at'].includes(k) || r.action !== 'update');
  const fmt = v => v === null || v === undefined ? '<span class="form-hint">—</span>' : esc(typeof v === 'object' ? JSON.stringify(v) : v);
  openModal(`${ACTION_LABELS[r.action] || r.action} — ${TABLE_LABELS[r.table_name] || ''}`, `
    <p class="form-hint">${fmtDateTime(r.at)} · <span dir="ltr">${esc(r.user_email || '')}</span></p>
    <div class="table-wrapper"><table>
      <thead><tr><th>الحقل</th>${r.action !== 'insert' ? '<th>قبل</th>' : ''}${r.action !== 'delete' ? '<th>بعد</th>' : ''}</tr></thead>
      <tbody>${keys.map(k => `<tr><td dir="ltr" style="text-align:right">${esc(k)}</td>${r.action !== 'insert' ? `<td>${fmt(oldD[k])}</td>` : ''}${r.action !== 'delete' ? `<td>${fmt(newD[k])}</td>` : ''}</tr>`).join('')}</tbody>
    </table></div>`);
}

async function showErrorLog() {
  const rows = await API.get('/errors');
  if (!Array.isArray(rows)) return;
  openModal('أخطاء النظام (آخر 100)', rows.length
    ? `<div class="table-wrapper"><table><thead><tr><th>الوقت</th><th>المستخدم</th><th>العملية</th><th>الرسالة</th></tr></thead><tbody>
        ${rows.map(e => `<tr><td style="white-space:nowrap">${fmtDateTime(e.at)}</td><td dir="ltr" style="text-align:right">${esc(e.user_email || '-')}</td>
          <td dir="ltr" style="text-align:right">${esc(e.method)} ${esc(e.route)}</td><td dir="ltr" style="text-align:right">${esc(e.code || '')} ${esc(e.message || '')}</td></tr>`).join('')}
      </tbody></table></div>`
    : '<div class="alert alert-green">لا توجد أخطاء مسجّلة 👍</div>');
}
