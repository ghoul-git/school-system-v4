async function renderFinance() {
  const el = document.getElementById('pageContent');
  const payments = await API.get('/payments');
  const total = payments.reduce((s, p) => s + p.amount, 0);
  const month = new Date().toISOString().slice(0, 7);
  const monthTotal = payments.filter(p => p.date_paid && p.date_paid.startsWith(month)).reduce((s, p) => s + p.amount, 0);

  el.innerHTML = `
    <div class="page-header">
      <div>
        <div class="page-heading">إدارة المالية</div>
        <div class="page-subheading">متابعة المدفوعات والذمم المالية</div>
      </div>
      <button class="btn btn-success" onclick="openPaymentModal()">+ تسجيل دفعة جديدة</button>
    </div>

    <div class="summary-box" style="margin-bottom:20px">
      <div class="summary-item">
        <div class="summary-value" style="color:var(--success)">${total.toFixed(2)}</div>
        <div class="summary-label">إجمالي المحصّل (د.أ)</div>
      </div>
      <div class="summary-item">
        <div class="summary-value" style="color:var(--primary)">${monthTotal.toFixed(2)}</div>
        <div class="summary-label">محصّل هذا الشهر (د.أ)</div>
      </div>
      <div class="summary-item">
        <div class="summary-value">${payments.length}</div>
        <div class="summary-label">إجمالي عمليات القبض</div>
      </div>
    </div>

    <div class="card">
      <div class="card-body" style="padding-bottom:0">
        <div class="search-bar">
          <input class="search-input" id="financeSearch" placeholder="🔍 بحث باسم الطالب..." oninput="filterPayments()">
          <input type="month" class="form-control" style="width:180px" id="monthFilter" value="${month}" onchange="filterPayments()">
        </div>
      </div>
      <div class="table-wrapper">
        <table>
          <thead>
            <tr>
              <th>رقم العملية</th>
              <th>اسم الطالب</th>
              <th>المبلغ</th>
              <th>طريقة الدفع</th>
              <th>المستلم</th>
              <th>التاريخ</th>
              <th>إجراءات</th>
            </tr>
          </thead>
          <tbody id="paymentsTbody">
            ${renderPaymentRows(payments)}
          </tbody>
        </table>
      </div>
    </div>
  `;
  window._allPayments = payments;
}

function renderPaymentRows(payments) {
  if (payments.length === 0) {
    return `<tr><td colspan="7"><div class="empty-state">
      <div class="empty-state-icon">💳</div>
      <div class="empty-state-text">لا توجد مدفوعات مسجلة</div>
    </div></td></tr>`;
  }
  return payments.map(p => `
    <tr>
      <td><small style="color:var(--text-muted)">${p.transaction_id}</small></td>
      <td><strong>${p.full_name}</strong></td>
      <td><span style="color:var(--success);font-weight:700;font-size:15px">${p.amount} د.أ</span></td>
      <td>${p.payment_method || '-'}</td>
      <td>${p.collected_by || '-'}</td>
      <td>${p.date_paid || '-'}</td>
      <td>
        <button class="btn btn-danger btn-sm" onclick="deletePayment(${p.id})">🗑</button>
      </td>
    </tr>
  `).join('');
}

function filterPayments() {
  const search = document.getElementById('financeSearch').value.toLowerCase();
  const month = document.getElementById('monthFilter').value;
  const filtered = (window._allPayments || []).filter(p => {
    const matchSearch = !search || (p.full_name && p.full_name.toLowerCase().includes(search));
    const matchMonth = !month || (p.date_paid && p.date_paid.startsWith(month));
    return matchSearch && matchMonth;
  });
  document.getElementById('paymentsTbody').innerHTML = renderPaymentRows(filtered);
}

async function openPaymentModal(prefilledId = '', prefilledName = '') {
  const students = await API.get('/students?status=active');
  const options = students.map(s =>
    `<option value="${s.student_id}" ${s.student_id === prefilledId ? 'selected' : ''}>${s.full_name} (${s.student_id})</option>`
  ).join('');

  openModal('تسجيل دفعة جديدة', `
    <div class="form-grid">
      <div class="form-group form-full">
        <label class="form-label">اختر الطالب *</label>
        <select class="form-control" id="p_student" onchange="loadStudentBalance(this.value)">
          <option value="">-- اختر طالب --</option>
          ${options}
        </select>
      </div>
      <div id="balanceAlert" style="grid-column:1/-1"></div>
      <div class="form-group">
        <label class="form-label">المبلغ المقبوض (د.أ) *</label>
        <input class="form-control" id="p_amount" type="number" min="1" placeholder="0">
      </div>
      <div class="form-group">
        <label class="form-label">تاريخ الدفع</label>
        <input class="form-control" id="p_date" type="date" value="${new Date().toISOString().split('T')[0]}">
      </div>
      <div class="form-group">
        <label class="form-label">طريقة الدفع</label>
        <select class="form-control" id="p_method">
          <option value="كاش (نقدي)">كاش (نقدي)</option>
          <option value="كليك (CliQ)">كليك (CliQ)</option>
          <option value="تحويل بنكي">تحويل بنكي</option>
          <option value="شيك">شيك</option>
        </select>
      </div>
      <div class="form-group">
        <label class="form-label">اسم المستلم *</label>
        <input class="form-control" id="p_collector" placeholder="اسم الموظف">
      </div>
      <div class="form-group form-full">
        <label class="form-label">ملاحظات</label>
        <input class="form-control" id="p_notes" placeholder="قسط شهر...">
      </div>
    </div>
    <hr class="divider">
    <button class="btn btn-success btn-full" onclick="submitPayment()">✅ تأكيد وحفظ العملية</button>
  `);

  if (prefilledId) setTimeout(() => loadStudentBalance(prefilledId), 100);
}

async function loadStudentBalance(studentId) {
  if (!studentId) return;
  const data = await API.get(`/finance/summary/${studentId}`);
  const el = document.getElementById('balanceAlert');
  if (!el) return;
  const { totalPaid, remaining, student } = data;
  const cls = remaining <= 0 ? 'alert-green' : remaining > student.total_yearly_tuition * 0.5 ? 'alert-red' : 'alert-yellow';
  el.innerHTML = `<div class="alert ${cls}" style="margin:0 0 4px 0">
    💰 مدفوع: <strong>${totalPaid.toFixed(2)} د.أ</strong> &nbsp;|&nbsp; متبقي: <strong>${remaining.toFixed(2)} د.أ</strong>
  </div>`;
}

async function submitPayment() {
  const body = {
    student_id: document.getElementById('p_student').value,
    amount: parseFloat(document.getElementById('p_amount').value),
    payment_method: document.getElementById('p_method').value,
    collected_by: document.getElementById('p_collector').value.trim(),
    date_paid: document.getElementById('p_date').value,
    notes: document.getElementById('p_notes').value.trim()
  };
  if (!body.student_id) return showToast('الرجاء اختيار الطالب', 'error');
  if (!body.amount || body.amount <= 0) return showToast('الرجاء إدخال مبلغ صحيح', 'error');
  if (!body.collected_by) return showToast('الرجاء إدخال اسم المستلم', 'error');

  const res = await API.post('/payments', body);
  if (res.success) {
    closeModal();
    showToast('✅ تم تسجيل الدفعة بنجاح', 'success');
    renderFinance();
  }
}

async function deletePayment(id) {
  if (!confirm('هل أنت متأكد من حذف هذه العملية؟')) return;
  const res = await API.delete(`/payments/${id}`);
  if (res.success) {
    showToast('تم حذف العملية', 'error');
    renderFinance();
  }
}
