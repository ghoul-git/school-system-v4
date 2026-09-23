async function renderReports() {
  const el = document.getElementById('pageContent');
  el.innerHTML = `
    <div class="page-header">
      <div>
        <div class="page-heading">التقارير</div>
        <div class="page-subheading">تقارير مالية وأكاديمية قابلة للطباعة</div>
      </div>
    </div>

    <div class="grid-3" style="margin-bottom:24px">
      <div class="card" style="cursor:pointer" onclick="generateDebtorsReport()">
        <div class="card-body" style="text-align:center;padding:30px">
          <div style="font-size:40px;margin-bottom:12px">💸</div>
          <div style="font-weight:700;font-size:16px">تقرير المديونيات</div>
          <div style="color:var(--text-muted);font-size:13px;margin-top:6px">قائمة الطلاب ذوي الذمم المالية</div>
        </div>
      </div>
      <div class="card" style="cursor:pointer" onclick="generatePaymentsReport()">
        <div class="card-body" style="text-align:center;padding:30px">
          <div style="font-size:40px;margin-bottom:12px">📊</div>
          <div style="font-weight:700;font-size:16px">تقرير الإيرادات الشهري</div>
          <div style="color:var(--text-muted);font-size:13px;margin-top:6px">ملخص المدفوعات لهذا الشهر</div>
        </div>
      </div>
      <div class="card" style="cursor:pointer" onclick="openStudentReportModal()">
        <div class="card-body" style="text-align:center;padding:30px">
          <div style="font-size:40px;margin-bottom:12px">📋</div>
          <div style="font-weight:700;font-size:16px">كشف حساب طالب</div>
          <div style="color:var(--text-muted);font-size:13px;margin-top:6px">تقرير مالي وأكاديمي لطالب محدد</div>
        </div>
      </div>
    </div>

    <div id="reportOutput"></div>
  `;
}

