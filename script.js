// `sb` (the Supabase client) comes from supabase-client.js.

/* -------------------- CLOUDFLARE TURNSTILE (bot protection) -------------------- */
const TURNSTILE_SITE_KEY = "0x4AAAAAAFxxrJZe7_l3TnIA";
let turnstileWidgets = {};

// Cloudflare calls this itself once its script has loaded (render=explicit mode).
window.onloadTurnstileCallback = function(){
  if (typeof turnstile === 'undefined') return;
  turnstileWidgets.login = turnstile.render('#turnstileLogin', { sitekey: TURNSTILE_SITE_KEY });
  turnstileWidgets.register = turnstile.render('#turnstileRegister', { sitekey: TURNSTILE_SITE_KEY });
  turnstileWidgets.resend = turnstile.render('#turnstileResend', { sitekey: TURNSTILE_SITE_KEY });
  turnstileWidgets.forgot = turnstile.render('#turnstileForgot', { sitekey: TURNSTILE_SITE_KEY });
  turnstileWidgets.resetResend = turnstile.render('#turnstileResetResend', { sitekey: TURNSTILE_SITE_KEY });
  turnstileWidgets.cp = turnstile.render('#turnstileCp', { sitekey: TURNSTILE_SITE_KEY });
};
const CAPTCHA_TEXT = 'Please complete the security verification before continuing.';

function turnstileAvailable(key){
  return typeof turnstile !== 'undefined' && turnstileWidgets[key] !== undefined;
}

// Turnstile tokens are single-use — always reset right after using one,
// win or lose, so the widget is ready for the next attempt.
function getTurnstileToken(key){
  if (!turnstileAvailable(key)) return undefined;
  return turnstile.getResponse(turnstileWidgets[key]) || null;
}
function resetTurnstile(key){
  if (turnstileAvailable(key)) {
    turnstile.reset(turnstileWidgets[key]);
  }
}

/* -------------------- PASSWORD SHOW/HIDE TOGGLE -------------------- */
document.querySelectorAll('.pw-toggle').forEach(btn => {
  btn.addEventListener('click', () => {
    const input = document.getElementById(btn.dataset.target);
    if (!input) return;
    const showing = input.type === 'text';
    input.type = showing ? 'password' : 'text';
    btn.setAttribute('aria-pressed', showing ? 'false' : 'true');
    btn.setAttribute('aria-label', showing ? 'Show password' : 'Hide password');
    btn.querySelector('.icon-eye').style.display = showing ? '' : 'none';
    btn.querySelector('.icon-eye-off').style.display = showing ? 'none' : '';
  });
});

/* -------------------- 6-BOX VERIFICATION CODE -------------------- */
// Each hidden input marked data-otp-boxes gets six one-digit boxes; the hidden input always holds
// the joined code, so the submit handlers keep reading it as before. Paste or SMS/email autofill
// of the whole code into any box fills all six.
function otpBoxesFor(id){ return Array.from(document.querySelectorAll('.otp-boxes[data-for="' + id + '"] input')); }
function syncOtp(id){
  const boxes = otpBoxesFor(id);
  document.getElementById(id).value = boxes.map(b => b.value).join('');
  boxes.forEach(b => b.classList.toggle('filled', !!b.value));
}
function clearOtp(id){ otpBoxesFor(id).forEach(b => { b.value = ''; }); syncOtp(id); }
function focusOtp(id){ const b = otpBoxesFor(id)[0]; if (b) setTimeout(() => b.focus(), 50); }
function fillOtpFrom(id, start, text){
  const boxes = otpBoxesFor(id);
  const all = (text || '').replace(/\D/g, '');
  if (all.length >= boxes.length) start = 0; // a whole code always fills from the first box
  const digits = all.slice(0, boxes.length - start);
  digits.split('').forEach((d, i) => { boxes[start + i].value = d; });
  syncOtp(id);
  const next = boxes[Math.min(start + digits.length, boxes.length - 1)];
  if (next) next.focus();
}
document.querySelectorAll('input[data-otp-boxes]').forEach(hidden => {
  const id = hidden.id;
  const wrap = document.createElement('div');
  wrap.className = 'otp-boxes';
  wrap.dataset.for = id;
  wrap.setAttribute('role', 'group');
  wrap.setAttribute('aria-label', '6-digit verification code');
  wrap.innerHTML = [1, 2, 3, 4, 5, 6].map(n =>
    `<input type="text" id="${id}-${n}" inputmode="numeric" pattern="[0-9]" maxlength="6" required aria-label="Digit ${n}"${n === 1 ? ' autocomplete="one-time-code"' : ' autocomplete="off"'}>`).join('');
  hidden.insertAdjacentElement('afterend', wrap);
  const boxes = otpBoxesFor(id);
  boxes.forEach((box, i) => {
    box.addEventListener('input', () => {
      if (box.value.length > 1) { const v = box.value; box.value = ''; fillOtpFrom(id, i, v); return; }
      box.value = box.value.replace(/\D/g, '');
      syncOtp(id);
      if (box.value && boxes[i + 1]) boxes[i + 1].focus();
    });
    box.addEventListener('keydown', (e) => {
      if (e.key === 'Backspace' && !box.value && boxes[i - 1]) { boxes[i - 1].value = ''; syncOtp(id); boxes[i - 1].focus(); e.preventDefault(); }
      else if (e.key === 'ArrowLeft' && boxes[i - 1]) { boxes[i - 1].focus(); e.preventDefault(); }
      else if (e.key === 'ArrowRight' && boxes[i + 1]) { boxes[i + 1].focus(); e.preventDefault(); }
    });
    box.addEventListener('paste', (e) => {
      e.preventDefault();
      fillOtpFrom(id, i, (e.clipboardData || window.clipboardData).getData('text'));
    });
    box.addEventListener('focus', () => box.select());
  });
});

/* -------------------- RESEND COOLDOWN -------------------- */
// Supabase only sends one code per email per 60 seconds, so the button waits that long too.
const RESEND_COOLDOWN_S = 60;
const resendTimers = {};
function startResendCooldown(btnId){
  const btn = document.getElementById(btnId);
  if (!btn) return;
  clearInterval(resendTimers[btnId]);
  let left = RESEND_COOLDOWN_S;
  const tick = () => {
    if (left <= 0) {
      clearInterval(resendTimers[btnId]);
      btn.disabled = false;
      btn.textContent = btn.dataset.idle || 'Resend verification code';
      return;
    }
    btn.disabled = true;
    btn.textContent = 'Resend code in ' + Math.floor(left / 60) + ':' + String(left % 60).padStart(2, '0');
    left--;
  };
  tick();
  resendTimers[btnId] = setInterval(tick, 1000);
}

/* -------------------- PASSWORD STRENGTH + MATCH CHECKS (register) -------------------- */
function passwordScore(pw){
  if (!pw) return 0;
  if (pw.length < 8) return 1;
  let kinds = 0;
  if (/[a-z]/.test(pw)) kinds++;
  if (/[A-Z]/.test(pw)) kinds++;
  if (/[0-9]/.test(pw)) kinds++;
  if (/[^A-Za-z0-9]/.test(pw)) kinds++;
  return (pw.length >= 12 && kinds >= 2) || kinds >= 3 ? 3 : 2;
}
function updatePasswordChecks(){
  const pw = document.getElementById('regPassword').value;
  const confirm = document.getElementById('regPasswordConfirm').value;
  const score = passwordScore(pw);
  const meter = document.getElementById('pwMeter');
  const lbl = document.getElementById('pwMeterLbl');
  meter.classList.toggle('hidden', !pw);
  meter.dataset.score = score;
  lbl.dataset.score = score;
  lbl.textContent = pw ? ['', 'Too short', 'Okay password', 'Strong password'][score] : '';
  const len = document.getElementById('pwCheckLen');
  const match = document.getElementById('pwCheckMatch');
  len.className = pw.length >= 8 ? 'ok' : '';
  match.className = !confirm ? '' : confirm === pw ? 'ok' : 'bad';
  match.textContent = confirm && confirm !== pw ? 'Passwords don’t match yet' : 'Passwords match';
}
['regPassword', 'regPasswordConfirm'].forEach(id =>
  document.getElementById(id).addEventListener('input', updatePasswordChecks));

/* -------------------- view helpers -------------------- */
// Held in memory only between the register form and the OTP check — never stored.
let pendingRegistration = null;

function isPendingRegistration(clientRow){
  return !clientRow || (clientRow['Full Name'] || '').indexOf('PENDING::') === 0;
}

// Students are not Supabase Auth users: the portal session is an opaque token from
// student_login / student_register / student_session_from_oauth / student_reset_password.
const SESSION_KEY = 'gps_session_token';
const SCHED_PROMPTED_KEY = 'gps_sched_prompted'; // schedule modal already auto-opened (or skipped) this login
function setSession(token){ sessionStorage.setItem(SESSION_KEY, token); }
function getSession(){ return sessionStorage.getItem(SESSION_KEY); }
function clearSession(){
  sessionStorage.removeItem(SESSION_KEY);
  sessionStorage.removeItem(SCHED_PROMPTED_KEY);
}
function firstRow(data){ return Array.isArray(data) ? data[0] : data; }

const ERROR_TEXT = {
  invalid_session: 'Your session has expired. Please log in again.',
  username_taken: 'That username is already taken. Please choose another.',
  invalid_username: 'Usernames must be 3–24 characters using only letters, numbers, dots or underscores.',
  weak_password: 'Password must be 8 to 72 characters.',
  too_many_attempts: 'Too many failed attempts. Please wait 15 minutes and try again.',
  recent_signin_required: 'Your verification expired. Please request a new code and try again.',
  not_authorized: 'That code was not sent to the email on this account. Please request a new code.',
  no_account: 'No student account uses that email. Please register first.',
  last_name_required: 'Please enter Last Name.',
  first_name_required: 'Please enter First Name.',
  gender_required: 'Please select your Gender.',
  school_required: 'Please select your School.',
  contact_required: 'Please enter Contact Number.',
  invalid_full_name: 'Please check your name details.',
  school_locked: 'You already have a pictorial booking, so your school can’t be changed here. Please contact the studio.',
  slot_full: 'That time slot just filled up. Please pick another time.',
  already_booked: 'You already have a pictorial schedule.',
  wrong_school: 'That slot is for a different school.',
  slot_unavailable: 'That time slot is no longer available. Please pick another time.',
  booking_closed: 'Pictorial booking is currently closed for your school.',
  slot_not_found: 'That time slot no longer exists. Please pick another time.',
  past_cutoff: 'It is too close to your pictorial schedule to change it online. Please contact the studio.',
  booking_started: 'Your pictorial schedule has already started, so it can’t be changed online. Please contact the studio.',
  same_slot: 'That is already your schedule. Pick a different date or time.',
  request_pending: 'You already have a pending request. Please wait for the studio to respond.',
  no_active_booking: 'You don’t have an active pictorial booking.',
  preferred_slot_required: 'Please pick your preferred new schedule.',
};
function errText(error, fallback){
  const m = (error && error.message) || '';
  return ERROR_TEXT[m] || m || fallback || 'Something went wrong. Please try again.';
}

// Every student RPC goes through here so an expired/revoked token always lands back on login.
async function rpc(name, args){
  const res = await sb.rpc(name, args);
  if (res.error && res.error.message === 'invalid_session') {
    res.error.handled = true;
    expireSession(ERROR_TEXT.invalid_session);
  }
  return res;
}
// Shows an RPC error in an alert box unless rpc() already sent the student to login.
function rpcFail(alertId, error, fallback){
  if (error && error.handled) return;
  alertBox(alertId, escapeHtml(errText(error, fallback)), 'error');
}

function expireSession(message){
  clearSession();
  closeSchedule();
  currentUser = null;
  currentProfile = null;
  bookingState = null;
  showView('login');
  if (message) alertBox('loginAlert', message, 'error');
  else clearAlert('loginAlert');
}

const els = {
  authShell: document.getElementById('authShell'),
  dashboard: document.getElementById('dashboard'),
  step2Shell: document.getElementById('step2Shell'),
  login: document.getElementById('view-login'),
  register: document.getElementById('view-register'),
  verify: document.getElementById('view-verify'),
  forgot: document.getElementById('view-forgot'),
  reset: document.getElementById('view-reset'),
  stepAccount: document.getElementById('stepAccount'),
  stepVerify: document.getElementById('stepVerify'),
  stepPortal: document.getElementById('stepPortal'),
};

