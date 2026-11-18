// `sb` (the Supabase client) comes from supabase-client.js. Staff are real Supabase Auth
// users with a staff_profiles row; every staff_* RPC checks is_staff() server-side.

/* -------------------- helpers -------------------- */
const MANILA_TZ = 'Asia/Manila';
const $ = (id) => document.getElementById(id);

function escapeHtml(str){
  if (str === null || str === undefined) return '';
  const div = document.createElement('div');
  div.textContent = String(str);
  return div.innerHTML;
}
function alertBox(id, html, type){ $(id).innerHTML = `<div class="alert alert-${type}">${html}</div>`; }
function clearAlert(id){ $(id).innerHTML = ''; }

const ERROR_TEXT = {
  not_staff: 'This account does not have staff access.',
  settings_not_found: 'Save this school’s settings before generating slots.',
  request_not_pending: 'That request was already handled. The list has been refreshed.',
  booking_not_active: 'That booking is no longer active. The list has been refreshed.',
  capacity_below_booked: 'Capacity can’t be lower than the number of students already booked in that slot.',
  slot_not_found: 'That slot no longer exists.',
  school_has_bookings: 'Students are still booked for this school (pictorial or Hair & Makeup). Move or cancel them first, then delete.',
  slot_has_bookings: 'Someone is booked in that slot. Move or cancel them first, then delete it.',
  slot_has_history: 'That slot has past booking records, so it can’t be deleted. Close it instead.',
  invalid_status: 'Invalid booking status.',
  slot_full: 'The chosen slot is already full.',
  slot_unavailable: 'The chosen slot is closed or already in the past.',
  wrong_school: 'The chosen slot belongs to a different school.',
  same_slot: 'The student is already booked in that slot.',
  no_target_slot: 'Pick a slot to move the student to.',
  hmu_settings_not_found: 'Save this school’s Hair & Makeup settings first.',
  hmu_hours_not_set: 'Set the HMU opening and closing hours and save before generating HMU slots.',
  hmu_dates_not_set: 'Set the HMU start and end dates and save before generating HMU slots.',
  set_hours_and_staff_first: 'Set the HMU hours and staff count before setting a daily maximum.',
  invalid_max: 'Max students per day must be 1 or more (leave it empty for no limit).',
  invalid_count: 'HMU staff must be 0 or more.',
};
function errText(error, fallback){
  const m = (error && error.message) || '';
  if (m.startsWith('max_exceeds_capacity:')) return `Max students per day can’t be more than ${m.split(':')[1]} (HMU staff × hourly slots per day).`;
  return ERROR_TEXT[m] || m || fallback || 'Something went wrong. Please try again.';
}
// The list on screen is out of date when a delete fails with one of these: reload it.
const STALE_SLOT_ERRORS = ['slot_not_found', 'slot_has_bookings'];
function showErr(alertId, error, fallback){
  if (error && error.message === 'not_staff') { forceSignOut(ERROR_TEXT.not_staff); return; }
  alertBox(alertId, escapeHtml(errText(error, fallback)), 'error');
}

