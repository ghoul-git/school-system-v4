// Default grades list — used if school hasn't configured their own yet
const DEFAULT_GRADES = [
  { name: 'KG1',         tuition: 450 },
  { name: 'KG2',         tuition: 450 },
  { name: 'التمهيدي',    tuition: 450 },
  { name: 'الصف الأول',  tuition: 500 },
  { name: 'الصف الثاني', tuition: 500 },
  { name: 'الصف الثالث', tuition: 500 },
  { name: 'الصف الرابع', tuition: 500 },
  { name: 'الصف الخامس', tuition: 500 },
  { name: 'الصف السادس', tuition: 500 },
  { name: 'الصف السابع', tuition: 550 },
  { name: 'الصف الثامن', tuition: 650 },
  { name: 'الصف التاسع', tuition: 720 },
];

let gradesConfig = [];

async function renderSettings() {
  const el = document.getElementById('pageContent');
  const settings = await API.get('/settings');

  // Load grades config from settings (stored as JSON string)
  try {
    gradesConfig = settings.grades_config
      ? JSON.parse(settings.grades_config)
      : [...DEFAULT_GRADES];
  } catch(e) {
    gradesConfig = [...DEFAULT_GRADES];
  }

  el.innerHTML = `
    <div class="page-header">
      <div>
        <div class="page-heading">الإعدادات</div>
        <div class="page-subheading">إعدادات النظام والمدرسة</div>
      </div>
    </div>

    <div class="grid-2" style="margin-bottom:20px">
      <!-- School Info -->
      <div class="card">
        <div class="card-header"><span class="card-title">🏫 بيانات المدرسة</span></div>
        <div class="card-body">
          <div class="form-group" style="margin-bottom:14px">
            <label class="form-label">اسم المدرسة</label>
            <input class="form-control" id="s_school_name" value="${esc(settings.school_name || '')}">
          </div>
          <div class="form-group" style="margin-bottom:14px">
            <label class="form-label">العام الدراسي</label>
            <input class="form-control" id="s_academic_year" value="${esc(settings.academic_year || '2025/2026')}">
          </div>
          <div class="form-group" style="margin-bottom:14px">
            <label class="form-label">العملة</label>
            <input class="form-control" id="s_currency" value="${esc(settings.currency || 'JD')}">
          </div>
          <button class="btn btn-primary btn-full" onclick="saveGeneralSettings()">💾 حفظ بيانات المدرسة</button>
        </div>
      </div>

      <!-- Financial Settings -->
      <div class="card">
        <div class="card-header"><span class="card-title">💰 الإعدادات المالية</span></div>
        <div class="card-body">
          <div class="form-group" style="margin-bottom:14px">
            <label class="form-label">الحد الأدنى للقسط الشهري (د.أ)</label>
            <input class="form-control" id="s_min_monthly" type="number" value="${esc(settings.min_monthly_payment || '20')}">
          </div>
          <div class="form-group" style="margin-bottom:14px">
            <label class="form-label">رسوم حجز المقعد (د.أ)</label>
            <input class="form-control" id="s_seat_fee" type="number" value="${esc(settings.seat_reservation_fee || '100')}">
          </div>
          <button class="btn btn-primary btn-full" onclick="saveGeneralSettings()">💾 حفظ الإعدادات المالية</button>
        </div>
      </div>
    </div>

    <!-- Grades & Tuition Config -->
    <div class="card" style="margin-bottom:20px">
      <div class="card-header">
        <span class="card-title">🎓 إعداد الصفوف الدراسية والأقساط</span>
        <button class="btn btn-outline btn-sm" onclick="addGradeRow()">+ إضافة صف</button>
      </div>
      <div class="card-body" style="padding-bottom:8px">
        <p style="color:var(--text-muted);font-size:13px;margin-bottom:16px">
          حدد الصفوف الدراسية المتاحة في مدرستك والقسط السنوي لكل صف. هذه القيم تُستخدم تلقائياً عند تسجيل طالب جديد.
        </p>

        <div class="table-wrapper">
          <table>
            <thead>
              <tr>
                <th style="width:50px">الترتيب</th>
                <th>اسم الصف</th>
                <th style="width:200px">القسط السنوي (د.أ)</th>
                <th style="width:100px">حذف</th>
              </tr>
            </thead>
            <tbody id="gradesConfigTable">
              ${renderGradeRows()}
            </tbody>
          </table>
        </div>

        <div style="display:flex;gap:10px;margin-top:16px;flex-wrap:wrap;align-items:center">
          <button class="btn btn-success" onclick="saveGradesConfig()">💾 حفظ إعدادات الصفوف</button>
          <button class="btn btn-outline" onclick="resetGradesToDefault()">↩ استعادة الافتراضي</button>
          <span style="font-size:12px;color:var(--text-muted)">
            * سيتم تحديث قوائم الصفوف في جميع صفحات النظام تلقائياً بعد الحفظ
          </span>
        </div>
      </div>
    </div>

    <!-- Backup -->
    <div class="card" style="margin-bottom:20px">
      <div class="card-header"><span class="card-title">💾 النسخ الاحتياطي</span></div>
      <div class="card-body">
        <p style="color:var(--text-muted);font-size:13px;margin-bottom:16px">
          تنزيل نسخة كاملة من بيانات المدرسة (الطلاب، المدفوعات، الدرجات، الحضور، الإعدادات) في ملف واحد. يُنصح بتنزيل نسخة أسبوعياً وحفظها في مكان آمن.
        </p>
        <button class="btn btn-primary" id="backupBtn" onclick="downloadBackup()">⬇️ تنزيل نسخة احتياطية</button>
      </div>
    </div>

    <!-- System Info -->
    <div class="card">
      <div class="card-header"><span class="card-title">ℹ️ معلومات النظام</span></div>
      <div class="card-body">
        <div class="profile-info-grid">
          <div class="profile-info-item"><div class="profile-info-label">إصدار النظام</div><div class="profile-info-value">v1.0.0</div></div>
          <div class="profile-info-item"><div class="profile-info-label">قاعدة البيانات</div><div class="profile-info-value">Supabase (سحابي)</div></div>
          <div class="profile-info-item"><div class="profile-info-label">العنوان</div><div class="profile-info-value">${location.host}</div></div>
        </div>
        <div class="alert alert-blue" style="margin-top:16px">
          🔒 البيانات محفوظة في قاعدة بيانات سحابية آمنة، ولا يمكن الوصول إليها إلا بعد تسجيل الدخول.
        </div>
      </div>
    </div>
  `;
}