function showView(name){
  if (name === 'step2') {
    els.authShell.classList.add('hidden');
    els.dashboard.style.display = 'none';
    els.step2Shell.classList.remove('hidden');
    return;
  }
  els.step2Shell.classList.add('hidden');

  [els.login, els.register, els.verify, els.forgot, els.reset].forEach(v => v.classList.add('hidden'));
  els.authShell.classList.remove('hidden');
  els.dashboard.style.display = 'none';

  els.stepAccount.classList.remove('active','done');
  els.stepVerify.classList.remove('active','done');
  els.stepPortal.classList.remove('active','done');

  if (name === 'login' || name === 'register' || name === 'forgot' || name === 'reset') {
    els.stepAccount.classList.add('active');
  }
  if (name === 'verify') {
    els.stepAccount.classList.add('done');
    els.stepVerify.classList.add('active');
  }
  document.getElementById('view-' + name).classList.remove('hidden');
}

function showDashboard(){
  els.authShell.classList.add('hidden');
  els.step2Shell.classList.add('hidden');
  els.dashboard.style.display = 'block';
  els.stepAccount.classList.add('done');
  els.stepVerify.classList.add('done');
  els.stepPortal.classList.add('active');
}

function alertBox(containerId, message, type){
  const el = document.getElementById(containerId);
  el.innerHTML = `<div class="alert alert-${type}">${message}</div>`;
}
function clearAlert(containerId){
  document.getElementById(containerId).innerHTML = '';
}

/* -------------------- PACKAGE SELECTION FROM MAIN PAGE -------------------- */
(function capturePackageFromUrl(){
  const params = new URLSearchParams(window.location.search);
  const pkgName = params.get('package');
  const pkgPrice = params.get('price');
  const pkgDate = params.get('date');
  if (pkgName && pkgPrice) {
    sessionStorage.setItem('pendingPackageName', pkgName);
    sessionStorage.setItem('pendingPackagePrice', pkgPrice);
  }
  if (pkgDate) {
    sessionStorage.setItem('pendingPreferredDate', pkgDate);
  }
})();

function showSelectedPackageBanner(){
  const pkgName = sessionStorage.getItem('pendingPackageName');
  const pkgPrice = sessionStorage.getItem('pendingPackagePrice');
  const pkgDate = sessionStorage.getItem('pendingPreferredDate');
  const banner = document.getElementById('selectedPackageBanner');
  if (!banner) return;
  if (pkgName && pkgPrice) {
    let text = `${pkgName} — ₱${Number(pkgPrice).toLocaleString()}`;
    if (pkgDate) {
      const formatted = new Date(pkgDate + 'T00:00:00').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
      text += ` · Preferred date: ${formatted}`;
    }
    document.getElementById('selectedPackageText').textContent = text;
    banner.classList.remove('hidden');
  } else {
    banner.classList.add('hidden');
  }
}
showSelectedPackageBanner();

/* -------------------- nav links between login/register/forgot -------------------- */
document.getElementById('goToRegister').addEventListener('click', (e) => {
  e.preventDefault();
  document.getElementById('registerForm').reset();
  clearAlert('loginAlert');
  showView('register');
});
document.getElementById('goToLogin').addEventListener('click', (e) => {
  e.preventDefault(); clearAlert('registerAlert'); showView('login');
});
document.getElementById('goToForgot').addEventListener('click', (e) => {
  e.preventDefault(); clearAlert('loginAlert'); showView('forgot');
});
document.getElementById('backToLoginFromForgot').addEventListener('click', () => {
  clearAlert('forgotAlert'); showView('login');
});
document.getElementById('backToLoginFromReset').addEventListener('click', () => {
  clearAlert('resetAlert'); showView('login');
});
document.getElementById('backToLoginFromVerify').addEventListener('click', async () => {
  pendingRegistration = null;
  await sb.auth.signOut();
  clearAlert('verifyAlert');
  showView('login');
});

// "Wrong email? Change it": back to the register form with the other fields kept.
document.getElementById('changeEmailLink').addEventListener('click', async (e) => {
  e.preventDefault();
  pendingRegistration = null;
  await sb.auth.signOut();
  clearAlert('verifyAlert');
  clearOtp('otpCode');
  showView('register');
  const em = document.getElementById('regEmail');
  em.focus();
  em.select();
});

/* -------------------- REGISTER -------------------- */
document.getElementById('registerForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  clearAlert('registerAlert');

  const username = document.getElementById('regUsername').value.trim();
  const email = document.getElementById('regEmail').value.trim();
  const password = document.getElementById('regPassword').value;
  const confirm = document.getElementById('regPasswordConfirm').value;
  const agreed = document.getElementById('regConsent').checked;

  if (password !== confirm) {
    alertBox('registerAlert', 'Passwords do not match.', 'error');
    return;
  }
  if (password.length < 8) {
    alertBox('registerAlert', 'Password must be at least 8 characters.', 'error');
    return;
  }
  if (!agreed) {
    alertBox('registerAlert', 'Please tick the box to agree to the Terms &amp; Conditions and Privacy Policy before continuing.', 'error');
    return;
  }

  const captchaToken = getTurnstileToken('register');
  if (turnstileAvailable('register') && !captchaToken) {
    alertBox('registerAlert', 'Please complete the security verification below before continuing', 'error');
    return;
  }

  const btn = document.getElementById('registerSubmit');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span>Creating account…';

  const { data: available, error: availError } = await sb.rpc('student_username_available', { p_username: username });
  if (availError || !available) {
    btn.disabled = false;
    btn.textContent = 'Create account';
    resetTurnstile('register');
    alertBox('registerAlert', availError ? escapeHtml(errText(availError)) : ERROR_TEXT.username_taken, 'error');
    return;
  }

  const { error: otpError } = await sb.auth.signInWithOtp({
    email,
    options: { shouldCreateUser: true, ...(captchaToken ? { captchaToken } : {}) }
  });

  resetTurnstile('register');
  btn.disabled = false;
  btn.textContent = 'Create account';

  if (otpError) {
    alertBox('registerAlert', otpError.message, 'error');
    return;
  }

  pendingRegistration = { username, password, email };

  document.getElementById('verifyEmailShown').textContent = email;
  clearOtp('otpCode');
  showView('verify');
  startResendCooldown('resendBtn');
  focusOtp('otpCode');
});

/* -------------------- LOGIN -------------------- */
document.getElementById('loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  clearAlert('loginAlert');

  const identifier = document.getElementById('loginEmail').value.trim();
  const password = document.getElementById('loginPassword').value;

  const captchaToken = getTurnstileToken('login');
  if (turnstileAvailable('login') && !captchaToken) {
    alertBox('loginAlert', 'Please complete the security verification below before continuing', 'error');
    return;
  }

  const btn = document.getElementById('loginSubmit');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span>Logging in…';

  const { data, error } = await sb.rpc('student_login', { p_identifier: identifier, p_password: password });

  resetTurnstile('login');
  btn.disabled = false;
  btn.textContent = 'Log in';

  if (error) { rpcFail('loginAlert', error); return; }
  const session = firstRow(data);
  if (!session || !session.session_token) {
    alertBox('loginAlert', 'Invalid username/email or password.', 'error');
    return;
  }

  document.getElementById('loginPassword').value = '';
  setSession(session.session_token);
  await enterPortal();
});

// Loads the profile for the stored session token and routes to Step 2 or the dashboard.
async function enterPortal(){
  const token = getSession();
  if (!token) { showView('login'); return null; }
  const { data: profile, error } = await rpc('student_get_profile', { p_token: token });
  if (error) {
    if (!error.handled) expireSession(errText(error, 'Could not load your account. Please log in again.'));
    return null;
  }
  if (!profile) { expireSession('Account not found.'); return null; }
  if (isPendingRegistration(profile)) await showStep2(profile);
  else await loadDashboard(profile);
  return profile;
}

/* -------------------- SOCIAL LOGIN / CONNECT (Google, Facebook) -------------------- */
const OAUTH_KEY = 'gps_oauth';
// Facebook is switched off: without Meta Business Verification only app testers can log in.
// Set ENABLE_FACEBOOK to true to bring back the Facebook buttons and the Connect row.
const ENABLE_FACEBOOK = false;
const SOCIAL_PROVIDERS = ENABLE_FACEBOOK ? { google: 'Google', facebook: 'Facebook' } : { google: 'Google' };
if (ENABLE_FACEBOOK) document.querySelectorAll('[data-fb]').forEach(el => { el.hidden = false; });

function startOAuth(state){
  sessionStorage.setItem(OAUTH_KEY, JSON.stringify(state));
  return sb.auth.signInWithOAuth({
    provider: state.provider,
    options: { redirectTo: window.location.origin + window.location.pathname }
  });
}

function socialErr(error){
  const m = (error && error.message) || '';
  // Google-created accounts have no usable password until one is set through Forgot password.
  if (/invalid[_ ]credentials/i.test(m)) return 'Incorrect password. If you signed up with Google and never set a password, use “Forgot password” on the login page to set one first.';
  if (/already linked/i.test(m)) return 'That account is already connected to a different student account.';
  if (/link expired/i.test(m)) return 'The connection request expired. Please try again.';
  return m || 'Something went wrong. Please try again.';
}

function wireLoginSocial(btnId, provider, alertId){
  document.getElementById(btnId).addEventListener('click', async () => {
    clearAlert(alertId);
    const { error } = await startOAuth({ mode: 'login', provider });
    if (error) { sessionStorage.removeItem(OAUTH_KEY); alertBox(alertId, error.message, 'error'); }
  });
}
wireLoginSocial('loginGoogle', 'google', 'loginAlert');
wireLoginSocial('loginFacebook', 'facebook', 'loginAlert');
wireLoginSocial('regGoogle', 'google', 'registerAlert');
wireLoginSocial('regFacebook', 'facebook', 'registerAlert');

function socialAuthErr(error, label){
  const m = (error && error.message) || '';
  if (/no email/i.test(m)) return `This ${label} account doesn't share an email address, so we can't create your account. Please sign up with your email instead.`;
  return m || 'Something went wrong. Please try again.';
}

async function renderSocialList(){
  const box = document.getElementById('socialList');
  if (!box || !currentUser) return;
  const { data } = await rpc('student_list_social_links', { p_token: getSession() });
  const linked = data || [];
  box.innerHTML = Object.entries(SOCIAL_PROVIDERS).map(([key, label]) => {
    const on = linked.includes(key);
    return `<div class="social-conn"><span>${label} — ${on ? 'Connected' : 'Not connected'}</span><button type="button" class="btn-ghost btn-inline" data-social="${key}" data-on="${on}">${on ? 'Disconnect' : 'Connect'}</button></div>`;
  }).join('');
}

document.getElementById('socialList').addEventListener('click', async (e) => {
  const btn = e.target.closest('button[data-social]');
  if (!btn) return;
  clearAlert('socialAlert');
  const provider = btn.dataset.social;
  const label = SOCIAL_PROVIDERS[provider];
  const pw = document.getElementById('socialPw').value;
  if (!pw) { alertBox('socialAlert', 'Enter your password first to confirm.', 'error'); return; }

  if (btn.dataset.on === 'true') {
    const { error } = await rpc('student_unlink_social', { p_token: getSession(), p_password: pw, p_provider: provider });
    if (error) { if (!error.handled) alertBox('socialAlert', socialErr(error), 'error'); return; }
    document.getElementById('socialPw').value = '';
    alertBox('socialAlert', `${label} disconnected.`, 'success');
    renderSocialList();
    return;
  }

  const { data: token, error } = await rpc('student_create_link_token', { p_token: getSession(), p_password: pw });
  if (error) { if (!error.handled) alertBox('socialAlert', socialErr(error), 'error'); return; }
  document.getElementById('socialPw').value = '';
  const res = await startOAuth({ mode: 'link', provider, token });
  if (res.error) { sessionStorage.removeItem(OAUTH_KEY); alertBox('socialAlert', res.error.message, 'error'); }
});

