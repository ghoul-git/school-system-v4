async function renderGrades() {
  const el = document.getElementById('pageContent');
  const students = await API.get('/students?status=active');
  // pre-cache grades config
  await getGradeOptions();

  el.innerHTML = `
    <div class="page-header">
      <div>
        <div class="page-heading">إدارة الدرجات</div>
        <div class="page-subheading">إدخال ومتابعة درجات الطلاب</div>
      </div>
    </div>

    <div class="card" style="margin-bottom:20px">
      <div class="card-body">
        <div class="search-bar">
          <select class="form-control" id="g_studentSelect" onchange="loadStudentGrades(this.value)">
            <option value="">-- اختر طالباً لعرض درجاته --</option>
            ${students.map(s => `<option value="${s.student_id}">${esc(s.full_name)} — ${esc(s.grade)}</option>`).join('')}
          </select>
          <select class="form-control" style="width:160px" id="g_semesterFilter" onchange="loadStudentGrades(document.getElementById('g_studentSelect').value)">
            <option value="">كل الفصول</option>
            <option value="الفصل الأول">الفصل الأول</option>
            <option value="الفصل الثاني">الفصل الثاني</option>
            <option value="السنوي">السنوي</option>
          </select>
        </div>
      </div>
    </div>

    <div id="gradesContent">
      <div class="empty-state">
        <div class="empty-state-icon">📝</div>
        <div class="empty-state-text">اختر طالباً لعرض درجاته</div>
      </div>
    </div>
  `;
}

async function filterGradesByStudent(studentId) {
  const select = document.getElementById('g_studentSelect');
  if (select) {
    select.value = studentId;
    loadStudentGrades(studentId);
  }
}

async function loadStudentGrades(studentId) {
  if (!studentId) return;
  const semFilter = document.getElementById('g_semesterFilter')?.value || '';
  const [gradeData, student] = await Promise.all([
    API.get(`/grades/${studentId}`),
    API.get(`/students/${studentId}`)
  ]);

  window._currentStudentGrade = student.grade;
  const subjects = await API.get(`/subjects?grade=${encodeURIComponent(student.grade)}`);
  const filtered = semFilter ? gradeData.filter(g => g.semester === semFilter) : gradeData;

  // Group by semester
  const bySemester = {};
  filtered.forEach(g => {
    if (!bySemester[g.semester]) bySemester[g.semester] = [];
    bySemester[g.semester].push(g);
  });

  const avgAll = filtered.length ? (filtered.reduce((s, g) => s + (g.score || 0), 0) / filtered.length).toFixed(1) : '-';

  const el = document.getElementById('gradesContent');
  el.innerHTML = `
    <div class="card" style="margin-bottom:16px">
      <div class="card-header">
        <span class="card-title">📊 ملخص درجات: ${esc(student.full_name)} — ${esc(student.grade)}</span>
        <div style="display:flex;gap:8px">
          <span class="badge badge-blue">المعدل العام: ${avgAll}</span>
          <button class="btn btn-primary btn-sm" onclick="openEnterGradesModal('${studentId}')">+ إدخال درجات</button>
        </div>
      </div>
      <div class="card-body">
        ${Object.keys(bySemester).length === 0
          ? `<div class="empty-state"><div class="empty-state-icon">📭</div><div class="empty-state-text">لا توجد درجات مسجلة لهذا الطالب</div></div>`
          : Object.entries(bySemester).map(([sem, grades]) => {
              const avg = (grades.reduce((s, g) => s + (g.score || 0), 0) / grades.length).toFixed(1);
              return `
                <div style="margin-bottom:20px">
                  <div style="font-weight:700;font-size:15px;margin-bottom:10px;color:var(--primary)">${esc(sem)} — معدل: ${avg}</div>
                  <div class="table-wrapper">
                    <table>
                      <thead><tr><th>المادة</th><th>الدرجة</th><th>من</th><th>التقدير</th></tr></thead>
                      <tbody>
                        ${grades.map(g => `
                          <tr>
                            <td><strong>${esc(g.subject_name)}</strong></td>
                            <td style="font-size:16px;font-weight:700">${g.score ?? '-'}</td>
                            <td style="color:var(--text-muted)">${g.max_score}</td>
                            <td>${gradeBadge(g.grade_letter)}</td>
                          </tr>
                        `).join('')}
                      </tbody>
                    </table>
                  </div>
                </div>
              `;
            }).join('')
        }
      </div>
    </div>
  `;
}

async function openEnterGradesModal(studentId, grade) {
  grade = grade || window._currentStudentGrade;
  const subjects = await API.get(`/subjects?grade=${encodeURIComponent(grade)}`);
  const existing = await API.get(`/grades/${studentId}`);
  const existingMap = {};
  existing.forEach(g => existingMap[`${g.subject_id}_${g.semester}`] = g.score);

  const semesters = ['الفصل الأول', 'الفصل الثاني', 'السنوي'];

  openModal('إدخال الدرجات', `
    <div class="form-group" style="margin-bottom:16px">
      <label class="form-label">الفصل الدراسي</label>
      <select class="form-control" id="eg_semester">
        ${semesters.map(s => `<option value="${s}">${s}</option>`).join('')}
      </select>
    </div>
    <div class="table-wrapper" style="max-height:350px;overflow-y:auto">
      <table>
        <thead><tr><th>المادة</th><th>الدرجة (من 100)</th></tr></thead>
        <tbody>
          ${subjects.map(sub => `
            <tr>
              <td><strong>${esc(sub.name)}</strong></td>
              <td><input class="form-control" type="number" min="0" max="100"
                id="score_${sub.id}" placeholder="0-100"
                value="${existingMap[sub.id + '_' + 'الفصل الأول'] ?? ''}">
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
    <hr class="divider">
    <button class="btn btn-primary btn-full" onclick="submitGrades('${studentId}', ${JSON.stringify(subjects.map(s => s.id))})">💾 حفظ الدرجات</button>
  `);
}

async function submitGrades(studentId, subjectIds) {
  const semester = document.getElementById('eg_semester').value;
  const promises = subjectIds.map(id => {
    const input = document.getElementById(`score_${id}`);
    if (!input || input.value === '') return null;
    const score = parseFloat(input.value);
    return API.post('/grades', { student_id: studentId, subject_id: id, semester, score });
  }).filter(Boolean);

  await Promise.all(promises);
  closeModal();
  showToast('✅ تم حفظ الدرجات بنجاح', 'success');
  loadStudentGrades(studentId);
}
