async function renderStudents() {
  const el = document.getElementById('pageContent');
  const [students, gradeOptions] = await Promise.all([
    API.get('/students'),
    getGradeOptions()
  ]);

  el.innerHTML = `
    <div class="page-header">
      <div>
        <div class="page-heading">إدارة الطلاب</div>
        <div class="page-subheading">${students.length} طالب مسجل في النظام</div>
      </div>
      <button class="btn btn-primary" onclick="openAddStudentModal()">+ إضافة طالب</button>
    </div>

    <div class="card">
      <div class="card-body" style="padding-bottom:0">
        <div class="search-bar">
          <input class="search-input" id="studentSearch" placeholder="🔍 بحث بالاسم أو رقم الهوية..." oninput="filterStudents()" />
          <select class="form-control" style="width:160px" id="gradeFilter" onchange="filterStudents()">
            <option value="">كل الصفوف</option>
            ${gradeOptions}
          </select>
          <select class="form-control" style="width:140px" id="statusFilter" onchange="filterStudents()">
            <option value="">كل الحالات</option>
            <option value="active">منظم</option>
            <option value="transferred">منتقل</option>
            <option value="dropped">منقطع</option>
          </select>
        </div>
      </div>
      <div class="table-wrapper">
        <table id="studentsTable">
          <thead>
            <tr>
              <th>رقم الطالب</th>
              <th>الاسم الكامل</th>
              <th>الصف</th>
              <th>ولي الأمر</th>
              <th>الهاتف</th>
              <th>القسط السنوي</th>
              <th>الحالة</th>
              <th>إجراءات</th>
            </tr>
          </thead>
          <tbody id="studentsTbody">
            ${renderStudentRows(students)}
          </tbody>
        </table>
      </div>
    </div>
  `;

  window._allStudents = students;
}

function renderStudentRows(students) {
  if (students.length === 0) {
    return `<tr><td colspan="8"><div class="empty-state">
      <div class="empty-state-icon">👨‍🎓</div>
      <div class="empty-state-text">لا يوجد طلاب مسجلون</div>
      <div class="empty-state-sub">اضغط "إضافة طالب" لتسجيل أول طالب</div>
    </div></td></tr>`;
  }
  return students.map(s => `
    <tr>
      <td><strong style="color:var(--primary)">${s.student_id}</strong></td>
      <td><strong>${s.full_name}</strong></td>
      <td>${s.grade} ${s.section ? '/ ' + s.section : ''}</td>
      <td>${s.parent_name || '-'}</td>
      <td dir="ltr" style="text-align:right">${s.parent_phone || '-'}</td>
      <td>${s.total_yearly_tuition} د.أ</td>
      <td>${statusBadge(s.status)}</td>
      <td>
        <div style="display:flex;gap:6px;">
          <button class="btn btn-outline btn-sm" onclick="viewStudentProfile('${s.student_id}')">👁 ملف</button>
          <button class="btn btn-outline btn-sm" onclick="openEditStudentModal('${s.student_id}')">✏️</button>
          <button class="btn btn-danger btn-sm" onclick="deleteStudent('${s.student_id}', '${s.full_name}')">🗑</button>
        </div>
      </td>
    </tr>
  `).join('');
}

function filterStudents() {
  const search = document.getElementById('studentSearch').value.toLowerCase();
  const grade = document.getElementById('gradeFilter').value;
  const status = document.getElementById('statusFilter').value;
  const filtered = (window._allStudents || []).filter(s => {
    const matchSearch = !search || s.full_name.toLowerCase().includes(search) || s.student_id.includes(search);
    const matchGrade = !grade || s.grade === grade;
    const matchStatus = !status || s.status === status;
    return matchSearch && matchGrade && matchStatus;
  });
  document.getElementById('studentsTbody').innerHTML = renderStudentRows(filtered);
}