// Runs once after Google/Facebook redirects back to this page.
async function handleOAuthReturn(st){
  history.replaceState(null, '', window.location.pathname);
  const label = SOCIAL_PROVIDERS[st.provider] || st.provider;
  const { data: { session } } = await sb.auth.getSession();
  if (!session) {
    showView('login');
    alertBox('loginAlert', 'Sign-in was cancelled or failed. Please try again.', 'error');
    return;
  }

  if (st.mode === 'link') {
    // Must run while the Google auth session exists; the link token proves which student asked.
    const { error } = await sb.rpc('student_link_social', { p_link_token: st.token, p_provider: st.provider });
    await sb.auth.signOut();
    const profile = await enterPortal();
    if (profile) alertBox('socialAlert', error ? socialErr(error) : `${label} connected.`, error ? 'error' : 'success');
    return;
  }

  // social_register first (creates the Clients row if needed), then mint the portal
  // session while the Google auth session is still fresh, then drop the auth session.
  const { data: reg, error: regError } = await sb.rpc('social_register', { p_provider: st.provider });
  const info = firstRow(reg); // test returns a one-row array, live returns {username, is_new}
  let sessionRes = null;
  if (!regError && info && info.username) {
    sessionRes = await sb.rpc('student_session_from_oauth');
  }
  await sb.auth.signOut();
  if (regError || !info || !info.username) {
    showView('login');
    alertBox('loginAlert', socialAuthErr(regError, label), 'error');
    return;
  }
  const portal = sessionRes && firstRow(sessionRes.data);
  if (!portal || !portal.session_token) {
    showView('login');
    alertBox('loginAlert', escapeHtml(errText(sessionRes && sessionRes.error, 'Sign-in failed. Please try again.')), 'error');
    return;
  }
  setSession(portal.session_token);
  const profile = await enterPortal();
  if (profile && info.is_new && isPendingRegistration(profile)) {
    alertBox('step2Alert', `Signed in with ${label}. Please complete your details to finish registering.`, 'success');
  }
}

/* -------------------- VERIFY OTP CODE (signup) -------------------- */
document.getElementById('otpForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  clearAlert('verifyAlert');

  const email = document.getElementById('verifyEmailShown').textContent;
  const token = document.getElementById('otpCode').value.trim();

  const btn = document.getElementById('otpSubmit');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span>Verifying…';

  const { error } = await sb.auth.verifyOtp({ email, token, type: 'email' });

  if (error) {
    btn.disabled = false;
    btn.textContent = 'Verify code';
    alertBox('verifyAlert', escapeHtml(error.message), 'error');
    return;
  }

  const reg = pendingRegistration;
  if (!reg) {
    btn.disabled = false;
    btn.textContent = 'Verify code';
    await sb.auth.signOut();
    showView('register');
    alertBox('registerAlert', 'Your registration details were cleared. Please fill in the form again.', 'error');
    return;
  }

  // The email comes from the fresh auth session; the password goes straight to the RPC.
  const { data, error: regError } = await sb.rpc('student_register', { p_username: reg.username, p_password: reg.password });
  await sb.auth.signOut();
  btn.disabled = false;
  btn.textContent = 'Verify code';

  const session = firstRow(data);
  if (regError || !session || !session.session_token) {
    pendingRegistration = null;
    showView('register');
    rpcFail('registerAlert', regError, 'Could not create your account. Please try again.');
    return;
  }

  pendingRegistration = null;
  clearOtp('otpCode');
  setSession(session.session_token);
  await enterPortal();
});

/* -------------------- RESEND VERIFICATION CODE -------------------- */
document.getElementById('resendBtn').addEventListener('click', async () => {
  clearAlert('verifyAlert');
  const email = document.getElementById('verifyEmailShown').textContent;
  const btn = document.getElementById('resendBtn');

  const captchaToken = getTurnstileToken('resend');
  if (turnstileAvailable('resend') && !captchaToken) {
    alertBox('verifyAlert', 'Please complete the security verification below before continuing', 'error');
    return;
  }

  btn.disabled = true;
  btn.textContent = 'Sending…';

  const { error } = await sb.auth.signInWithOtp({
    email,
    options: { shouldCreateUser: true, ...(captchaToken ? { captchaToken } : {}) }
  });

  resetTurnstile('resend');
  btn.disabled = false;
  btn.textContent = 'Resend verification code';

  if (error) {
    alertBox('verifyAlert', error.message, 'error');
  } else {
    alertBox('verifyAlert', 'Verification code resent. Check your inbox.', 'success');
    startResendCooldown('resendBtn');
  }
});

/* -------------------- FORGOT PASSWORD (OTP) — step 1: username or email, then send code -------------------- */
let gpsReset = { username: '', email: null };

function maskEmail(email){
  const parts = email.split('@');
  const u = parts[0];
  return (u.length <= 2 ? u[0] : u.slice(0, 2)) + '***@' + parts[1];
}
// With CAPTCHA on in Supabase, every email-code request needs the widget token for its form.
async function sendOtp(email, widgetKey){
  const captchaToken = getTurnstileToken(widgetKey);
  if (turnstileAvailable(widgetKey) && !captchaToken) return { error: { message: CAPTCHA_TEXT } };
  const res = await sb.auth.signInWithOtp({ email, options: { shouldCreateUser: true, ...(captchaToken ? { captchaToken } : {}) } });
  resetTurnstile(widgetKey);
  return res;
}

document.getElementById('forgotForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  clearAlert('forgotAlert');

  const identifier = document.getElementById('forgotIdentifier').value.trim();
  // Checked before the lookup so the captcha prompt never hints whether the account exists.
  if (turnstileAvailable('forgot') && !getTurnstileToken('forgot')) {
    alertBox('forgotAlert', CAPTCHA_TEXT, 'error');
    return;
  }
  const btn = document.getElementById('forgotSubmit');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span>Sending code…';

  // One box: the RPC looks up by email if it has an "@", otherwise by username.
  const { data } = await sb.rpc('student_reset_lookup', { p_identifier: identifier });
  const rows = data || [];

  if (rows.length > 1) {
    btn.disabled = false;
    btn.textContent = 'Send code';
    alertBox('forgotAlert', 'More than one account uses that email. Please enter your username instead.', 'error');
    return;
  }

  const row = rows[0];
  gpsReset = { username: identifier, email: null };

  if (row && row.student_email) {
    const { error } = await sendOtp(row.student_email, 'forgot');
    if (error) {
      btn.disabled = false;
      btn.textContent = 'Send code';
      alertBox('forgotAlert', escapeHtml(error.message), 'error');
      return;
    }
    gpsReset = { username: row.student_username, email: row.student_email };
  }

  btn.disabled = false;
  btn.textContent = 'Send code';

  // Same message whether or not it matched, so nobody can probe which accounts exist.
  document.getElementById('resetCopy').innerHTML =
    'If <strong id="resetEmailShown">' + escapeHtml(identifier) + '</strong> matches an account, we sent a 6-digit code to its registered email' +
    (gpsReset.email ? ' (' + escapeHtml(maskEmail(gpsReset.email)) + ')' : '') +
    '. Enter it below and choose a new password.';
  clearOtp('resetOtpCode');
  showView('reset');
  startResendCooldown('resetResendBtn');
  focusOtp('resetOtpCode');
});

/* -------------------- FORGOT PASSWORD (OTP) — step 2: verify code + set new password -------------------- */
document.getElementById('resetForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  clearAlert('resetAlert');

  const token = document.getElementById('resetOtpCode').value.trim();
  const password = document.getElementById('resetPassword').value;
  const confirm = document.getElementById('resetPasswordConfirm').value;

  if (!/^\d{6}$/.test(token)) {
    alertBox('resetAlert', 'Enter the 6-digit verification code.', 'error');
    return;
  }
  if (password !== confirm) {
    alertBox('resetAlert', 'Passwords do not match.', 'error');
    return;
  }
  if (password.length < 8) {
    alertBox('resetAlert', 'Password must be at least 8 characters.', 'error');
    return;
  }
  if (!gpsReset.email) {
    alertBox('resetAlert', 'Invalid or expired code.', 'error');
    return;
  }

  const btn = document.getElementById('resetSubmit');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span>Updating…';

  const { error: otpError } = await sb.auth.verifyOtp({ email: gpsReset.email, token, type: 'email' });
  if (otpError) {
    btn.disabled = false;
    btn.textContent = 'Update password';
    alertBox('resetAlert', 'Invalid or expired code.', 'error');
    return;
  }

  // Must run while the OTP auth session is fresh; returns a new portal session token.
  const { data: newToken, error: updateError } = await sb.rpc('student_reset_password', {
    p_username: gpsReset.username, p_new_password: password
  });
  await sb.auth.signOut();

  btn.disabled = false;
  btn.textContent = 'Update password';

  if (updateError || !newToken) {
    rpcFail('resetAlert', updateError, 'Could not update your password. Please try again.');
    return;
  }

  gpsReset = { username: '', email: null };
  document.getElementById('resetForm').reset();
  clearOtp('resetOtpCode');
  setSession(newToken);
  await enterPortal();
});

document.getElementById('resetResendBtn').addEventListener('click', async () => {
  clearAlert('resetAlert');
  if (!gpsReset.email) {
    alertBox('resetAlert', 'Verification code resent. Check your inbox.', 'success');
    startResendCooldown('resetResendBtn');
    return;
  }
  const btn = document.getElementById('resetResendBtn');
  btn.disabled = true;
  btn.textContent = 'Sending…';
  const { error } = await sendOtp(gpsReset.email, 'resetResend');
  btn.disabled = false;
  btn.textContent = 'Resend verification code';
  if (error) alertBox('resetAlert', error.message, 'error');
  else { alertBox('resetAlert', 'Verification code resent. Check your inbox.', 'success'); startResendCooldown('resetResendBtn'); }
});

/* -------------------- CHANGE PASSWORD (dashboard, OTP) -------------------- */
function cpEmail(){
  return (currentProfile && currentProfile['Email']) || (currentUser && currentUser.email) || '';
}
function cpReset(){
  ['cpOtp','cpNew','cpConfirm'].forEach(id => { document.getElementById(id).value = ''; });
  document.getElementById('cpStep2').classList.add('hidden');
  document.getElementById('cpStep1').classList.remove('hidden');
}
async function cpSendCode(btn, idleText){
  clearAlert('cpAlert');
  const email = cpEmail();
  if (!email) { alertBox('cpAlert', 'No email found on this account.', 'error'); return false; }
  btn.disabled = true;
  btn.textContent = 'Sending…';
  const { error } = await sendOtp(email, 'cp');
  btn.disabled = false;
  btn.textContent = idleText;
  if (error) { alertBox('cpAlert', error.message, 'error'); return false; }
  alertBox('cpAlert', 'Verification code sent to ' + escapeHtml(maskEmail(email)) + '.', 'success');
  return true;
}

document.getElementById('cpSendBtn').addEventListener('click', async (e) => {
  if (await cpSendCode(e.currentTarget, 'Send verification code')) {
    document.getElementById('cpStep1').classList.add('hidden');
    document.getElementById('cpStep2').classList.remove('hidden');
  }
});
document.getElementById('cpResendBtn').addEventListener('click', (e) => cpSendCode(e.currentTarget, 'Resend code'));
document.getElementById('cpCancelBtn').addEventListener('click', () => { clearAlert('cpAlert'); cpReset(); });

document.getElementById('cpSaveBtn').addEventListener('click', async () => {
  clearAlert('cpAlert');
  const token = document.getElementById('cpOtp').value.trim();
  const password = document.getElementById('cpNew').value;
  const confirm = document.getElementById('cpConfirm').value;

  if (!/^\d{6}$/.test(token)) { alertBox('cpAlert', 'Enter the 6-digit verification code.', 'error'); return; }
  if (password.length < 8) { alertBox('cpAlert', 'Password must be at least 8 characters.', 'error'); return; }
  if (password !== confirm) { alertBox('cpAlert', 'Passwords do not match.', 'error'); return; }

  const btn = document.getElementById('cpSaveBtn');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span>Updating…';

  const { error: otpError } = await sb.auth.verifyOtp({ email: cpEmail(), token, type: 'email' });
  if (otpError) {
    btn.disabled = false;
    btn.textContent = 'Update password';
    alertBox('cpAlert', 'Invalid or expired code.', 'error');
    return;
  }

  // Resetting revokes every old session token, so swap in the new one.
  const { data: newToken, error: updateError } = await sb.rpc('student_reset_password', {
    p_username: currentProfile['Username'], p_new_password: password
  });
  await sb.auth.signOut();

  btn.disabled = false;
  btn.textContent = 'Update password';

  if (updateError || !newToken) { rpcFail('cpAlert', updateError, 'Could not update your password. Please try again.'); return; }

  setSession(newToken);
  cpReset();
  alertBox('cpAlert', 'Password updated.', 'success');
});

