// School Management System — Express API backed by Supabase.
// Every request runs as the logged-in staff member (their JWT is forwarded),
// so Row Level Security in Postgres is the final gatekeeper.
'use strict';
const express = require('express');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

// Both values are public by design (the browser needs them); security comes from Row Level Security.
// Set SCHOOL_SUPABASE_URL / SCHOOL_SUPABASE_KEY to point at a different Supabase project.
const SUPABASE_URL = process.env.SCHOOL_SUPABASE_URL || 'https://equkqmyeleoixnrxugbr.supabase.co';
const SUPABASE_KEY = process.env.SCHOOL_SUPABASE_KEY || 'sb_publishable_O5NxGkMNvgDThJlWpWWHow_NhIZ_Eu3';

const app = express();
// Wrap async handlers so errors reach the error middleware.
const h = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
// Unwrap a Supabase result or throw.
function ok({ data, error }) { if (error) throw error; return data; }
app.use(express.json({ limit: '5mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Public: the browser needs these to show the login screen (both are safe to expose).
app.get('/api/config', (req, res) => {
  res.json({ supabaseUrl: SUPABASE_URL, supabaseKey: SUPABASE_KEY });
});

const dbClient = headers => createClient(SUPABASE_URL, SUPABASE_KEY, {
  global: { headers }, auth: { persistSession: false, autoRefreshToken: false }
});

// Public: uptime monitors (e.g. UptimeRobot) poll this. 200 = healthy, 503 = database down or many recent errors.
app.get('/api/health', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  try {
    const { data, error } = await dbClient({}).rpc('health_check');
    if (error) throw error;
    res.status(data?.ok ? 200 : 503).json({ status: data?.ok ? 'ok' : 'degraded' });
  } catch {
    res.status(503).json({ status: 'down' });
  }
});

// Public but secret-protected: the school's Google Drive backup script calls this daily
// with the long token the owner created in Settings. Tokens are stored hashed in the database.
app.get('/api/backup/auto', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const token = String(req.headers['x-backup-token'] || '');
  if (!/^[0-9a-f]{64}$/.test(token)) return res.status(401).json({ error: 'invalid token' });
  const { data, error } = await dbClient({}).rpc('backup_export', { p_token: token });
  if (error) return res.status(error.code === '42501' ? 401 : 500).json({ error: error.code === '42501' ? 'invalid token' : 'backup failed' });
  res.json({ school_date: today(), tables: data });
});

// Everything else under /api requires a logged-in user.
app.use('/api', (req, res, next) => {
  const auth = req.headers.authorization || '';
  if (!auth.startsWith('Bearer ')) return res.status(401).json({ error: 'Not logged in' });
  req.db = dbClient({ Authorization: auth });
  next();
});

// ─── Roles ───────────────────────────────────────────────────────────────────
// owner = principal/owner (everything), accountant = money, secretary = students & academics.
// The database enforces the same rules (Row Level Security); this layer gives clear messages.
const ALL = ['owner', 'accountant', 'secretary'];
const RULES = [
  // [method regex, path regex, roles]  — first match wins; anything unmatched is owner-only.
  [/GET/, /^\/me$/, null],                    // null = any signed-in user, even before joining
  [/POST/, /^\/staff\/redeem$/, null],
  [/POST/, /^\/events$/, null],
  [/.*/, /^\/terms\//, ALL],
  [/GET/, /^\/settings$/, ALL],
  [/GET/, /^\/dashboard$/, ALL],
  [/GET/, /^\/students(\/[^/]+)?$/, ALL],
  [/POST|PUT/, /^\/students(\/import|\/[^/]+)?$/, ['owner', 'secretary']],
  [/GET|POST/, /^\/payments$/, ['owner', 'accountant']],
  [/GET/, /^\/finance\//, ['owner', 'accountant']],
  [/.*/, /^\/(grades|subjects|attendance)(\/|$)/, ['owner', 'secretary']],
];
async function getRole(req) {
  if (req.role === undefined) req.role = ok(await req.db.rpc('my_role')) || null;
  return req.role;
}
app.use('/api', h(async (req, res, next) => {
  const rule = RULES.find(([m, p]) => m.test(req.method) && p.test(req.path));
  const allowed = rule ? rule[2] : ['owner'];
  if (allowed === null) return next();
  const role = await getRole(req);
  if (!role) return res.status(403).json({ error: 'حسابك غير مرتبط بالمدرسة بعد', code: 'NO_ROLE' });
  if (!allowed.includes(role)) return res.status(403).json({ error: 'ليس لديك صلاحية لهذا الإجراء', code: 'FORBIDDEN' });
  next();
}));

// ─── Helpers ─────────────────────────────────────────────────────────────────
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
// School's local date (Jordan), not UTC — otherwise 12–3 AM counts as yesterday.
const TIMEZONE = 'Asia/Amman';
const today = () => new Date().toLocaleDateString('en-CA', { timeZone: TIMEZONE });
const monthRange = m => { // 'YYYY-MM' -> ['YYYY-MM-01', first day of next month]
  const [y, mo] = m.split('-').map(Number);
  const next = mo === 12 ? `${y + 1}-01` : `${y}-${String(mo + 1).padStart(2, '0')}`;
  return [`${m}-01`, `${next}-01`];
};
const clean = s => String(s).replace(/[,()%*\\]/g, ' ').trim(); // safe inside PostgREST filters

// Input validation (messages are shown to the user in Arabic).
class ValidationError extends Error {}
function safeNum(value, label, { min = -Infinity, max = Infinity, required = false } = {}) {
  if (value === undefined || value === null || value === '') {
    if (required) throw new ValidationError(`${label} مطلوب`);
    return null;
  }
  const n = Number(value);
  if (!Number.isFinite(n)) throw new ValidationError(`${label} يجب أن يكون رقماً (القيمة: "${value}")`);
  if (n < min) throw new ValidationError(`${label} يجب ألا يقل عن ${min}`);
  if (n > max) throw new ValidationError(`${label} يجب ألا يزيد عن ${max}`);
  return n;
}
function safeStr(value, label, { required = false, maxLen = 500 } = {}) {
  const s = (value ?? '').toString().trim();
  if (required && !s) throw new ValidationError(`${label} مطلوب`);
  if (s.length > maxLen) throw new ValidationError(`${label} أطول من ${maxLen} حرفاً`);
  return s;
}
function safeDate(value, label, { required = false } = {}) {
  if (!value) {
    if (required) throw new ValidationError(`${label} مطلوب`);
    return null;
  }
  const s = String(value).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || isNaN(new Date(s).getTime())) {
    throw new ValidationError(`${label} يجب أن يكون بصيغة YYYY-MM-DD (القيمة: "${s}")`);
  }
  return s;
}

const STUDENT_STATUSES = new Set(['active', 'transferred', 'dropped', 'graduated']);
const ATTENDANCE_STATUSES = new Set(['present', 'absent', 'late', 'excused']);
// Accept Arabic labels too (from spreadsheets).
const STATUS_ALIASES = { 'منتظم': 'active', 'منظم': 'active', 'منتقل': 'transferred', 'منقطع': 'dropped', 'خريج': 'graduated' };
const ATTENDANCE_ALIASES = { 'حاضر': 'present', 'غائب': 'absent', 'متأخر': 'late', 'غياب بعذر': 'excused', 'بعذر': 'excused' };
function studentStatus(v, fallback = 'active') {
  const s = safeStr(v, 'الحالة', { maxLen: 30 }).toLowerCase();
  const out = s ? (STATUS_ALIASES[s] || s) : fallback;
  if (!STUDENT_STATUSES.has(out)) throw new ValidationError(`حالة غير صحيحة: "${v}"`);
  return out;
}
function attendanceStatus(v) {
  const s = safeStr(v, 'الحضور', { maxLen: 30 }).toLowerCase();
  const out = s ? (ATTENDANCE_ALIASES[s] || s) : 'present';
  if (!ATTENDANCE_STATUSES.has(out)) throw new ValidationError(`حالة حضور غير صحيحة: "${v}"`);
  return out;
}
// Accept dates as YYYY-MM-DD or M/D/YYYY (Excel exports).
function flexDate(v, label, opts) {
  const s = (v ?? '').toString().trim();
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  return safeDate(m ? `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}` : s, label, opts);
}
// First non-empty value among several possible CSV column names.
const pick = (row, ...keys) => { for (const k of keys) if (row[k] !== undefined && String(row[k]).trim() !== '') return row[k]; return ''; };

function getLetterGrade(score) {
  const n = Number(score);
  if (!Number.isFinite(n)) return 'F';
  if (n >= 90) return 'A+';
  if (n >= 80) return 'A';
  if (n >= 70) return 'B';
  if (n >= 60) return 'C';
  if (n >= 50) return 'D';
  return 'F';
}

// Shared shape for bulk imports: validate every row first, report bad rows by line number.
function readImportRows(body) {
  const rows = Array.isArray(body?.rows) ? body.rows : null;
  if (!rows) throw new ValidationError('الملف لا يحتوي على صفوف');
  if (!rows.length) throw new ValidationError('الملف فارغ');
  if (rows.length > 5000) throw new ValidationError('عدد الصفوف كبير جداً (الحد الأقصى 5000)');
  return rows;
}
async function studentMap(db, ids) {
  const uniq = [...new Set(ids.map(x => String(x ?? '').trim()).filter(Boolean))];
  const map = new Map();
  for (let i = 0; i < uniq.length; i += 300) {
    const rows = ok(await db.from('students').select('student_id, grade').in('student_id', uniq.slice(i, i + 300)));
    rows.forEach(r => map.set(r.student_id, r));
  }
  return map;
}

// ─── ACCOUNT & STAFF ─────────────────────────────────────────
app.get('/api/me', h(async (req, res) => {
  let email = null;
  try { email = JSON.parse(Buffer.from(req.headers.authorization.slice(7).split('.')[1], 'base64url').toString()).email ?? null; } catch {}
  res.json({ email, role: await getRole(req) });
}));

// A new staff member enters the 8-digit PIN the owner gave them.
app.post('/api/staff/redeem', h(async (req, res) => {
  const pin = String(req.body?.pin ?? '').replace(/\s/g, '');
  if (!/^\d{8}$/.test(pin)) throw new ValidationError('الرمز يتكون من 8 أرقام');
  const role = ok(await req.db.rpc('redeem_invite', { p_pin: pin }));
  if (!role) return res.status(400).json({ error: 'الرمز غير صحيح أو منتهي الصلاحية' });
  res.json({ success: true, role });
}));

app.get('/api/staff', h(async (req, res) => {
  const [staff, invites] = await Promise.all([
    req.db.rpc('staff_list').then(ok),
    req.db.from('staff_invites').select('id, role, note, created_by, created_at, expires_at')
      .is('used_at', null).eq('revoked', false).gt('expires_at', new Date().toISOString()).order('created_at', { ascending: false }).then(ok)
  ]);
  res.json({ staff, invites });
}));

const STAFF_ROLES = new Set(['owner', 'accountant', 'secretary']);
app.post('/api/staff/invites', h(async (req, res) => {
  const role = String(req.body?.role ?? '');
  if (!STAFF_ROLES.has(role)) throw new ValidationError('اختر الدور');
  const note = safeStr(req.body?.note, 'اسم الموظف', { maxLen: 100 }) || null;
  res.json(ok(await req.db.rpc('create_invite', { p_role: role, p_note: note })));
}));

app.delete('/api/staff/invites/:id', h(async (req, res) => {
  ok(await req.db.rpc('revoke_invite', { p_id: safeNum(req.params.id, 'الرقم', { required: true, min: 1 }) }));
  res.json({ success: true });
}));

app.put('/api/staff/:email', h(async (req, res) => {
  const role = String(req.body?.role ?? '');
  if (!STAFF_ROLES.has(role)) throw new ValidationError('اختر الدور');
  ok(await req.db.rpc('set_staff', { p_email: req.params.email, p_role: role, p_active: req.body?.active !== false }));
  res.json({ success: true });
}));

app.post('/api/staff/:email/reset-2fa', h(async (req, res) => {
  ok(await req.db.rpc('reset_staff_mfa', { p_email: req.params.email }));
  res.json({ success: true });
}));

// ─── ACTIVITY LOG ────────────────────────────────────────────
const EVENT_ACTIONS = new Set(['login', 'logout', 'view_student', 'print_report', 'mfa_enrolled']);
app.post('/api/events', h(async (req, res) => {
  const action = String(req.body?.action ?? '');
  if (!EVENT_ACTIONS.has(action)) throw new ValidationError('حدث غير معروف');
  const sid = safeStr(req.body?.student_id, 'الطالب', { maxLen: 50 }) || null;
  const detail = req.body?.detail && typeof req.body.detail === 'object' && !Array.isArray(req.body.detail) ? req.body.detail : null;
  ok(await req.db.rpc('log_event', { p_action: action, p_student_id: sid, p_detail: detail }));
  res.json({ success: true });
}));

app.get('/api/audit', h(async (req, res) => {
  const limit = safeNum(req.query.limit, 'الحد', { min: 1, max: 500 }) ?? 100;
  const offset = safeNum(req.query.offset, 'البداية', { min: 0 }) ?? 0;
  let q = req.db.from('audit_log').select('id, at, user_email, role, action, table_name, row_key, student_id, old_data, new_data', { count: 'exact' });
  const from = safeDate(req.query.from, 'من تاريخ'), to = safeDate(req.query.to, 'إلى تاريخ');
  if (from) q = q.gte('at', `${from}T00:00:00+03:00`);
  if (to) q = q.lt('at', new Date(new Date(`${to}T00:00:00+03:00`).getTime() + 86400000).toISOString());
  if (req.query.user) q = q.eq('user_email', safeStr(req.query.user, 'المستخدم', { maxLen: 200 }));
  if (req.query.student_id) q = q.eq('student_id', safeStr(req.query.student_id, 'الطالب', { maxLen: 50 }));
  if (req.query.table) q = q.eq('table_name', safeStr(req.query.table, 'الجدول', { maxLen: 50 }));
  const { data, error, count } = await q.order('at', { ascending: false }).order('id', { ascending: false }).range(offset, offset + limit - 1);
  if (error) throw error;
  res.json({ rows: data, total: count });
}));

app.get('/api/errors', h(async (req, res) => {
  res.json(ok(await req.db.from('error_log').select('*').order('at', { ascending: false }).limit(100)));
}));

// ─── AUTOMATIC BACKUP TOKEN (for the Google Drive script) ────
app.get('/api/backup/token', h(async (req, res) => {
  const rows = ok(await req.db.from('backup_tokens').select('created_at, created_by, last_used_at').eq('revoked', false).limit(1));
  res.json({ active: rows.length > 0, ...(rows[0] || {}) });
}));
app.post('/api/backup/token', h(async (req, res) => {
  res.json({ token: ok(await req.db.rpc('create_backup_token')) });
}));
app.delete('/api/backup/token', h(async (req, res) => {
  ok(await req.db.rpc('revoke_backup_tokens'));
  res.json({ success: true });
}));

// ─── SETTINGS ───────────────────────────────────────────────
app.get('/api/settings', h(async (req, res) => {
  const rows = ok(await req.db.from('settings').select('key, value'));
  res.json(Object.fromEntries(rows.map(r => [r.key, r.value])));
}));

app.post('/api/settings', h(async (req, res) => {
  if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) throw new ValidationError('بيانات غير صالحة');
  const rows = Object.entries(req.body).map(([key, value]) => ({
    key: safeStr(key, 'المفتاح', { required: true, maxLen: 100 }),
    value: value == null ? null : String(value)
  }));
  if (rows.length) ok(await req.db.from('settings').upsert(rows));
  res.json({ success: true });
}));

// ─── STUDENTS ────────────────────────────────────────────────
function studentFields(body, { partial = false } = {}) {
  const out = {};
  const has = f => body[f] !== undefined;
  if (!partial || has('full_name')) out.full_name = safeStr(body.full_name, 'اسم الطالب', { required: true, maxLen: 200 });
  if (!partial || has('grade')) out.grade = safeStr(body.grade, 'الصف', { required: true, maxLen: 100 });
  if (!partial || has('section')) out.section = safeStr(body.section, 'الشعبة', { maxLen: 10 }) || 'A';
  if (!partial || has('parent_name')) out.parent_name = safeStr(body.parent_name, 'اسم ولي الأمر', { maxLen: 200 });
  if (!partial || has('parent_phone')) out.parent_phone = safeStr(body.parent_phone, 'الهاتف', { maxLen: 30 });
  if (!partial || has('parent_email')) out.parent_email = safeStr(body.parent_email, 'البريد الإلكتروني', { maxLen: 200 });
  if (!partial || has('address')) out.address = safeStr(body.address, 'العنوان', { maxLen: 300 });
  if (!partial || has('date_of_birth')) out.date_of_birth = safeDate(body.date_of_birth, 'تاريخ الميلاد') ?? '';
  if (!partial || has('gender')) out.gender = body.gender === 'female' ? 'female' : 'male';
  if (!partial || has('total_yearly_tuition')) out.total_yearly_tuition = safeNum(body.total_yearly_tuition, 'القسط السنوي', { min: 0, max: 1000000 }) ?? 500;
  if (!partial || has('notes')) out.notes = safeStr(body.notes, 'الملاحظات', { maxLen: 1000 });
  // Guardian consent (PDPL Art. 5 — minors need a parent/guardian's documented consent)
  if (!partial || has('guardian_consent_at')) out.guardian_consent_at = safeDate(body.guardian_consent_at, 'تاريخ موافقة ولي الأمر');
  if (!partial || has('guardian_consent_by')) out.guardian_consent_by = safeStr(body.guardian_consent_by, 'اسم ولي الأمر الموافق', { maxLen: 200 }) || null;
  if (out.guardian_consent_at && !out.guardian_consent_by && !partial) throw new ValidationError('يرجى إدخال اسم ولي الأمر الذي وقّع الموافقة');
  if (has('status')) out.status = studentStatus(body.status);
  return out;
}

app.get('/api/students', h(async (req, res) => {
  const { grade, status, search } = req.query;
  if (status && !STUDENT_STATUSES.has(status)) throw new ValidationError(`حالة غير صحيحة: "${status}"`);
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
  if (!student) return res.status(404).json({ error: 'الطالب غير موجود' });
  res.json(student);
}));

app.post('/api/students', h(async (req, res) => {
  const fields = studentFields(req.body);
  // student_id comes from a Postgres sequence, so two people adding at once never collide.
  const row = ok(await req.db.from('students').insert(fields).select('student_id').single());
  res.json({ success: true, student_id: row.student_id });
}));

app.put('/api/students/:id', h(async (req, res) => {
  const updates = studentFields(req.body, { partial: true });
  if (!Object.keys(updates).length) throw new ValidationError('لا يوجد ما يتم تحديثه');
  ok(await req.db.from('students').update(updates).eq('student_id', req.params.id));
  res.json({ success: true });
}));

app.delete('/api/students/:id', h(async (req, res) => {
  const gone = ok(await req.db.from('students').delete().eq('student_id', req.params.id).select('id'));
  if (!gone.length) return res.status(404).json({ error: 'الطالب غير موجود' });
  res.json({ success: true });
}));

// Bulk import from CSV (students_template.csv, or the school's own export).
app.post('/api/students/import', h(async (req, res) => {
  const rows = readImportRows(req.body);
  const errors = [], valid = [];
  rows.forEach((row, i) => {
    try {
      const sid = safeStr(pick(row, 'student_id', 'رقم_الطالب'), 'رقم الطالب', { maxLen: 50 });
      if (sid && !/^\d+$/.test(sid)) throw new ValidationError(`رقم الطالب يجب أن يكون أرقاماً فقط (القيمة: "${sid}")`);
      const rec = {
        full_name: safeStr(pick(row, 'student_name', 'full_name', 'الاسم', 'اسم_الطالب'), 'اسم الطالب', { required: true, maxLen: 200 }),
        grade: safeStr(pick(row, 'grade_level', 'grade', 'الصف'), 'الصف', { required: true, maxLen: 100 }),
        section: safeStr(pick(row, 'section', 'الشعبة'), 'الشعبة', { maxLen: 10 }) || 'A',
        parent_name: safeStr(pick(row, 'parent_name', 'ولي_الأمر'), 'اسم ولي الأمر', { maxLen: 200 }),
        parent_phone: safeStr(pick(row, 'parent_phone', 'الهاتف'), 'الهاتف', { maxLen: 30 }),
        total_yearly_tuition: safeNum(pick(row, 'total_tuition', 'total_yearly_tuition', 'القسط'), 'القسط السنوي', { min: 0, max: 1000000 }) ?? 500,
        status: studentStatus(pick(row, 'status', 'الحالة'))
      };
      const year = safeStr(pick(row, 'academic_year', 'العام_الدراسي'), 'العام الدراسي', { maxLen: 20 }).replace(/\.$/, '');
      if (year) rec.academic_year = year;
      if (sid) rec.student_id = sid;
      valid.push({ line: i + 2, rec });
    } catch (e) {
      if (!(e instanceof ValidationError)) throw e;
      errors.push({ row: i + 2, reason: e.message });
    }
  });

  // Reject numbers that already exist or repeat inside the file.
  const existing = await studentMap(req.db, valid.map(v => v.rec.student_id));
  const seen = new Set();
  const toInsert = [];
  for (const v of valid) {
    const sid = v.rec.student_id;
    if (sid && (existing.has(sid) || seen.has(sid))) { errors.push({ row: v.line, reason: `رقم الطالب ${sid} موجود مسبقاً` }); continue; }
    if (sid) seen.add(sid);
    toInsert.push(v.rec);
  }
  // Rows with and without explicit numbers go in separate batches (same columns per batch).
  const withId = toInsert.filter(r => r.student_id), withoutId = toInsert.filter(r => !r.student_id);
  if (withId.length) {
    ok(await req.db.from('students').insert(withId));
    ok(await req.db.rpc('sync_student_number_seq'));
  }
  if (withoutId.length) ok(await req.db.from('students').insert(withoutId));
  errors.sort((a, b) => a.row - b.row);
  res.json({ success: true, imported: toInsert.length, skipped: errors.length, errors });
}));

// Parent's right of access / portability: everything we hold about one student, as a file.
app.get('/api/students/:id/export', h(async (req, res) => {
  const id = req.params.id;
  const student = ok(await req.db.from('students').select('*').eq('student_id', id).maybeSingle());
  if (!student) return res.status(404).json({ error: 'الطالب غير موجود' });
  const [payments, grades, attendance] = await Promise.all([
    fetchAll(() => req.db.from('payments').select('*').eq('student_id', id).order('id')),
    fetchAll(() => req.db.from('grades').select('*, subjects(name)').eq('student_id', id).order('id')),
    fetchAll(() => req.db.from('attendance').select('*').eq('student_id', id).order('id'))
  ]);
  ok(await req.db.from('data_requests').insert({
    request_type: 'export', student_id: id,
    requested_by: safeStr(req.query.requested_by, 'مقدّم الطلب', { maxLen: 200 }) || null
  }));
  ok(await req.db.rpc('log_event', { p_action: 'export_student', p_student_id: id, p_detail: null }));
  res.setHeader('Content-Disposition', `attachment; filename="student-${id}-data-${today()}.json"`);
  res.json({ exported_at: new Date().toISOString(), student, payments, grades, attendance });
}));

// Parent's right to erasure: permanently deletes the student and all linked records (logged).
app.post('/api/students/:id/erase', h(async (req, res) => {
  const id = req.params.id;
  if (String(req.body.confirm ?? '').trim() !== id) throw new ValidationError('للتأكيد اكتب رقم الطالب كما هو');
  const requested_by = safeStr(req.body.requested_by, 'اسم مقدّم الطلب', { required: true, maxLen: 200 });
  const note = safeStr(req.body.note, 'الملاحظات', { maxLen: 500 });
  const removed = ok(await req.db.rpc('erase_student', { p_student_id: id, p_requested_by: requested_by, p_note: note }));
  res.json({ success: true, removed });
}));

// ─── TERMS ACCEPTANCE (staff) ────────────────────────────────
app.get('/api/terms/status', h(async (req, res) => {
  const version = safeStr(req.query.version, 'الإصدار', { required: true, maxLen: 50 });
  const rows = ok(await req.db.from('terms_acceptances').select('accepted_at').eq('version', version).limit(1));
  res.json({ accepted: rows.length > 0, accepted_at: rows[0]?.accepted_at ?? null });
}));

app.post('/api/terms/accept', h(async (req, res) => {
  const version = safeStr(req.body.version, 'الإصدار', { required: true, maxLen: 50 });
  if (req.body.agreed !== true) throw new ValidationError('يجب الموافقة على الشروط وسياسة الخصوصية للمتابعة');
  ok(await req.db.from('terms_acceptances').upsert({ version }, { onConflict: 'user_email,version', ignoreDuplicates: true }));
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
  const student_id = safeStr(req.body.student_id, 'الطالب', { required: true, maxLen: 50 });
  const amount = safeNum(req.body.amount, 'المبلغ', { required: true, min: 0.01, max: 1000000 });
  const txId = 'TXN-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6).toUpperCase();
  ok(await req.db.from('payments').insert({
    transaction_id: txId, student_id, amount,
    payment_method: safeStr(req.body.payment_method, 'طريقة الدفع', { maxLen: 50 }) || 'cash',
    collected_by: safeStr(req.body.collected_by, 'المستلم', { maxLen: 200 }),
    date_paid: safeDate(req.body.date_paid, 'تاريخ الدفع') ?? today(),
    notes: safeStr(req.body.notes, 'الملاحظات', { maxLen: 1000 })
  }));
  res.json({ success: true, transaction_id: txId });
}));

app.delete('/api/payments/:id', h(async (req, res) => {
  const id = safeNum(req.params.id, 'رقم العملية', { required: true, min: 1 });
  const gone = ok(await req.db.from('payments').delete().eq('id', id).select('id'));
  if (!gone.length) return res.status(404).json({ error: 'الدفعة غير موجودة' });
  res.json({ success: true });
}));

// ─── FINANCE ─────────────────────────────────────────────────
app.get('/api/finance/summary/:student_id', h(async (req, res) => {
  const id = req.params.student_id;
  const [student, payments] = await Promise.all([
    req.db.from('students').select('*').eq('student_id', id).maybeSingle().then(ok),
    fetchAll(() => req.db.from('payments').select('*').eq('student_id', id).order('date_paid', { ascending: false }))
  ]);
  if (!student) return res.status(404).json({ error: 'الطالب غير موجود' });
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

function gradeFields(body) {
  const score = safeNum(body.score, 'الدرجة', { min: 0, max: 200 });
  return {
    semester: safeStr(body.semester, 'الفصل الدراسي', { required: true, maxLen: 50 }),
    score,
    max_score: safeNum(body.max_score, 'الدرجة القصوى', { min: 1, max: 200 }) ?? 100,
    grade_letter: safeStr(body.grade_letter, 'التقدير', { maxLen: 5 }) || getLetterGrade(score ?? 0),
    teacher_notes: safeStr(body.teacher_notes, 'ملاحظات المعلم', { maxLen: 1000 }),
    academic_year: safeStr(body.academic_year, 'العام الدراسي', { maxLen: 20 }).replace(/\.$/, '') || '2025/2026'
  };
}

app.post('/api/grades', h(async (req, res) => {
  const rec = {
    student_id: safeStr(req.body.student_id, 'الطالب', { required: true, maxLen: 50 }),
    subject_id: safeNum(req.body.subject_id, 'المادة', { required: true, min: 1 }),
    ...gradeFields(req.body)
  };
  ok(await req.db.from('grades').upsert(rec, { onConflict: 'student_id,subject_id,semester,academic_year' }));
  res.json({ success: true });
}));

// Bulk import: student_id, subject_name, semester, score, max_score, academic_year, teacher_notes
app.post('/api/grades/import', h(async (req, res) => {
  const rows = readImportRows(req.body);
  const students = await studentMap(req.db, rows.map(r => pick(r, 'student_id', 'رقم_الطالب')));
  const subjects = await fetchAll(() => req.db.from('subjects').select('id, name, grade').order('id'));
  const subjectId = new Map(subjects.map(s => [`${s.grade}|${s.name}`, s.id]));
  const errors = [], byKey = new Map();
  rows.forEach((row, i) => {
    try {
      const sid = safeStr(pick(row, 'student_id', 'رقم_الطالب'), 'رقم الطالب', { required: true, maxLen: 50 });
      const st = students.get(sid);
      if (!st) throw new ValidationError(`الطالب ${sid} غير موجود`);
      const name = safeStr(pick(row, 'subject_name', 'subject', 'المادة'), 'المادة', { required: true, maxLen: 100 });
      const subj = subjectId.get(`${st.grade}|${name}`);
      if (!subj) throw new ValidationError(`المادة "${name}" غير موجودة للصف "${st.grade}"`);
      const rec = { student_id: sid, subject_id: subj, ...gradeFields({
        semester: pick(row, 'semester', 'الفصل'), score: pick(row, 'score', 'الدرجة'), max_score: pick(row, 'max_score'),
        grade_letter: pick(row, 'grade_letter'), teacher_notes: pick(row, 'teacher_notes', 'ملاحظات'),
        academic_year: pick(row, 'academic_year', 'العام_الدراسي')
      }) };
      byKey.set(`${rec.student_id}|${rec.subject_id}|${rec.semester}|${rec.academic_year}`, rec); // last row wins
    } catch (e) {
      if (!(e instanceof ValidationError)) throw e;
      errors.push({ row: i + 2, reason: e.message });
    }
  });
  const recs = [...byKey.values()];
  for (let i = 0; i < recs.length; i += 1000) {
    ok(await req.db.from('grades').upsert(recs.slice(i, i + 1000), { onConflict: 'student_id,subject_id,semester,academic_year' }));
  }
  res.json({ success: true, imported: rows.length - errors.length, skipped: errors.length, errors });
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
  const date = safeDate(req.query.date, 'التاريخ') || today();
  res.json(await fetchAll(() => req.db.from('attendance').select('*').eq('date', date).order('id')));
}));

app.get('/api/attendance/:student_id', h(async (req, res) => {
  let q = req.db.from('attendance').select('*').eq('student_id', req.params.student_id);
  if (req.query.month) {
    if (!/^\d{4}-\d{2}$/.test(req.query.month)) throw new ValidationError('الشهر يجب أن يكون بصيغة YYYY-MM');
    const [a, b] = monthRange(req.query.month); q = q.gte('date', a).lt('date', b);
  }
  res.json(ok(await q.order('date', { ascending: false })));
}));

function attendanceRecord(r) {
  return {
    student_id: safeStr(r.student_id, 'الطالب', { required: true, maxLen: 50 }),
    date: flexDate(r.date, 'التاريخ', { required: true }),
    status: attendanceStatus(r.status),
    notes: safeStr(r.notes, 'الملاحظات', { maxLen: 500 })
  };
}

// Accepts one record or an array (saving a whole class in one request).
app.post('/api/attendance', h(async (req, res) => {
  const list = (Array.isArray(req.body) ? req.body : [req.body]).map(attendanceRecord);
  if (list.length) ok(await req.db.from('attendance').upsert(list, { onConflict: 'student_id,date' }));
  res.json({ success: true });
}));

// Bulk import: student_id, date, status, notes
app.post('/api/attendance/import', h(async (req, res) => {
  const rows = readImportRows(req.body);
  const students = await studentMap(req.db, rows.map(r => pick(r, 'student_id', 'رقم_الطالب')));
  const errors = [], byKey = new Map();
  rows.forEach((row, i) => {
    try {
      const rec = attendanceRecord({
        student_id: pick(row, 'student_id', 'رقم_الطالب'), date: pick(row, 'date', 'التاريخ'),
        status: pick(row, 'status', 'الحالة'), notes: pick(row, 'notes', 'ملاحظات')
      });
      if (!students.has(rec.student_id)) throw new ValidationError(`الطالب ${rec.student_id} غير موجود`);
      byKey.set(`${rec.student_id}|${rec.date}`, rec);
    } catch (e) {
      if (!(e instanceof ValidationError)) throw e;
      errors.push({ row: i + 2, reason: e.message });
    }
  });
  const recs = [...byKey.values()];
  for (let i = 0; i < recs.length; i += 1000) {
    ok(await req.db.from('attendance').upsert(recs.slice(i, i + 1000), { onConflict: 'student_id,date' }));
  }
  res.json({ success: true, imported: rows.length - errors.length, skipped: errors.length, errors });
}));

// ─── DASHBOARD ───────────────────────────────────────────────
app.get('/api/dashboard', h(async (req, res) => {
  res.json(ok(await req.db.rpc('dashboard_stats')));
}));

// ─── BACKUP ──────────────────────────────────────────────────
// Full export of every table as one JSON file (Settings → download backup).
app.get('/api/backup', h(async (req, res) => {
  const tables = ['students', 'payments', 'subjects', 'grades', 'attendance', 'academic_plan', 'settings', 'data_requests', 'terms_acceptances'];
  const data = {};
  for (const t of tables) data[t] = await fetchAll(() => req.db.from(t).select('*').order(t === 'settings' ? 'key' : 'id'));
  const stamp = today();
  ok(await req.db.rpc('log_event', { p_action: 'backup_download', p_student_id: null, p_detail: null }));
  res.setHeader('Content-Disposition', `attachment; filename="school-backup-${stamp}.json"`);
  res.json({ exported_at: new Date().toISOString(), school_date: stamp, tables: data });
}));

// Unknown API routes
app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

// Errors → clear status codes and Arabic messages.
app.use(async (err, req, res, next) => {
  if (err instanceof ValidationError) return res.status(400).json({ error: err.message });
  if (err?.type === 'entity.parse.failed') return res.status(400).json({ error: 'بيانات غير صالحة' });
  const msg = err?.message || String(err);
  const code = String(err?.code || '');
  if (/jwt|JWS|token/i.test(msg) || code.startsWith('PGRST3')) return res.status(401).json({ error: 'Session expired' });
  if (code === '23503') {
    const inUse = /still referenced/i.test(`${msg} ${err?.details || ''}`);
    return res.status(409).json({ error: inUse
      ? 'لا يمكن الحذف: هذا الطالب لديه مدفوعات أو درجات أو حضور مسجّل. غيّر حالته إلى منتقل أو منقطع بدلاً من الحذف.'
      : 'الطالب أو المادة غير موجود' });
  }
  if (code === 'P0002') return res.status(404).json({ error: 'الطالب غير موجود' });
  if (code === '23505') return res.status(409).json({ error: /already a staff/.test(msg) ? 'حسابك مرتبط بالمدرسة مسبقاً' : 'السجل موجود مسبقاً' });
  if (code === '23514' || code === '22P02') return res.status(400).json({ error: 'قيمة غير صالحة: ' + msg });
  if (code === '42501') return res.status(403).json({ error: 'ليس لديك صلاحية لهذا الإجراء', code: 'FORBIDDEN' });
  if (code === '22023' && /own account/.test(msg)) return res.status(400).json({ error: 'لا يمكنك تغيير حسابك أنت. اطلب ذلك من مالك آخر.' });
  if (code === 'P0001' && /too many attempts/.test(msg)) return res.status(429).json({ error: 'محاولات خاطئة كثيرة. انتظر 15 دقيقة ثم حاول مجدداً.' });
  console.error(err);
  // Record the failure for the owner's System page (no personal data: route + short message only).
  if (req.db) {
    const log = req.db.rpc('log_error', { p_method: req.method, p_route: req.path, p_status: 500, p_code: code || null, p_message: msg }).then(() => {}, () => {});
    await Promise.race([log, new Promise(r => setTimeout(r, 1500))]);
  }
  res.status(500).json({ error: 'حدث خطأ في الخادم. تم تسجيله وسنراجعه.' });
});

module.exports = app;