async function openAddStudentModal() {
  openModal('تسجيل طالب جديد', `
    <div class="form-grid">
      <div class="form-group form-full">
        <label class="form-label">الاسم الرباعي للطالب *</label>
        <input class="form-control" id="m_name" placeholder="أدخل الاسم الكامل">
      </div>
      <div class="form-group">
        <label class="form-label">الصف الدراسي *</label>
        <select class="form-control" id="m_grade" onchange="autoFillTuition(this.value)">
          ${await getGradeOptions()}
        </select>
      </div>
      <div class="form-group">
        <label class="form-label">الشعبة</label>
        <select class="form-control" id="m_section">
          <option value="A">A</option><option value="B">B</option><option value="C">C</option>
        </select>
      </div>
      <div class="form-group">
        <label class="form-label">اسم ولي الأمر</label>
        <input class="form-control" id="m_parent" placeholder="الاسم الكامل">
      </div>
      <div class="form-group">
        <label class="form-label">رقم الهاتف</label>
        <input class="form-control" id="m_phone" placeholder="07XXXXXXXX" dir="ltr">
      </div>
      <div class="form-group">
        <label class="form-label">البريد الإلكتروني</label>
        <input class="form-control" id="m_email" placeholder="example@email.com" dir="ltr">
      </div>
      <div class="form-group">
        <label class="form-label">تاريخ الميلاد</label>
        <input class="form-control" id="m_dob" type="date">
      </div>
      <div class="form-group">
        <label class="form-label">الجنس</label>
        <select class="form-control" id="m_gender">
          <option value="male">ذكر</option>
          <option value="female">أنثى</option>
        </select>
      </div>
      <div class="form-group">
        <label class="form-label">القسط السنوي (د.أ)</label>
        <input class="form-control" id="m_tuition" type="number" value="500">
      </div>
      <div class="form-group">
        <label class="form-label">العنوان</label>
        <input class="form-control" id="m_address" placeholder="المنطقة / المدينة">
      </div>
      <div class="form-group form-full">
        <label class="form-label">ملاحظات</label>
        <input class="form-control" id="m_notes" placeholder="أي ملاحظات إضافية...">
      </div>
    </div>
    <hr class="divider">
    <button class="btn btn-primary btn-full" onclick="submitAddStudent()">حفظ وتوليد رقم الطالب</button>
  `);
}

function autoFillTuition(gradeName) {
  const tuitionInput = document.getElementById('m_tuition');
  if (tuitionInput && gradeName) {
    tuitionInput.value = getTuitionForGrade(gradeName);
  }
}

async function submitAddStudent() {
  const body = {
    full_name: document.getElementById('m_name').value.trim(),
    grade: document.getElementById('m_grade').value,
    section: document.getElementById('m_section').value,
    parent_name: document.getElementById('m_parent').value.trim(),
    parent_phone: document.getElementById('m_phone').value.trim(),
    parent_email: document.getElementById('m_email').value.trim(),
    date_of_birth: document.getElementById('m_dob').value,
    gender: document.getElementById('m_gender').value,
    total_yearly_tuition: parseFloat(document.getElementById('m_tuition').value) || 500,
    address: document.getElementById('m_address').value.trim(),
    notes: document.getElementById('m_notes').value.trim()
  };
  if (!body.full_name) return showToast('الرجاء إدخال اسم الطالب', 'error');
  const res = await API.post('/students', body);
  if (res.success) {
    closeModal();
    showToast(`✅ تم تسجيل الطالب بنجاح - رقمه: ${res.student_id}`, 'success');
    renderStudents();
  }
}

async function openEditStudentModal(id) {
  const s = await API.get(`/students/${id}`);
  openModal('تعديل بيانات الطالب', `
    <div class="form-grid">
      <div class="form-group form-full">
        <label class="form-label">الاسم الكامل</label>
        <input class="form-control" id="e_name" value="${s.full_name}">
      </div>
      <div class="form-group">
        <label class="form-label">الصف</label>
        <input class="form-control" id="e_grade" value="${s.grade}">
      </div>
      <div class="form-group">
        <label class="form-label">الشعبة</label>
        <input class="form-control" id="e_section" value="${s.section || ''}">
      </div>
      <div class="form-group">
        <label class="form-label">اسم ولي الأمر</label>
        <input class="form-control" id="e_parent" value="${s.parent_name || ''}">
      </div>
      <div class="form-group">
        <label class="form-label">الهاتف</label>
        <input class="form-control" id="e_phone" value="${s.parent_phone || ''}" dir="ltr">
      </div>
      <div class="form-group">
        <label class="form-label">القسط السنوي</label>
        <input class="form-control" id="e_tuition" type="number" value="${s.total_yearly_tuition}">
      </div>
      <div class="form-group">
        <label class="form-label">الحالة</label>
        <select class="form-control" id="e_status">
          <option value="active" ${s.status==='active'?'selected':''}>منظم</option>
          <option value="transferred" ${s.status==='transferred'?'selected':''}>منتقل</option>
          <option value="dropped" ${s.status==='dropped'?'selected':''}>منقطع</option>
          <option value="graduated" ${s.status==='graduated'?'selected':''}>خريج</option>
        </select>
      </div>
      <div class="form-group">
        <label class="form-label">العنوان</label>
        <input class="form-control" id="e_address" value="${s.address || ''}">
      </div>
      <div class="form-group form-full">
        <label class="form-label">ملاحظات</label>
        <input class="form-control" id="e_notes" value="${s.notes || ''}">
      </div>
    </div>
    <hr class="divider">
    <button class="btn btn-primary btn-full" onclick="submitEditStudent('${id}')">حفظ التعديلات</button>
  `);
}