/* -------------------- SIGN OUT -------------------- */
// Revokes the token server-side (best effort) and clears it locally.
function signOutStudent(message){
  const token = getSession();
  if (token) sb.rpc('student_logout', { p_token: token }).then(() => {}, () => {});
  sb.auth.signOut();
  expireSession(message);
}

document.getElementById('signOutBtn').addEventListener('click', () => signOutStudent());

/* -------------------- DASHBOARD TABS (with mobile hamburger) -------------------- */
const tabsToggle = document.getElementById('tabsToggle');
const tabsList = document.getElementById('tabsList');

// The burger shows on phones and tablets (see styles.css); on laptops the list is a sidebar.
function setMenuOpen(open){
  tabsList.classList.toggle('open', open);
  tabsToggle.classList.toggle('is-open', open);
  tabsToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
  tabsToggle.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
}

tabsToggle.addEventListener('click', () => setMenuOpen(!tabsList.classList.contains('open')));
// Tap outside the open menu or press Escape to close it.
document.addEventListener('click', (e) => {
  if (tabsList.classList.contains('open') && !tabsList.contains(e.target) && !tabsToggle.contains(e.target)) setMenuOpen(false);
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && tabsList.classList.contains('open')) { setMenuOpen(false); tabsToggle.focus(); }
});
// Rotating a tablet or widening the window back to the sidebar layout drops the open state.
window.matchMedia('(min-width:1025px)').addEventListener('change', (e) => { if (e.matches) setMenuOpen(false); });

document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    setMenuOpen(false);
    if (!tab.dataset.tab) return; // Sign out has its own handler
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
    tab.classList.add('active');
    document.getElementById(tab.dataset.tab).classList.add('active');
    window.scrollTo({ top: 0 });
  });
});

/* -------------------- PROFILE STATE -------------------- */
let currentUser = null;
let currentProfile = null;
let profileEditMode = false;
let bookingState = null;

let DETAILS_ROWS = [];

async function loadLookups(){
  const { data, error } = await sb.from('Details').select('Schools, Course, Major, Gender, College');
  if (error) { console.error(error); DETAILS_ROWS = []; return; }
  DETAILS_ROWS = data || [];
}

function distinctSchools(){
  const seen = new Set();
  return DETAILS_ROWS.map(r => (r['Schools'] || '').trim())
    .filter(v => v && !seen.has(v.toLowerCase()) && seen.add(v.toLowerCase()))
    .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
}
function distinctColleges(){
  const seen = new Set();
  return DETAILS_ROWS.map(r => (r['College'] || '').trim())
    .filter(v => v && !seen.has(v.toLowerCase()) && seen.add(v.toLowerCase()))
    .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
}
function distinctGenders(){
  const seen = new Set();
  return DETAILS_ROWS.map(r => (r['Gender'] || '').trim())
    .filter(v => v && !seen.has(v.toLowerCase()) && seen.add(v.toLowerCase()));
}
// Old desktop builds stored strands/sections/grades/schools in the Course
// column with a prefix ("STRAND:STEM 1"). The data is cleaned now, but a
// PC that hasn't updated yet could still add one — never show those.
const PLACEHOLDER_COURSE = /^(STRAND|SECTION|GRADE|SCHOOL):/i;

function distinctCourses(){
  const seen = new Set();
  return DETAILS_ROWS.map(r => (r['Course'] || '').trim())
    .filter(v => v && !PLACEHOLDER_COURSE.test(v))
    .filter(v => !seen.has(v.toLowerCase()) && seen.add(v.toLowerCase()))
    .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
}
function distinctMajors(){
  const seen = new Set();
  return DETAILS_ROWS.map(r => (r['Major'] || '').trim())
    .filter(v => v && !seen.has(v.toLowerCase()) && seen.add(v.toLowerCase()))
    .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
}

// ================================================================
//  TYPE-AHEAD
// ================================================================
function setupTypeahead(inputId, listId, getPool, opts){
  opts = opts || {};
  const input = document.getElementById(inputId);
  const list = document.getElementById(listId);
  if (!input || !list) return;

  let items = [];
  let activeIndex = -1;

  function render(matches){
    items = matches;
    activeIndex = -1;
    if (!matches.length) { list.classList.remove('visible'); list.innerHTML = ''; return; }
    list.innerHTML = matches.map((m, i) =>
      `<div class="suggest-item" data-i="${i}">${escapeHtml(m)}</div>`).join('');
    list.classList.add('visible');
  }

  function highlight(i){
    activeIndex = i;
    Array.from(list.children).forEach((el, idx) => el.classList.toggle('active', idx === i));
    const el = list.children[i];
    if (el && el.scrollIntoView) el.scrollIntoView({ block: 'nearest' });
  }

  function pick(value){
    input.value = value;
    list.classList.remove('visible');
    list.innerHTML = '';
    input.dispatchEvent(new Event('change', { bubbles: true }));
    if (opts.onPick) opts.onPick(value);
  }

  input.addEventListener('input', () => {
    const typed = input.value.trim();
    if (!typed) { list.classList.remove('visible'); list.innerHTML = ''; return; }
    const pool = getPool();
    render(pool.filter(v => v.toLowerCase().indexOf(typed.toLowerCase()) >= 0));
  });

  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown'){
      if (!items.length) return;
      e.preventDefault();
      highlight(Math.min(activeIndex + 1, items.length - 1));
    } else if (e.key === 'ArrowUp'){
      if (!items.length) return;
      e.preventDefault();
      highlight(Math.max(activeIndex - 1, 0));
    } else if (e.key === 'Enter'){
      if (list.classList.contains('visible') && items.length){
        e.preventDefault();
        pick(items[activeIndex >= 0 ? activeIndex : 0]);
      }
    } else if (e.key === 'Tab'){
      if (list.classList.contains('visible') && items.length){
        pick(items[activeIndex >= 0 ? activeIndex : 0]);
      }
    } else if (e.key === 'Escape'){
      list.classList.remove('visible');
    }
  });

  list.addEventListener('mousedown', (e) => {
    const el = e.target.closest('.suggest-item');
    if (!el) return;
    e.preventDefault();
    pick(items[Number(el.dataset.i)]);
  });

  input.addEventListener('blur', () => {
    setTimeout(() => {
      list.classList.remove('visible');
      const typed = input.value.trim();
      const pool = getPool();
      if (!typed){
        if (opts.required && opts.onInvalid) opts.onInvalid('empty');
        return;
      }
      const validMatch = pool.find(v => v.toLowerCase() === typed.toLowerCase());
      if (validMatch){
        input.value = validMatch;
      } else {
        input.value = '';
        if (opts.onInvalid) opts.onInvalid('nomatch');
      }
    }, 150);
  });
}

function optionsHtml(list, selectedVal){
  const opts = list.map(v =>
    `<option value="${escapeHtml(v)}" ${v === selectedVal ? 'selected' : ''}>${escapeHtml(v)}</option>`
  ).join('');
  return `<option value="">Select…</option>${opts}`;
}

function escapeHtml(str){
  if (str === null || str === undefined) return str;
  const div = document.createElement('div');
  div.textContent = String(str);
  return div.innerHTML;
}

// ================================================================
//  Name capitalization
//  ONLY the Last Name is auto-capitalized (smartName).
//  First Name is saved and shown exactly as the student typed it.
// ================================================================
function capitalizeFirst(w){
  if (!w) return w;
  return w[0].toUpperCase() + w.slice(1);
}

function smartName(str){
  if (!str) return '';
  return str.trim().split(/\s+/).filter(Boolean).map(w => {
    if (w.length <= 2) return w;
    if (/[A-Z]/.test(w.slice(1))) return capitalizeFirst(w); // respect typed internal caps (McDonald, DiCaprio)
    if (/^mc[a-z]{3,}$/i.test(w)) return 'Mc' + capitalizeFirst(w.slice(2).toLowerCase());
    return w[0].toUpperCase() + w.slice(1).toLowerCase();
  }).join(' ');
}

const ROMAN_NUMERALS = new Set(['I','II','III','IV','V','VI','VII','VIII','IX','X']);
function formatSuffix(str){
  if (!str) return '';
  const t = str.trim();
  const core = t.replace(/\.$/, '');
  if (ROMAN_NUMERALS.has(core.toUpperCase())) {
    return t.endsWith('.') ? core.toUpperCase() + '.' : core.toUpperCase();
  }
  return t;
}

function titleCase(str){
  if (!str) return str;
  return str.trim().split(/\s+/).map(word => {
    if (!word) return word;
    if (word.length >= 2 && word.length <= 3 && word === word.toUpperCase()) {
      return word;
    }
    return word[0].toUpperCase() + word.slice(1).toLowerCase();
  }).join(' ');
}

