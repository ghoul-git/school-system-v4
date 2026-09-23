// Shared header/footer for legal pages + fills business details from /js/business.js
(function () {
  const B = window.BUSINESS || {};
  const esc = v => String(v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const val = k => (B[k] === null || B[k] === undefined || B[k] === '') ? `<span class="todo">[يُستكمل: ${k}]</span>` : esc(B[k]);
  document.querySelectorAll('[data-biz]').forEach(el => { el.innerHTML = val(el.dataset.biz); });
  const links = [
    ['/legal/privacy.html', 'سياسة الخصوصية'], ['/legal/terms.html', 'شروط الخدمة'], ['/legal/refund.html', 'سياسة الاسترداد'],
    ['/legal/cookies.html', 'سياسة ملفات تعريف الارتباط'], ['/legal/about.html', 'معلومات الشركة'], ['/legal/licenses.html', 'التراخيص']
  ];
  const here = location.pathname;
  const header = document.createElement('header');
  header.className = 'legal-top';
  header.innerHTML = `<nav aria-label="الصفحات القانونية"><a class="brand" href="/">${val('productName')}</a>${links.map(([h, t]) => `<a href="${h}"${here === h ? ' aria-current="page"' : ''}>${t}</a>`).join('')}</nav>`;
  document.body.prepend(header);
  const skip = document.createElement('a');
  skip.className = 'skip-link'; skip.href = '#content'; skip.textContent = 'تخطَّ إلى المحتوى';
  document.body.prepend(skip);
  const foot = document.createElement('footer');
  foot.className = 'legal-foot';
  foot.innerHTML = `© ${new Date().getFullYear()} ${val('companyName')} — ${val('address')} — ${val('email')}`;
  document.body.append(foot);
})();