async function submitEditStudent(id) {
  const body = {
    full_name: document.getElementById('e_name').value.trim(),
    grade: document.getElementById('e_grade').value.trim(),
    section: document.getElementById('e_section').value.trim(),
    parent_name: document.getElementById('e_parent').value.trim(),
    parent_phone: document.getElementById('e_phone').value.trim(),
    total_yearly_tuition: parseFloat(document.getElementById('e_tuition').value),
    status: document.getElementById('e_status').value,
    address: document.getElementById('e_address').value.trim(),
    notes: document.getElementById('e_notes').value.trim()
  };
  const res = await API.put(`/students/${id}`, body);
  if (res.success) {
    closeModal();
    showToast('✅ تم تحديث بيانات الطالب', 'success');
    renderStudents();
  }
}

async function deleteStudent(id, name) {
  if (!confirm(`هل أنت متأكد من حذف الطالب "${name}"؟ لا يمكن التراجع عن هذا الإجراء.`)) return;
  const res = await API.delete(`/students/${id}`);
  if (res.success) {
    showToast('🗑 تم حذف الطالب', 'error');
    renderStudents();
  }
}

async function viewStudentProfile(id) {
  const data = await API.get(`/finance/summary/${id}`);
  const { student: s, totalPaid, remaining, payments } = data;
  const pct = Math.min(100, (totalPaid / s.total_yearly_tuition) * 100).toFixed(0);

  let statusAlert = '';
  if (s.status === 'transferred') {
    statusAlert = `<div class="alert alert-blue">ℹ️ هذا الطالب منتقل إلى مدرسة أخرى</div>`;
  } else if (totalPaid >= s.total_yearly_tuition) {
    statusAlert = `<div class="alert alert-green">🎉 مستوفٍ - تم سداد كامل القسط السنوي</div>`;
  } else if (remaining > 0) {
    statusAlert = `<div class="alert alert-yellow">⚠️ متبقي ${remaining.toFixed(2)} د.أ من القسط السنوي</div>`;
  }

  openModal(`ملف الطالب — ${s.full_name}`, `
    ${statusAlert}
    <div class="profile-info-grid" style="margin-bottom:16px">
      <div class="profile-info-item"><div class="profile-info-label">رقم الطالب</div><div class="profile-info-value" style="color:var(--primary)">${s.student_id}</div></div>
      <div class="profile-info-item"><div class="profile-info-label">الصف</div><div class="profile-info-value">${s.grade}</div></div>
      <div class="profile-info-item"><div class="profile-info-label">الحالة</div><div class="profile-info-value">${statusBadge(s.status)}</div></div>
      <div class="profile-info-item"><div class="profile-info-label">ولي الأمر</div><div class="profile-info-value">${s.parent_name || '-'}</div></div>
      <div class="profile-info-item"><div class="profile-info-label">الهاتف</div><div class="profile-info-value" dir="ltr">${s.parent_phone || '-'}</div></div>
      <div class="profile-info-item"><div class="profile-info-label">القسط السنوي</div><div class="profile-info-value">${s.total_yearly_tuition} د.أ</div></div>
    </div>

    <div style="margin-bottom:16px">
      <div style="display:flex;justify-content:space-between;margin-bottom:6px;font-size:13px;font-weight:700">
        <span>نسبة السداد</span><span>${pct}%</span>
      </div>
      <div style="background:var(--border);border-radius:999px;height:10px;overflow:hidden">
        <div style="background:var(--success);height:100%;width:${pct}%;border-radius:999px"></div>
      </div>
      <div style="display:flex;justify-content:space-between;margin-top:8px;font-size:13px">
        <span style="color:var(--success)">مدفوع: <strong>${totalPaid.toFixed(2)} د.أ</strong></span>
        <span style="color:var(--danger)">متبقي: <strong>${remaining.toFixed(2)} د.أ</strong></span>
      </div>
    </div>

    <div style="font-weight:700;margin-bottom:8px;font-size:14px">سجل المدفوعات (${payments.length})</div>
    <div class="table-wrapper" style="max-height:200px;overflow-y:auto">
      <table>
        <thead><tr><th>التاريخ</th><th>المبلغ</th><th>الطريقة</th><th>المستلم</th></tr></thead>
        <tbody>
          ${payments.length === 0
            ? `<tr><td colspan="4" style="text-align:center;color:var(--text-muted)">لا توجد مدفوعات</td></tr>`
            : payments.map(p => `
              <tr>
                <td>${p.date_paid || '-'}</td>
                <td style="color:var(--success);font-weight:700">${p.amount} د.أ</td>
                <td>${p.payment_method || '-'}</td>
                <td>${p.collected_by || '-'}</td>
              </tr>`).join('')
          }
        </tbody>
      </table>
    </div>
    <hr class="divider">
    <div style="display:flex;gap:10px">
      <button class="btn btn-primary" style="flex:1" onclick="closeModal();navigateTo('finance');setTimeout(()=>openPaymentModal('${s.student_id}','${s.full_name}'),300)">💰 تسجيل دفعة</button>
      <button class="btn btn-outline" style="flex:1" onclick="closeModal();navigateTo('grades');setTimeout(()=>filterGradesByStudent('${s.student_id}'),300)">📝 الدرجات</button>
    </div>
  `);
}
