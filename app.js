// School Management System — Express API backed by Supabase.
// Every request runs as the logged-in staff member (their JWT is forwarded),
// so Row Level Security in Postgres is the final gatekeeper.
const express = require('express');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

// Both values are public by design (the browser needs them); security comes from Row Level Security.
// Set SCHOOL_SUPABASE_URL / SCHOOL_SUPABASE_KEY to point at a different Supabase project.
const SUPABASE_URL = process.env.SCHOOL_SUPABASE_URL || 'https://equkqmyeleoixnrxugbr.supabase.co';
const SUPABASE_KEY = process.env.SCHOOL_SUPABASE_KEY || 'sb_publishable_O5NxGkMNvgDThJlWpWWHow_NhIZ_Eu3';

const app = express();
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Public: the browser needs these to show the login screen (both are safe to expose).
app.get('/api/config', (req, res) => {
  res.json({ supabaseUrl: SUPABASE_URL, supabaseKey: SUPABASE_KEY });
});

// Everything else under /api requires a logged-in user.
app.use('/api', (req, res, next) => {
  const auth = req.headers.authorization || '';
  if (!auth.startsWith('Bearer ')) return res.status(401).json({ error: 'Not logged in' });
  req.db = createClient(SUPABASE_URL, SUPABASE_KEY, {
    global: { headers: { Authorization: auth } },
    auth: { persistSession: false, autoRefreshToken: false }
  });
  next();
});

// Wrap async handlers so errors reach the error middleware.
const h = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
// Unwrap a Supabase result or throw.
function ok({ data, error }) { if (error) throw error; return data; }
// PostgREST returns at most 1000 rows per request; page through larger tables.
async function fetchAll(build) {
  const size = 1000; let from = 0; const out = [];
  for (;;) {
    const rows = ok(await build().range(from, from + size - 1));
    out.push(...rows);
    if (rows.length < size) return out;
    from += size;
  }
}
const today = () => new Date().toISOString().slice(0, 10);
const monthRange = m => { // 'YYYY-MM' -> ['YYYY-MM-01', first day of next month]
  const [y, mo] = m.split('-').map(Number);
  const next = mo === 12 ? `${y + 1}-01` : `${y}-${String(mo + 1).padStart(2, '0')}`;
  return [`${m}-01`, `${next}-01`];
};
const clean = s => String(s).replace(/[,()%*\\]/g, ' ').trim(); // safe inside PostgREST filters

// ─── SETTINGS ───────────────────────────────────────────────
app.get('/api/settings', h(async (req, res) => {
  const rows = ok(await req.db.from('settings').select('key, value'));
  res.json(Object.fromEntries(rows.map(r => [r.key, r.value])));
}));

app.post('/api/settings', h(async (req, res) => {
  const rows = Object.entries(req.body).map(([key, value]) => ({ key, value: value == null ? null : String(value) }));
  if (rows.length) ok(await req.db.from('settings').upsert(rows));
  res.json({ success: true });
}));

// ─── STUDENTS ────────────────────────────────────────────────
app.get('/api/students', h(async (req, res) => {
  const { grade, status, search } = req.query;
  const rows = await fetchAll(() => {
    let q = req.db.from('students').select('*');
    if (grade) q = q.eq('grade', grade);
    if (status) q = q.eq('status', status);
    if (search && clean(search)) { const s = clean(search); q = q.or(`full_name.ilike.*${s}*,student_id.ilike.*${s}*`); }
    return q.order('full_name').order('id');
  });
  res.json(rows);
}));

app.get('/api/students/:id', h(async (req, res) => {
  const student = ok(await req.db.from('students').select('*').eq('student_id', req.params.id).maybeSingle());
  if (!student) return res.status(404).json({ error: 'Student not found' });
  res.json(student);
}));

app.post('/api/students', h(async (req, res) => {
  const { full_name, grade, section, parent_name, parent_phone, parent_email, address, date_of_birth, gender, total_yearly_tuition, notes } = req.body;
  if (!full_name || !grade) return res.status(400).json({ error: 'Name and grade are required' });
  // student_id comes from a Postgres sequence, so two people adding at once never collide.
  const row = ok(await req.db.from('students').insert({
    full_name, grade, section: section || 'A', parent_name: parent_name || '', parent_phone: parent_phone || '',
    parent_email: parent_email || '', address: address || '', date_of_birth: date_of_birth || '',
    gender: gender || 'male', total_yearly_tuition: total_yearly_tuition || 500, notes: notes || ''
  }).select('student_id').single());
  res.json({ success: true, student_id: row.student_id });
}));

app.put('/api/students/:id', h(async (req, res) => {
  const fields = ['full_name','grade','section','parent_name','parent_phone','parent_email','address','date_of_birth','gender','total_yearly_tuition','status','notes'];
  const updates = Object.fromEntries(fields.filter(f => req.body[f] !== undefined).map(f => [f, req.body[f]]));
  if (!Object.keys(updates).length) return res.status(400).json({ error: 'Nothing to update' });
  ok(await req.db.from('students').update(updates).eq('student_id', req.params.id));
  res.json({ success: true });
}));

app.delete('/api/students/:id', h(async (req, res) => {
  ok(await req.db.from('students').delete().eq('student_id', req.params.id));
  res.json({ success: true });
}));

// ─── PAYMENTS ────────────────────────────────────────────────
const flattenName = r => { const { students, ...p } = r; return { ...p, full_name: students?.full_name }; };