function fmtDate(iso, opts){
  return new Date(iso).toLocaleDateString('en-US', Object.assign({ timeZone: MANILA_TZ, month: 'short', day: 'numeric', year: 'numeric' }, opts || {}));
}
function fmtTime(iso){
  return new Date(iso).toLocaleTimeString('en-US', { timeZone: MANILA_TZ, hour: 'numeric', minute: '2-digit' });
}
function fmtRange(start, end){ return fmtTime(start) + (end ? ' – ' + fmtTime(end) : ''); }
function fmtWhen(iso){ return iso ? `${fmtDate(iso, { weekday: 'short' })}, ${fmtTime(iso)}` : '—'; }
function manilaDay(iso){ return new Date(iso).toLocaleDateString('en-CA', { timeZone: MANILA_TZ }); }
function todayManila(){ return manilaDay(new Date().toISOString()); }
// Manila has no DST, so a fixed +08:00 offset is exact.
function dayStartIso(day){ return `${day}T00:00:00+08:00`; }
function nextDay(day){
  const d = new Date(Date.UTC(Number(day.slice(0, 4)), Number(day.slice(5, 7)) - 1, Number(day.slice(8, 10)) + 1));
  return d.toISOString().slice(0, 10);
}
function hhmm(t){ return t ? String(t).slice(0, 5) : ''; }
function fmtClock(t){
  if (!t) return '';
  const [h, m] = t.split(':').map(Number);
  return `${(h % 12) || 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
}
const DOW = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const STATUS_LABEL = { booked: 'Booked', completed: 'Completed', no_show: 'No-show', cancelled: 'Cancelled', pending: 'Pending', approved: 'Approved', rejected: 'Rejected', needs_rebook: 'Needs rebook' };
function chip(status){ return `<span class="chip chip-${escapeHtml(status)}">${escapeHtml(STATUS_LABEL[status] || status)}</span>`; }
// '1 slot', '12 slots'
function plural(n, word){ n = n || 0; return `${n.toLocaleString()} ${word}${n === 1 ? '' : 's'}`; }
// School names are compared without case or outer spaces; the DB keeps one stored spelling.
function sameSchool(a, b){ return (a || '').trim().toLowerCase() === (b || '').trim().toLowerCase(); }

function setBusy(btn, busy, text){
  if (busy) { btn.dataset.idle = btn.textContent; btn.disabled = true; btn.innerHTML = `<span class="spinner"></span>${escapeHtml(text || 'Working…')}`; }
  else { btn.disabled = false; btn.textContent = btn.dataset.idle || btn.textContent; }
}

function downloadCsv(filename, header, rows){
  const cell = (v) => {
    let s = v === null || v === undefined ? '' : String(v);
    if (/^[=+\-@]/.test(s)) s = "'" + s; // keep spreadsheet apps from running it as a formula
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = [header, ...rows].map(r => r.map(cell).join(',')).join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }));
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// The API returns at most 1000 rows per request, so page with .range() until a short page.
async function fetchAll(makeQuery){
  const PAGE = 1000;
  let all = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await makeQuery().range(from, from + PAGE - 1);
    if (error) return { data: null, error };
    all = all.concat(data || []);
    if (!data || data.length < PAGE) return { data: all, error: null };
  }
}

// Each list bumps its counter per load; a response from an older load is dropped
// so a slow earlier request can't overwrite what the latest filters asked for.
const loadSeq = {};
function nextSeq(key){ return (loadSeq[key] = (loadSeq[key] || 0) + 1); }

/* -------------------- dialog -------------------- */
let dialogHandler = null;
function openDialog({ title, body, okText, danger, onOk }){
  $('dialogTitle').textContent = title;
  $('dialogBody').innerHTML = body || '';
  $('dialogOk').textContent = okText || 'OK';
  $('dialogOk').classList.toggle('btn-danger', !!danger);
  clearAlert('dialogAlert');
  dialogHandler = onOk;
  $('dialog').classList.remove('hidden');
  $('dialogTitle').focus();
}
function closeDialog(){ $('dialog').classList.add('hidden'); dialogHandler = null; }
$('dialogCancel').addEventListener('click', closeDialog);
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('dialog').classList.contains('hidden') && !$('dialogOk').disabled) closeDialog(); });
$('dialogOk').addEventListener('click', async () => {
  if (!dialogHandler) { closeDialog(); return; }
  clearAlert('dialogAlert');
  const btn = $('dialogOk');
  setBusy(btn, true);
  let ok = false;
  try { ok = await dialogHandler(); } finally { setBusy(btn, false); }
  if (ok !== false) closeDialog();
});

/* -------------------- auth -------------------- */
let currentStaff = null;

// Cloudflare Turnstile: with CAPTCHA on in Supabase, password sign-in needs this token.
const TURNSTILE_SITE_KEY = "0x4AAAAAAFxxrJZe7_l3TnIA";
let staffCaptcha;
window.onloadTurnstileCallback = function(){
  if (typeof turnstile !== 'undefined') staffCaptcha = turnstile.render('#turnstileStaff', { sitekey: TURNSTILE_SITE_KEY });
};

async function checkStaff(){
  const { data: { session } } = await sb.auth.getSession();
  if (!session) return null;
  const { data, error } = await sb.from('staff_profiles').select('full_name, role').eq('user_id', session.user.id).maybeSingle();
  if (error || !data) return null;
  return { ...data, email: session.user.email };
}

function showLogin(){
  $('dash').classList.add('hidden');
  $('loginShell').classList.remove('hidden');
}

async function forceSignOut(message){
  currentStaff = null;
  closeDialog();
  await sb.auth.signOut();
  showLogin();
  if (message) alertBox('loginAlert', escapeHtml(message), 'error');
}

$('loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  clearAlert('loginAlert');
  const btn = $('loginSubmit');
  const captchaToken = staffCaptcha !== undefined ? turnstile.getResponse(staffCaptcha) : undefined;
  if (staffCaptcha !== undefined && !captchaToken) { alertBox('loginAlert', 'Please complete the security verification below.', 'error'); return; }
  setBusy(btn, true, 'Signing in…');
  const { error } = await sb.auth.signInWithPassword({
    email: $('staffEmail').value.trim(), password: $('staffPassword').value,
    ...(captchaToken ? { options: { captchaToken } } : {}),
  });
  if (staffCaptcha !== undefined) turnstile.reset(staffCaptcha); // tokens are single-use
  if (error) { setBusy(btn, false); alertBox('loginAlert', /captcha/i.test(error.message) ? 'Security verification failed. Please try again.' : 'Invalid email or password.', 'error'); return; }
  const staff = await checkStaff();
  setBusy(btn, false);
  $('staffPassword').value = '';
  if (!staff) { await forceSignOut('This account does not have staff access. Contact your admin.'); return; }
  enterDashboard(staff);
});

$('signOutBtn').addEventListener('click', () => forceSignOut());

sb.auth.onAuthStateChange((event) => {
  if (event === 'SIGNED_OUT' && currentStaff) { currentStaff = null; showLogin(); }
});

/* -------------------- navigation -------------------- */
const PAGE_LOADERS = {};
function showPage(name){
  document.querySelectorAll('.nav-btn[data-page]').forEach(b => b.classList.toggle('active', b.dataset.page === name));
  document.querySelectorAll('.page').forEach(p => p.classList.toggle('active', p.id === 'page-' + name));
  $('nav').classList.remove('open');
  $('navToggle').setAttribute('aria-expanded', 'false');
  if (PAGE_LOADERS[name]) PAGE_LOADERS[name]();
}
document.querySelectorAll('.nav-btn[data-page]').forEach(b => b.addEventListener('click', () => showPage(b.dataset.page)));
$('navToggle').addEventListener('click', () => {
  const open = $('nav').classList.toggle('open');
  $('navToggle').setAttribute('aria-expanded', open ? 'true' : 'false');
});

/* -------------------- schools (Details.Schools + any school with settings) -------------------- */
let SCHOOLS = [];
let settingsRows = [];
let hmuRows = [];         // hmu_settings rows (Hair & Makeup page)

async function loadSchools(){
  const [details, settings] = await Promise.all([
    sb.from('Details').select('Schools'),
    sb.from('slot_settings').select('*').order('school'),
  ]);
  settingsRows = settings.data || [];
  const seen = new Map();
  [...(details.data || []).map(r => r['Schools']), ...settingsRows.map(r => r.school)].forEach(s => {
    const v = (s || '').trim();
    if (v && !seen.has(v.toLowerCase())) seen.set(v.toLowerCase(), v);
  });
  SCHOOLS = [...seen.values()].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
  fillSchoolSelects();
}

function fillSchoolSelects(){
  const opts = (list) => list.map(s => `<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`).join('');
  const withSettings = settingsRows.map(r => r.school);
  const keep = (id, html) => { const sel = $(id); const v = sel.value; sel.innerHTML = html; if (v && [...sel.options].some(o => o.value === v)) sel.value = v; };
  // School settings can be created for any school; slot views only make sense for schools with settings.
  keep('setSchool', '<option value="">Select a school…</option>' + opts(SCHOOLS));
  keep('slotSchool', withSettings.length ? opts(withSettings) : '<option value="">No schools set up yet</option>');
  keep('bkSchool', '<option value="">All schools</option>' + opts(withSettings));
  keep('actSchool', '<option value="">All schools</option>' + opts(withSettings));
  keep('ubSchool', '<option value="">Select a school…</option>' + opts(SCHOOLS));
  keep('hmuSchool', '<option value="">Select a school…</option>' + opts(SCHOOLS));
  keep('hmuListSchool', '<option value="">All schools</option>' + opts(hmuRows.map(r => r.school)));
  keep('annSchool', '<option value="">All schools</option>' + opts(SCHOOLS));
  keep('annFilter', '<option value="*">All announcements</option><option value="">General (all schools) only</option>' + opts(SCHOOLS));
}

/* -------------------- enter dashboard -------------------- */
async function enterDashboard(staff){
  currentStaff = staff;
  $('staffName').textContent = staff.full_name || staff.email || 'Staff';
  $('loginShell').classList.add('hidden');
  $('dash').classList.remove('hidden');
  await loadSchools();
  if (!$('bkFrom').value) $('bkFrom').value = todayManila();
  refreshRequestBadge();
  showPage('settings');
}

/* ================================================================
   SLOT SETTINGS
   ================================================================ */
// Slots are always one hour; staff enter the school's total and it is spread over every hour.
const SLOT_MINUTES = 60;
const SETTINGS_DEFAULTS = {
  is_enabled: false, start_date: '', end_date: '', days_of_week: [1, 2, 3, 4, 5],
  open_time: '08:00', close_time: '17:00', lunch_start: '12:00', lunch_end: '13:00',
  total_students: null,
};

function settingsFor(school){
  return settingsRows.find(r => r.school.toLowerCase() === (school || '').toLowerCase());
}

/* ---- Blocked dates (holidays / no-duty days), kept as sorted 'YYYY-MM-DD' strings ---- */
let blockedDates = [];

// A calendar date with no time zone (e.g. '2026-12-08' → 'Tue, Dec 8').
function fmtDay(day, opts){
  return new Date(day + 'T00:00:00Z').toLocaleDateString('en-US', Object.assign({ timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric' }, opts || {}));
}
// Consecutive days collapse into one range: ['12-05','12-06','12-08'] → [[05,06],[08,08]].
function dayRanges(days){
  const out = [];
  days.forEach(d => {
    const last = out[out.length - 1];
    if (last && nextDay(last[1]) === d) last[1] = d; else out.push([d, d]);
  });
  return out;
}
function rangeLabel([from, to]){
  return from === to ? fmtDay(from) : `${fmtDay(from)} – ${fmtDay(to)}`;
}

function renderBlocked(){
  $('blockList').innerHTML = blockedDates.length
    ? dayRanges(blockedDates).map(r => `<span class="date-chip">${escapeHtml(rangeLabel(r))}<button type="button" data-unblock="${r[0]}|${r[1]}" aria-label="Unblock ${escapeHtml(rangeLabel(r))}">×</button></span>`).join('')
    : '<span class="muted">No blocked dates.</span>';
}

$('blockAddBtn').addEventListener('click', () => {
  clearAlert('settingsAlert');
  const from = $('blockFrom').value;
  const to = $('blockTo').value || from;
  if (!from) { alertBox('settingsAlert', 'Pick the first blocked date.', 'error'); return; }
  if (to < from) { alertBox('settingsAlert', 'The "to" date must be on or after the first date.', 'error'); return; }
  const add = [];
  for (let d = from; d <= to && add.length <= 366; d = nextDay(d)) add.push(d);
  if (add.length > 366) { alertBox('settingsAlert', 'Block at most one year at a time.', 'error'); return; }
  blockedDates = [...new Set([...blockedDates, ...add])].sort();
  $('blockFrom').value = ''; $('blockTo').value = '';
  renderBlocked();
  updatePreview();
});
$('blockList').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-unblock]');
  if (!btn) return;
  const [from, to] = btn.dataset.unblock.split('|');
  blockedDates = blockedDates.filter(d => d < from || d > to);
  renderBlocked();
  updatePreview();
});

function fillSettingsForm(){
  const school = $('setSchool').value;
  $('settingsForm').classList.toggle('disabled', !school);
  const row = settingsFor(school) || SETTINGS_DEFAULTS;
  blockedDates = [...(row.blocked_dates || [])].sort();
  renderBlocked();
  $('setEnabled').checked = !!row.is_enabled;
  $('setStart').value = row.start_date || '';
  $('setEnd').value = row.end_date || '';
  document.querySelectorAll('#setDays input').forEach(cb => { cb.checked = (row.days_of_week || []).map(Number).includes(Number(cb.value)); });
  $('setOpen').value = hhmm(row.open_time);
  $('setClose').value = hhmm(row.close_time);
  $('setLunchStart').value = hhmm(row.lunch_start);
  $('setLunchEnd').value = hhmm(row.lunch_end);
  $('setTotal').value = row.total_students ?? '';
  $('generateBtn').disabled = !school;
  $('saveSettingsBtn').disabled = !school;
  $('rebuildBtn').disabled = !settingsFor(school);
  updatePreview();
}

function readSettingsForm(){
  const toMin = (t) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
  const s = {
    school: $('setSchool').value,
    is_enabled: $('setEnabled').checked,
    start_date: $('setStart').value,
    end_date: $('setEnd').value,
    days_of_week: [...document.querySelectorAll('#setDays input:checked')].map(cb => Number(cb.value)),
    open_time: $('setOpen').value,
    close_time: $('setClose').value,
    lunch_start: $('setLunchStart').value || null,
    lunch_end: $('setLunchEnd').value || null,
    slot_minutes: SLOT_MINUTES,
    total_students: Number($('setTotal').value),
  };
  let error = null;
  if (!s.school) error = 'Pick a school first.';
  else if (!s.start_date || !s.end_date) error = 'Set the start and end dates.';
  else if (s.end_date < s.start_date) error = 'End date must be on or after the start date.';
  else if (!s.days_of_week.length) error = 'Pick at least one day of the week.';
  else if (!s.open_time || !s.close_time || toMin(s.close_time) <= toMin(s.open_time)) error = 'Closing time must be after opening time.';
  else if (!!s.lunch_start !== !!s.lunch_end) error = 'Set both lunch start and lunch end, or leave both blank.';
  else if (s.lunch_start && toMin(s.lunch_end) <= toMin(s.lunch_start)) error = 'Lunch end must be after lunch start.';
  else if (!(Number.isInteger(s.total_students) && s.total_students > 0)) error = 'Enter the total number of students in the school.';
  const plan = error ? null : slotPlan(s, toMin);
  if (plan && !plan.totalSlots) error = 'These dates, days and hours give no 1-hour slots. Check the hours, lunch break, days and blocked dates.';
  if (plan) s.per_slot_capacity = plan.perHour;
  return { s, error, toMin, plan };
}

// Mirrors staff_generate_slots: which days and 1-hour slots the settings create, and how the
// school's total is spread over them (rounded up so everyone fits).
function slotPlan(s, toMin){
  let hoursPerDay = 0;
  for (let t = toMin(s.open_time); t + SLOT_MINUTES <= toMin(s.close_time); t += SLOT_MINUTES) {
    const end = t + SLOT_MINUTES;
    if (!s.lunch_start || !(t < toMin(s.lunch_end) && end > toMin(s.lunch_start))) hoursPerDay++;
  }
  let days = 0;
  let skipped = 0;
  for (let d = s.start_date; d <= s.end_date; d = nextDay(d)) {
    const dow = new Date(d + 'T00:00:00Z').getUTCDay() || 7;
    if (!s.days_of_week.includes(dow)) continue;
    if (blockedDates.includes(d)) skipped++; else days++;
  }
  const totalSlots = days * hoursPerDay;
  const perHour = totalSlots ? Math.ceil(s.total_students / totalSlots) : 0;
  return { days, skipped, hoursPerDay, totalSlots, perHour, perDay: perHour * hoursPerDay, seats: perHour * totalSlots };
}

function updatePreview(){
  const { error, plan, s } = readSettingsForm();
  if (error || !plan) { $('setPreview').innerHTML = error && $('setSchool').value && $('setTotal').value ? escapeHtml(error) : '—'; return; }
  const n = (x) => x.toLocaleString();
  $('setPreview').innerHTML =
    `<strong>${n(s.total_students)} students</strong> over <strong>${plan.days} day${plan.days === 1 ? '' : 's'}</strong> × ${plan.hoursPerDay} hours = ${n(plan.totalSlots)} one-hour slots`
    + `<br>→ <strong>${n(plan.perHour)} students per hour</strong> · about ${n(plan.perDay)} per day`
    + `<br><span class="preview-sub">Room for ${n(plan.seats)} (${n(plan.seats - s.total_students)} spare)`
    + (plan.skipped ? ` · ${plan.skipped} blocked day${plan.skipped === 1 ? '' : 's'} skipped` : '') + '</span>';
}

$('setSchool').addEventListener('change', () => { clearAlert('settingsAlert'); fillSettingsForm(); });
$('settingsForm').addEventListener('input', updatePreview);
$('settingsForm').addEventListener('change', updatePreview);

async function saveSettings(){
  const { s, error } = readSettingsForm();
  if (error) { alertBox('settingsAlert', escapeHtml(error), 'error'); return false; }
  const existing = settingsFor(s.school);
  if (existing) s.school = existing.school; // keep the stored spelling (it is the time_slots foreign key)
  const { error: dbError } = await sb.from('slot_settings').upsert({ ...s, updated_at: new Date().toISOString() }, { onConflict: 'school' });
  if (dbError) { showErr('settingsAlert', dbError, 'Could not save settings.'); return false; }
  // Blocked dates go through the RPC so slots on newly blocked days close (and unblocked days reopen).
  const { data: blockRes, error: blockError } = await sb.rpc('staff_set_blocked_dates', { p_school: s.school, p_dates: blockedDates });
  if (blockError) { showErr('settingsAlert', blockError, 'Settings saved, but the blocked dates could not be updated.'); return false; }
  // The per-hour number changes with the total, dates and hours, so push it onto existing upcoming slots too.
  const { data: capRes, error: capError } = await sb.rpc('staff_apply_capacity', { p_school: s.school, p_capacity: s.per_slot_capacity });
  if (capError) { showErr('settingsAlert', capError, 'Settings saved, but existing slots could not be updated.'); return false; }
  await loadSchools();
  $('setSchool').value = s.school;
  $('rebuildBtn').disabled = false; // the school now has saved settings
  renderSettingsTable();
  return Object.assign({ per_hour: s.per_slot_capacity }, blockRes || {}, { capacity: capRes || {} });
}

// Extra lines for the success message after blocked dates and capacity were applied.
function blockedSummaryHtml(res){
  let html = '';
  const cap = res.capacity || {};
  if (cap.updated) html += ` Updated ${cap.updated.toLocaleString()} upcoming slot${cap.updated === 1 ? '' : 's'} to <strong>${res.per_hour} students per hour</strong>.`;
  if (cap.kept_higher) html += ` ${cap.kept_higher} slot${cap.kept_higher === 1 ? ' already has' : 's already have'} more students booked than that, so ${cap.kept_higher === 1 ? 'it keeps its' : 'they keep their'} current size.`;
  if (res.closed_slots) html += ` Closed ${res.closed_slots} slot${res.closed_slots === 1 ? '' : 's'} on newly blocked days.`;
  if (res.reopened_slots) html += ` Reopened ${res.reopened_slots} slot${res.reopened_slots === 1 ? '' : 's'} on unblocked days.`;
  const booked = res.booked_on_blocked || [];
  if (booked.length) {
    html += `<br><strong>Students still booked on blocked days:</strong> ` + booked.map(b =>
      `<button type="button" class="btn-link" data-goto-bookings="${escapeHtml(b.day)}">${escapeHtml(fmtDay(b.day))} (${b.students})</button>`).join(', ')
      + '. Move them to another day from Bookings.';
  }
  return html;
}
$('settingsAlert').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-goto-bookings]');
  if (!btn) return;
  $('bkSchool').value = $('setSchool').value;
  $('bkFrom').value = $('bkTo').value = btn.dataset.gotoBookings;
  $('bkStatus').value = 'booked';
  showPage('bookings');
});

$('settingsForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  clearAlert('settingsAlert');
  const btn = $('saveSettingsBtn');
  setBusy(btn, true, 'Saving…');
  const res = await saveSettings();
  setBusy(btn, false);
  if (res) alertBox('settingsAlert', `Settings saved for <strong>${escapeHtml($('setSchool').value)}</strong>.`
    + ($('setEnabled').checked ? '' : ' Booking is <strong>disabled</strong>, so students can’t see slots yet.')
    + blockedSummaryHtml(res), booked(res) ? 'warn' : 'success');
});
const booked = (res) => (res.booked_on_blocked || []).length > 0;

$('generateBtn').addEventListener('click', () => {
  clearAlert('settingsAlert');
  const { s, error } = readSettingsForm();
  if (error) { alertBox('settingsAlert', escapeHtml(error), 'error'); return; }
  openDialog({
    title: 'Generate slots?',
    body: `<p>This saves the settings for <strong>${escapeHtml(s.school)}</strong> and adds any missing 1-hour slots from <strong>${escapeHtml(fmtDay(s.start_date, { year: 'numeric' }))}</strong> to <strong>${escapeHtml(fmtDay(s.end_date, { year: 'numeric' }))}</strong>.</p><div class="preview-box">${$('setPreview').innerHTML}</div><p class="muted" style="margin-top:12px">Slots that already exist keep their times. If you changed the hours or days, use <strong>Rebuild slots</strong> instead.</p>`,
    okText: 'Save & generate',
    onOk: async () => {
      const saved = await saveSettings();
      if (!saved) { alertBox('dialogAlert', 'Fix the settings first (see the message on the page).', 'error'); return false; }
      const { data, error: rpcError } = await sb.rpc('staff_generate_slots', { p_school: $('setSchool').value });
      if (rpcError) { showErr('dialogAlert', rpcError); return false; }
      const added = (data && data.added) || 0;
      alertBox('settingsAlert', `Added <strong>${added}</strong> new slot${added === 1 ? '' : 's'} for ${escapeHtml($('setSchool').value)}.`
        + (added === 0 ? ' (All slots in this window already existed.)' : '') + blockedSummaryHtml(saved), booked(saved) ? 'warn' : 'success');
      renderSettingsTable();
      return true;
    },
  });
});

$('rebuildBtn').addEventListener('click', () => {
  clearAlert('settingsAlert');
  const { s, error } = readSettingsForm();
  if (error) { alertBox('settingsAlert', escapeHtml(error), 'error'); return; }
  openDialog({
    title: 'Rebuild slots?',
    body: `<p>This saves the settings for <strong>${escapeHtml(s.school)}</strong>, then:</p>
      <ul class="dialog-list">
        <li>removes upcoming slots that nobody has booked,</li>
        <li>makes fresh 1-hour slots from these settings,</li>
        <li>keeps every student who is already booked (their slot stays; move them from Bookings if needed).</li>
      </ul>
      <div class="preview-box">${$('setPreview').innerHTML}</div>
      <p class="muted" style="margin-top:12px">Single slots you closed by hand on the Slots tab open again.</p>`,
    okText: 'Save & rebuild',
    danger: true,
    onOk: async () => {
      const saved = await saveSettings();
      if (!saved) { alertBox('dialogAlert', 'Fix the settings first (see the message on the page).', 'error'); return false; }
      const { data, error: rpcError } = await sb.rpc('staff_rebuild_slots', { p_school: $('setSchool').value });
      if (rpcError) { showErr('dialogAlert', rpcError); return false; }
      const r = data || {};
      let html = `Rebuilt slots for <strong>${escapeHtml($('setSchool').value)}</strong>: ${(r.slots || 0).toLocaleString()} one-hour slots at <strong>${saved.per_hour} students per hour</strong>`
        + ` (removed ${(r.removed || 0).toLocaleString()} unbooked old slot${r.removed === 1 ? '' : 's'}).`;
      if (r.closed_leftovers) html += ` Closed ${r.closed_leftovers} old slot${r.closed_leftovers === 1 ? '' : 's'} outside the new schedule, so nobody new can book ${r.closed_leftovers === 1 ? 'it' : 'them'}.`;
      if (r.kept_booked) html += `<br><strong>${r.kept_booked} old slot${r.kept_booked === 1 ? ' still has' : 's still have'} booked students</strong> (they stay booked). Check the Slots and Bookings tabs and move them to the new schedule if needed.`;
      alertBox('settingsAlert', html, r.kept_booked ? 'warn' : 'success');
      slotRows = []; slotDay = null;
      renderSettingsTable();
      return true;
    },
  });
});

async function renderSettingsTable(){
  const table = $('settingsTable');
  if (!settingsRows.length) { table.innerHTML = '<tbody><tr><td class="empty">No schools set up yet. Pick a school above to start.</td></tr></tbody>'; return; }
  const counts = await Promise.all(settingsRows.map(r =>
    sb.from('time_slots').select('id', { count: 'exact', head: true }).eq('school', r.school).gt('slot_start', new Date().toISOString())));
  table.innerHTML = `
    <thead><tr><th>School</th><th>Booking</th><th>Window</th><th>Days</th><th>Hours</th><th>Students</th><th>Blocked</th><th>Upcoming slots</th><th></th></tr></thead>
    <tbody>${settingsRows.map((r, i) => `
      <tr>
        <td data-label="School"><strong>${escapeHtml(r.school)}</strong></td>
        <td data-label="Booking">${r.is_enabled ? '<span class="chip chip-approved">Enabled</span>' : '<span class="chip chip-cancelled">Disabled</span>'}</td>
        <td data-label="Window">${escapeHtml(r.start_date)} → ${escapeHtml(r.end_date)}</td>
        <td data-label="Days">${(r.days_of_week || []).map(d => DOW[d]).join(', ')}</td>
        <td data-label="Hours">${fmtClock(hhmm(r.open_time))} – ${fmtClock(hhmm(r.close_time))}${r.lunch_start ? `<div class="muted">Lunch ${fmtClock(hhmm(r.lunch_start))} – ${fmtClock(hhmm(r.lunch_end))}</div>` : ''}</td>
        <td data-label="Students">${r.total_students ? `<strong>${r.total_students.toLocaleString()}</strong><div class="muted">${r.per_slot_capacity} per hour</div>` : `<span class="muted">${r.per_slot_capacity} per ${r.slot_minutes === 60 ? 'hour' : r.slot_minutes + ' min'}</span>`}</td>
        <td data-label="Blocked">${(r.blocked_dates || []).length ? dayRanges([...r.blocked_dates].sort()).map(rg => escapeHtml(rangeLabel(rg))).join('<br>') : '<span class="muted">None</span>'}</td>
        <td data-label="Upcoming slots">${counts[i].count ?? '—'}</td>
        <td><div class="row-actions">
          <button type="button" class="btn-link" data-edit-school="${escapeHtml(r.school)}">Edit</button>
          <button type="button" class="btn-link danger" data-del-school="${escapeHtml(r.school)}">Delete</button>
        </div></td>
      </tr>`).join('')}
    </tbody>`;
}
$('settingsTable').addEventListener('click', (e) => {
  const delBtn = e.target.closest('[data-del-school]');
  if (delBtn) {
    const school = delBtn.dataset.delSchool;
    clearAlert('settingsAlert');
    openDialog({
      title: 'Delete this school setup?',
      body: `<p>This deletes the booking setup of <strong>${escapeHtml(school)}</strong>, including Hair &amp; Makeup:</p>
        <ul class="dialog-list">
          <li>its pictorial settings and HMU settings</li>
          <li>every pictorial slot and HMU slot nobody has booked</li>
        </ul>
        <p class="muted">If students are still booked, nothing is deleted. Move or cancel them first. If some slots have past records (cancelled, completed, no-show), those slots and the settings are kept and booking is turned OFF instead. Student accounts are not touched. This can’t be undone.</p>`,
      okText: 'Delete school setup', danger: true,
      onOk: async () => {
        const { data, error } = await sb.rpc('staff_delete_school_setup', { p_school: school });
        if (error) { showErr('dialogAlert', error); return false; }
        const r = data || {};
        const deleted = `${plural(r.slots_deleted, 'pictorial slot')} and ${plural(r.hmu_slots_deleted, 'HMU slot')}`;
        if (r.removed) {
          alertBox('settingsAlert', `Deleted the setup of <strong>${escapeHtml(school)}</strong> (${deleted}).`, 'success');
        } else {
          const kept = (r.slots_kept || 0) + (r.hmu_slots_kept || 0);
          alertBox('settingsAlert', `Deleted ${deleted} of <strong>${escapeHtml(school)}</strong>. `
            + `${plural(kept, 'slot')} still ${kept === 1 ? 'has' : 'have'} past booking records, so the settings were kept and pictorial booking and HMU are now <strong>off</strong> for this school.`, 'warn');
        }
        if ($('setSchool').value === school) $('setSchool').value = '';
        slotRows = []; slotDay = null;
        await loadSchools();
        await loadHmuSettings();
        fillSchoolSelects();
        fillSettingsForm();
        renderSettingsTable();
        return true;
      },
    });
    return;
  }
  const btn = e.target.closest('[data-edit-school]');
  if (!btn) return;
  $('setSchool').value = btn.dataset.editSchool;
  clearAlert('settingsAlert');
  fillSettingsForm();
  $('setSchool').scrollIntoView({ behavior: 'smooth', block: 'center' });
});

PAGE_LOADERS.settings = () => { fillSettingsForm(); renderSettingsTable(); };

/* ================================================================
   SLOTS
   ================================================================ */
let slotRows = [];        // every slot of the selected school (all dates)
let slotDays = [];        // sorted 'YYYY-MM-DD' days that have slots or are blocked
let slotDay = null;       // the day on screen
let slotDayNames = {};    // slot start (ms) -> booked student names on slotDay

async function loadSlots(){
  const school = $('slotSchool').value;
  if (!school) {
    $('slotsList').innerHTML = '<div class="empty">Set up a school in Slot Settings first.</div>';
    $('slotsSummary').textContent = ''; $('slotDayStrip').innerHTML = '';
    return;
  }
  const seq = nextSeq('slots');
  if (!slotRows.length) $('slotsList').innerHTML = '<div class="empty">Loading…</div>';
  const { data, error } = await fetchAll(() => sb.from('time_slots')
    .select('id, slot_start, slot_end, capacity, booked_count, is_closed').eq('school', school).order('slot_start'));
  if (seq !== loadSeq.slots) return;
  if (error) { showErr('slotsAlert', error, 'Could not load slots.'); $('slotsList').innerHTML = ''; return; }
  slotRows = data || [];
  const blocked = (settingsFor(school) || {}).blocked_dates || [];
  slotDays = [...new Set([...slotRows.map(r => manilaDay(r.slot_start)), ...blocked])].sort();
  // Keep the chosen day; otherwise today, else the next day with slots, else the last one.
  const today = todayManila();
  if (!slotDay || !slotDays.includes(slotDay)) slotDay = slotDays.find(d => d >= today) || slotDays[slotDays.length - 1] || null;
  await showSlotDay(slotDay, { keepScroll: true });
}

async function showSlotDay(day, opts){
  slotDay = day;
  if (day) $('slotDate').value = day;
  slotDayNames = {};
  renderDayStrip(opts && opts.keepScroll);
  renderSlotDay();
  if (!day) return;
  // Booked names for the day, shown beside each slot.
  const seq = nextSeq('slotNames');
  const { data } = await fetchAll(() => sb.rpc('staff_list_bookings', { p_school: $('slotSchool').value, p_from: day, p_to: day, p_status: 'booked' }));
  if (seq !== loadSeq.slotNames || day !== slotDay) return;
  (data || []).forEach(b => {
    const key = new Date(b.slot_start).getTime();
    (slotDayNames[key] = slotDayNames[key] || []).push(b.full_name || b.student_username);
  });
  renderSlotDay();
}

// Day strip shared by Slots and Hair & Makeup: one chip per day with booked/capacity.
function paintDayStrip({ strip, prev, next, days, slots, active, blocked = [], empty, keepScroll }){
  const byDay = {};
  slots.forEach(s => { const d = manilaDay(s.slot_start); (byDay[d] = byDay[d] || []).push(s); });
  const today = todayManila();
  strip.innerHTML = days.length ? days.map(d => {
    const list = byDay[d] || [];
    const booked = list.reduce((a, s) => a + s.booked_count, 0);
    const cap = list.reduce((a, s) => a + s.capacity, 0);
    const isBlocked = blocked.includes(d);
    const closed = isBlocked || (list.length > 0 && list.every(s => s.is_closed));
    const cls = ['day-chip', d === active ? 'is-active' : '', closed ? 'is-closed' : '', d < today ? 'is-past' : '', cap && booked >= cap ? 'is-full' : ''].join(' ');
    return `<button type="button" class="${cls}" role="option" aria-selected="${d === active}" data-strip-day="${d}">
      <span class="dc-dow">${escapeHtml(fmtDay(d, { month: undefined, day: undefined }))}</span>
      <span class="dc-date">${escapeHtml(fmtDay(d, { weekday: undefined }))}</span>
      <span class="dc-meta">${isBlocked ? 'Blocked' : closed ? 'Closed' : `${booked}/${cap}`}</span>
    </button>`;
  }).join('') : `<span class="muted">${escapeHtml(empty)}</span>`;
  const i = days.indexOf(active);
  prev.disabled = i <= 0;
  next.disabled = i < 0 || i >= days.length - 1;
  const chipEl = strip.querySelector('.is-active');
  if (chipEl) chipEl.scrollIntoView({ block: 'nearest', inline: 'center', behavior: keepScroll ? 'auto' : 'smooth' });
}

// Slot status chip shared by Slots and Hair & Makeup.
function slotStatusChip(s){
  if (new Date(s.slot_start).getTime() <= Date.now()) return '<span class="chip chip-cancelled">Past</span>';
  if (s.is_closed) return '<span class="chip chip-rejected">Closed</span>';
  if (s.booked_count >= s.capacity) return '<span class="chip chip-pending">Full</span>';
  return '<span class="chip chip-approved">Open</span>';
}

function renderDayStrip(keepScroll){
  paintDayStrip({
    strip: $('slotDayStrip'), prev: $('slotPrevDay'), next: $('slotNextDay'),
    days: slotDays, slots: slotRows, active: slotDay, keepScroll,
    blocked: (settingsFor($('slotSchool').value) || {}).blocked_dates || [],
    empty: 'No slots yet. Generate them from Slot Settings.',
  });
}

function renderSlotDay(){
  const day = slotDay;
  if (!day) { $('slotsList').innerHTML = '<div class="empty">No slots yet for this school. Generate them from Slot Settings.</div>'; $('slotsSummary').textContent = ''; return; }
  const list = slotRows.filter(s => manilaDay(s.slot_start) === day);
  const isBlocked = ((settingsFor($('slotSchool').value) || {}).blocked_dates || []).includes(day);
  const booked = list.reduce((a, s) => a + s.booked_count, 0);
  const cap = list.reduce((a, s) => a + (s.is_closed ? 0 : s.capacity), 0);
  $('slotsSummary').innerHTML = list.length
    ? `<span><strong>${list.length}</strong> slots</span><span><strong>${booked}</strong> booked</span><span><strong>${Math.max(cap - booked, 0)}</strong> open seats</span>`
    : '';
  const title = escapeHtml(fmtDay(day, { weekday: 'long', month: 'long', year: 'numeric' }));
  if (!list.length) {
    $('slotsList').innerHTML = `<div class="day-card"><div class="day-head"><div><strong>${title}</strong></div></div>
      <div class="empty flat">${isBlocked ? 'Blocked date (holiday / no duty). No slots on this day.' : 'No slots on this day.'}</div></div>`;
    return;
  }
  const allClosed = list.every(s => s.is_closed);
  $('slotsList').innerHTML = `
    <div class="day-card">
      <div class="day-head">
        <div><strong>${title}</strong>
          ${isBlocked ? ' <span class="chip chip-cancelled">Blocked date</span>' : allClosed ? ' <span class="chip chip-cancelled">Day closed</span>' : ''}</div>
        <div class="row-actions">
          ${booked ? `<button type="button" class="btn btn-ghost btn-inline btn-sm" data-day-bookings="${day}">View ${booked} booking${booked === 1 ? '' : 's'}</button>` : ''}
          <button type="button" class="btn btn-ghost btn-inline btn-sm" data-day-toggle="${day}" data-closed="${allClosed}">${allClosed ? 'Reopen day' : 'Close day'}</button>
        </div>
      </div>
      <table class="table slot-table">
        <thead><tr><th>Time</th><th>Booked students</th><th>Capacity</th><th>Left</th><th>Status</th><th></th></tr></thead>
        <tbody>${list.map(s => {
          const names = slotDayNames[new Date(s.slot_start).getTime()] || [];
          return `
          <tr class="${s.is_closed ? 'row-closed' : ''}">
            <td data-label="Time"><strong>${escapeHtml(fmtRange(s.slot_start, s.slot_end))}</strong></td>
            <td data-label="Booked students">${s.booked_count ? (names.length ? names.map(n => `<div>${escapeHtml(n)}</div>`).join('') : `${s.booked_count} booked`) : '<span class="muted">—</span>'}</td>
            <td data-label="Capacity"><span class="cap-edit"><input type="number" min="${s.booked_count}" max="500" value="${s.capacity}" data-cap-input="${s.id}" aria-label="Capacity"><button type="button" class="btn-link" data-cap-save="${s.id}">Save</button></span></td>
            <td data-label="Left">${Math.max(s.capacity - s.booked_count, 0)}</td>
            <td data-label="Status">${slotStatusChip(s)}</td>
            <td><div class="row-actions">
              <button type="button" class="btn-link" data-slot-toggle="${s.id}" data-closed="${s.is_closed}">${s.is_closed ? 'Reopen' : 'Close'}</button>
              ${s.booked_count ? '' : `<button type="button" class="btn-link danger" data-slot-del="${s.id}">Delete</button>`}
            </div></td>
          </tr>`; }).join('')}
        </tbody>
      </table>
    </div>`;
}

// Loaders keep the alert box so a success message survives the reload after an action.
$('slotLoadBtn').addEventListener('click', () => { clearAlert('slotsAlert'); loadSlots(); });
$('slotSchool').addEventListener('change', () => { clearAlert('slotsAlert'); slotRows = []; slotDay = null; loadSlots(); });
$('slotDayStrip').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-strip-day]');
  if (btn) { clearAlert('slotsAlert'); showSlotDay(btn.dataset.stripDay); }
});
$('slotPrevDay').addEventListener('click', () => { const i = slotDays.indexOf(slotDay); if (i > 0) showSlotDay(slotDays[i - 1]); });
$('slotNextDay').addEventListener('click', () => { const i = slotDays.indexOf(slotDay); if (i >= 0 && i < slotDays.length - 1) showSlotDay(slotDays[i + 1]); });
$('slotDate').addEventListener('change', () => { if ($('slotDate').value) { clearAlert('slotsAlert'); showSlotDay($('slotDate').value); } });
$('slotTodayBtn').addEventListener('click', () => { clearAlert('slotsAlert'); showSlotDay(todayManila()); });

$('slotsList').addEventListener('click', async (e) => {
  const capBtn = e.target.closest('[data-cap-save]');
  const slotBtn = e.target.closest('[data-slot-toggle]');
  const dayBtn = e.target.closest('[data-day-toggle]');
  const dayBookingsBtn = e.target.closest('[data-day-bookings]');
  const delBtn = e.target.closest('[data-slot-del]');
  clearAlert('slotsAlert');

  if (delBtn) {
    const slot = slotRows.find(s => s.id === delBtn.dataset.slotDel);
    openDialog({
      title: 'Delete this slot?',
      body: `<p><strong>${escapeHtml(fmtWhen(slot.slot_start))}</strong> will be removed. Students will no longer see it.</p><p class="muted">This can’t be undone. “Generate slots” or “Rebuild slots” in Slot Settings will create it again if the date is still in range.</p>`,
      okText: 'Delete slot', danger: true,
      onOk: async () => {
        const { error } = await sb.rpc('staff_delete_slot', { p_slot_id: slot.id });
        if (error) { showErr('dialogAlert', error); if (STALE_SLOT_ERRORS.includes(error.message)) loadSlots(); return false; }
        alertBox('slotsAlert', `Deleted the ${escapeHtml(fmtRange(slot.slot_start, slot.slot_end))} slot.`, 'success');
        loadSlots();
        return true;
      },
    });
    return;
  }

  if (dayBookingsBtn) {
    $('bkSchool').value = $('slotSchool').value;
    $('bkFrom').value = $('bkTo').value = dayBookingsBtn.dataset.dayBookings;
    $('bkStatus').value = 'booked';
    showPage('bookings');
    return;
  }

  if (capBtn) {
    const id = capBtn.dataset.capSave;
    const val = Number(document.querySelector(`[data-cap-input="${id}"]`).value);
    if (!(val >= 0)) { alertBox('slotsAlert', 'Enter a capacity of 0 or more.', 'error'); return; }
    capBtn.disabled = true;
    const { error } = await sb.rpc('staff_update_slot', { p_slot_id: id, p_capacity: val });
    capBtn.disabled = false;
    if (error) { showErr('slotsAlert', error); return; }
    alertBox('slotsAlert', 'Capacity updated.', 'success');
    loadSlots();
    return;
  }

  if (slotBtn) {
    const closing = slotBtn.dataset.closed !== 'true';
    const slot = slotRows.find(s => s.id === slotBtn.dataset.slotToggle);
    const run = async () => {
      const { error } = await sb.rpc('staff_update_slot', { p_slot_id: slot.id, p_is_closed: closing });
      if (error) { showErr(closing && slot.booked_count ? 'dialogAlert' : 'slotsAlert', error); return false; }
      alertBox('slotsAlert', closing ? 'Slot closed. Students can no longer book it.' : 'Slot reopened.', 'success');
      loadSlots();
      return true;
    };
    if (closing && slot.booked_count) {
      openDialog({
        title: 'Close this slot?',
        body: `<p><strong>${slot.booked_count}</strong> student${slot.booked_count === 1 ? ' is' : 's are'} booked at ${escapeHtml(fmtWhen(slot.slot_start))}. Closing stops new bookings but does <strong>not</strong> cancel or move them. Use the Bookings tab to move them.</p>`,
        okText: 'Close slot', danger: true, onOk: run,
      });
    } else run();
    return;
  }

  if (dayBtn) {
    const day = dayBtn.dataset.dayToggle;
    const closing = dayBtn.dataset.closed !== 'true';
    const booked = slotRows.filter(s => manilaDay(s.slot_start) === day).reduce((a, s) => a + s.booked_count, 0);
    openDialog({
      title: closing ? 'Close the whole day?' : 'Reopen the whole day?',
      body: closing
        ? `<p>All slots on <strong>${escapeHtml(day)}</strong> will stop accepting bookings.</p>${booked ? `<p><strong>${booked}</strong> student${booked === 1 ? ' is' : 's are'} already booked that day. They stay booked. Move them from the Bookings tab.</p>` : ''}`
        : `<p>All slots on <strong>${escapeHtml(day)}</strong> will accept bookings again.</p>`,
      okText: closing ? 'Close day' : 'Reopen day', danger: closing,
      onOk: async () => {
        const { error } = await sb.rpc('staff_set_day_closed', { p_school: $('slotSchool').value, p_day: day, p_closed: closing });
        if (error) { showErr('dialogAlert', error); return false; }
        alertBox('slotsAlert', closing ? `Closed ${escapeHtml(day)}.` : `Reopened ${escapeHtml(day)}.`, 'success');
        loadSlots();
        return true;
      },
    });
  }
});

PAGE_LOADERS.slots = () => { clearAlert('slotsAlert'); loadSlots(); };

/* ================================================================
   BOOKINGS
   ================================================================ */
let bookingRows = [];

async function loadBookings(){
  const seq = nextSeq('bookings');
  $('bookingsTable').innerHTML = '<tbody><tr><td class="empty">Loading…</td></tr></tbody>';
  const args = {
    p_school: $('bkSchool').value || null,
    p_from: $('bkFrom').value || null,
    p_to: $('bkTo').value || null,
    p_status: $('bkStatus').value || null,
  };
  const { data, error } = await fetchAll(() => sb.rpc('staff_list_bookings', args));
  if (seq !== loadSeq.bookings) return;
  if (error) { showErr('bookingsAlert', error, 'Could not load bookings.'); $('bookingsTable').innerHTML = ''; return; }
  bookingRows = data || [];
  renderBookings();
}

function filteredBookings(){
  const q = $('bkSearch').value.trim().toLowerCase();
  if (!q) return bookingRows;
  return bookingRows.filter(b => (b.full_name || '').toLowerCase().includes(q) || (b.student_username || '').toLowerCase().includes(q));
}

function renderBookings(){
  const rows = filteredBookings();
  const counts = {};
  rows.forEach(b => { counts[b.booking_status] = (counts[b.booking_status] || 0) + 1; });
  $('bookingsSummary').innerHTML = rows.length
    ? `<span><strong>${rows.length}</strong> booking${rows.length === 1 ? '' : 's'}</span>` + Object.keys(counts).map(k => `<span>${chip(k)} ${counts[k]}</span>`).join('')
    : '';
  if (!rows.length) { $('bookingsTable').innerHTML = '<tbody><tr><td class="empty">No bookings match these filters.</td></tr></tbody>'; return; }
  $('bookingsTable').innerHTML = `
    <thead><tr><th>Schedule</th><th>Student</th><th>School</th><th>Contact</th><th>Status</th><th>Actions</th></tr></thead>
    <tbody>${rows.map(b => `
      <tr>
        <td data-label="Schedule"><strong>${escapeHtml(fmtDate(b.slot_start, { weekday: 'short' }))}</strong><div class="muted">${escapeHtml(fmtRange(b.slot_start, b.slot_end))}</div></td>
        <td data-label="Student"><strong>${escapeHtml(b.full_name || '—')}</strong><div class="muted">${escapeHtml(b.student_username)}</div></td>
        <td data-label="School">${escapeHtml(b.school_name)}</td>
        <td data-label="Contact">${escapeHtml(b.contact || '—')}<div class="muted">${escapeHtml(b.email || '')}</div></td>
        <td data-label="Status">${chip(b.booking_status)}</td>
        <td data-label="Actions">${b.booking_status === 'booked' ? `
          <div class="row-actions">
            <button type="button" class="btn-link" data-bk-move="${b.booking_id}">Move</button>
            <button type="button" class="btn-link" data-bk-status="completed" data-id="${b.booking_id}">Completed</button>
            <button type="button" class="btn-link" data-bk-status="no_show" data-id="${b.booking_id}">No-show</button>
            <button type="button" class="btn-link danger" data-bk-status="cancelled" data-id="${b.booking_id}">Cancel</button>
          </div>` : ''}</td>
      </tr>`).join('')}
    </tbody>`;
}

$('bkLoadBtn').addEventListener('click', () => { clearAlert('bookingsAlert'); loadBookings(); });
$('bkSearch').addEventListener('input', renderBookings);

// Open future slots of a school with seats left, for the move / approve pickers.
async function openSlotsFor(school, excludeId){
  const now = new Date().toISOString();
  const { data, error } = await fetchAll(() => sb.from('time_slots')
    .select('id, slot_start, slot_end, capacity, booked_count, is_closed')
    .eq('school', school).eq('is_closed', false).gt('slot_start', now)
    .order('slot_start'));
  if (error) return { error };
  return { slots: (data || []).filter(s => s.booked_count < s.capacity && s.id !== excludeId) };
}
function slotOptions(slots, selectedId){
  return slots.map(s => `<option value="${s.id}" ${s.id === selectedId ? 'selected' : ''}>${escapeHtml(fmtDate(s.slot_start, { weekday: 'short' }))}, ${escapeHtml(fmtRange(s.slot_start, s.slot_end))} (${s.capacity - s.booked_count} left)</option>`).join('');
}

const STATUS_CONFIRM = {
  completed: { title: 'Mark as completed?', text: 'Use this after the student’s pictorial is done.', ok: 'Mark completed' },
  no_show: { title: 'Mark as no-show?', text: 'The student’s seat is released back to the slot. They will be able to book again.', ok: 'Mark no-show', danger: true },
  cancelled: { title: 'Cancel this booking?', text: 'The seat is released back to the slot. The student will be able to book again.', ok: 'Cancel booking', danger: true },
};

$('bookingsTable').addEventListener('click', async (e) => {
  const moveBtn = e.target.closest('[data-bk-move]');
  const statusBtn = e.target.closest('[data-bk-status]');
  clearAlert('bookingsAlert');

  if (statusBtn) {
    const b = bookingRows.find(r => r.booking_id === statusBtn.dataset.id);
    const cfg = STATUS_CONFIRM[statusBtn.dataset.bkStatus];
    openDialog({
      title: cfg.title,
      body: `<p><strong>${escapeHtml(b.full_name || b.student_username)}</strong> · ${escapeHtml(fmtWhen(b.slot_start))}</p><p class="muted">${cfg.text}</p>`,
      okText: cfg.ok, danger: cfg.danger,
      onOk: async () => {
        const { error } = await sb.rpc('staff_set_booking_status', { p_booking_id: b.booking_id, p_status: statusBtn.dataset.bkStatus });
        if (error) { showErr('dialogAlert', error); if (error.message === 'booking_not_active') loadBookings(); return false; }
        alertBox('bookingsAlert', `${escapeHtml(b.full_name || b.student_username)} marked as <strong>${escapeHtml(STATUS_LABEL[statusBtn.dataset.bkStatus])}</strong>.`, 'success');
        loadBookings();
        return true;
      },
    });
    return;
  }

  if (moveBtn) {
    const b = bookingRows.find(r => r.booking_id === moveBtn.dataset.bkMove);
    const res = await openSlotsFor(b.school_name);
    if (res.error) { showErr('bookingsAlert', res.error); return; }
    const current = res.slots.find(s => s.slot_start === b.slot_start);
    const choices = res.slots.filter(s => s !== current && new Date(s.slot_start).getTime() !== new Date(b.slot_start).getTime());
    openDialog({
      title: 'Move booking',
      body: `<p><strong>${escapeHtml(b.full_name || b.student_username)}</strong><br><span class="muted">Currently ${escapeHtml(fmtWhen(b.slot_start))}</span></p>` +
        (choices.length
          ? `<div class="field"><label for="moveSlot">New slot</label><select id="moveSlot">${slotOptions(choices)}</select></div>`
          : '<div class="empty">No other open slots with seats left for this school.</div>'),
      okText: 'Move student',
      onOk: async () => {
        const sel = $('moveSlot');
        if (!sel) return true;
        const { error } = await sb.rpc('staff_move_booking', { p_booking_id: b.booking_id, p_new_slot_id: sel.value });
        if (error) { showErr('dialogAlert', error); return false; }
        alertBox('bookingsAlert', `Moved ${escapeHtml(b.full_name || b.student_username)} to <strong>${escapeHtml(sel.options[sel.selectedIndex].text)}</strong>.`, 'success');
        loadBookings();
        return true;
      },
    });
  }
});

$('bookingsCsvBtn').addEventListener('click', () => {
  const rows = filteredBookings();
  if (!rows.length) { alertBox('bookingsAlert', 'Nothing to download. Load some bookings first.', 'error'); return; }
  downloadCsv(`bookings-${todayManila()}.csv`,
    ['Date', 'Time', 'Full Name', 'Username', 'School', 'Contact', 'Email', 'Status'],
    rows.map(b => [manilaDay(b.slot_start), fmtRange(b.slot_start, b.slot_end), b.full_name, b.student_username, b.school_name, b.contact, b.email, STATUS_LABEL[b.booking_status] || b.booking_status]));
});

PAGE_LOADERS.bookings = () => { clearAlert('bookingsAlert'); loadBookings(); };

/* ================================================================
   HAIR & MAKEUP (HMU)
   Settings live in hmu_settings (staff edit it directly), except staff count and the daily
   maximum, which go through their RPCs. Linked mode = the school has pictorial booking on.
   ================================================================ */
const HMU_HOURS = Array.from({ length: 17 }, (_, i) => String(i + 5).padStart(2, '0') + ':00'); // 5 AM to 9 PM
let hmuBlocked = [];      // open-mode blocked dates in the form, sorted 'YYYY-MM-DD'

async function loadHmuSettings(){
  const { data, error } = await sb.from('hmu_settings').select('*').order('school');
  if (error) { showErr('hmuAlert', error, 'Could not load Hair & Makeup settings.'); return false; }
  hmuRows = data || [];
  return true;
}
function hmuFor(school){ return hmuRows.find(r => sameSchool(r.school, school)); }
function pictorialFor(school){ return settingsRows.find(r => sameSchool(r.school, school)); }
function hmuLinked(school){ const p = pictorialFor(school); return !!(p && p.is_enabled); }
// The DB functions match the school name exactly, so keep the spelling already stored:
// the HMU row's, else the pictorial settings' (linked mode reads its dates from there).
function hmuSchoolName(school){
  const stored = hmuFor(school) || pictorialFor(school);
  return stored ? stored.school : school;
}

// 'Mon–Sat' for a run of days, otherwise 'Mon, Wed, Fri'.
function daysLabel(days){
  const d = [...(days || [])].map(Number).sort((a, b) => a - b);
  if (!d.length) return 'no days';
  const run = d.every((v, i) => i === 0 || v === d[i - 1] + 1);
  return run && d.length > 2 ? `${DOW[d[0]]}–${DOW[d[d.length - 1]]}` : d.map(x => DOW[x]).join(', ');
}

const toMinutes = (t) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
// Mirrors _hmu_slots_per_day: 1-hour slots between open and close, skipping any that touch lunch.
function hmuSlotsPerDay(open, close, ls, le){
  if (!open || !close) return 0;
  let n = 0;
  for (let t = toMinutes(open); t + 60 <= toMinutes(close); t += 60) {
    const end = t + 60;
    if (!ls || !le || !(t < toMinutes(le) && end > toMinutes(ls))) n++;
  }
  return n;
}

function hourOptions(sel, value, emptyText){
  const list = HMU_HOURS.slice();
  if (value && !list.includes(value)) { list.push(value); list.sort(); } // keep a stored half-hour
  sel.innerHTML = `<option value="">${escapeHtml(emptyText)}</option>` + list.map(t => `<option value="${t}">${escapeHtml(fmtClock(t))}</option>`).join('');
  sel.value = value || '';
}

function renderHmuBlocked(){
  $('hmuBlockList').innerHTML = hmuBlocked.length
    ? dayRanges(hmuBlocked).map(r => `<span class="date-chip">${escapeHtml(rangeLabel(r))}<button type="button" data-hmu-unblock="${r[0]}|${r[1]}" aria-label="Unblock ${escapeHtml(rangeLabel(r))}">×</button></span>`).join('')
    : '<span class="muted">No blocked dates.</span>';
}
$('hmuBlockAddBtn').addEventListener('click', () => {
  clearAlert('hmuAlert');
  const from = $('hmuBlockFrom').value;
  const to = $('hmuBlockTo').value || from;
  if (!from) { alertBox('hmuAlert', 'Pick the first blocked date.', 'error'); return; }
  if (to < from) { alertBox('hmuAlert', 'The "to" date must be on or after the first date.', 'error'); return; }
  const add = [];
  for (let d = from; d <= to && add.length <= 366; d = nextDay(d)) add.push(d);
  if (add.length > 366) { alertBox('hmuAlert', 'Block at most one year at a time.', 'error'); return; }
  hmuBlocked = [...new Set([...hmuBlocked, ...add])].sort();
  $('hmuBlockFrom').value = ''; $('hmuBlockTo').value = '';
  renderHmuBlocked();
});
$('hmuBlockList').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-hmu-unblock]');
  if (!btn) return;
  const [from, to] = btn.dataset.hmuUnblock.split('|');
  hmuBlocked = hmuBlocked.filter(d => d < from || d > to);
  renderHmuBlocked();
});

function fillHmuForm(){
  const school = $('hmuSchool').value;
  $('hmuForm').classList.toggle('disabled', !school);
  const row = hmuFor(school) || {};
  const linked = !!school && hmuLinked(school);
  $('hmuEnabled').checked = !!row.is_enabled;
  $('hmuMode').innerHTML = !school ? ''
    : linked ? '<span class="chip chip-approved">Linked to pictorial schedule</span>'
    : '<span class="chip chip-pending">Open schedule</span>';
  hourOptions($('hmuOpen'), hhmm(row.open_time), 'Select…');
  hourOptions($('hmuClose'), hhmm(row.close_time), 'Select…');
  hourOptions($('hmuLunchStart'), hhmm(row.lunch_start), 'No lunch');
  hourOptions($('hmuLunchEnd'), hhmm(row.lunch_end), 'No lunch');
  $('hmuStaff').value = row.school ? row.staff_count : 2; // the table's default
  $('hmuMax').value = row.max_per_day ?? '';
  $('hmuCutoff').value = row.cutoff_hours ?? 0;
  $('hmuStart').value = row.start_date || '';
  $('hmuEnd').value = row.end_date || '';
  const days = (row.days_of_week || [1, 2, 3, 4, 5, 6]).map(Number);
  document.querySelectorAll('#hmuDays input').forEach(cb => { cb.checked = days.includes(Number(cb.value)); });
  hmuBlocked = [...(row.blocked_dates || [])].sort();
  renderHmuBlocked();
  $('hmuDatesOpen').classList.toggle('hidden', !school || linked);
  $('hmuDatesLinked').classList.toggle('hidden', !linked);
  if (linked) {
    const p = pictorialFor(school);
    const nBlocked = (p.blocked_dates || []).length;
    $('hmuDatesLinked').innerHTML = `Dates follow the pictorial schedule (<strong>${escapeHtml(fmtDay(p.start_date, { weekday: undefined }))} – ${escapeHtml(fmtDay(p.end_date, { weekday: undefined }))}, ${escapeHtml(daysLabel(p.days_of_week))}</strong>)`
      + (nBlocked ? `, skipping its ${plural(nBlocked, 'blocked date')}` : '') + '. Change them in Slot Settings.';
  }
  $('hmuSaveBtn').disabled = !school;
  $('hmuGenBtn').disabled = !row.school;
  updateHmuCapacity();
}

function updateHmuCapacity(){
  const school = $('hmuSchool').value;
  const per = hmuSlotsPerDay($('hmuOpen').value, $('hmuClose').value, $('hmuLunchStart').value, $('hmuLunchEnd').value);
  const staffRaw = $('hmuStaff').value.trim();
  const staff = staffRaw === '' ? 0 : Number(staffRaw);
  const cap = Number.isInteger(staff) && staff > 0 ? staff * per : 0;
  $('hmuMax').disabled = !(per > 0 && cap > 0);
  if (!school) { $('hmuCapacity').textContent = '—'; return; }
  if (!per) { $('hmuCapacity').textContent = 'Set the opening and closing hours to see how many students fit per day.'; return; }
  $('hmuCapacity').innerHTML = `${plural(per, 'one-hour slot')} a day × ${Number.isInteger(staff) ? staff : 0} staff = <strong>${cap} students per day</strong>`
    + `<br><span class="preview-sub">Max possible: ${cap}${$('hmuMax').value ? ` · daily limit set to ${escapeHtml($('hmuMax').value)}` : ' · no daily limit'}</span>`;
}
$('hmuForm').addEventListener('input', updateHmuCapacity);
$('hmuForm').addEventListener('change', updateHmuCapacity);

function readHmuForm(){
  const school = $('hmuSchool').value;
  const linked = hmuLinked(school);
  const num = (id) => { const v = $(id).value.trim(); return v === '' ? null : Number(v); };
  const s = {
    school,
    is_enabled: $('hmuEnabled').checked,
    open_time: $('hmuOpen').value || null,
    close_time: $('hmuClose').value || null,
    lunch_start: $('hmuLunchStart').value || null,
    lunch_end: $('hmuLunchEnd').value || null,
    cutoff_hours: num('hmuCutoff') ?? 0,
    staff: num('hmuStaff'),
    max: num('hmuMax'),
    start_date: $('hmuStart').value || null,
    end_date: $('hmuEnd').value || null,
    days_of_week: [...document.querySelectorAll('#hmuDays input:checked')].map(cb => Number(cb.value)),
    blocked_dates: hmuBlocked.slice(),
  };
  let error = null;
  if (!school) error = 'Pick a school first.';
  else if (!!s.open_time !== !!s.close_time) error = 'Set both the opening and closing hours.';
  else if (s.open_time && toMinutes(s.close_time) <= toMinutes(s.open_time)) error = 'Closing time must be after opening time.';
  else if (s.is_enabled && !s.open_time) error = 'Set the HMU hours before turning HMU booking on.';
  else if (!!s.lunch_start !== !!s.lunch_end) error = 'Set both lunch start and lunch end, or leave both as “No lunch”.';
  else if (s.lunch_start && toMinutes(s.lunch_end) <= toMinutes(s.lunch_start)) error = 'Lunch end must be after lunch start.';
  else if (s.open_time && !hmuSlotsPerDay(s.open_time, s.close_time, s.lunch_start, s.lunch_end)) error = 'These hours give no 1-hour slots. Check the hours and lunch break.';
  else if (!(Number.isInteger(s.staff) && s.staff >= 0 && s.staff <= 50)) error = 'Enter the number of HMU staff (0 or more).';
  else if (s.max !== null && !(Number.isInteger(s.max) && s.max >= 1)) error = 'Max students per day must be a whole number of 1 or more, or empty for no limit.';
  else if (!(Number.isInteger(s.cutoff_hours) && s.cutoff_hours >= 0 && s.cutoff_hours <= 168)) error = 'Cutoff hours must be from 0 to 168.';
  else if (!linked && !!s.start_date !== !!s.end_date) error = 'Set both the start and end dates, or leave both empty.';
  else if (!linked && s.start_date && s.end_date < s.start_date) error = 'End date must be on or after the start date.';
  else if (!linked && s.start_date && !s.days_of_week.length) error = 'Pick at least one day of the week.';
  return { s, error, linked };
}

// Saves the form. Returns { name, notes[], warn } or null when something failed (message shown).
async function saveHmu(alertId){
  const { s, error, linked } = readHmuForm();
  if (error) { alertBox(alertId, escapeHtml(error), 'error'); return null; }
  const existing = hmuFor(s.school);
  const name = hmuSchoolName(s.school);
  const row = {
    school: name, is_enabled: s.is_enabled,
    open_time: s.open_time, close_time: s.close_time, lunch_start: s.lunch_start, lunch_end: s.lunch_end,
    cutoff_hours: s.cutoff_hours, updated_at: new Date().toISOString(),
  };
  // Dates are only used in open mode; a linked school keeps whatever was stored.
  if (!linked) Object.assign(row, { start_date: s.start_date, end_date: s.end_date, days_of_week: s.days_of_week, blocked_dates: s.blocked_dates });
  const { error: dbError } = await sb.from('hmu_settings').upsert(row, { onConflict: 'school' });
  if (dbError) { showErr(alertId, dbError, 'Could not save Hair & Makeup settings.'); return null; }

  const notes = [];
  let warn = false;
  if (!existing || Number(existing.staff_count) !== s.staff) {
    const { data, error: e1 } = await sb.rpc('staff_set_hmu_staff_count', { p_school: name, p_count: s.staff });
    if (e1) { showErr(alertId, e1, 'Settings saved, but the staff count could not be updated.'); await loadHmuSettings(); return null; }
    const r = data || {};
    notes.push(`Staff count set to ${s.staff}: ${r.daily_capacity ?? 0} students per day${r.updated_slots ? `, ${plural(r.updated_slots, 'upcoming slot')} updated` : ''}.`);
    if (existing && existing.max_per_day !== null && r.max_per_day !== null && r.max_per_day < existing.max_per_day) {
      notes.push(`The daily maximum was lowered to ${r.max_per_day} to fit.`);
    }
  }
  // Re-check the daily maximum after any hours or staff change, so a limit that no longer fits shows up.
  if (s.max !== null || (existing && existing.max_per_day !== null)) {
    const { data, error: e2 } = await sb.rpc('staff_set_hmu_max_per_day', { p_school: name, p_max: s.max });
    if (e2) { notes.push(escapeHtml(errText(e2))); warn = true; }
    else notes.push(s.max === null ? 'No daily limit.' : `Daily limit: ${data.max_per_day} of ${data.daily_capacity} possible.`);
  }
  await loadHmuSettings();
  fillSchoolSelects();
  $('hmuSchool').value = s.school;
  fillHmuForm();
  if (warn) { $('hmuMax').value = s.max ?? ''; updateHmuCapacity(); } // keep what the admin typed so they can fix it
  return { name, notes, warn };
}

$('hmuSchool').addEventListener('change', () => {
  clearAlert('hmuAlert');
  fillHmuForm();
  const row = hmuFor($('hmuSchool').value);
  if (row && $('hmuListSchool').value !== row.school) showHmuSchool(row.school);
});

$('hmuForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  clearAlert('hmuAlert');
  const btn = $('hmuSaveBtn');
  setBusy(btn, true, 'Saving…');
  const res = await saveHmu('hmuAlert');
  setBusy(btn, false);
  if (!res) return;
  alertBox('hmuAlert', `Hair &amp; Makeup settings saved for <strong>${escapeHtml(res.name)}</strong>.`
    + (res.notes.length ? ' ' + res.notes.join(' ') : '')
    + ($('hmuEnabled').checked ? '' : ' HMU booking is <strong>off</strong>, so students don’t see it.')
    + ' If you changed the hours or dates, press <strong>Generate / Rebuild HMU slots</strong>.', res.warn ? 'warn' : 'success');
});

$('hmuGenBtn').addEventListener('click', () => {
  clearAlert('hmuAlert');
  const { s, error, linked } = readHmuForm();
  if (error) { alertBox('hmuAlert', escapeHtml(error), 'error'); return; }
  openDialog({
    title: 'Generate HMU slots?',
    body: `<p>This saves the Hair &amp; Makeup settings for <strong>${escapeHtml(s.school)}</strong>, then:</p>
      <ul class="dialog-list">
        <li>removes upcoming HMU slots nobody has booked,</li>
        <li>makes 1-hour HMU slots from ${linked ? 'the <strong>pictorial schedule’s dates</strong>' : 'the HMU dates'} and these hours,</li>
        <li>keeps every student who already booked HMU.</li>
      </ul>
      <div class="preview-box">${$('hmuCapacity').innerHTML}</div>`,
    okText: 'Save & generate',
    onOk: async () => {
      const saved = await saveHmu('dialogAlert');
      if (!saved) return false;
      const { data, error: rpcError } = await sb.rpc('staff_generate_hmu_slots', { p_school: saved.name });
      if (rpcError) { showErr('dialogAlert', rpcError); return false; }
      const r = data || {};
      let html = `HMU slots ready for <strong>${escapeHtml(saved.name)}</strong> (${r.mode === 'linked' ? 'linked to pictorial' : 'open schedule'}): `
        + `<strong>${plural(r.slots, 'upcoming slot')}</strong> made or updated, ${plural(r.removed, 'unbooked old slot')} removed.`;
      if (r.closed_leftovers) html += ` Closed ${plural(r.closed_leftovers, 'booked slot')} outside the new schedule. Those students stay booked; check the HMU list.`;
      if (saved.notes.length) html += '<br>' + saved.notes.join(' ');
      if (!r.slots) html += '<br>No slots were made. Check that the dates are in the future and the days of the week are right.';
      alertBox('hmuAlert', html, saved.warn || r.closed_leftovers || !r.slots ? 'warn' : 'success');
      showHmuSchool(saved.name);
      return true;
    },
  });
});

/* ---- HMU list (same layout as Slots: day strip, then one table per school) ---- */
let hmuSlotRows = [];   // every HMU slot for the chosen school, or all schools (all dates)
let hmuDays = [];       // sorted 'YYYY-MM-DD' days that have HMU slots
let hmuDay = null;      // the day on screen
let hmuListRows = [];   // HMU bookings on hmuDay

// Show a school's HMU list from its first upcoming day.
function showHmuSchool(school){
  $('hmuListSchool').value = school;
  hmuDay = null;
  loadHmuList();
}

async function loadHmuList(){
  const seq = nextSeq('hmuList');
  const school = $('hmuListSchool').value || null;
  if (!hmuSlotRows.length) $('hmuList').innerHTML = '<div class="empty">Loading…</div>';
  const { data, error } = await fetchAll(() => {
    const q = sb.from('hmu_slots').select('id, school, slot_start, slot_end, capacity, booked_count, is_closed').order('slot_start');
    return school ? q.eq('school', school) : q;
  });
  if (seq !== loadSeq.hmuList) return;
  if (error) { showErr('hmuListAlert', error, 'Could not load HMU slots.'); $('hmuList').innerHTML = ''; return; }
  hmuSlotRows = data || [];
  hmuDays = [...new Set(hmuSlotRows.map(s => manilaDay(s.slot_start)))].sort();
  // Keep the chosen day; otherwise today, else the next day with slots, else the last one.
  const today = todayManila();
  if (!hmuDay) hmuDay = hmuDays.find(d => d >= today) || hmuDays[hmuDays.length - 1] || null;
  await showHmuDay(hmuDay, { keepScroll: true });
}

async function showHmuDay(day, opts){
  hmuDay = day;
  $('hmuListDate').value = day || '';
  hmuListRows = [];
  paintDayStrip({
    strip: $('hmuDayStrip'), prev: $('hmuPrevDay'), next: $('hmuNextDay'),
    days: hmuDays, slots: hmuSlotRows, active: day, keepScroll: opts && opts.keepScroll,
    empty: 'No HMU slots yet. Generate them in the settings above.',
  });
  renderHmuList();
  if (!day) return;
  const seq = nextSeq('hmuDay');
  const { data, error } = await fetchAll(() => sb.rpc('staff_list_hmu_bookings', { p_school: $('hmuListSchool').value || null, p_day: day }));
  if (seq !== loadSeq.hmuDay || day !== hmuDay) return;
  if (error) { showErr('hmuListAlert', error, 'Could not load HMU bookings.'); return; }
  hmuListRows = data || [];
  renderHmuList();
}

const holdsSeat = (b) => b.status === 'booked' || b.status === 'completed';

function hmuPersonHtml(b){
  const off = b.status === 'cancelled' || b.status === 'no_show';
  return `
    <div class="hmu-person${off ? ' is-off' : ''}">
      <div><strong>${escapeHtml(b.full_name || '—')}</strong> <span class="muted">${escapeHtml(b.username)}</span>${b.status === 'booked' ? '' : ' ' + chip(b.status)}</div>
      ${b.pictorial_start ? `<div class="muted">Pictorial ${escapeHtml(fmtTime(b.pictorial_start))}</div>` : ''}
      ${b.status === 'needs_rebook' ? '<div class="muted">Pictorial changed. Ask the student to pick a new HMU time.</div>' : ''}
      ${b.status === 'booked' ? `
      <div class="row-actions">
        <button type="button" class="btn-link" data-hmu-status="completed" data-id="${b.id}">Completed</button>
        <button type="button" class="btn-link" data-hmu-status="no_show" data-id="${b.id}">No-show</button>
        <button type="button" class="btn-link danger" data-hmu-status="cancelled" data-id="${b.id}">Cancel</button>
      </div>` : ''}
    </div>`;
}

function renderHmuList(){
  const day = hmuDay;
  if (!day) {
    $('hmuListSummary').textContent = '';
    $('hmuList').innerHTML = '<div class="empty">No HMU slots yet. Generate them in the settings above.</div>';
    return;
  }
  const title = escapeHtml(fmtDay(day, { weekday: 'long', month: 'long', year: 'numeric' }));
  const slots = hmuSlotRows.filter(s => manilaDay(s.slot_start) === day);
  const booked = slots.reduce((a, s) => a + s.booked_count, 0);
  const open = slots.reduce((a, s) => a + (s.is_closed ? 0 : Math.max(s.capacity - s.booked_count, 0)), 0);
  const rebook = hmuListRows.filter(b => b.status === 'needs_rebook').length;
  $('hmuListSummary').innerHTML = slots.length
    ? `<span><strong>${slots.length}</strong> slots</span><span><strong>${booked}</strong> booked</span><span><strong>${open}</strong> open seats</span>`
      + (rebook ? `<span>${chip('needs_rebook')} ${rebook}</span>` : '')
    : '';
  const schools = [...new Set([...slots.map(s => s.school), ...hmuListRows.map(b => b.school)])].sort((a, b) => a.localeCompare(b));
  if (!schools.length) {
    $('hmuList').innerHTML = `<div class="day-card"><div class="day-head"><div><strong>${title}</strong></div></div>
      <div class="empty flat">No HMU slots on this day.</div></div>`;
    return;
  }
  $('hmuList').innerHTML = schools.map(school => {
    const list = slots.filter(s => s.school === school);
    const rows = hmuListRows.filter(b => b.school === school);
    const at = (iso) => new Date(iso).getTime();
    const slotTimes = new Set(list.map(s => at(s.slot_start)));
    // Bookings whose slot is not in the list (e.g. a closed leftover) get their own rows at the end.
    const others = rows.filter(b => !slotTimes.has(at(b.hmu_start)));
    const h = hmuFor(school) || {};
    const cap = list.reduce((a, s) => a + (s.is_closed ? 0 : s.capacity), 0);
    const limit = h.max_per_day ? `${h.max_per_day} max per day` : `${cap} daily capacity`;
    return `
      <div class="day-card">
        <div class="day-head">
          <div><strong>${title}</strong> <span class="muted">${escapeHtml(school)} · ${hmuLinked(school) ? 'Linked to pictorial' : 'Open schedule'}</span></div>
          <div><strong>${rows.filter(holdsSeat).length}</strong> booked / ${escapeHtml(limit)}</div>
        </div>
        <table class="table slot-table">
          <thead><tr><th>Time</th><th>Booked students</th><th>Capacity</th><th>Left</th><th>Status</th><th></th></tr></thead>
          <tbody>${list.map(s => {
            const people = rows.filter(b => at(b.hmu_start) === at(s.slot_start));
            return `
            <tr class="${s.is_closed ? 'row-closed' : ''}">
              <td data-label="Time"><strong>${escapeHtml(fmtRange(s.slot_start, s.slot_end))}</strong></td>
              <td data-label="Booked students">${people.length ? people.map(hmuPersonHtml).join('') : '<span class="muted">—</span>'}</td>
              <td data-label="Capacity"><span class="cap-edit"><input type="number" min="${s.booked_count}" max="50" value="${s.capacity}" data-hmu-cap-input="${s.id}" aria-label="Capacity"><button type="button" class="btn-link" data-hmu-cap-save="${s.id}">Save</button></span></td>
              <td data-label="Left">${Math.max(s.capacity - s.booked_count, 0)}</td>
              <td data-label="Status">${slotStatusChip(s)}</td>
              <td><div class="row-actions">
                <button type="button" class="btn-link" data-hmu-slot-toggle="${s.id}">${s.is_closed ? 'Reopen' : 'Close'}</button>
                ${!s.booked_count && !people.length ? `<button type="button" class="btn-link danger" data-hmu-slot-del="${s.id}">Delete</button>` : ''}
              </div></td>
            </tr>`; }).join('')}
          ${others.map(b => `
            <tr>
              <td data-label="Time"><strong>${escapeHtml(fmtRange(b.hmu_start, b.hmu_end))}</strong><div class="muted">Not in the current slots</div></td>
              <td data-label="Booked students">${hmuPersonHtml(b)}</td>
              <td data-label="Capacity">—</td><td data-label="Left">—</td><td data-label="Status">—</td><td></td>
            </tr>`).join('')}
          </tbody>
        </table>
      </div>`;
  }).join('');
}

const HMU_STATUS_CONFIRM = {
  completed: { title: 'Mark HMU as completed?', text: 'Use this after the student’s hair and makeup is done.', ok: 'Mark completed' },
  no_show: { title: 'Mark HMU as no-show?', text: 'The seat is released back to the HMU slot.', ok: 'Mark no-show', danger: true },
  cancelled: { title: 'Cancel this HMU booking?', text: 'The seat is released back to the HMU slot. The student can book HMU again.', ok: 'Cancel HMU', danger: true },
};
// Change one HMU slot (capacity and/or closed). Returns false when it failed.
async function updateHmuSlot(slot, changes, alertId){
  const { error } = await sb.rpc('staff_update_hmu_slot', { p_slot_id: slot.id, ...changes });
  if (error) { showErr(alertId, error); if (error.message === 'slot_not_found') loadHmuList(); return false; }
  loadHmuList();
  return true;
}

$('hmuList').addEventListener('click', async (e) => {
  const capBtn = e.target.closest('[data-hmu-cap-save]');
  if (capBtn) {
    clearAlert('hmuListAlert');
    const slot = hmuSlotRows.find(s => s.id === capBtn.dataset.hmuCapSave);
    const val = Number(document.querySelector(`[data-hmu-cap-input="${slot.id}"]`).value);
    if (!Number.isInteger(val) || val < 0) { alertBox('hmuListAlert', 'Enter a capacity of 0 or more.', 'error'); return; }
    capBtn.disabled = true;
    const ok = await updateHmuSlot(slot, { p_capacity: val }, 'hmuListAlert');
    capBtn.disabled = false;
    if (ok) alertBox('hmuListAlert', `The ${escapeHtml(fmtRange(slot.slot_start, slot.slot_end))} HMU slot now takes ${plural(val, 'student')}.`, 'success');
    return;
  }
  const toggleBtn = e.target.closest('[data-hmu-slot-toggle]');
  if (toggleBtn) {
    clearAlert('hmuListAlert');
    const slot = hmuSlotRows.find(s => s.id === toggleBtn.dataset.hmuSlotToggle);
    const closing = !slot.is_closed;
    const when = escapeHtml(fmtRange(slot.slot_start, slot.slot_end));
    const run = async (alertId) => {
      const ok = await updateHmuSlot(slot, { p_is_closed: closing }, alertId);
      if (ok) alertBox('hmuListAlert', closing ? `The ${when} HMU slot is closed. Students can no longer book it.` : `The ${when} HMU slot is open again.`, 'success');
      return ok;
    };
    if (closing && slot.booked_count) {
      openDialog({
        title: 'Close this HMU slot?',
        body: `<p>${plural(slot.booked_count, 'student')} ${slot.booked_count === 1 ? 'is' : 'are'} booked at ${when}. Closing stops new bookings but does <strong>not</strong> cancel them.</p>`,
        okText: 'Close slot', danger: true, onOk: () => run('dialogAlert'),
      });
    } else run('hmuListAlert');
    return;
  }
  const delBtn = e.target.closest('[data-hmu-slot-del]');
  if (delBtn) {
    clearAlert('hmuListAlert');
    const slot = hmuSlotRows.find(s => s.id === delBtn.dataset.hmuSlotDel);
    openDialog({
      title: 'Delete this HMU slot?',
      body: `<p><strong>${escapeHtml(slot.school)}</strong> · HMU ${escapeHtml(fmtWhen(slot.slot_start))} will be removed. Students will no longer see it.</p><p class="muted">This can’t be undone. “Generate / Rebuild HMU slots” will create it again if the date is still in range.</p>`,
      okText: 'Delete slot', danger: true,
      onOk: async () => {
        const { error } = await sb.rpc('staff_delete_hmu_slot', { p_slot_id: slot.id });
        if (error) { showErr('dialogAlert', error); if (STALE_SLOT_ERRORS.includes(error.message)) loadHmuList(); return false; }
        alertBox('hmuListAlert', `Deleted the ${escapeHtml(fmtRange(slot.slot_start, slot.slot_end))} HMU slot.`, 'success');
        loadHmuList();
        return true;
      },
    });
    return;
  }
  const btn = e.target.closest('[data-hmu-status]');
  if (!btn) return;
  clearAlert('hmuListAlert');
  const b = hmuListRows.find(r => r.id === btn.dataset.id);
  const status = btn.dataset.hmuStatus;
  const cfg = HMU_STATUS_CONFIRM[status];
  openDialog({
    title: cfg.title,
    body: `<p><strong>${escapeHtml(b.full_name || b.username)}</strong> · HMU ${escapeHtml(fmtWhen(b.hmu_start))}</p><p class="muted">${cfg.text}</p>`,
    okText: cfg.ok, danger: cfg.danger,
    onOk: async () => {
      const { error } = await sb.rpc('staff_set_hmu_booking_status', { p_id: b.id, p_status: status });
      if (error) { showErr('dialogAlert', error); if (error.message === 'booking_not_active') loadHmuList(); return false; }
      alertBox('hmuListAlert', `${escapeHtml(b.full_name || b.username)}’s HMU marked as <strong>${escapeHtml(STATUS_LABEL[status])}</strong>.`, 'success');
      loadHmuList();
      return true;
    },
  });
});

$('hmuListLoadBtn').addEventListener('click', () => { clearAlert('hmuListAlert'); loadHmuList(); });
$('hmuListSchool').addEventListener('change', () => { clearAlert('hmuListAlert'); showHmuSchool($('hmuListSchool').value); });
$('hmuDayStrip').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-strip-day]');
  if (btn) { clearAlert('hmuListAlert'); showHmuDay(btn.dataset.stripDay); }
});
$('hmuPrevDay').addEventListener('click', () => { const i = hmuDays.indexOf(hmuDay); if (i > 0) showHmuDay(hmuDays[i - 1]); });
$('hmuNextDay').addEventListener('click', () => { const i = hmuDays.indexOf(hmuDay); if (i >= 0 && i < hmuDays.length - 1) showHmuDay(hmuDays[i + 1]); });
$('hmuListDate').addEventListener('change', () => { if ($('hmuListDate').value) { clearAlert('hmuListAlert'); showHmuDay($('hmuListDate').value); } });
$('hmuListTodayBtn').addEventListener('click', () => { clearAlert('hmuListAlert'); showHmuDay(todayManila()); });

// CSV of HMU bookings for the chosen school (or all schools): one day, or every date.
async function downloadHmuCsv(btn, allDates){
  clearAlert('hmuListAlert');
  const school = $('hmuListSchool').value || null;
  const day = allDates ? null : $('hmuListDate').value;
  if (!allDates && !day) { alertBox('hmuListAlert', 'Pick a date first.', 'error'); return; }
  setBusy(btn, true, 'Preparing…');
  const { data, error } = await fetchAll(() => sb.rpc('staff_list_hmu_bookings', { p_school: school, p_day: day }));
  setBusy(btn, false);
  if (error) { showErr('hmuListAlert', error, 'Could not load HMU bookings.'); return; }
  const rows = data || [];
  if (!rows.length) { alertBox('hmuListAlert', allDates ? 'No HMU bookings to download.' : 'No HMU bookings on this day.', 'error'); return; }
  const name = (school || 'all-schools').replace(/[^\w.-]+/g, '_');
  downloadCsv(`hmu-${name}-${allDates ? 'all-dates' : day}.csv`,
    ['Date', 'HMU Time', 'Full Name', 'Username', 'School', 'Pictorial', 'Status'],
    rows.map(b => [manilaDay(b.hmu_start), fmtRange(b.hmu_start, b.hmu_end), b.full_name, b.username, b.school,
      b.pictorial_start ? fmtWhen(b.pictorial_start) : '', STATUS_LABEL[b.status] || b.status]));
}
$('hmuCsvDayBtn').addEventListener('click', (e) => downloadHmuCsv(e.currentTarget, false));
$('hmuCsvAllBtn').addEventListener('click', (e) => downloadHmuCsv(e.currentTarget, true));

PAGE_LOADERS.hmu = async () => {
  clearAlert('hmuListAlert');
  if (!(await loadHmuSettings())) return;
  fillSchoolSelects();
  fillHmuForm();
  loadHmuList();
};

/* ================================================================
   STUDENT ACTIVITY (self-service book / reschedule / cancel log)
   + older approval-style requests, shown only while any are pending
   ================================================================ */
let requestRows = [];
let activityRows = [];

// The badge counts activity since this staff member last opened the tab (kept per browser),
// plus any older requests still waiting for a decision.
function seenKey(){ return 'gps-staff-activity-seen:' + ((currentStaff && currentStaff.email) || ''); }
function getSeen(){ try { return localStorage.getItem(seenKey()) || ''; } catch (e) { return ''; } }
function markSeen(){ try { localStorage.setItem(seenKey(), new Date().toISOString()); } catch (e) {} }

async function refreshRequestBadge(){
  const [pending, recent] = await Promise.all([
    sb.rpc('staff_list_requests', { p_status: 'pending' }),
    sb.rpc('staff_list_events', { p_school: null, p_limit: 200 }),
  ]);
  const seen = getSeen();
  const fresh = (recent.data || []).filter(e => !seen || e.created_at > seen).length;
  const n = (pending.data || []).length + fresh;
  $('reqBadge').textContent = n > 99 ? '99+' : n;
  $('reqBadge').classList.toggle('hidden', !n);
}

const EVENT_LABEL = { booked: 'Booked', rescheduled: 'Rescheduled', cancelled: 'Cancelled' };
function eventChange(e){
  if (e.event === 'booked') return `Booked <strong>${escapeHtml(fmtWhen(e.to_slot_start))}</strong>`;
  if (e.event === 'cancelled') return `Cancelled <strong>${escapeHtml(fmtWhen(e.from_slot_start))}</strong>`;
  return `${escapeHtml(fmtWhen(e.from_slot_start))} → <strong>${escapeHtml(fmtWhen(e.to_slot_start))}</strong>`;
}
function filteredActivity(){
  const type = $('actType').value;
  const q = $('actSearch').value.trim().toLowerCase();
  return activityRows.filter(e => (!type || e.event === type)
    && (!q || (e.full_name || '').toLowerCase().includes(q) || (e.student_username || '').toLowerCase().includes(q)));
}
function renderActivity(){
  const rows = filteredActivity();
  const seen = getSeen();
  $('activityList').innerHTML = rows.length ? `
    <div class="table-wrap"><table class="table">
      <thead><tr><th>When</th><th>Student</th><th>Change</th><th>School</th></tr></thead>
      <tbody>${rows.map(e => `
        <tr class="${seen && e.created_at > seen ? 'row-new' : ''}">
          <td data-label="When">${escapeHtml(fmtWhen(e.created_at))}</td>
          <td data-label="Student"><strong>${escapeHtml(e.full_name || e.student_username)}</strong><div class="muted">${escapeHtml(e.student_username)}${e.contact ? ' · ' + escapeHtml(e.contact) : ''}</div></td>
          <td data-label="Change"><span class="chip chip-ev-${e.event}">${EVENT_LABEL[e.event] || escapeHtml(e.event)}</span><div class="ev-change">${eventChange(e)}</div></td>
          <td data-label="School">${escapeHtml(e.school_name)}</td>
        </tr>`).join('')}
      </tbody>
    </table></div>` : '<div class="empty">No student activity yet.</div>';
}

async function loadActivity(){
  const seq = nextSeq('activity');
  if (!activityRows.length) $('activityList').innerHTML = '<div class="empty">Loading…</div>';
  const { data, error } = await sb.rpc('staff_list_events', { p_school: $('actSchool').value || null, p_limit: 1000 });
  if (seq !== loadSeq.activity) return;
  if (error) { showErr('requestsAlert', error, 'Could not load student activity.'); $('activityList').innerHTML = ''; return; }
  activityRows = data || [];
  renderActivity();
}

$('actSchool').addEventListener('change', () => { clearAlert('requestsAlert'); activityRows = []; loadActivity(); });
$('actType').addEventListener('change', renderActivity);
$('actSearch').addEventListener('input', renderActivity);
$('actCsvBtn').addEventListener('click', () => {
  const rows = filteredActivity();
  if (!rows.length) { alertBox('requestsAlert', 'Nothing to download.', 'error'); return; }
  downloadCsv(`student-activity-${todayManila()}.csv`, ['When', 'Full Name', 'Username', 'Contact', 'School', 'Change', 'From', 'To'],
    rows.map(e => [fmtWhen(e.created_at), e.full_name, e.student_username, e.contact, e.school_name, EVENT_LABEL[e.event] || e.event,
      e.from_slot_start ? fmtWhen(e.from_slot_start) : '', e.to_slot_start ? fmtWhen(e.to_slot_start) : '']));
});

async function loadRequests(){
  loadActivity();
  const seq = nextSeq('requests');
  const status = $('reqStatus').value || null;
  const { data, error } = await fetchAll(() => sb.rpc('staff_list_requests', { p_status: status }));
  if (seq !== loadSeq.requests) return;
  if (error) { showErr('requestsAlert', error, 'Could not load requests.'); $('requestsList').innerHTML = ''; return; }
  requestRows = data || [];
  $('legacyRequests').classList.toggle('hidden', !requestRows.length);
  markSeen();
  refreshRequestBadge();
  if (!requestRows.length) { $('requestsList').innerHTML = ''; return; }
  $('requestsList').innerHTML = requestRows.map(r => `
    <div class="req-card">
      <div class="req-head">
        <div><span class="chip chip-${r.request_type === 'cancel' ? 'cancelled' : 'booked'}">${r.request_type === 'cancel' ? 'Cancel' : 'Reschedule'}</span> ${chip(r.request_status)}</div>
        <span class="muted">Sent ${escapeHtml(fmtWhen(r.requested_at))}</span>
      </div>
      <div class="req-student"><strong>${escapeHtml(r.full_name || r.student_username)}</strong> <span class="muted">${escapeHtml(r.student_username)}${r.contact ? ' · ' + escapeHtml(r.contact) : ''}</span></div>
      <div class="req-grid">
        <div><div class="label">Current schedule</div>${escapeHtml(fmtWhen(r.current_slot_start))}</div>
        ${r.request_type === 'reschedule' ? `<div><div class="label">Requested</div>${escapeHtml(fmtWhen(r.requested_slot_start))}${r.request_status === 'pending' && r.requested_slots_left !== null ? ` <span class="${r.requested_slots_left > 0 ? 'muted' : 'danger-text'}">(${r.requested_slots_left} left)</span>` : ''}</div>` : ''}
      </div>
      ${r.reason ? `<div class="req-reason"><div class="label">Reason</div>${escapeHtml(r.reason)}</div>` : ''}
      ${r.staff_note ? `<div class="req-reason"><div class="label">Staff note</div>${escapeHtml(r.staff_note)}</div>` : ''}
      ${r.request_status === 'pending' ? `
        <div class="actions">
          <button type="button" class="btn btn-primary btn-inline btn-sm" data-req-approve="${r.request_id}">Approve</button>
          <button type="button" class="btn btn-ghost btn-inline btn-sm" data-req-reject="${r.request_id}">Reject</button>
        </div>` : ''}
    </div>`).join('');
}

$('reqLoadBtn').addEventListener('click', () => { clearAlert('requestsAlert'); loadRequests(); });

$('requestsList').addEventListener('click', async (e) => {
  const approveBtn = e.target.closest('[data-req-approve]');
  const rejectBtn = e.target.closest('[data-req-reject]');
  if (!approveBtn && !rejectBtn) return;
  clearAlert('requestsAlert');
  const r = requestRows.find(x => x.request_id === (approveBtn || rejectBtn).dataset[approveBtn ? 'reqApprove' : 'reqReject']);
  const who = escapeHtml(r.full_name || r.student_username);
  const noteField = '<div class="field"><label for="reqNote">Note (optional, kept with the request)</label><textarea id="reqNote" rows="2" maxlength="500"></textarea></div>';

  const resolve = async (approve, newSlotId) => {
    const { error } = await sb.rpc('staff_resolve_request', {
      p_request_id: r.request_id, p_approve: approve, p_note: $('reqNote').value.trim() || null, p_new_slot_id: newSlotId || null,
    });
    if (error) { showErr('dialogAlert', error); if (error.message === 'request_not_pending' || error.message === 'booking_not_active') loadRequests(); return false; }
    alertBox('requestsAlert', `${approve ? 'Approved' : 'Rejected'} ${who}’s ${r.request_type} request.`, 'success');
    loadRequests();
    return true;
  };

  if (rejectBtn) {
    openDialog({ title: 'Reject request?', body: `<p>${who} keeps their current schedule (${escapeHtml(fmtWhen(r.current_slot_start))}).</p>` + noteField, okText: 'Reject', danger: true, onOk: () => resolve(false) });
    return;
  }

  if (r.request_type === 'cancel') {
    openDialog({ title: 'Approve cancellation?', body: `<p>${who}’s booking on ${escapeHtml(fmtWhen(r.current_slot_start))} will be cancelled and the seat released. They can book again later.</p>` + noteField, okText: 'Approve & cancel booking', danger: true, onOk: () => resolve(true) });
    return;
  }

  // Reschedule: default to the slot the student asked for, but staff may pick another.
  let school = null;
  if (r.requested_slot_id) {
    const { data } = await sb.from('time_slots').select('school').eq('id', r.requested_slot_id).maybeSingle();
    school = data && data.school;
  }
  const res = school ? await openSlotsFor(school) : { slots: [] };
  if (res.error) { showErr('requestsAlert', res.error); return; }
  const slots = res.slots.filter(s => new Date(s.slot_start).getTime() !== new Date(r.current_slot_start).getTime());
  const requestedOpen = slots.some(s => s.id === r.requested_slot_id);
  openDialog({
    title: 'Approve reschedule?',
    body: `<p>${who}: ${escapeHtml(fmtWhen(r.current_slot_start))} → new slot below.</p>` +
      (requestedOpen ? '' : '<div class="alert alert-error">The slot the student asked for is full or closed. Pick another one.</div>') +
      (slots.length ? `<div class="field"><label for="approveSlot">New slot</label><select id="approveSlot">${slotOptions(slots, r.requested_slot_id)}</select></div>` : '<div class="empty">No open slots with seats left. Reject the request or add capacity first.</div>') +
      noteField,
    okText: 'Approve & move',
    onOk: async () => {
      if (!$('approveSlot')) { alertBox('dialogAlert', 'There is no open slot to move the student to.', 'error'); return false; }
      return resolve(true, $('approveSlot').value);
    },
  });
});

PAGE_LOADERS.requests = () => { clearAlert('requestsAlert'); loadRequests(); };

/* ================================================================
   UNBOOKED STUDENTS
   ================================================================ */
let unbookedRows = [];

async function loadUnbooked(){
  clearAlert('unbookedAlert');
  const school = $('ubSchool').value;
  if (!school) { $('unbookedTable').innerHTML = '<tbody><tr><td class="empty">Pick a school.</td></tr></tbody>'; $('unbookedSummary').textContent = ''; return; }
  $('unbookedTable').innerHTML = '<tbody><tr><td class="empty">Loading…</td></tr></tbody>';
  const seq = nextSeq('unbooked');
  const { data, error } = await fetchAll(() => sb.rpc('staff_unbooked_students', { p_school: school }));
  if (seq !== loadSeq.unbooked) return;
  if (error) { showErr('unbookedAlert', error, 'Could not load students.'); $('unbookedTable').innerHTML = ''; return; }
  unbookedRows = data || [];
  $('unbookedSummary').innerHTML = `<span><strong>${unbookedRows.length}</strong> student${unbookedRows.length === 1 ? '' : 's'} without a booking</span>`;
  $('unbookedTable').innerHTML = unbookedRows.length ? `
    <thead><tr><th>Full name</th><th>Username</th><th>Contact</th><th>Email</th></tr></thead>
    <tbody>${unbookedRows.map(s => `
      <tr><td data-label="Full name"><strong>${escapeHtml(s.full_name)}</strong></td><td data-label="Username">${escapeHtml(s.student_username)}</td><td data-label="Contact">${escapeHtml(s.contact || '—')}</td><td data-label="Email">${escapeHtml(s.email || '—')}</td></tr>`).join('')}
    </tbody>` : '<tbody><tr><td class="empty">Every registered student of this school has a booking.</td></tr></tbody>';
}
$('ubLoadBtn').addEventListener('click', loadUnbooked);
$('ubSchool').addEventListener('change', loadUnbooked);
$('unbookedCsvBtn').addEventListener('click', () => {
  if (!unbookedRows.length) { alertBox('unbookedAlert', 'Nothing to download. Load a school first.', 'error'); return; }
  downloadCsv(`unbooked-${$('ubSchool').value.replace(/[^\w.-]+/g, '_')}-${todayManila()}.csv`,
    ['Full Name', 'Username', 'Contact', 'Email'], unbookedRows.map(s => [s.full_name, s.student_username, s.contact, s.email]));
});
PAGE_LOADERS.unbooked = () => { if ($('ubSchool').value) loadUnbooked(); };

/* ================================================================
   ANNOUNCEMENTS
   ================================================================ */
let annRows = [];

async function loadAnnouncements(){
  const { data, error } = await sb.from('announcements').select('id, title, body, is_pinned, created_at, school')
    .order('is_pinned', { ascending: false }).order('created_at', { ascending: false });
  if (error) { showErr('annAlert', error, 'Could not load announcements.'); return; }
  annRows = data || [];
  renderAnnouncements();
}

function renderAnnouncements(){
  const f = $('annFilter').value;
  const rows = f === '*' ? annRows : annRows.filter(a => f === '' ? !a.school : (a.school || '').toLowerCase() === f.toLowerCase());
  $('annList').innerHTML = rows.length ? rows.map(a => `
    <div class="ann-card">
      <div class="req-head">
        <div>${a.is_pinned ? '<span class="chip chip-booked">Pinned</span> ' : ''}<span class="chip ${a.school ? 'chip-pending' : 'chip-approved'}">${escapeHtml(a.school || 'All schools')}</span></div>
        <span class="muted">${escapeHtml(fmtWhen(a.created_at))}</span>
      </div>
      <h3 class="ann-title">${escapeHtml(a.title)}</h3>
      <div class="ann-body">${escapeHtml(a.body)}</div>
      <div class="row-actions">
        <button type="button" class="btn-link" data-ann-pin="${a.id}" data-pinned="${a.is_pinned}">${a.is_pinned ? 'Unpin' : 'Pin'}</button>
        <button type="button" class="btn-link danger" data-ann-del="${a.id}">Delete</button>
      </div>
    </div>`).join('') : '<div class="empty">No announcements here yet.</div>';
}

$('annFilter').addEventListener('change', renderAnnouncements);

$('annForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  clearAlert('annAlert');
  const title = $('annTitle').value.trim();
  const body = $('annBody').value.trim();
  if (!title || !body) { alertBox('annAlert', 'Title and message are required.', 'error'); return; }
  const btn = $('annSubmit');
  setBusy(btn, true, 'Posting…');
  const { error } = await sb.from('announcements').insert({ title, body, is_pinned: $('annPinned').checked, school: $('annSchool').value || null });
  setBusy(btn, false);
  if (error) { showErr('annAlert', error, 'Could not post the announcement.'); return; }
  $('annForm').reset();
  alertBox('annAlert', 'Announcement posted.', 'success');
  loadAnnouncements();
});

$('annList').addEventListener('click', async (e) => {
  const pinBtn = e.target.closest('[data-ann-pin]');
  const delBtn = e.target.closest('[data-ann-del]');
  clearAlert('annAlert');
  if (pinBtn) {
    const { error } = await sb.from('announcements').update({ is_pinned: pinBtn.dataset.pinned !== 'true' }).eq('id', pinBtn.dataset.annPin);
    if (error) { showErr('annAlert', error); return; }
    loadAnnouncements();
    return;
  }
  if (delBtn) {
    const a = annRows.find(x => x.id === delBtn.dataset.annDel);
    openDialog({
      title: 'Delete announcement?',
      body: `<p><strong>${escapeHtml(a.title)}</strong> will be removed from every student’s portal. This can’t be undone.</p>`,
      okText: 'Delete', danger: true,
      onOk: async () => {
        const { error } = await sb.from('announcements').delete().eq('id', a.id);
        if (error) { showErr('dialogAlert', error); return false; }
        alertBox('annAlert', 'Announcement deleted.', 'success');
        loadAnnouncements();
        return true;
      },
    });
  }
});

PAGE_LOADERS.announcements = loadAnnouncements;

/* -------------------- bootstrap -------------------- */
(async function init(){
  const staff = await checkStaff();
  if (staff) enterDashboard(staff);
  else { await sb.auth.signOut(); showLogin(); }
})();
