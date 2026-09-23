async function renderAttendance() {
  const el = document.getElementById('pageContent');
  const today = todayLocal();
  const gradeOptions = await getGradeOptions();

  el.innerHTML = `
    <div class="page-header">
      <div>
        <div class="page-heading">الحضور والغياب</div>
        <div class="page-subheading">تسجيل ومتابعة حضور الطلاب اليومي</div>
      </div>
      <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center">
        ${importControls('attendance', 'handleAttendanceImport')}
      </div>
    </div>
    <div id="attendanceImportResult"></div>

    <div class="card" style="margin-bottom:20px">
      <div class="card-body">
        <div class="search-bar">
          <input type="date" class="form-control" style="width:180px" id="att_date" value="${today}" onchange="loadAttendanceForDate(this.value)">
          <select class="form-control" style="width:180px" id="att_grade" onchange="loadAttendanceForDate(document.getElementById('att_date').value)">
            <option value="">كل الصفوف</option>
            ${gradeOptions}
          </select>
          <button class="btn btn-primary" onclick="saveAllAttendance()">💾 حفظ الحضور</button>
        </div>
      </div>
    </div>

    <div id="attendanceContent">
      <div class="loading"><div class="spinner"></div> جاري التحميل...</div>
    </div>
  `;

  loadAttendanceForDate(today);
}

async function loadAttendanceForDate(date) {
  const grade = document.getElementById('att_grade')?.value || '';
  let url = `/students?status=active`;
  if (grade) url += `&grade=${encodeURIComponent(grade)}`;
  const students = await API.get(url);

  // Load existing attendance for this date
  const existingMap = {};
  const dayRecords = await API.get(`/attendance?date=${date}`);
  const ids = new Set(students.map(s => s.student_id));
  dayRecords.forEach(a => { if (ids.has(a.student_id)) existingMap[a.student_id] = a.status; });

  const present = Object.values(existingMap).filter(v => v === 'present').length;
  const absent = Object.values(existingMap).filter(v => v === 'absent').length;
  const late = Object.values(existingMap).filter(v => v === 'late').length;

  const el = document.getElementById('attendanceContent');
  el.innerHTML = `
    <div class="summary-box" style="margin-bottom:16px">
      <div class="summary-item"><div class="summary-value" style="color:var(--success)">${present}</div><div class="summary-label">حاضر</div></div>
      <div class="summary-item"><div class="summary-value" style="color:var(--danger)">${absent}</div><div class="summary-label">غائب</div></div>
      <div class="summary-item"><div class="summary-value" style="color:var(--warning)">${late}</div><div class="summary-label">متأخر</div></div>
      <div class="summary-item"><div class="summary-value">${students.length}</div><div class="summary-label">إجمالي الطلاب</div></div>
    </div>

    <div class="card">
      <div class="card-header">
        <span class="card-title">كشف الحضور — ${date}</span>
        <div style="display:flex;gap:8px">
          <button class="btn btn-outline btn-sm" onclick="markAll('present')">✅ تحديد الكل حاضر</button>
          <button class="btn btn-outline btn-sm" onclick="markAll('absent')">❌ تحديد الكل غائب</button>
        </div>
      </div>
      <div class="table-wrapper">
        <table>
          <thead>
            <tr>
              <th>رقم الطالب</th>
              <th>الاسم</th>
              <th>الصف</th>
              <th>الحضور</th>
            </tr>
          </thead>
          <tbody>
            ${students.length === 0
              ? `<tr><td colspan="4"><div class="empty-state"><div class="empty-state-icon">📭</div><div class="empty-state-text">لا يوجد طلاب في هذا الصف</div></div></td></tr>`
              : students.map(s => {
                  const status = existingMap[s.student_id] || 'present';
                  return `
                    <tr>
                      <td style="color:var(--primary);font-weight:700">${s.student_id}</td>
                      <td><strong>${esc(s.full_name)}</strong></td>
                      <td>${esc(s.grade)}</td>
                      <td>
                        <select class="form-control att-select" style="width:140px" data-student="${s.student_id}" data-date="${date}">
                          <option value="present" ${status==='present'?'selected':''}>✅ حاضر</option>
                          <option value="absent" ${status==='absent'?'selected':''}>❌ غائب</option>
                          <option value="late" ${status==='late'?'selected':''}>⏰ متأخر</option>
                          <option value="excused" ${status==='excused'?'selected':''}>📋 غياب بعذر</option>
                        </select>
                      </td>
                    </tr>
                  `;
                }).join('')
            }
          </tbody>
        </table>
      </div>
    </div>
  `;
}

function markAll(status) {
  document.querySelectorAll('.att-select').forEach(sel => sel.value = status);
}

async function saveAllAttendance() {
  const selects = document.querySelectorAll('.att-select');
  if (selects.length === 0) return showToast('لا يوجد طلاب لحفظ حضورهم', 'error');

  const records = Array.from(selects).map(sel => ({
    student_id: sel.dataset.student,
    date: sel.dataset.date,
    status: sel.value
  }));

  const res = await once('saveAttendance', () => API.post('/attendance', records));
  if (!res || !res.success) return;
  showToast('✅ تم حفظ كشف الحضور بنجاح', 'success');
}

function handleAttendanceImport(event) {
  return importCSVFile(event, '/attendance/import', 'attendanceImportResult', 'الحضور', () => {
    const d = document.getElementById('att_date');
    if (d) loadAttendanceForDate(d.value);
  });
}