function renderGradeRows() {
  if (gradesConfig.length === 0) {
    return `<tr><td colspan="4" style="text-align:center;color:var(--text-muted);padding:20px">
      لا يوجد صفوف. اضغط "+ إضافة صف" لإضافة أول صف دراسي.
    </td></tr>`;
  }
  return gradesConfig.map((g, i) => `
    <tr id="grade-row-${i}">
      <td>
        <div style="display:flex;flex-direction:column;gap:2px">
          <button onclick="moveGrade(${i},-1)" ${i===0?'disabled':''} style="background:none;border:none;cursor:pointer;font-size:14px;opacity:${i===0?0.3:1}">▲</button>
          <button onclick="moveGrade(${i},1)" ${i===gradesConfig.length-1?'disabled':''} style="background:none;border:none;cursor:pointer;font-size:14px;opacity:${i===gradesConfig.length-1?0.3:1}">▼</button>
        </div>
      </td>
      <td>
        <input class="form-control" id="gname_${i}" value="${esc(g.name)}"
          placeholder="مثال: الصف العاشر"
          oninput="gradesConfig[${i}].name = this.value">
      </td>
      <td>
        <input class="form-control" id="gtuition_${i}" type="number" value="${g.tuition}"
          placeholder="0"
          oninput="gradesConfig[${i}].tuition = parseFloat(this.value)||0">
      </td>
      <td>
        <button class="btn btn-danger btn-sm" onclick="removeGrade(${i})">🗑 حذف</button>
      </td>
    </tr>
  `).join('');
}

function addGradeRow() {
  gradesConfig.push({ name: '', tuition: 500 });
  document.getElementById('gradesConfigTable').innerHTML = renderGradeRows();
  // Focus the new name input
  const lastIdx = gradesConfig.length - 1;
  const input = document.getElementById(`gname_${lastIdx}`);
  if (input) input.focus();
}

function removeGrade(idx) {
  if (!confirm(`هل أنت متأكد من حذف صف "${gradesConfig[idx].name}"؟`)) return;
  gradesConfig.splice(idx, 1);
  document.getElementById('gradesConfigTable').innerHTML = renderGradeRows();
}

