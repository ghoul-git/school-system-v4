async function renderDashboard() {
  const data = await API.get('/dashboard');
  const el = document.getElementById('pageContent');

  el.innerHTML = `
    <div class="stats-grid">
      <div class="stat-card">
        <div class="stat-icon blue">👨‍🎓</div>
        <div class="stat-info">
          <div class="stat-value">${data.totalStudents}</div>
          <div class="stat-label">إجمالي الطلاب النشطين</div>
        </div>
      </div>
      <div class="stat-card">
        <div class="stat-icon green">💵</div>
        <div class="stat-info">
          <div class="stat-value">${data.totalRevenue.toFixed(0)} <small style="font-size:14px;font-weight:400">د.أ</small></div>
          <div class="stat-label">إجمالي الإيرادات المحصلة</div>
        </div>
      </div>
      <div class="stat-card">
        <div class="stat-icon yellow">📅</div>
        <div class="stat-info">
          <div class="stat-value">${data.monthRevenue.toFixed(0)} <small style="font-size:14px;font-weight:400">د.أ</small></div>
          <div class="stat-label">إيرادات هذا الشهر</div>
        </div>
      </div>
      <div class="stat-card">
        <div class="stat-icon red">⚠️</div>
        <div class="stat-info">
          <div class="stat-value">${data.debtors}</div>
          <div class="stat-label">طلاب لديهم ذمم مالية</div>
        </div>
      </div>
    </div>

    <div class="grid-2">
      <div class="card">
        <div class="card-header">
          <span class="card-title">آخر المدفوعات</span>
          <button class="btn btn-outline btn-sm" onclick="navigateTo('finance')">عرض الكل</button>
        </div>
        <div class="table-wrapper">
          <table>
            <thead>
              <tr>
                <th>الطالب</th>
                <th>المبلغ</th>
                <th>التاريخ</th>
                <th>الطريقة</th>
              </tr>
            </thead>
            <tbody>
              ${data.recentPayments.length === 0
                ? `<tr><td colspan="4"><div class="empty-state"><div class="empty-state-icon">💳</div><div class="empty-state-text">لا توجد مدفوعات بعد</div></div></td></tr>`
                : data.recentPayments.map(p => `
                  <tr>
                    <td><strong>${esc(p.full_name)}</strong></td>
                    <td><span style="color:var(--success);font-weight:700">${p.amount} د.أ</span></td>
                    <td>${p.date_paid || '-'}</td>
                    <td>${esc(p.payment_method || '-')}</td>
                  </tr>
                `).join('')
              }
            </tbody>
          </table>
        </div>
      </div>

      <div class="card">
        <div class="card-header">
          <span class="card-title">توزيع الطلاب حسب الصف</span>
        </div>
        <div class="card-body">
          ${data.byGrade.length === 0
            ? `<div class="empty-state"><div class="empty-state-icon">📊</div><div class="empty-state-text">لا يوجد بيانات</div></div>`
            : data.byGrade.map(g => `
              <div style="margin-bottom:12px;">
                <div style="display:flex;justify-content:space-between;margin-bottom:4px;">
                  <span style="font-size:13px;font-weight:600">${esc(g.grade)}</span>
                  <span style="font-size:13px;color:var(--text-muted)">${g.count} طالب</span>
                </div>
                <div style="background:var(--border);border-radius:999px;height:8px;overflow:hidden;">
                  <div style="background:var(--primary);height:100%;width:${Math.min(100, (g.count / data.totalStudents) * 100)}%;border-radius:999px;transition:width 0.5s;"></div>
                </div>
              </div>
            `).join('')
          }
        </div>
      </div>
    </div>

    <div style="margin-top:20px;" class="card">
      <div class="card-header">
        <span class="card-title">وصول سريع</span>
      </div>
      <div class="card-body" style="display:flex;gap:12px;flex-wrap:wrap;">
        <button class="btn btn-primary" onclick="navigateTo('students'); setTimeout(openAddStudentModal, 300)">+ تسجيل طالب جديد</button>
        <button class="btn btn-success" onclick="navigateTo('finance')">💰 تسجيل دفعة</button>
        <button class="btn btn-outline" onclick="navigateTo('attendance')">📅 تسجيل الحضور اليوم</button>
        <button class="btn btn-outline" onclick="navigateTo('grades')">📝 إدخال الدرجات</button>
        <button class="btn btn-outline" onclick="navigateTo('reports')">📋 طباعة تقرير</button>
      </div>
    </div>
  `;
}