// Last Name is re-capitalized when the person clicks/tabs away. First Name is left alone.
function attachAutoCapitalize(prefix){
  const ln = document.getElementById(prefix + 'LastName');
  if (ln) ln.addEventListener('blur', () => {
    ln.value = smartName(ln.value);
    ln.dispatchEvent(new Event('input', { bubbles: true })); // refresh the name preview
  });
  const mi = document.getElementById(prefix + 'MiddleInitial');
  if (mi) mi.addEventListener('blur', () => {
    mi.value = mi.value.toUpperCase();
    mi.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

function buildFullName(lastName, firstName, mi, suffix, placement){
  lastName = (lastName || '').trim();
  firstName = (firstName || '').trim();
  mi = (mi || '').trim();
  suffix = (suffix || '').trim();
  const miPart = mi ? ' ' + mi + '.' : '';
  if (!suffix || placement === 'none') return lastName + ', ' + firstName + miPart;
  if (placement === 'last') return lastName + ' ' + suffix + ', ' + firstName + miPart;
  return lastName + ', ' + firstName + ' ' + suffix + miPart;
}

/* -------------------- LOAD DASHBOARD DATA -------------------- */
async function loadDashboard(profile){
  await loadLookups();

  currentProfile = profile || {};
  currentUser = { username: currentProfile['Username'], email: currentProfile['Email'] };
  profileEditMode = false;
  clearAlert('profileAlert');
  clearAlert('apptAlert');

  const displayName = (currentProfile['First Name'] || '').trim() || currentProfile['Username'] || '';
  document.getElementById('dashGreeting').textContent = displayName ? `Welcome, ${displayName}` : 'Welcome';

  renderProfileGrid();
  showDashboard();

  renderDbDate();
  renderNotices();
  renderSoftCopies();
  renderSocialList();
  cpReset();
  clearAlert('cpAlert');

  await refreshBooking();
  // Auto-open the schedule picker once per login session (Skip counts as that once).
  if (needsBooking() && !sessionStorage.getItem(SCHED_PROMPTED_KEY)) {
    sessionStorage.setItem(SCHED_PROMPTED_KEY, '1');
    openSchedule('book');
  }
}

/* -------------------- DASHBOARD -------------------- */
function renderDbDate(){
  document.getElementById('dbDate').textContent = new Date().toLocaleDateString('en-US', {
    timeZone: 'Asia/Manila', year: 'numeric', month: 'long', day: 'numeric'
  });
}

/* -------------------- NOTICE: reads the announcements table -------------------- */
function noticeRowHTML(n, full){
  const date = new Date(n.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  return `
    <div class="notice-row ${full ? 'full' : ''}">
      <div class="notice-title">${n.is_pinned ? '<span class="pin">&#128204;</span>' : ''} ${escapeHtml(n.title)}</div>
      <div class="notice-body">${escapeHtml(n.body)}</div>
      <div class="notice-meta">${date}</div>
    </div>`;
}

const DB_NOTICE_EMPTY = `<div class="dbx-empty"><span class="dbx-ic red" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 8 3 8H3s3-1 3-8"/><path d="M10 20a2 2 0 0 0 4 0"/></svg></span>
  <div><strong>No new notices</strong>The studio posts reminders for your school here, like what to wear and schedule changes.</div></div>`;

async function renderNotices(){
  const dashList = document.getElementById('dbNoticeList');
  const fullList = document.getElementById('noticeFullList');

  const { data: rows, error } = await sb
    .from('announcements')
    .select('title, body, is_pinned, created_at, school')
    .order('is_pinned', { ascending: false })
    .order('created_at', { ascending: false });

  if (error) {
    console.error(error);
    dashList.innerHTML = '<div class="stub-empty">Could not load notices.</div>';
    fullList.innerHTML = '<div class="stub-empty">Could not load notices.</div>';
    return;
  }

  // school = null means every school; otherwise only that school's students see it.
  const mySchool = ((currentProfile && currentProfile['School']) || '').trim().toLowerCase();
  const data = rows.filter(n => !n.school || n.school.trim().toLowerCase() === mySchool);

  if (!data.length) {
    dashList.innerHTML = DB_NOTICE_EMPTY;
    fullList.innerHTML = '<div class="stub-empty">No notices yet.</div>';
    return;
  }

  dashList.innerHTML = data.slice(0, 3).map(n => noticeRowHTML(n, false)).join('');
  fullList.innerHTML = data.map(n => noticeRowHTML(n, true)).join('');
}

function showTab(target){
  setMenuOpen(false);
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === target));
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.toggle('active', p.id === target));
}
document.querySelectorAll('[data-goto-tab]').forEach(btn => {
  btn.addEventListener('click', () => showTab(btn.dataset.gotoTab));
});

/* -------------------- PICTORIAL BOOKING: state, reminders, appointments -------------------- */
const MANILA_TZ = 'Asia/Manila';

function manilaDateKey(iso){
  // en-CA gives YYYY-MM-DD
  return new Date(iso).toLocaleDateString('en-CA', { timeZone: MANILA_TZ });
}
function fmtManilaDate(iso){
  return new Date(iso).toLocaleDateString('en-US', { timeZone: MANILA_TZ, weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
}
function fmtManilaTime(iso){
  return new Date(iso).toLocaleTimeString('en-US', { timeZone: MANILA_TZ, hour: 'numeric', minute: '2-digit' });
}
function fmtSlotRange(start, end){
  return fmtManilaTime(start) + (end ? ' – ' + fmtManilaTime(end) : '');
}

// Students must arrive this many minutes before their pictorial schedule.
const ARRIVE_EARLY_MIN = 30;
function arriveByTime(iso){
  return fmtManilaTime(new Date(new Date(iso).getTime() - ARRIVE_EARLY_MIN * 60000).toISOString());
}
function arriveByHtml(iso){
  return `<span class="arrive-ic" aria-hidden="true">&#9201;</span> Please arrive by <strong>${escapeHtml(arriveByTime(iso))}</strong>, ${ARRIVE_EARLY_MIN} minutes before your <span class="nowrap">${escapeHtml(fmtManilaTime(iso))}</span> schedule.`;
}

function needsBooking(){
  return !!(bookingState && bookingState.enabled && !bookingState.booking);
}
// No cutoff: students can reschedule or cancel any time until their slot starts.
function hasBookingStarted(){
  const b = bookingState && bookingState.booking;
  return !!b && new Date(b.slot_start).getTime() <= Date.now();
}
const BOOKING_STARTED_TEXT = 'Your pictorial schedule has already started, so it can’t be changed online. Please contact the studio.';

// The API returns at most 1000 rows per request; a school with short slots can have more.
async function fetchAvailability(token){
  const PAGE = 1000;
  let all = [];
  for (let from = 0; ; from += PAGE) {
    const res = await sb.rpc('get_slot_availability', { p_token: token }).range(from, from + PAGE - 1);
    if (res.error) {
      if (res.error.message === 'invalid_session') { res.error.handled = true; expireSession(ERROR_TEXT.invalid_session); }
      return res;
    }
    all = all.concat(res.data || []);
    if (!res.data || res.data.length < PAGE) return { data: all, error: null };
  }
}

async function refreshBooking(){
  const token = getSession();
  if (!token) return;
  const { data, error } = await rpc('student_booking_state', { p_token: token });
  if (error) {
    if (error.handled) return;
    console.error(error);
    bookingState = null;
  } else {
    bookingState = data;
    // Fetch slot times so a pending reschedule can show which slot was requested.
    const req = data && data.pending_request;
    if (req && req.requested_slot_id && !slotsCache.some(s => s.slot_id === req.requested_slot_id)) {
      const res = await fetchAvailability(token);
      if (!res.error) slotsCache = res.data || [];
    }
  }
  renderBookingReminders();
  renderDashboardPictorial(error);
  renderAppointments(error);
}

// Whole days from today to the pictorial, both counted as Philippine calendar dates.
function daysUntilManila(iso){
  const toUtc = (key) => { const [y, m, d] = key.split('-').map(Number); return Date.UTC(y, m - 1, d); };
  return Math.round((toUtc(manilaDateKey(iso)) - toUtc(manilaDateKey(new Date().toISOString()))) / 86400000);
}

// The "Your pictorial" card at the top of the dashboard.
function renderDashboardPictorial(loadError){
  const box = document.getElementById('dbPictorial');
  const sub = document.getElementById('dashSub');
  const st = bookingState || {};
  const b = st.booking;
  const school = st.school || (currentProfile && currentProfile['School']) || '';
  const chip = (text, red) => `<span class="dbx-chip${red ? ' red' : ''}">${escapeHtml(text)}</span>`;
  const schoolChip = school ? chip(school) : '';

  if (loadError || !bookingState) {
    sub.textContent = 'Always stay updated in your student portal.';
    box.innerHTML = '<div class="dbx-kick">Your pictorial</div><p class="dbx-text">We couldn’t load your schedule. Please refresh the page.</p>';
    return;
  }
  if (b) {
    const days = daysUntilManila(b.slot_start);
    const when = hasBookingStarted() ? 'Done' : days <= 0 ? 'Today' : days === 1 ? 'Tomorrow' : `In ${days} days`;
    const locked = hasBookingStarted();
    sub.textContent = locked ? 'Thanks for coming to your pictorial.' : 'You’re all set. Here’s what’s next.';
    box.innerHTML = `
      <div class="dbx-kick">Your pictorial</div>
      <div class="dbx-when">${escapeHtml(fmtManilaDate(b.slot_start))}</div>
      <div class="dbx-time">${escapeHtml(fmtSlotRange(b.slot_start, b.slot_end))} · Philippine time</div>
      ${locked ? '' : `<div class="arrive-note">${arriveByHtml(b.slot_start)}</div>`}
      <div class="dbx-chips">${chip(when, !locked)}${schoolChip}${chip(st.pending_request ? 'Request pending' : 'Booked')}</div>
      <div class="dbx-acts">
        <button type="button" class="btn btn-primary" id="dbCalBtn">Add to calendar</button>
        ${locked ? '' : '<button type="button" class="btn btn-ghost" id="dbReschedBtn">Reschedule</button>'}
      </div>`;
    return;
  }
  if (st.enabled) {
    sub.textContent = 'One step left: book your pictorial schedule.';
    box.innerHTML = `
      <div class="dbx-kick">Your pictorial</div>
      <div class="dbx-when">Not booked yet</div>
      <p class="dbx-text">Pick a date and time for your graduation pictorial. Slots are first come, first served.</p>
      <div class="dbx-chips">${schoolChip}${chip('Booking open', true)}</div>
      <div class="dbx-acts"><button type="button" class="btn btn-primary" data-open-schedule>Book now</button></div>`;
    return;
  }
  sub.textContent = 'Always stay updated in your student portal.';
  box.innerHTML = `
    <div class="dbx-kick">Your pictorial</div>
    <div class="dbx-when">Booking opens soon</div>
    <p class="dbx-text">Pictorial booking isn’t open for your school yet. We’ll post a notice here once it opens.</p>
    <div class="dbx-chips">${schoolChip}</div>`;
}
document.getElementById('dbPictorial').addEventListener('click', (e) => {
  if (e.target.closest('#dbCalBtn')) { downloadBookingIcs(); return; }
  if (e.target.closest('#dbReschedBtn')) {
    clearAlert('apptAlert');
    if (hasBookingStarted()) { showTab('tab-appointments'); alertBox('apptAlert', escapeHtml(BOOKING_STARTED_TEXT), 'error'); return; }
    openSchedule('reschedule');
  }
});

function renderBookingReminders(){
  const notice = document.getElementById('noticeBookingReminder');
  if (!needsBooking()) {
    notice.innerHTML = '';
    return;
  }
  notice.innerHTML = `
    <div class="notice-row full notice-reminder">
      <div class="notice-title"><span class="pin">&#128204;</span> Book your pictorial schedule</div>
      <div class="notice-body">Booking is open for ${escapeHtml(bookingState.school || 'your school')}. Choose your pictorial date and time before slots run out.</div>
      <div class="notice-meta"><button type="button" class="btn btn-primary btn-inline" data-open-schedule>Book now</button></div>
    </div>`;
}

function renderAppointments(loadError){
  const list = document.getElementById('appointmentsList');
  if (loadError) {
    list.innerHTML = '<div class="stub-empty">Could not load your appointments. Please refresh the page.</div>';
    return;
  }
  const st = bookingState || {};
  const b = st.booking;
  if (!b) {
    list.innerHTML = st.enabled
      ? `<div class="notice-row full">
           <div class="notice-title">Pictorial <span class="appt-status">Not booked</span></div>
           <div class="notice-body">You haven’t picked your pictorial schedule yet.</div>
           <div class="notice-meta"><button type="button" class="btn btn-primary btn-inline" data-open-schedule>Book now</button></div>
         </div>`
      : '<div class="stub-empty">Pictorial booking isn’t open for your school yet. We’ll post a notice once it opens.</div>';
    return;
  }

  const req = st.pending_request;
  let reqHtml = '';
  if (req) {
    const reqWhen = new Date(req.created_at).toLocaleDateString('en-US', { timeZone: MANILA_TZ, month: 'short', day: 'numeric' });
    let what = req.type === 'cancel' ? 'Cancellation request' : 'Reschedule request';
    const wanted = req.requested_slot_id && slotsCache.find(s => s.slot_id === req.requested_slot_id);
    if (wanted) what += ` for ${escapeHtml(fmtManilaDate(wanted.slot_start))}, ${escapeHtml(fmtSlotRange(wanted.slot_start, wanted.slot_end))}`;
    reqHtml = `
      <div class="appt-request">
        <span class="appt-status">Pending</span>
        ${what} — sent ${escapeHtml(reqWhen)}. The studio will review it soon.
        <button type="button" class="btn-ghost btn-inline" id="apptWithdrawBtn">Withdraw request</button>
      </div>`;
  }

  // Students change their own booking straight away (no staff approval) until the slot starts.
  const locked = hasBookingStarted();
  const changeNote = locked
    ? `<div class="notice-meta">${escapeHtml(BOOKING_STARTED_TEXT)}</div>`
    : '<div class="notice-meta">You can reschedule or cancel any time before your schedule starts.</div>';
  const actions = `<div class="appt-actions">
       ${locked ? '' : `<button type="button" class="btn btn-primary btn-inline" data-request="reschedule">Reschedule</button>
       <button type="button" class="btn btn-ghost btn-inline" data-request="cancel">Cancel booking</button>`}
       <button type="button" class="btn btn-ghost btn-inline" id="apptCalendarBtn">Add to calendar</button>
     </div>`;

  list.innerHTML = `
    <div class="notice-row full">
      <div class="notice-title">Pictorial <span class="appt-status confirmed">Booked</span></div>
      <div class="appt-when">${escapeHtml(fmtManilaDate(b.slot_start))}</div>
      <div class="notice-body">${escapeHtml(fmtSlotRange(b.slot_start, b.slot_end))} (Philippine time)${st.school ? ' · ' + escapeHtml(st.school) : ''}</div>
      ${locked ? '' : `<div class="arrive-note">${arriveByHtml(b.slot_start)}</div>`}
      ${reqHtml}
      ${actions}
      ${changeNote}
    </div>`;
}

// Downloads an .ics file so the student can add the pictorial to their phone's calendar.
function downloadBookingIcs(){
  const b = bookingState && bookingState.booking;
  if (!b) return;
  const stamp = (iso) => new Date(iso).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const ics = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Grad Pro Studios//Student Portal//EN', 'BEGIN:VEVENT',
    `UID:${b.id}@gradprostudios`, `DTSTAMP:${stamp(new Date().toISOString())}`,
    `DTSTART:${stamp(b.slot_start)}`, `DTEND:${stamp(b.slot_end || b.slot_start)}`,
    'SUMMARY:Graduation pictorial — Grad Pro Studios',
    `DESCRIPTION:${(bookingState.school || '').replace(/[,;\\]/g, ' ')} graduation pictorial. Please arrive by ${arriveByTime(b.slot_start)} (${ARRIVE_EARLY_MIN} minutes early).`,
    'BEGIN:VALARM', 'TRIGGER:-PT2H', 'ACTION:DISPLAY', 'DESCRIPTION:Pictorial in 2 hours', 'END:VALARM',
    'END:VEVENT', 'END:VCALENDAR',
  ].join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([ics], { type: 'text/calendar;charset=utf-8' }));
  a.download = 'grad-pro-pictorial.ics';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

document.addEventListener('click', (e) => {
  if (e.target.closest('[data-open-schedule]')) { clearAlert('apptAlert'); openSchedule('book'); return; }
  const reqBtn = e.target.closest('#appointmentsList [data-request]');
  if (reqBtn) {
    clearAlert('apptAlert');
    if (hasBookingStarted()) { alertBox('apptAlert', escapeHtml(BOOKING_STARTED_TEXT), 'error'); return; }
    openSchedule(reqBtn.dataset.request);
  }
});

document.getElementById('appointmentsList').addEventListener('click', async (e) => {
  if (e.target.closest('#apptCalendarBtn')) { downloadBookingIcs(); return; }
  const btn = e.target.closest('#apptWithdrawBtn');
  if (!btn) return;
  clearAlert('apptAlert');
  btn.disabled = true;
  const { error } = await rpc('withdraw_request', { p_token: getSession() });
  if (error) { btn.disabled = false; rpcFail('apptAlert', error); return; }
  alertBox('apptAlert', 'Your request was withdrawn.', 'success');
  await refreshBooking();
});

/* -------------------- SCHEDULE MODAL (book / reschedule / cancel) -------------------- */
let schedMode = 'book';
let slotsCache = [];
let slotsByDay = {};
let schedMonth = null;     // { y, m } with m 0-based
let schedDay = null;       // 'YYYY-MM-DD' (Manila)
let schedSlotId = null;
let schedBusy = false;

const SCHED_COPY = {
  book: { title: 'Choose your pictorial schedule', confirm: 'Confirm Pictorial Schedule', skip: 'Skip for now' },
  reschedule: { title: 'Pick your new schedule', confirm: 'Confirm New Schedule', skip: 'Keep my schedule' },
  cancel: { title: 'Cancel your pictorial booking?', confirm: 'Yes, cancel my booking', skip: 'Keep my schedule' },
};

function closeSchedule(){
  const modal = document.getElementById('schedModal');
  if (!modal) return;
  modal.classList.add('hidden');
  document.body.classList.remove('modal-open');
}

async function openSchedule(mode){
  schedMode = mode;
  document.querySelector('.sched-card').classList.remove('is-done');
  document.getElementById('schedDone').classList.add('hidden');
  document.getElementById('schedSteps').classList.toggle('hidden', mode !== 'book');
  schedDay = null;
  schedSlotId = null;
  const copy = SCHED_COPY[mode];
  document.getElementById('schedTitle').textContent = copy.title;
  document.getElementById('schedConfirm').textContent = copy.confirm;
  document.getElementById('schedSkip').textContent = copy.skip;
  document.getElementById('schedPicker').classList.toggle('hidden', mode === 'cancel');
  const school = (bookingState && bookingState.school) || (currentProfile && currentProfile['School']) || '';
  const b = bookingState && bookingState.booking;
  const current = b ? `${fmtManilaDate(b.slot_start)}, ${fmtSlotRange(b.slot_start, b.slot_end)}` : '';
  document.getElementById('schedSub').textContent =
    mode === 'cancel' ? `Current schedule: ${current}`
    : mode === 'reschedule' ? `Current schedule: ${current} · Only open slots are shown. Your change is saved right away.`
    : (school ? school + ' · ' : '') + 'Times are in Philippine time (Asia/Manila).';
  document.getElementById('schedCancelNote').classList.toggle('hidden', mode !== 'cancel');
  clearAlert('schedAlert');

  document.getElementById('schedModal').classList.remove('hidden');
  document.body.classList.add('modal-open');
  document.getElementById('schedTitle').focus();

  if (mode === 'cancel') { updateSchedConfirm(); return; }
  await loadSlots();
}

async function loadSlots(){
  document.getElementById('schedDays').innerHTML = '';
  document.getElementById('schedTimes').innerHTML = '<div class="sched-empty">Loading available slots…</div>';
  updateSchedConfirm();
  const { data, error } = await fetchAvailability(getSession());
  if (error) {
    rpcFail('schedAlert', error, 'Could not load available slots.');
    document.getElementById('schedTimes').innerHTML = '';
    return;
  }
  const current = bookingState && bookingState.booking && bookingState.booking.slot_id;
  slotsCache = data || [];
  const pickable = slotsCache.filter(s => !(schedMode === 'reschedule' && s.slot_id === current));
  slotsByDay = {};
  pickable.forEach(s => { (slotsByDay[manilaDateKey(s.slot_start)] = slotsByDay[manilaDateKey(s.slot_start)] || []).push(s); });

  if (schedDay && !dayOpen(schedDay)) { schedDay = null; schedSlotId = null; }
  if (schedSlotId && !pickable.some(s => s.slot_id === schedSlotId && s.slots_left > 0)) schedSlotId = null;

  const days = Object.keys(slotsByDay).sort();
  const firstOpen = days.find(dayOpen) || days[0];
  if (!schedMonth || !days.length || !schedDay) {
    const anchor = schedDay || firstOpen;
    if (anchor) schedMonth = { y: Number(anchor.slice(0, 4)), m: Number(anchor.slice(5, 7)) - 1 };
    else { const t = manilaDateKey(new Date().toISOString()); schedMonth = { y: Number(t.slice(0, 4)), m: Number(t.slice(5, 7)) - 1 }; }
  }
  renderCalendar();
  renderTimes();
}

function dayOpen(key){
  return (slotsByDay[key] || []).some(s => s.slots_left > 0);
}

function renderCalendar(){
  const { y, m } = schedMonth;
  document.getElementById('schedMonth').textContent =
    new Date(Date.UTC(y, m, 1)).toLocaleDateString('en-US', { timeZone: 'UTC', month: 'long', year: 'numeric' });

  const keys = Object.keys(slotsByDay).sort();
  const monthKey = (yy, mm) => yy * 12 + mm;
  const minM = keys.length ? monthKey(Number(keys[0].slice(0, 4)), Number(keys[0].slice(5, 7)) - 1) : monthKey(y, m);
  const maxKey = keys[keys.length - 1];
  const maxM = keys.length ? monthKey(Number(maxKey.slice(0, 4)), Number(maxKey.slice(5, 7)) - 1) : monthKey(y, m);
  document.getElementById('schedPrev').disabled = monthKey(y, m) <= minM;
  document.getElementById('schedNext').disabled = monthKey(y, m) >= maxM;

  const lead = new Date(Date.UTC(y, m, 1)).getUTCDay();
  const count = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  let html = '';
  for (let i = 0; i < lead; i++) html += '<span class="sched-day blank" aria-hidden="true"></span>';
  for (let d = 1; d <= count; d++) {
    const key = `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const has = !!slotsByDay[key];
    const open = dayOpen(key);
    const cls = ['sched-day', open ? 'open' : 'disabled', has && !open ? 'full' : '', key === schedDay ? 'selected' : ''].join(' ');
    const label = new Date(Date.UTC(y, m, d)).toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'long', month: 'long', day: 'numeric' })
      + (open ? '' : has ? ' (full)' : ' (no slots)');
    html += `<button type="button" class="${cls}" data-day="${key}" ${open ? '' : 'disabled'} aria-label="${label}" aria-pressed="${key === schedDay}">${d}</button>`;
  }
  document.getElementById('schedDays').innerHTML = html;
}

function renderTimes(){
  const box = document.getElementById('schedTimes');
  const head = document.getElementById('schedDateLabel');
  if (!Object.keys(slotsByDay).length) {
    head.textContent = 'No open slots';
    box.innerHTML = '<div class="sched-empty">There are no open pictorial slots right now. Please check back later.</div>';
    updateSchedConfirm();
    return;
  }
  if (!schedDay) {
    head.textContent = 'Select a date';
    box.innerHTML = '<div class="sched-empty">Pick an available date on the calendar to see the times.</div>';
    updateSchedConfirm();
    return;
  }
  head.textContent = fmtManilaDate(slotsByDay[schedDay][0].slot_start);
  box.innerHTML = slotsByDay[schedDay].map(s => {
    const full = s.slots_left <= 0;
    const sel = s.slot_id === schedSlotId;
    return `<button type="button" class="sched-time${sel ? ' selected' : ''}" data-slot="${s.slot_id}" ${full ? 'disabled' : ''} aria-pressed="${sel}">
      <span>${escapeHtml(fmtSlotRange(s.slot_start, s.slot_end))}</span>
      <span class="sched-left">${full ? 'Full' : s.slots_left + ' left'}</span>
    </button>`;
  }).join('');
  updateSchedConfirm();
}

function updateSchedConfirm(){
  document.getElementById('schedConfirm').disabled = schedBusy || (schedMode !== 'cancel' && !schedSlotId);
  // Arrival reminder under the times as soon as a time is picked.
  const note = document.getElementById('schedArriveNote');
  const slot = schedMode !== 'cancel' && schedSlotId && schedDay && (slotsByDay[schedDay] || []).find(s => s.slot_id === schedSlotId);
  note.innerHTML = slot ? arriveByHtml(slot.slot_start) : '';
  note.classList.toggle('hidden', !slot);
}

document.getElementById('schedDays').addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-day]');
  if (!btn || btn.disabled) return;
  schedDay = btn.dataset.day;
  schedSlotId = null;
  clearAlert('schedAlert');
  renderCalendar();
  renderTimes();
});
document.getElementById('schedTimes').addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-slot]');
  if (!btn || btn.disabled) return;
  schedSlotId = btn.dataset.slot;
  renderTimes();
});
document.getElementById('schedPrev').addEventListener('click', () => {
  const d = new Date(Date.UTC(schedMonth.y, schedMonth.m - 1, 1));
  schedMonth = { y: d.getUTCFullYear(), m: d.getUTCMonth() };
  renderCalendar();
});
document.getElementById('schedNext').addEventListener('click', () => {
  const d = new Date(Date.UTC(schedMonth.y, schedMonth.m + 1, 1));
  schedMonth = { y: d.getUTCFullYear(), m: d.getUTCMonth() };
  renderCalendar();
});

function skipSchedule(){
  if (schedBusy) return;
  if (schedMode === 'book') sessionStorage.setItem(SCHED_PROMPTED_KEY, '1');
  closeSchedule();
}
document.getElementById('schedSkip').addEventListener('click', skipSchedule);
document.getElementById('schedClose').addEventListener('click', skipSchedule);
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !document.getElementById('schedModal').classList.contains('hidden')) skipSchedule();
});

document.getElementById('schedConfirm').addEventListener('click', async () => {
  clearAlert('schedAlert');
  const btn = document.getElementById('schedConfirm');
  const idle = btn.textContent;
  schedBusy = true;
  updateSchedConfirm();
  btn.innerHTML = '<span class="spinner"></span>Saving…';

  const token = getSession();
  const res = schedMode === 'book' ? await rpc('book_slot', { p_token: token, p_slot_id: schedSlotId })
    : schedMode === 'reschedule' ? await rpc('student_reschedule', { p_token: token, p_slot_id: schedSlotId })
    : await rpc('student_cancel_booking', { p_token: token });

  schedBusy = false;
  btn.textContent = idle;
  updateSchedConfirm();

  if (res.error) {
    if (res.error.handled) return;
    const code = res.error.message;
    if (code === 'slot_full' || code === 'slot_unavailable' || code === 'slot_not_found' || code === 'same_slot') {
      schedSlotId = null;
      await loadSlots();
      alertBox('schedAlert', escapeHtml(ERROR_TEXT[code]), 'error');
      return;
    }
    if (code === 'booking_started' || code === 'past_cutoff') { alertBox('schedAlert', escapeHtml(BOOKING_STARTED_TEXT), 'error'); await refreshBooking(); return; }
    rpcFail('schedAlert', res.error);
    if (code === 'already_booked' || code === 'request_pending' || code === 'no_active_booking' || code === 'booking_closed') await refreshBooking();
    return;
  }

  const mode = schedMode;
  if (mode !== 'cancel') {
    await refreshBooking();
    showBookingDone(mode, res.data || {});
    return;
  }
  closeSchedule();
  await refreshBooking();
  showTab('tab-appointments');
  if (mode === 'cancel') {
    alertBox('apptAlert', 'Your pictorial booking was cancelled. You can book a new schedule any time while booking is open.', 'success');
  } else {
    const b = res.data || {};
    alertBox('apptAlert', `Your pictorial ${mode === 'book' ? 'is booked for' : 'is now moved to'} <strong>${escapeHtml(fmtManilaDate(b.slot_start))}, ${escapeHtml(fmtSlotRange(b.slot_start, b.slot_end))}</strong>.`, 'success');
  }
});

// What students see after booking. Edit this list to match the studio's own reminders.
// The arrival time (ARRIVE_EARLY_MIN before the schedule) is shown on its own above this list.
const BEFORE_PICTORIAL = [
  'Get a good night’s sleep the night before',
  'Eat a light meal and drink water before you come',
  'Come with clean, neatly styled hair',
  'Keep your face fresh: light, natural makeup works best on camera',
  'Bring a comb, face powder or oil-blotting paper for a quick touch-up',
];
let lastBookedMode = 'book';
function showBookingDone(mode, b){
  lastBookedMode = mode;
  document.getElementById('schedDoneTitle').textContent = mode === 'book' ? 'You’re booked!' : 'Schedule updated';
  document.getElementById('schedDoneSub').textContent = mode === 'book' ? 'Your pictorial schedule is saved.' : 'Your pictorial is moved to the new schedule.';
  document.getElementById('schedDoneWhen').textContent = b.slot_start ? fmtManilaDate(b.slot_start) + ' · ' + fmtSlotRange(b.slot_start, b.slot_end) : '';
  document.getElementById('schedDoneArrive').innerHTML = b.slot_start ? arriveByHtml(b.slot_start) : '';
  document.getElementById('schedDoneBring').innerHTML = BEFORE_PICTORIAL.map(t => '<li>' + escapeHtml(t) + '</li>').join('');
  document.getElementById('schedDone').classList.remove('hidden');
  document.querySelector('.sched-card').classList.add('is-done');
  document.getElementById('schedDoneTitle').focus();
}
document.getElementById('schedDoneClose').addEventListener('click', () => {
  closeSchedule();
  showTab('tab-appointments');
  const b = bookingState && bookingState.booking;
  if (b) alertBox('apptAlert', `Your pictorial ${lastBookedMode === 'book' ? 'is booked for' : 'is now moved to'} <strong>${escapeHtml(fmtManilaDate(b.slot_start))}, ${escapeHtml(fmtSlotRange(b.slot_start, b.slot_end))}</strong>.`, 'success');
});
document.getElementById('schedDoneCal').addEventListener('click', () => downloadBookingIcs());

/* -------------------- RENDER PROFILE GRID -------------------- */
function renderProfileGrid(){
  const grid = document.getElementById('profileGrid');
  const actions = document.getElementById('profileEditActions');
  const editBtn = document.getElementById('editProfileBtn');

  if (!profileEditMode) {
    const rows = [
      ['Full name', currentProfile['Full Name'] || 'Not set yet'],
      ['Username', currentProfile['Username'] || 'Not set yet'],
      ['Email', currentUser.email],
      ['Gender', currentProfile['Gender'] || 'Not set yet'],
      ['School', currentProfile['School'] || 'Not set yet'],
      ['College', currentProfile['College'] || 'Not set yet'],
      ['Course', currentProfile['Course'] || 'Not set yet'],
      ['Major', currentProfile['Major'] || 'Not set yet'],
      ['Contact number', currentProfile['Contact .'] || 'Not set yet'],
      ['Socials', currentProfile['Socials'] || 'Not set yet'],
    ];

    grid.innerHTML = rows.map(([label, val]) => `
    <div class="profile-field">
      <span class="eyebrow">${label}</span>
      <div class="val">${escapeHtml(val)}</div>
    </div>
    `).join('');
    actions.classList.add('hidden');
    editBtn.textContent = 'Edit details';
    editBtn.classList.remove('hidden');
    return;
  }

  const p = currentProfile;
  // With an active booking the school is fixed (slots belong to a school), so it is shown as
  // locked text with the reason, not as a search box that could rewrite or clear it.
  const schoolLocked = !!(bookingState && bookingState.booking);
  grid.innerHTML = `
    <div class="profile-field">
      <span class="eyebrow">Username</span>
      <div class="val val-locked">${escapeHtml(p['Username'] || '')}</div>
    </div>
    <div class="profile-field">
      <span class="eyebrow">Email</span>
      <div class="val val-locked">${escapeHtml(currentUser.email || '')}</div>
    </div>
    <div class="profile-field">
      <label class="eyebrow" for="edit_LastName">Last name<span class="req-star">*</span></label>
      <input type="text" id="edit_LastName" value="${escapeHtml(p['Last Name'] || '')}" required>
    </div>
    <div class="profile-field">
      <label class="eyebrow" for="edit_FirstName">First name<span class="req-star">*</span></label>
      <input type="text" id="edit_FirstName" value="${escapeHtml(p['First Name'] || '')}" required>
    </div>
    <div class="profile-field">
      <label class="eyebrow" for="edit_MiddleInitial">Middle initial</label>
      <input type="text" id="edit_MiddleInitial" maxlength="1" value="${escapeHtml(p['Middle Initial'] || '')}">
    </div>
    <div class="profile-field">
      <label class="eyebrow" for="edit_Suffix">Suffix</label>
      <input type="text" id="edit_Suffix" placeholder="Jr., Sr., III">
    </div>
    <div class="profile-field">
      <span class="eyebrow">Suffix placement</span>
      <div class="radio-row">
        <label><input type="radio" name="edit_SuffixPlacement" value="none" checked> None</label>
        <label><input type="radio" name="edit_SuffixPlacement" value="last"> After last name</label>
        <label><input type="radio" name="edit_SuffixPlacement" value="first"> After first name</label>
      </div>
    </div>
    <div class="profile-field suggest-wrap">
      <label class="eyebrow" for="edit_Gender">Gender<span class="req-star">*</span></label>
      <input type="text" id="edit_Gender" value="${escapeHtml(p['Gender'] || '')}" autocomplete="off" placeholder="Type to search...">
      <div class="suggest-list" id="edit_GenderList"></div>
    </div>
    <div class="profile-field span-2 suggest-wrap">
      <label class="eyebrow" for="edit_School">School<span class="req-star">*</span></label>
      ${schoolLocked
        ? `<div class="val val-locked" id="edit_SchoolLocked">${escapeHtml(p['School'] || '')}</div>
      <div class="field-hint school-lock-note">&#128274; Your school is locked because you have a pictorial booking. To change it, cancel your booking in <button type="button" class="dbx-link" data-goto-tab="tab-appointments">Appointments</button> first, or contact the studio.</div>`
        : `<input type="text" id="edit_School" value="${escapeHtml(p['School'] || '')}" autocomplete="off" placeholder="Type to search your school">
      <div class="suggest-list" id="edit_SchoolList"></div>`}
    </div>
    <div class="profile-field span-2 suggest-wrap">
      <label class="eyebrow" for="edit_College">College</label>
      <input type="text" id="edit_College" value="${escapeHtml(p['College'] || '')}" autocomplete="off" placeholder="Type to search (leave blank if none)">
      <div class="suggest-list" id="edit_CollegeList"></div>
    </div>
    <div class="profile-field span-2 suggest-wrap">
      <label class="eyebrow" for="edit_Course">Course</label>
      <input type="text" id="edit_Course" value="${escapeHtml(p['Course'] || '')}" autocomplete="off" placeholder="Type to search your course">
      <div class="suggest-list" id="edit_CourseList"></div>
    </div>
    <div class="profile-field span-2 suggest-wrap">
      <label class="eyebrow" for="edit_Major">Major</label>
      <input type="text" id="edit_Major" value="${escapeHtml(p['Major'] || '')}" autocomplete="off" placeholder="Type to search (leave blank if none)">
      <div class="suggest-list" id="edit_MajorList"></div>
    </div>
    <div class="profile-field">
      <label class="eyebrow" for="edit_Contact">Contact number<span class="req-star">*</span></label>
      <input type="text" id="edit_Contact" value="${escapeHtml(p['Contact .'] || '')}" required>
    </div>
    <div class="profile-field">
      <label class="eyebrow" for="edit_Socials">Socials</label>
      <input type="text" id="edit_Socials" value="${escapeHtml(p['Socials'] || '')}">
    </div>
    <div class="profile-field span-2">
      <span class="eyebrow">Name preview</span>
      <div class="val name-preview" id="edit_NamePreview"></div>
    </div>
  `;
  actions.classList.remove('hidden');
  editBtn.classList.add('hidden');

  attachAutoCapitalize('edit_');

  setupTypeahead('edit_Gender', 'edit_GenderList', distinctGenders, {
    required: true,
    onInvalid: (why) => { if (why === 'nomatch') alertBox('profileAlert', 'Please pick a Gender from the suggestions.', 'error'); }
  });
  if (!schoolLocked) setupTypeahead('edit_School', 'edit_SchoolList', distinctSchools, {
    required: true,
    onInvalid: (why) => { if (why === 'nomatch') alertBox('profileAlert', 'Please pick a School from the suggestions.', 'error'); }
  });
  setupTypeahead('edit_College', 'edit_CollegeList', distinctColleges, {
    onInvalid: (why) => { if (why === 'nomatch') alertBox('profileAlert', 'Please pick a College from the suggestions, or leave it blank.', 'error'); }
  });
  setupTypeahead('edit_Course', 'edit_CourseList', distinctCourses, {
    onInvalid: (why) => { if (why === 'nomatch') alertBox('profileAlert', 'Please pick a Course from the suggestions, or leave it blank.', 'error'); }
  });
  setupTypeahead('edit_Major', 'edit_MajorList', distinctMajors, {
    onInvalid: (why) => { if (why === 'nomatch') alertBox('profileAlert', 'Please pick a Major from the suggestions, or leave it blank.', 'error'); }
  });

  const preview = () => {
    document.getElementById('edit_NamePreview').textContent = buildFullName(
      smartName(document.getElementById('edit_LastName').value),
      document.getElementById('edit_FirstName').value.trim(),
      document.getElementById('edit_MiddleInitial').value.toUpperCase(),
      formatSuffix(document.getElementById('edit_Suffix').value),
      (document.querySelector('input[name="edit_SuffixPlacement"]:checked') || {}).value || 'none'
    ) || '—';
  };
  ['edit_LastName','edit_FirstName','edit_MiddleInitial','edit_Suffix'].forEach(id =>
    document.getElementById(id).addEventListener('input', preview));
  document.querySelectorAll('input[name="edit_SuffixPlacement"]').forEach(r =>
    r.addEventListener('change', preview));
  preview();
}

// Links drawn inside the profile grid (e.g. "Appointments" in the locked-school note).
document.getElementById('profileGrid').addEventListener('click', (e) => {
  const link = e.target.closest('[data-goto-tab]');
  if (link) showTab(link.dataset.gotoTab);
});

document.getElementById('editProfileBtn').addEventListener('click', () => {
  clearAlert('profileAlert');
  profileEditMode = true;
  renderProfileGrid();
});

document.getElementById('cancelProfileBtn').addEventListener('click', () => {
  clearAlert('profileAlert');
  profileEditMode = false;
  renderProfileGrid();
});

document.getElementById('saveProfileBtn').addEventListener('click', async () => {
  clearAlert('profileAlert');

  const val = (id) => document.getElementById(id).value.trim();

  const lastName = smartName(val('edit_LastName'));
  const firstName = val('edit_FirstName');
  const middleInitial = val('edit_MiddleInitial').toUpperCase();
  const suffix = formatSuffix(val('edit_Suffix'));
  const gender = val('edit_Gender');
  // Locked school: send the saved value exactly as it is, so the server never sees a "change".
  const schoolInput = document.getElementById('edit_School');
  const school = schoolInput ? schoolInput.value.trim() : (currentProfile['School'] || '');
  const contact = val('edit_Contact');

  if (!lastName) { alertBox('profileAlert', 'Last name is required.', 'error'); return; }
  if (!firstName) { alertBox('profileAlert', 'First name is required.', 'error'); return; }
  if (!gender) { alertBox('profileAlert', 'Please select your gender.', 'error'); return; }
  if (!school) { alertBox('profileAlert', 'Please select your school.', 'error'); return; }
  if (!contact) { alertBox('profileAlert', 'Contact number is required.', 'error'); return; }

  const placement = (document.querySelector('input[name="edit_SuffixPlacement"]:checked') || {}).value || 'none';
  const fullName = buildFullName(lastName, firstName, middleInitial, suffix, placement);

  const updates = {
    'Last Name': lastName,
    'First Name': firstName,
    'Middle Initial': middleInitial,
    'Gender': gender,
    'School': school,
    'College': val('edit_College'),
    'Course': val('edit_Course'),
    'Major': val('edit_Major'),
    'Contact .': contact,
    'Socials': val('edit_Socials'),
    'Full Name': fullName,
  };

  const btn = document.getElementById('saveProfileBtn');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span>Saving…';

  const { data, error } = await rpc('student_save_profile', { p_token: getSession(), p_profile: updates });

  btn.disabled = false;
  btn.textContent = 'Save changes';

  if (error) {
    if (error.message === 'duplicate_full_name') {
      alertBox('profileAlert',
        `"${escapeHtml(fullName)}" is already registered under a different account. Add a Middle Initial or Suffix to tell your record apart, or contact the studio for help.`,
        'error');
      return;
    }
    rpcFail('profileAlert', error);
    return;
  }

  const schoolChanged = (currentProfile['School'] || '').trim().toLowerCase() !== (data['School'] || '').trim().toLowerCase();
  currentProfile = data;
  currentUser = { username: data['Username'], email: data['Email'] };
  profileEditMode = false;
  renderProfileGrid();
  alertBox('profileAlert', 'Details updated.', 'success');

  const dn = (currentProfile['First Name'] || '').trim() || currentProfile['Username'] || '';
  document.getElementById('dashGreeting').textContent = dn ? `Welcome, ${dn}` : 'Welcome';
  if (schoolChanged) { renderNotices(); refreshBooking(); }
});

/* -------------------- STEP 2 — student info registration -------------------- */
let step2TypeaheadWired = false;

// Accepts 9171234567, 09171234567, +63 917 123 4567 or 639171234567; saves it as 09171234567.
function normalizePhMobile(value){
  let d = String(value || '').replace(/\D/g, '');
  if (d.length === 12 && d.startsWith('63')) d = d.slice(2);
  else if (d.length === 11 && d.startsWith('0')) d = d.slice(1);
  return /^9\d{9}$/.test(d) ? '0' + d : null;
}

async function showStep2(profile){
  await loadLookups();
  currentProfile = profile || {};
  currentUser = { username: currentProfile['Username'], email: currentProfile['Email'] };

  ['s2LastName','s2FirstName','s2MiddleInitial','s2Suffix',
   's2Gender','s2School','s2College','s2Course','s2Major',
   's2Contact','s2Socials'].forEach(id => {
    document.getElementById(id).value = '';
  });
  const noneRadio = document.querySelector('input[name="s2SuffixPlacement"][value="none"]');
  if (noneRadio) noneRadio.checked = true;
  document.getElementById('s2NamePreview').textContent = '—';
  clearAlert('step2Alert');

  if (!step2TypeaheadWired){
    step2TypeaheadWired = true;
    attachAutoCapitalize('s2');
    setupTypeahead('s2Gender', 's2GenderList', distinctGenders, {
      required: true,
      onInvalid: (why) => { if (why === 'nomatch') alertBox('step2Alert', 'Please pick a Gender from the suggestions.', 'error'); }
    });
    setupTypeahead('s2School', 's2SchoolList', distinctSchools, {
      required: true,
      onInvalid: (why) => { if (why === 'nomatch') alertBox('step2Alert', 'Please pick a School from the suggestions.', 'error'); }
    });
    setupTypeahead('s2College', 's2CollegeList', distinctColleges, {
      onInvalid: (why) => { if (why === 'nomatch') alertBox('step2Alert', 'Please pick a College from the suggestions, or leave it blank.', 'error'); }
    });
    setupTypeahead('s2Course', 's2CourseList', distinctCourses, {
      onInvalid: (why) => { if (why === 'nomatch') alertBox('step2Alert', 'Please pick a Course from the suggestions, or leave it blank.', 'error'); }
    });
    setupTypeahead('s2Major', 's2MajorList', distinctMajors, {
      onInvalid: (why) => { if (why === 'nomatch') alertBox('step2Alert', 'Please pick a Major from the suggestions, or leave it blank.', 'error'); }
    });
  }

  showView('step2');
}

function updateStep2Preview(){
  const placement = (document.querySelector('input[name="s2SuffixPlacement"]:checked') || {}).value || 'none';
  document.getElementById('s2NamePreview').textContent = buildFullName(
    smartName(document.getElementById('s2LastName').value),
    document.getElementById('s2FirstName').value.trim(),
    document.getElementById('s2MiddleInitial').value.toUpperCase(),
    formatSuffix(document.getElementById('s2Suffix').value),
    placement
  ) || '—';
}
['s2LastName','s2FirstName','s2MiddleInitial','s2Suffix'].forEach(id => {
  document.getElementById(id).addEventListener('input', updateStep2Preview);
});
document.querySelectorAll('input[name="s2SuffixPlacement"]').forEach(r =>
  r.addEventListener('change', updateStep2Preview));

document.getElementById('step2Cancel').addEventListener('click', () => signOutStudent());

document.getElementById('step2Form').addEventListener('submit', async (e) => {
  e.preventDefault();
  clearAlert('step2Alert');

  if (!getSession()) { showView('login'); return; }

  const val = (id) => document.getElementById(id).value.trim();
  const lastName = smartName(val('s2LastName'));
  const firstName = val('s2FirstName');
  const middleInitial = val('s2MiddleInitial').toUpperCase();
  const suffix = formatSuffix(val('s2Suffix'));
  const gender = val('s2Gender');
  const school = val('s2School');
  const contact = val('s2Contact');

  if (!lastName) { alertBox('step2Alert', 'Please enter Last Name.', 'error'); return; }
  if (!firstName) { alertBox('step2Alert', 'Please enter First Name.', 'error'); return; }
  if (!gender) { alertBox('step2Alert', 'Please select your Gender.', 'error'); return; }
  if (!school) { alertBox('step2Alert', 'Please select your School.', 'error'); return; }
  if (!contact) { alertBox('step2Alert', 'Please enter Contact Number.', 'error'); return; }
  const mobile = normalizePhMobile(contact);
  if (!mobile) { alertBox('step2Alert', 'Please enter a valid 10-digit mobile number, e.g. 917 123 4567.', 'error'); return; }

  const placement = (document.querySelector('input[name="s2SuffixPlacement"]:checked') || {}).value || 'none';
  const fullName = buildFullName(lastName, firstName, middleInitial, suffix, placement);

  const btn = document.getElementById('step2Submit');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span>Saving…';

  const { data, error } = await rpc('student_save_profile', {
    p_token: getSession(),
    p_profile: {
      'Last Name': lastName,
      'First Name': firstName,
      'Middle Initial': middleInitial,
      'Gender': gender,
      'School': school,
      'College': val('s2College'),
      'Course': val('s2Course'),
      'Major': val('s2Major'),
      'Contact .': mobile,
      'Socials': val('s2Socials'),
      'Full Name': fullName,
    }
  });

  btn.disabled = false;
  btn.textContent = 'Next';

  if (error) {
    if (error.message === 'duplicate_full_name') {
      alertBox('step2Alert',
        `"${escapeHtml(fullName)}" is already registered in our system. If this is you and you already have an account, please log in instead. If someone else shares this exact name, add a Middle Initial or Suffix to tell your record apart, or contact the studio for help.`,
        'error');
      return;
    }
    rpcFail('step2Alert', error);
    return;
  }

  // loadDashboard opens the schedule modal if this school has booking enabled and
  // the student has no booking yet; "Skip for now" just leaves them on the dashboard.
  await loadDashboard(data);
});

/* -------------------- BOOTSTRAP: check session on load -------------------- */
(async function init(){
  const oauthRaw = sessionStorage.getItem(OAUTH_KEY);
  if (oauthRaw) {
    sessionStorage.removeItem(OAUTH_KEY);
    let st = null;
    try { st = JSON.parse(oauthRaw); } catch (err) {}
    if (st) { await handleOAuthReturn(st); return; }
  }

  if (getSession()) {
    await enterPortal();
  } else {
    const params = new URLSearchParams(window.location.search);
    showView(params.get('view') === 'register' ? 'register' : 'login');
  }
})();

/* -------------------- INACTIVITY AUTO-LOGOUT (5 min) -------------------- */
const INACTIVITY_LIMIT_MS = 5 * 60 * 1000;
let inactivityTimer = null;

function resetInactivityTimer(){
  clearTimeout(inactivityTimer);
  inactivityTimer = setTimeout(() => {
    if (getSession()) signOutStudent('You were logged out due to inactivity.');
  }, INACTIVITY_LIMIT_MS);
}

['mousemove', 'keydown', 'click', 'scroll', 'touchstart'].forEach(evt => {
  document.addEventListener(evt, resetInactivityTimer, { passive: true });
});

resetInactivityTimer();

/* -------------------- COOKIE CONSENT BANNER -------------------- */
const COOKIE_CONSENT_KEY = 'gpsCookieConsent';

function showCookieBannerIfNeeded(){
  const banner = document.getElementById('cookieBanner');
  if (!banner) return;
  const alreadyAccepted = localStorage.getItem(COOKIE_CONSENT_KEY) === 'accepted';
  if (!alreadyAccepted) {
    banner.classList.remove('hidden');
  }
}

document.getElementById('cookieAcceptBtn').addEventListener('click', () => {
  localStorage.setItem(COOKIE_CONSENT_KEY, 'accepted');
  document.getElementById('cookieBanner').classList.add('hidden');
});

showCookieBannerIfNeeded();

/* -------------------- SOFT COPIES: reads the Drive folder columns on the Clients row -------------------- */
function softCopyRowHTML(label, url, expiresAt){
  const ms = new Date(expiresAt) - Date.now();
  const active = !!url && ms > 0;
  const days = Math.ceil(ms / 86400000);
  const exp = new Date(expiresAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const msg = active ? `Access ends ${exp} (${days} day${days === 1 ? '' : 's'} left). Open it with the email you registered with. If asked, request a PIN and check that inbox.` : 'This link has expired. Please contact the studio to request a new one.';
  const btn = active ? `<div class="notice-meta"><a class="btn btn-primary btn-inline" href="${escapeHtml(url)}" target="_blank" rel="noopener">Open folder</a></div>` : '';
  return `<div class="notice-row full"><div class="notice-title">${label}<span class="appt-status ${active ? 'confirmed' : ''}">${active ? 'Available' : 'Expired'}</span></div><div class="notice-body">${msg}</div>${btn}</div>`;
}

function renderSoftCopies(){
  const list = document.getElementById('softCopyList');
  if (!list) return;
  const p = currentProfile || {};
  const items = [['RAW photos', p.raw_folder_url, p.raw_expires_at], ['Edited photos', p.edited_folder_url, p.edited_expires_at]].filter(it => it[2]);
  list.innerHTML = items.length ? items.map(it => softCopyRowHTML(it[0], it[1], it[2])).join('') : '<div class="stub-empty">No photos have been delivered yet.</div>';
}