app.get('/api/payments', h(async (req, res) => {
  const { student_id } = req.query;
  const rows = await fetchAll(() => {
    let q = req.db.from('payments')
      .select('id, transaction_id, student_id, amount, payment_method, collected_by, date_paid, notes, created_at, students!inner(full_name)');
    if (student_id) q = q.eq('student_id', student_id);
    return q.order('date_paid', { ascending: false }).order('id', { ascending: false });
  });
  res.json(rows.map(flattenName));
}));

app.post('/api/payments', h(async (req, res) => {
  const { student_id, amount, payment_method, collected_by, date_paid, notes } = req.body;
  if (!student_id || !amount) return res.status(400).json({ error: 'Student ID and amount required' });
  const txId = 'TXN-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6).toUpperCase();
  ok(await req.db.from('payments').insert({
    transaction_id: txId, student_id, amount, payment_method: payment_method || 'cash',
    collected_by: collected_by || '', date_paid: date_paid || today(), notes: notes || ''
  }));
  res.json({ success: true, transaction_id: txId });
}));

app.delete('/api/payments/:id', h(async (req, res) => {
  ok(await req.db.from('payments').delete().eq('id', req.params.id));
  res.json({ success: true });
}));

// ─── FINANCE ─────────────────────────────────────────────────
app.get('/api/finance/summary/:student_id', h(async (req, res) => {
  const id = req.params.student_id;
  const [student, payments] = await Promise.all([
    req.db.from('students').select('*').eq('student_id', id).maybeSingle().then(ok),
    fetchAll(() => req.db.from('payments').select('*').eq('student_id', id).order('date_paid', { ascending: false }))
  ]);
  if (!student) return res.status(404).json({ error: 'Student not found' });
  const totalPaid = payments.reduce((sum, p) => sum + Number(p.amount), 0);
  const currentMonth = today().slice(0, 7);
  const monthlyPaid = payments.filter(p => p.date_paid && p.date_paid.startsWith(currentMonth)).reduce((sum, p) => sum + Number(p.amount), 0);
  res.json({ student, payments, totalPaid, monthlyPaid, remaining: Number(student.total_yearly_tuition) - totalPaid });
}));

// Total paid per student in one query (used by the debtors report).
app.get('/api/finance/balances', h(async (req, res) => {
  const rows = ok(await req.db.rpc('student_balances'));
  res.json(Object.fromEntries(rows.map(r => [r.student_id, Number(r.total_paid)])));
}));

// ─── GRADES ──────────────────────────────────────────────────
app.get('/api/grades/:student_id', h(async (req, res) => {
  const rows = ok(await req.db.from('grades').select('*, subjects(name)').eq('student_id', req.params.student_id));
  const out = rows.map(({ subjects, ...g }) => ({ ...g, subject_name: subjects?.name }))
    .sort((a, b) => (a.subject_name || '').localeCompare(b.subject_name || '', 'ar') || String(a.semester).localeCompare(String(b.semester)));
  res.json(out);
}));

function getLetterGrade(score) {
  if (score >= 90) return 'A+';
  if (score >= 80) return 'A';
  if (score >= 70) return 'B';
  if (score >= 60) return 'C';
  if (score >= 50) return 'D';
  return 'F';
}

app.post('/api/grades', h(async (req, res) => {
  const { student_id, subject_id, semester, score, max_score, grade_letter, teacher_notes, academic_year } = req.body;
  ok(await req.db.from('grades').upsert({
    student_id, subject_id, semester, score, max_score: max_score || 100,
    grade_letter: grade_letter || getLetterGrade(score), teacher_notes: teacher_notes || '',
    academic_year: academic_year || '2025/2026'
  }, { onConflict: 'student_id,subject_id,semester,academic_year' }));
  res.json({ success: true });
}));

// ─── SUBJECTS ────────────────────────────────────────────────
app.get('/api/subjects', h(async (req, res) => {
  let q = req.db.from('subjects').select('*');
  q = req.query.grade ? q.eq('grade', req.query.grade).order('name') : q.order('grade').order('name');
  res.json(ok(await q));
}));

// ─── ATTENDANCE ──────────────────────────────────────────────
// All students' attendance for one day (one query instead of one per student).
app.get('/api/attendance', h(async (req, res) => {
  const date = req.query.date || today();
  res.json(await fetchAll(() => req.db.from('attendance').select('*').eq('date', date).order('id')));
}));

app.get('/api/attendance/:student_id', h(async (req, res) => {
  let q = req.db.from('attendance').select('*').eq('student_id', req.params.student_id);
  if (req.query.month) { const [a, b] = monthRange(req.query.month); q = q.gte('date', a).lt('date', b); }
  res.json(ok(await q.order('date', { ascending: false })));
}));

// Accepts one record or an array (saving a whole class in one request).
app.post('/api/attendance', h(async (req, res) => {
  const list = (Array.isArray(req.body) ? req.body : [req.body]).map(({ student_id, date, status, notes }) =>
    ({ student_id, date, status: status || 'present', notes: notes || '' }));
  if (list.length) ok(await req.db.from('attendance').upsert(list, { onConflict: 'student_id,date' }));
  res.json({ success: true });
}));

// ─── DASHBOARD ───────────────────────────────────────────────
app.get('/api/dashboard', h(async (req, res) => {
  res.json(ok(await req.db.rpc('dashboard_stats')));
}));

// Unknown API routes
app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

// Errors: expired/invalid login -> 401, everything else -> 500 with the message.
app.use((err, req, res, next) => {
  const msg = err?.message || String(err);
  const authError = /jwt|JWS|token/i.test(msg) || String(err?.code || '').startsWith('PGRST3');
  if (!authError) console.error(err);
  res.status(authError ? 401 : 500).json({ error: authError ? 'Session expired' : msg });
});

module.exports = app;
