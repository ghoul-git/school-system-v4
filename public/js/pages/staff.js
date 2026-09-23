// ─── Staff & permissions (owner only) ───
async function renderStaff() {
  const el = document.getElementById('pageContent');
  const data = await API.get('/staff');
  if (!data || data.error) throw new Error(data?.error || 'تعذّر تحميل الموظفين');
  const { staff = [], invites = [] } = data;
  const roleOptions = sel => Object.entries(ROLE_LABELS).map(([k, v]) => `<option value="${k}" ${k === sel ? 'selected' : ''}>${v}</option>`).join('');

  el.innerHTML = `
    <div class="page-header">
      <div>
        <div class="page-heading">الموظفون والصلاحيات</div>
        <div class="page-subheading">كل موظف يدخل بحسابه الخاص، وصلاحياته تحددها أنت عبر رمز الانضمام.</div>
      </div>
    </div>

    <div class="grid-2">
      <div class="card">
        <div class="card-header"><span class="card-title">إضافة موظف</span></div>
        <div class="card-body">
          <div class="form-group"><label class="form-label" for="inv_role">الدور</label>
            <select class="form-control" id="inv_role">
              <option value="secretary">سكرتير</option>
              <option value="accountant">محاسب</option>
              <option value="owner">مالك / مدير (صلاحيات كاملة)</option>
            </select></div>
          <div class="form-group"><label class="form-label" for="inv_note">اسم الموظف (للتذكير فقط)</label>
            <input class="form-control" id="inv_note" maxlength="100"></div>
          <button class="btn btn-primary btn-full" onclick="createInvite()">إنشاء رمز انضمام</button>
          <p class="form-hint">الرمز من 8 أرقام، صالح 48 ساعة، ويُستخدم مرة واحدة فقط. سلّمه للموظف شخصياً أو برسالة خاصة.</p>
        </div>
      </div>

      <div class="card">
        <div class="card-header"><span class="card-title">ماذا يستطيع كل دور؟</span></div>
        <div class="table-wrapper">
          <table>
            <thead><tr><th>القسم</th><th>مالك/مدير</th><th>محاسب</th><th>سكرتير</th></tr></thead>
            <tbody>
              <tr><td>الطلاب</td><td>كامل</td><td>عرض فقط</td><td>إضافة وتعديل</td></tr>
              <tr><td>المالية والتقارير</td><td>كامل</td><td>عرض وتسجيل دفعات</td><td>—</td></tr>
              <tr><td>الدرجات والحضور</td><td>كامل</td><td>—</td><td>كامل</td></tr>
              <tr><td>الحذف وطلبات أولياء الأمور</td><td>✓</td><td>—</td><td>—</td></tr>
              <tr><td>الإعدادات، الموظفون، سجل النشاط، النسخ الاحتياطي</td><td>✓</td><td>—</td><td>—</td></tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>

    ${invites.length ? `
    <div class="card" style="margin-top:20px">
      <div class="card-header"><span class="card-title">رموز انضمام لم تُستخدم بعد (${invites.length})</span></div>
      <div class="table-wrapper"><table>
        <thead><tr><th>الدور</th><th>الموظف</th><th>أنشأه</th><th>ينتهي</th><th></th></tr></thead>
        <tbody>${invites.map(i => `
          <tr><td>${esc(ROLE_LABELS[i.role] || i.role)}</td><td>${esc(i.note || '-')}</td><td dir="ltr" style="text-align:right">${esc(i.created_by || '-')}</td>
            <td>${fmtDateTime(i.expires_at)}</td>
            <td><button class="btn btn-outline btn-sm" onclick="revokeInvite(${Number(i.id)})">إلغاء الرمز</button></td></tr>`).join('')}
        </tbody></table></div>
    </div>` : ''}

    <div class="card" style="margin-top:20px">
      <div class="card-header"><span class="card-title">الموظفون (${staff.length})</span></div>
      <div class="table-wrapper"><table>
        <thead><tr><th>البريد</th><th>الدور</th><th>التحقق بخطوتين</th><th>آخر دخول</th><th>الحالة</th><th>إجراءات</th></tr></thead>
        <tbody>${staff.map((m, i) => `
          <tr>
            <td dir="ltr" style="text-align:right">${esc(m.email)}${m.is_me ? ' <span class="badge badge-blue">أنت</span>' : ''}</td>
            <td>${m.is_me ? esc(ROLE_LABELS[m.role]) : `<select class="form-control" id="st_role_${i}" aria-label="دور ${esc(m.email)}" style="min-width:130px">${roleOptions(m.role)}</select>`}</td>
            <td>${m.has_2fa ? '<span class="consent-ok">✓ مفعّل</span>' : '<span class="consent-missing">غير مفعّل</span>'}</td>
            <td>${m.last_sign_in ? fmtDateTime(m.last_sign_in) : '-'}</td>
            <td>${m.active ? '<span class="badge badge-green">فعّال</span>' : '<span class="badge badge-red">موقوف</span>'}</td>
            <td>${m.is_me ? '<span class="form-hint">لا يمكنك تعديل حسابك</span>' : `
              <div style="display:flex;gap:6px;flex-wrap:wrap">
                <button class="btn btn-outline btn-sm" onclick="saveStaff(${i}, true)">حفظ الدور</button>
                ${m.active
                  ? `<button class="btn btn-danger btn-sm" onclick="saveStaff(${i}, false)">إيقاف الحساب</button>`
                  : `<button class="btn btn-success btn-sm" onclick="saveStaff(${i}, true)">إعادة التفعيل</button>`}
                ${m.has_2fa ? `<button class="btn btn-outline btn-sm" onclick="resetStaff2fa(${i})">إعادة ضبط التحقق</button>` : ''}
              </div>`}
            </td>
          </tr>`).join('')}
        </tbody></table></div>
      <div class="card-body"><p class="form-hint">إيقاف الحساب يمنع الدخول فوراً ويبقي سجلّ نشاطه. استخدمه عند مغادرة أي موظف.</p></div>
    </div>`;
  window._staffList = staff;
}