async function generateDebtorsReport() {
  const students = await API.get('/students?status=active');
  const results = [];

  const paid = await API.get('/finance/balances');
  for (const s of students) {
    const totalPaid = paid[s.student_id] || 0;
    const remaining = Number(s.total_yearly_tuition) - totalPaid;
    if (remaining > 0) results.push({ ...s, totalPaid, remaining });
  }

  const total = results.reduce((sum, s) => sum + s.remaining, 0);
  const el = document.getElementById('reportOutput');

  el.innerHTML = `
    <div class="card">
      <div class="card-header">
        <span class="card-title">📋 تقرير المديونيات — ${new Date().toLocaleDateString('ar-JO')}</span>
        <button class="btn btn-outline btn-sm" onclick="printReport()">🖨 طباعة</button>
      </div>
      <div id="printable">
        <div class="card-body">
          <div class="alert alert-red" style="margin-bottom:16px">
            إجمالي الذمم المالية غير المسددة: <strong>${total.toFixed(2)} د.أ</strong> — ${results.length} طالب
          </div>
          <div class="table-wrapper">
            <table>
              <thead>
                <tr><th>رقم الطالب</th><th>الاسم</th><th>الصف</th><th>الهاتف</th><th>القسط الكلي</th><th>المدفوع</th><th>المتبقي</th></tr>
              </thead>
              <tbody>
                ${results.map(s => `
                  <tr>
                    <td>${s.student_id}</td>
                    <td><strong>${esc(s.full_name)}</strong></td>
                    <td>${esc(s.grade)}</td>
                    <td dir="ltr">${esc(s.parent_phone || '-')}</td>
                    <td>${s.total_yearly_tuition} د.أ</td>
                    <td style="color:var(--success)">${s.totalPaid.toFixed(2)} د.أ</td>
                    <td style="color:var(--danger);font-weight:700">${s.remaining.toFixed(2)} د.أ</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  `;
}

async function generatePaymentsReport() {
  const month = todayLocal().slice(0, 7);
  const payments = await API.get(`/payments`);
  const monthPayments = payments.filter(p => p.date_paid && p.date_paid.startsWith(month));
  const total = monthPayments.reduce((s, p) => s + p.amount, 0);

  const byMethod = {};
  monthPayments.forEach(p => {
    byMethod[p.payment_method] = (byMethod[p.payment_method] || 0) + p.amount;
  });

  document.getElementById('reportOutput').innerHTML = `
    <div class="card">
      <div class="card-header">
        <span class="card-title">📊 تقرير الإيرادات — ${month}</span>
        <button class="btn btn-outline btn-sm" onclick="printReport()">🖨 طباعة</button>
      </div>
      <div id="printable">
        <div class="card-body">
          <div class="summary-box" style="margin-bottom:20px">
            <div class="summary-item"><div class="summary-value" style="color:var(--success)">${total.toFixed(2)}</div><div class="summary-label">إجمالي الشهر (د.أ)</div></div>
            <div class="summary-item"><div class="summary-value">${monthPayments.length}</div><div class="summary-label">عدد العمليات</div></div>
          </div>

          <div style="margin-bottom:20px">
            <div style="font-weight:700;margin-bottom:10px">توزيع حسب طريقة الدفع</div>
            ${Object.entries(byMethod).map(([method, amount]) => `
              <div style="display:flex;justify-content:space-between;padding:10px;background:var(--surface2);border-radius:6px;margin-bottom:6px">
                <span>${esc(method)}</span>
                <strong style="color:var(--success)">${amount.toFixed(2)} د.أ</strong>
              </div>
            `).join('')}
          </div>

          <div class="table-wrapper">
            <table>
              <thead><tr><th>الطالب</th><th>المبلغ</th><th>الطريقة</th><th>المستلم</th><th>التاريخ</th></tr></thead>
              <tbody>
                ${monthPayments.map(p => `
                  <tr>
                    <td>${esc(p.full_name)}</td>
                    <td style="color:var(--success);font-weight:700">${p.amount} د.أ</td>
                    <td>${esc(p.payment_method)}</td>
                    <td>${esc(p.collected_by || '-')}</td>
                    <td>${p.date_paid}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  `;
}

async function openStudentReportModal() {
  const students = await API.get('/students');
  openModal('اختر الطالب', `
    <div class="form-group">
      <label class="form-label">الطالب</label>
      <select class="form-control" id="rpt_student">
        <option value="">-- اختر طالب --</option>
        ${students.map(s => `<option value="${s.student_id}">${esc(s.full_name)} (${s.student_id})</option>`).join('')}
      </select>
    </div>
    <hr class="divider">
    <button class="btn btn-primary btn-full" onclick="generateStudentReport(document.getElementById('rpt_student').value)">إنشاء التقرير</button>
  `);
}

async function generateStudentReport(studentId) {
  if (!studentId) return showToast('اختر طالباً', 'error');
  closeModal();
  const [finData, gradeData] = await Promise.all([
    API.get(`/finance/summary/${studentId}`),
    API.get(`/grades/${studentId}`)
  ]);
  const { student: s, payments, totalPaid, remaining } = finData;
  const avgGrade = gradeData.length ? (gradeData.reduce((sum, g) => sum + (g.score || 0), 0) / gradeData.length).toFixed(1) : '-';

  document.getElementById('reportOutput').innerHTML = `
    <div class="card">
      <div class="card-header">
        <span class="card-title">كشف حساب: ${esc(s.full_name)}</span>
        <button class="btn btn-outline btn-sm" onclick="printReport()">🖨 طباعة</button>
      </div>
      <div id="printable">
        <div class="card-body">
          <div class="profile-info-grid" style="margin-bottom:20px">
            <div class="profile-info-item"><div class="profile-info-label">رقم الطالب</div><div class="profile-info-value">${s.student_id}</div></div>
            <div class="profile-info-item"><div class="profile-info-label">الصف</div><div class="profile-info-value">${esc(s.grade)}</div></div>
            <div class="profile-info-item"><div class="profile-info-label">الحالة</div><div class="profile-info-value">${statusBadge(s.status)}</div></div>
            <div class="profile-info-item"><div class="profile-info-label">ولي الأمر</div><div class="profile-info-value">${esc(s.parent_name || '-')}</div></div>
            <div class="profile-info-item"><div class="profile-info-label">الهاتف</div><div class="profile-info-value">${esc(s.parent_phone || '-')}</div></div>
            <div class="profile-info-item"><div class="profile-info-label">المعدل العام</div><div class="profile-info-value" style="color:var(--primary)">${avgGrade}</div></div>
          </div>
          <div class="summary-box" style="margin-bottom:20px">
            <div class="summary-item"><div class="summary-value">${s.total_yearly_tuition}</div><div class="summary-label">القسط الكلي (د.أ)</div></div>
            <div class="summary-item"><div class="summary-value" style="color:var(--success)">${totalPaid.toFixed(2)}</div><div class="summary-label">المدفوع (د.أ)</div></div>
            <div class="summary-item"><div class="summary-value" style="color:var(--danger)">${remaining.toFixed(2)}</div><div class="summary-label">المتبقي (د.أ)</div></div>
          </div>
          <div style="font-weight:700;margin-bottom:8px">سجل المدفوعات</div>
          <table>
            <thead><tr><th>التاريخ</th><th>المبلغ</th><th>الطريقة</th><th>المستلم</th></tr></thead>
            <tbody>
              ${payments.map(p => `<tr><td>${p.date_paid}</td><td>${p.amount} د.أ</td><td>${esc(p.payment_method)}</td><td>${esc(p.collected_by)}</td></tr>`).join('')}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  `;
}

function printReport() {
  const content = document.getElementById('printable').innerHTML;
  const win = window.open('', '_blank');
  win.document.write(`
    <html dir="rtl"><head>
      <meta charset="UTF-8">
      <title>تقرير</title>
      <link href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;700&display=swap" rel="stylesheet">
      <style>
        body { font-family: 'Cairo', sans-serif; padding: 20px; direction: rtl; }
        table { width:100%; border-collapse:collapse; }
        th, td { padding:8px; border:1px solid #ddd; text-align:right; }
        th { background:#f0f0f0; }
        .summary-box { display:flex; gap:20px; background:#f7f7f7; padding:15px; border-radius:8px; margin:15px 0; }
        .summary-item { text-align:center; }
        .summary-value { font-size:22px; font-weight:900; }
        .summary-label { font-size:11px; color:#666; }
        .profile-info-grid { display:grid; grid-template-columns:repeat(3,1fr); gap:10px; margin-bottom:15px; }
        .profile-info-item { background:#f7f7f7; padding:10px; border-radius:6px; }
        .profile-info-label { font-size:10px; color:#999; }
        .profile-info-value { font-weight:700; }
      </style>
    </head><body>${content}</body></html>
  `);
  win.document.close();
  win.print();
}