function moveGrade(idx, direction) {
  const newIdx = idx + direction;
  if (newIdx < 0 || newIdx >= gradesConfig.length) return;
  // Sync current input values before moving
  syncGradeInputs();
  [gradesConfig[idx], gradesConfig[newIdx]] = [gradesConfig[newIdx], gradesConfig[idx]];
  document.getElementById('gradesConfigTable').innerHTML = renderGradeRows();
}

function syncGradeInputs() {
  gradesConfig.forEach((g, i) => {
    const nameEl = document.getElementById(`gname_${i}`);
    const tuitionEl = document.getElementById(`gtuition_${i}`);
    if (nameEl) g.name = nameEl.value;
    if (tuitionEl) g.tuition = parseFloat(tuitionEl.value) || 0;
  });
}

function resetGradesToDefault() {
  if (!confirm('هل أنت متأكد من استعادة الصفوف الافتراضية؟ سيتم حذف أي تعديلات غير محفوظة.')) return;
  gradesConfig = [...DEFAULT_GRADES];
  document.getElementById('gradesConfigTable').innerHTML = renderGradeRows();
  showToast('تم استعادة الصفوف الافتراضية — اضغط حفظ لتأكيد التغييرات', '');
}

async function saveGradesConfig() {
  syncGradeInputs();

  // Validate — no empty names
  const invalid = gradesConfig.filter(g => !g.name.trim());
  if (invalid.length > 0) {
    showToast('❌ يوجد صف بدون اسم — الرجاء إدخال اسم لكل صف', 'error');
    return;
  }

  // Check for duplicate names
  const names = gradesConfig.map(g => g.name.trim());
  const hasDups = names.length !== new Set(names).size;
  if (hasDups) {
    showToast('❌ يوجد صفوف بنفس الاسم — يجب أن يكون كل اسم فريداً', 'error');
    return;
  }

  const res = await API.post('/settings', {
    grades_config: JSON.stringify(gradesConfig)
  });

  if (res.success) {
    showToast('✅ تم حفظ إعدادات الصفوف بنجاح', 'success');
    // Refresh grade dropdowns throughout the app
    window._gradesConfig = gradesConfig;
  }
}

async function saveGeneralSettings() {
  const body = {
    school_name: document.getElementById('s_school_name').value.trim(),
    academic_year: document.getElementById('s_academic_year').value.trim(),
    currency: document.getElementById('s_currency').value.trim(),
    min_monthly_payment: document.getElementById('s_min_monthly').value,
    seat_reservation_fee: document.getElementById('s_seat_fee').value
  };
  const res = await API.post('/settings', body);
  if (res.success) {
    showToast('✅ تم حفظ الإعدادات', 'success');
    document.getElementById('sidebarSchoolName').textContent = body.school_name;
  }
}

// Legacy alias so any old call to saveSettings() still works
function saveSettings() { saveGeneralSettings(); }

// ── Global helper: get grade names list from saved config ─────────────────────
// Used by students.js, attendance.js, grades.js to build their dropdowns
async function getGradeOptions(selectedValue = '') {
  if (!window._gradesConfig) {
    const settings = await API.get('/settings');
    try {
      window._gradesConfig = settings.grades_config
        ? JSON.parse(settings.grades_config)
        : DEFAULT_GRADES;
    } catch(e) {
      window._gradesConfig = DEFAULT_GRADES;
    }
  }
  return window._gradesConfig.map(g =>
    `<option value="${esc(g.name)}" ${g.name === selectedValue ? 'selected' : ''}>${esc(g.name)}</option>`
  ).join('');
}

// Get tuition for a given grade name from saved config
function getTuitionForGrade(gradeName) {
  const config = window._gradesConfig || DEFAULT_GRADES;
  const found = config.find(g => g.name === gradeName);
  return found ? found.tuition : 500;
}

// Download a full JSON backup of all school data
async function downloadBackup() {
  const btn = document.getElementById('backupBtn');
  btn.disabled = true;
  try {
    const res = await fetch('/api/backup', { headers: { Authorization: `Bearer ${await Auth.token()}` } });
    if (!res.ok) throw new Error('فشل تنزيل النسخة الاحتياطية');
    const blob = await res.blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `school-backup-${todayLocal()}.json`;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(a.href);
    showToast('✅ تم تنزيل النسخة الاحتياطية', 'success');
  } catch (e) {
    showToast(e.message, 'error');
  } finally {
    btn.disabled = false;
  }
}