function fmtDateTime(v) {
  if (!v) return '-';
  const d = new Date(v);
  return isNaN(d) ? '-' : d.toLocaleString('ar-JO-u-nu-latn', { timeZone: 'Asia/Amman', dateStyle: 'medium', timeStyle: 'short' });
}

async function createInvite() {
  const role = document.getElementById('inv_role').value;
  const note = document.getElementById('inv_note').value.trim();
  if (role === 'owner' && !confirm('هذا الرمز يعطي صلاحيات كاملة (مالك/مدير). هل أنت متأكد؟')) return;
  const res = await once('invite', () => API.post('/staff/invites', { role, note }));
  if (!res || !res.pin) return;
  openModal('رمز الانضمام', `
    <p>أعطِ هذا الرمز لـ <strong>${esc(note || 'الموظف')}</strong> (${esc(ROLE_LABELS[res.role])}):</p>
    <div class="pin-display" dir="ltr" aria-label="رمز الانضمام">${esc(res.pin.slice(0, 4))} ${esc(res.pin.slice(4))}</div>
    <p class="form-hint">صالح حتى ${fmtDateTime(res.expires_at)} ويُستخدم مرة واحدة. لن يظهر مرة أخرى.</p>
    <ol class="auth-steps">
      <li>يفتح الموظف رابط النظام ويختار «حساب موظف جديد».</li>
      <li>يفعّل التحقق بخطوتين بتطبيق على هاتفه.</li>
      <li>يُدخل هذا الرمز فيرتبط بالمدرسة بالصلاحية المحددة.</li>
    </ol>
    <button class="btn btn-primary btn-full" onclick="closeModal(); renderStaff()">تم</button>`);
}

async function revokeInvite(id) {
  if (!confirm('إلغاء هذا الرمز؟ لن يعمل بعد الآن.')) return;
  const res = await API.delete(`/staff/invites/${id}`);
  if (res && res.success) { showToast('تم إلغاء الرمز', 'success'); renderStaff(); }
}

async function saveStaff(i, active) {
  const m = (window._staffList || [])[i];
  if (!m) return;
  const role = document.getElementById(`st_role_${i}`)?.value || m.role;
  if (!active && !confirm(`إيقاف حساب ${m.email}؟ لن يتمكن من الدخول.`)) return;
  if (role === 'owner' && m.role !== 'owner' && !confirm('سيحصل هذا الموظف على صلاحيات كاملة. متابعة؟')) return;
  const res = await once('staff-' + i, () => API.put(`/staff/${encodeURIComponent(m.email)}`, { role, active }));
  if (res && res.success) { showToast('✅ تم الحفظ', 'success'); renderStaff(); }
}

async function resetStaff2fa(i) {
  const m = (window._staffList || [])[i];
  if (!m || !confirm(`إعادة ضبط التحقق بخطوتين لـ ${m.email}؟ استخدمها فقط إذا فقد هاتفه وتأكدت من هويته. سيُطلب منه ربط هاتف جديد عند الدخول.`)) return;
  const res = await API.post(`/staff/${encodeURIComponent(m.email)}/reset-2fa`, {});
  if (res && res.success) { showToast('تمت إعادة الضبط', 'success'); renderStaff(); }
}
