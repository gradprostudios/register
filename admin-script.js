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
  invalid_status: 'Invalid booking status.',
  slot_full: 'The chosen slot is already full.',
  slot_unavailable: 'The chosen slot is closed or already in the past.',
  wrong_school: 'The chosen slot belongs to a different school.',
  same_slot: 'The student is already booked in that slot.',
  no_target_slot: 'Pick a slot to move the student to.',
};
function errText(error, fallback){
  const m = (error && error.message) || '';
  return ERROR_TEXT[m] || m || fallback || 'Something went wrong. Please try again.';
}
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
const STATUS_LABEL = { booked: 'Booked', completed: 'Completed', no_show: 'No-show', cancelled: 'Cancelled', pending: 'Pending', approved: 'Approved', rejected: 'Rejected' };
function chip(status){ return `<span class="chip chip-${escapeHtml(status)}">${escapeHtml(STATUS_LABEL[status] || status)}</span>`; }

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
const TURNSTILE_SITE_KEY = "0x4AAAAAAD4Y5yYW8B-1flNT";
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
        <td><button type="button" class="btn-link" data-edit-school="${escapeHtml(r.school)}">Edit</button></td>
      </tr>`).join('')}
    </tbody>`;
}
$('settingsTable').addEventListener('click', (e) => {
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

function renderDayStrip(keepScroll){
  const strip = $('slotDayStrip');
  const blocked = (settingsFor($('slotSchool').value) || {}).blocked_dates || [];
  const byDay = {};
  slotRows.forEach(s => { (byDay[manilaDay(s.slot_start)] = byDay[manilaDay(s.slot_start)] || []).push(s); });
  const today = todayManila();
  strip.innerHTML = slotDays.length ? slotDays.map(d => {
    const list = byDay[d] || [];
    const booked = list.reduce((a, s) => a + s.booked_count, 0);
    const cap = list.reduce((a, s) => a + s.capacity, 0);
    const isBlocked = blocked.includes(d);
    const closed = isBlocked || (list.length > 0 && list.every(s => s.is_closed));
    const cls = ['day-chip', d === slotDay ? 'is-active' : '', closed ? 'is-closed' : '', d < today ? 'is-past' : '', cap && booked >= cap ? 'is-full' : ''].join(' ');
    return `<button type="button" class="${cls}" role="option" aria-selected="${d === slotDay}" data-strip-day="${d}">
      <span class="dc-dow">${escapeHtml(fmtDay(d, { month: undefined, day: undefined }))}</span>
      <span class="dc-date">${escapeHtml(fmtDay(d, { weekday: undefined }))}</span>
      <span class="dc-meta">${isBlocked ? 'Blocked' : closed ? 'Closed' : `${booked}/${cap}`}</span>
    </button>`;
  }).join('') : '<span class="muted">No slots yet. Generate them from Slot Settings.</span>';
  const i = slotDays.indexOf(slotDay);
  $('slotPrevDay').disabled = i <= 0;
  $('slotNextDay').disabled = i < 0 || i >= slotDays.length - 1;
  const active = strip.querySelector('.is-active');
  if (active) active.scrollIntoView({ block: 'nearest', inline: 'center', behavior: keepScroll ? 'auto' : 'smooth' });
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
  const now = Date.now();
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
          const past = new Date(s.slot_start).getTime() <= now;
          const names = slotDayNames[new Date(s.slot_start).getTime()] || [];
          return `
          <tr class="${s.is_closed ? 'row-closed' : ''}">
            <td data-label="Time"><strong>${escapeHtml(fmtRange(s.slot_start, s.slot_end))}</strong></td>
            <td data-label="Booked students">${s.booked_count ? (names.length ? names.map(n => `<div>${escapeHtml(n)}</div>`).join('') : `${s.booked_count} booked`) : '<span class="muted">—</span>'}</td>
            <td data-label="Capacity"><span class="cap-edit"><input type="number" min="${s.booked_count}" max="500" value="${s.capacity}" data-cap-input="${s.id}" aria-label="Capacity"><button type="button" class="btn-link" data-cap-save="${s.id}">Save</button></span></td>
            <td data-label="Left">${Math.max(s.capacity - s.booked_count, 0)}</td>
            <td data-label="Status">${past ? '<span class="chip chip-cancelled">Past</span>' : s.is_closed ? '<span class="chip chip-rejected">Closed</span>' : s.booked_count >= s.capacity ? '<span class="chip chip-pending">Full</span>' : '<span class="chip chip-approved">Open</span>'}</td>
            <td><button type="button" class="btn-link" data-slot-toggle="${s.id}" data-closed="${s.is_closed}">${s.is_closed ? 'Reopen' : 'Close'}</button></td>
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
  clearAlert('slotsAlert');

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
