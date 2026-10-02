const SUPABASE_URL = "https://rkxuwluybpynxvguhqpn.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_uBCFBzLjcvRSK5ZcIevXZw_GzhneWhJ";

const sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

/* -------------------- CLOUDFLARE TURNSTILE (bot protection) -------------------- */
const TURNSTILE_SITE_KEY = "0x4AAAAAAD4Y5yYW8B-1flNT";
let turnstileWidgets = {};

// Cloudflare calls this itself once its script has loaded (render=explicit mode).
window.onloadTurnstileCallback = function(){
  if (typeof turnstile === 'undefined') return;
  turnstileWidgets.login = turnstile.render('#turnstileLogin', { sitekey: TURNSTILE_SITE_KEY });
  turnstileWidgets.register = turnstile.render('#turnstileRegister', { sitekey: TURNSTILE_SITE_KEY });
  turnstileWidgets.resend = turnstile.render('#turnstileResend', { sitekey: TURNSTILE_SITE_KEY });
};

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

/* -------------------- view helpers -------------------- */
let pendingUser = null;
let pendingRegistration = null;

function isUsernameTakenInClients(username){
  return sb.from('Clients').select('Username').eq('Username', username).limit(1)
    .then(({ data, error }) => {
      if (error) { console.error(error); return false; }
      return data && data.length > 0;
    });
}

function pendingFullName(username){
  return 'PENDING::' + username;
}
function isPendingRegistration(clientRow){
  return !clientRow || (clientRow['Full Name'] || '').indexOf('PENDING::') === 0;
}

const SESSION_KEY = 'gps_username';
function setSession(username){ sessionStorage.setItem(SESSION_KEY, username); }
function getSession(){ return sessionStorage.getItem(SESSION_KEY); }
function clearSession(){ sessionStorage.removeItem(SESSION_KEY); }

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

async function savePendingPackageSelection(studentProfileId){
  const pkgName = sessionStorage.getItem('pendingPackageName');
  const pkgPrice = sessionStorage.getItem('pendingPackagePrice');

  if (pkgName && pkgPrice) {
    const { error } = await sb.from('package_selections').insert({
      student_id: studentProfileId,
      package_name: pkgName,
      package_price: Number(pkgPrice)
    });

    if (!error || error.code === '23505') {
      sessionStorage.removeItem('pendingPackageName');
      sessionStorage.removeItem('pendingPackagePrice');
    }
  }

  const pkgDate = sessionStorage.getItem('pendingPreferredDate');
  if (pkgDate) {
    const { error: apptError } = await sb.from('appointments').insert({
      student_id: studentProfileId,
      appointment_type: 'photoshoot',
      scheduled_at: pkgDate + 'T00:00:00',
      status: 'pending',
      notes: 'Preferred walk-in date from package selection — awaiting studio confirmation.'
    });
    if (!apptError) {
      sessionStorage.removeItem('pendingPreferredDate');
    }
  }
}

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
    alertBox('registerAlert', 'Please check the **Terms & Conditions** and **Data Privacy Agreement** before proceeding.', 'error');
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

  const usernameTaken = await isUsernameTakenInClients(username);
  if (usernameTaken) {
    btn.disabled = false;
    btn.textContent = 'Create account';
    alertBox('registerAlert', 'That username is already taken. Please choose another.', 'error');
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
  showView('verify');
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

  const looksLikeEmail = identifier.includes('@');
  let query = sb.from('Clients').select('*');
  if (looksLikeEmail) {
    const safeEmail = identifier.replace(/[\\%_]/g, '\\$&');
    query = query.ilike('Email', safeEmail).limit(50);
  } else {
    query = query.eq('Username', identifier).limit(1);
  }
  const { data: rows, error } = await query;

  resetTurnstile('login');
  btn.disabled = false;
  btn.textContent = 'Log in';

  const row = !error && rows ? rows.find(r => r['Password'] === password) : null;
  if (!row) {
    alertBox('loginAlert', 'Invalid username/email or password.', 'error');
    return;
  }

  if (isPendingRegistration(row)) {
    pendingUser = { username: row['Username'], email: row['Email'] };
    await showStep2();
  } else {
    setSession(row['Username']);
    await loadDashboard({ username: row['Username'], email: row['Email'] }, row);
  }
});

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
  if (/invalid credentials/i.test(m)) return 'Incorrect password.';
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
  const { data } = await sb.rpc('list_social_links', { p_username: currentUser.username });
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
    const { error } = await sb.rpc('unlink_social', { p_username: currentUser.username, p_password: pw, p_provider: provider });
    if (error) { alertBox('socialAlert', socialErr(error), 'error'); return; }
    document.getElementById('socialPw').value = '';
    alertBox('socialAlert', `${label} disconnected.`, 'success');
    renderSocialList();
    return;
  }

  const { data: token, error } = await sb.rpc('create_link_token', { p_username: currentUser.username, p_password: pw });
  if (error) { alertBox('socialAlert', socialErr(error), 'error'); return; }
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
    const { error } = await sb.rpc('link_social', { p_token: st.token, p_provider: st.provider });
    await sb.auth.signOut();
    const username = getSession();
    if (!username) { showView('login'); return; }
    const { data: rows } = await sb.from('Clients').select('*').eq('Username', username).limit(1);
    const row = rows && rows[0];
    if (!row) { clearSession(); showView('login'); return; }
    await loadDashboard({ username: row['Username'], email: row['Email'] }, row);
    alertBox('socialAlert', error ? socialErr(error) : `${label} connected.`, error ? 'error' : 'success');
    return;
  }

  const { data: reg, error: regError } = await sb.rpc('social_register', { p_provider: st.provider });
  await sb.auth.signOut();
  const info = Array.isArray(reg) ? reg[0] : reg;
  if (regError || !info || !info.username) {
    showView('login');
    alertBox('loginAlert', socialAuthErr(regError, label), 'error');
    return;
  }
  const { data: rows } = await sb.from('Clients').select('*').eq('Username', info.username).limit(1);
  const row = rows && rows[0];
  if (!row) { showView('login'); alertBox('loginAlert', 'Account not found.', 'error'); return; }
  if (isPendingRegistration(row)) {
    pendingUser = { username: row['Username'], email: row['Email'] };
    await showStep2();
    if (info.is_new) alertBox('step2Alert', `Signed in with ${label}. Please complete your details to finish registering.`, 'success');
  } else {
    setSession(row['Username']);
    await loadDashboard({ username: row['Username'], email: row['Email'] }, row);
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

  btn.disabled = false;
  btn.textContent = 'Verify code';

  if (error) {
    alertBox('verifyAlert', error.message, 'error');
    return;
  }

  const reg = pendingRegistration;
  pendingRegistration = null;

  if (reg) {
    const { error: clientsError } = await sb.from('Clients').insert({
      'Username': reg.username,
      'Password': reg.password,
      'Email': reg.email,
      'Full Name': pendingFullName(reg.username),
      'Date': new Date().toISOString().slice(0, 10)
    });
    if (clientsError) {
      alertBox('verifyAlert', clientsError.message, 'error');
      return;
    }
  }

  pendingUser = reg ? { username: reg.username, email: reg.email } : { email };
  await showStep2();
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
  }
});

/* -------------------- FORGOT PASSWORD (OTP) — step 1: look up account + send code -------------------- */
let gpsReset = { username: '', email: null };

function maskEmail(email){
  const parts = email.split('@');
  const u = parts[0];
  return (u.length <= 2 ? u[0] : u.slice(0, 2)) + '***@' + parts[1];
}
function sendOtp(email){
  return sb.auth.signInWithOtp({ email, options: { shouldCreateUser: true } });
}

document.getElementById('forgotForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  clearAlert('forgotAlert');

  const username = document.getElementById('forgotEmail').value.trim();
  const btn = document.getElementById('forgotSubmit');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span>Sending code…';

  const { data } = await sb.from('Clients').select('Username, Email').eq('Username', username).limit(1);
  const row = data && data[0];
  gpsReset = { username, email: null };

  if (row && row.Email) {
    const { error } = await sendOtp(row.Email);
    if (error) {
      btn.disabled = false;
      btn.textContent = 'Send code';
      alertBox('forgotAlert', error.message, 'error');
      return;
    }
    gpsReset = { username: row.Username, email: row.Email };
  }

  btn.disabled = false;
  btn.textContent = 'Send code';

  document.getElementById('resetCopy').innerHTML =
    'If <strong id="resetEmailShown">' + escapeHtml(username) + '</strong> exists, we sent a 6-digit code to its registered email' +
    (gpsReset.email ? ' (' + escapeHtml(maskEmail(gpsReset.email)) + ')' : '') +
    '. Enter it below and choose a new password.';
  document.getElementById('resetOtpCode').value = '';
  showView('reset');
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
  await sb.auth.signOut();

  const { error: updateError } = await sb
    .from('Clients')
    .update({ 'Password': password })
    .eq('Username', gpsReset.username);

  btn.disabled = false;
  btn.textContent = 'Update password';

  if (updateError) {
    alertBox('resetAlert', updateError.message, 'error');
    return;
  }

  gpsReset = { username: '', email: null };
  document.getElementById('resetForm').reset();
  showView('login');
  alertBox('loginAlert', 'Password updated. Log in with your new password.', 'success');
});

document.getElementById('resetResendBtn').addEventListener('click', async () => {
  clearAlert('resetAlert');
  if (!gpsReset.email) {
    alertBox('resetAlert', 'Verification code resent. Check your inbox.', 'success');
    return;
  }
  const btn = document.getElementById('resetResendBtn');
  btn.disabled = true;
  btn.textContent = 'Sending…';
  const { error } = await sendOtp(gpsReset.email);
  btn.disabled = false;
  btn.textContent = 'Resend verification code';
  if (error) alertBox('resetAlert', error.message, 'error');
  else alertBox('resetAlert', 'Verification code resent. Check your inbox.', 'success');
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
  const { error } = await sendOtp(email);
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
  await sb.auth.signOut();

  const { error: updateError } = await sb
    .from('Clients')
    .update({ 'Password': password })
    .eq('Username', currentProfile['Username']);

  btn.disabled = false;
  btn.textContent = 'Update password';

  if (updateError) { alertBox('cpAlert', updateError.message, 'error'); return; }

  cpReset();
  alertBox('cpAlert', 'Password updated.', 'success');
});

/* -------------------- SIGN OUT -------------------- */
document.getElementById('signOutBtn').addEventListener('click', async () => {
  clearSession();
  await sb.auth.signOut();
  showView('login');
});

/* -------------------- DASHBOARD TABS (with mobile hamburger) -------------------- */
const tabsToggle = document.getElementById('tabsToggle');
const tabsList = document.getElementById('tabsList');

tabsToggle.addEventListener('click', () => {
  const isOpen = tabsList.classList.toggle('open');
  tabsToggle.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
});

document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
    tab.classList.add('active');
    document.getElementById(tab.dataset.tab).classList.add('active');
    tabsList.classList.remove('open');
    tabsToggle.setAttribute('aria-expanded', 'false');
  });
});

/* -------------------- PROFILE STATE -------------------- */
let currentUser = null;
let currentProfile = null;
let profileEditMode = false;
const FIXED_SCHOOL = 'Central Mindanao University';

let DETAILS_ROWS = [];

async function loadLookups(){
  const { data, error } = await sb.from('Details').select('Schools, Course, Major, Gender, College');
  if (error) { console.error(error); DETAILS_ROWS = []; return; }
  DETAILS_ROWS = data || [];
}

function distinctSchools(){
  return [FIXED_SCHOOL];
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
function distinctCourses(){
  const seen = new Set();
  return DETAILS_ROWS.map(r => (r['Course'] || '').trim())
    .filter(v => v && !seen.has(v.toLowerCase()) && seen.add(v.toLowerCase()))
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
async function loadDashboard(user, clientRow){
  const [profileRes] = await Promise.all([
    clientRow ? Promise.resolve({ data: [clientRow] }) :
      sb.from('Clients').select('*').eq('Username', user.username).limit(1),
    loadLookups(),
  ]);

  currentUser = user;
  currentProfile = (profileRes.data && profileRes.data[0]) || {};
  profileEditMode = false;

  const displayName = (currentProfile['First Name'] || '').trim() || currentProfile['Username'] || '';
  document.getElementById('dashGreeting').textContent = displayName ? `Welcome, ${displayName}` : 'Welcome';

  renderProfileGrid();
  showDashboard();

  initDashboardCarousel();
  renderNotices();
  renderAppointments();
  renderSocialList();
  cpReset();
  clearAlert('cpAlert');
}

/* -------------------- DASHBOARD: carousel of studio output photos -------------------- */
const CAROUSEL_FILES = ['sample1.jpg', 'sample2.jpg', 'sample3.jpg', 'sample4.jpg', 'sample5.jpg', 'sample6.jpg', 'sample7.jpg', 'sample8.jpg'];
let dbSlideIndex = 0;
let dbSlideTimer = null;
let dbCarouselBuilt = false;

function initDashboardCarousel(){
  document.getElementById('dbDate').textContent = new Date().toLocaleDateString('en-US', {
    year: 'numeric', month: 'long', day: 'numeric'
  });

  if (dbCarouselBuilt) return;
  dbCarouselBuilt = true;

  const carousel = document.getElementById('dbCarousel');
  const dots = document.getElementById('dbDots');
  carousel.innerHTML = '';
  dots.innerHTML = '';

  CAROUSEL_FILES.forEach((file, i) => {
    const img = document.createElement('img');
    img.src = file;
    img.alt = `Studio output photo ${i + 1}`;
    if (i === 0) img.classList.add('active');
    img.onerror = () => img.remove();
    carousel.appendChild(img);

    const dot = document.createElement('span');
    if (i === 0) dot.classList.add('active');
    dot.addEventListener('click', () => showDbSlide(i));
    dots.appendChild(dot);
  });

  clearInterval(dbSlideTimer);
  dbSlideTimer = setInterval(() => {
    const imgs = carousel.querySelectorAll('img');
    if (imgs.length > 1) showDbSlide((dbSlideIndex + 1) % imgs.length);
  }, 4000);
}

function showDbSlide(i){
  const imgs = document.querySelectorAll('#dbCarousel img');
  const dots = document.querySelectorAll('#dbDots span');
  if (!imgs.length) return;
  imgs[dbSlideIndex]?.classList.remove('active');
  dots[dbSlideIndex]?.classList.remove('active');
  dbSlideIndex = i % imgs.length;
  imgs[dbSlideIndex]?.classList.add('active');
  dots[dbSlideIndex]?.classList.add('active');
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

async function renderNotices(){
  const dashList = document.getElementById('dbNoticeList');
  const fullList = document.getElementById('noticeFullList');

  const { data, error } = await sb
    .from('announcements')
    .select('*')
    .order('is_pinned', { ascending: false })
    .order('created_at', { ascending: false });

  if (error) {
    console.error(error);
    dashList.innerHTML = '<div class="stub-empty">Could not load notices.</div>';
    fullList.innerHTML = '<div class="stub-empty">Could not load notices.</div>';
    return;
  }

  if (!data.length) {
    dashList.innerHTML = '<div class="stub-empty">No notices yet.</div>';
    fullList.innerHTML = '<div class="stub-empty">No notices yet.</div>';
    return;
  }

  dashList.innerHTML = data.slice(0, 3).map(n => noticeRowHTML(n, false)).join('');
  fullList.innerHTML = data.map(n => noticeRowHTML(n, true)).join('');
}

document.querySelectorAll('[data-goto-tab]').forEach(btn => {
  btn.addEventListener('click', () => {
    const target = btn.dataset.gotoTab;
    document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === target));
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.toggle('active', p.id === target));
  });
});

/* -------------------- APPOINTMENTS: reads the appointments table -------------------- */
function apptRowHTML(a){
  const when = a.scheduled_at
    ? new Date(a.scheduled_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
    : 'Not yet scheduled';
  const typeLabel = (a.appointment_type || 'other').replace('_', ' ');
  return `
    <div class="notice-row full">
      <div class="notice-title">${typeLabel[0].toUpperCase()}${typeLabel.slice(1)}
        <span class="appt-status ${a.status === 'confirmed' ? 'confirmed' : ''}">${a.status}</span>
      </div>
      <div class="notice-body">${when}${a.location ? ' · ' + escapeHtml(a.location) : ''}</div>
      ${a.notes ? `<div class="notice-meta">${escapeHtml(a.notes)}</div>` : ''}
    </div>`;
}

async function renderAppointments(){
  const list = document.getElementById('appointmentsList');
  if (!currentProfile?.id) {
    list.innerHTML = '<div class="stub-empty">Complete your Registration first to see appointments here.</div>';
    return;
  }
  const { data, error } = await sb
    .from('appointments')
    .select('*')
    .eq('student_id', currentProfile.id)
    .order('scheduled_at');

  if (error) {
    console.error(error);
    list.innerHTML = '<div class="stub-empty">Could not load appointments.</div>';
    return;
  }
  list.innerHTML = data.length ? data.map(apptRowHTML).join('') : '<div class="stub-empty">No appointments scheduled yet.</div>';
}

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
      <input type="text" id="edit_School" value="${escapeHtml(FIXED_SCHOOL)}" readonly>
      <div class="suggest-list" id="edit_SchoolList"></div>
    </div>
    <div class="profile-field suggest-wrap">
      <label class="eyebrow" for="edit_College">College</label>
      <input type="text" id="edit_College" value="${escapeHtml(p['College'] || '')}" autocomplete="off" placeholder="Type to search (leave blank if none)">
      <div class="suggest-list" id="edit_CollegeList"></div>
    </div>
    <div class="profile-field suggest-wrap">
      <label class="eyebrow" for="edit_Course">Course</label>
      <input type="text" id="edit_Course" value="${escapeHtml(p['Course'] || '')}" autocomplete="off" placeholder="Type to search your course">
      <div class="suggest-list" id="edit_CourseList"></div>
    </div>
    <div class="profile-field suggest-wrap">
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
  setupTypeahead('edit_School', 'edit_SchoolList', distinctSchools, {
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
  const school = FIXED_SCHOOL;
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

  const { data, error } = await sb
    .from('Clients')
    .update(updates)
    .eq('Username', currentProfile['Username'])
    .select()
    .single();

  btn.disabled = false;
  btn.textContent = 'Save changes';

  if (error) {
    if (error.code === '23505' || /duplicate key|Clients_pkey/i.test(error.message)) {
      alertBox('profileAlert',
        `"${fullName}" is already registered under a different account. Add a Middle Initial or Suffix to tell your record apart, or contact the studio for help.`,
        'error');
      return;
    }
    alertBox('profileAlert', error.message, 'error');
    return;
  }

  currentProfile = data;
  profileEditMode = false;
  renderProfileGrid();
  alertBox('profileAlert', 'Details updated.', 'success');

  const dn = (currentProfile['First Name'] || '').trim() || currentProfile['Username'] || '';
  document.getElementById('dashGreeting').textContent = dn ? `Welcome, ${dn}` : 'Welcome';
});

/* -------------------- STEP 2 — student info registration -------------------- */
let step2TypeaheadWired = false;

async function showStep2(){
  await loadLookups();

  ['s2LastName','s2FirstName','s2MiddleInitial','s2Suffix',
   's2Gender','s2College','s2Course','s2Major',
   's2Contact','s2Socials'].forEach(id => {
    document.getElementById(id).value = '';
  });
  document.getElementById('s2School').value = FIXED_SCHOOL;
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

document.getElementById('step2Cancel').addEventListener('click', async () => {
  clearSession();
  await sb.auth.signOut();
  pendingUser = null;
  showView('login');
});

document.getElementById('step2Form').addEventListener('submit', async (e) => {
  e.preventDefault();
  clearAlert('step2Alert');

  if (!pendingUser) { showView('login'); return; }

  const val = (id) => document.getElementById(id).value.trim();
  const lastName = smartName(val('s2LastName'));
  const firstName = val('s2FirstName');
  const middleInitial = val('s2MiddleInitial').toUpperCase();
  const suffix = formatSuffix(val('s2Suffix'));
  const gender = val('s2Gender');
  const school = FIXED_SCHOOL;
  const contact = val('s2Contact');

  if (!lastName) { alertBox('step2Alert', 'Please enter Last Name.', 'error'); return; }
  if (!firstName) { alertBox('step2Alert', 'Please enter First Name.', 'error'); return; }
  if (!gender) { alertBox('step2Alert', 'Please select your Gender.', 'error'); return; }
  if (!school) { alertBox('step2Alert', 'Please select your School.', 'error'); return; }
  if (!contact) { alertBox('step2Alert', 'Please enter Contact Number.', 'error'); return; }

  const placement = (document.querySelector('input[name="s2SuffixPlacement"]:checked') || {}).value || 'none';
  const fullName = buildFullName(lastName, firstName, middleInitial, suffix, placement);

  const btn = document.getElementById('step2Submit');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span>Saving…';

  const { data, error } = await sb
    .from('Clients')
    .update({
      'Last Name': lastName,
      'First Name': firstName,
      'Middle Initial': middleInitial,
      'Gender': gender,
      'School': school,
      'College': val('s2College'),
      'Course': val('s2Course'),
      'Major': val('s2Major'),
      'Contact .': contact,
      'Socials': val('s2Socials'),
      'Full Name': fullName,
    })
    .eq('Username', pendingUser.username)
    .select()
    .single();

  btn.disabled = false;
  btn.textContent = 'Next';

  if (error) {
    if (error.code === '23505' || /duplicate key|Clients_pkey/i.test(error.message)) {
      alertBox('step2Alert',
        `"${fullName}" is already registered in our system. If this is you and you already have an account, please log in instead. If someone else shares this exact name, add a Middle Initial or Suffix to tell your record apart, or contact the studio for help.`,
        'error');
      return;
    }
    alertBox('step2Alert', error.message, 'error');
    return;
  }

  const user = pendingUser;
  pendingUser = null;
  if (data['Username']) setSession(data['Username']);
  await loadDashboard(user, data);
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

  const username = getSession();

  if (username) {
    const { data: rows } = await sb.from('Clients').select('*').eq('Username', username).limit(1);
    const clientRow = rows && rows[0];
    if (!clientRow) {
      clearSession();
      showView('login');
    } else if (isPendingRegistration(clientRow)) {
      pendingUser = { username: clientRow['Username'], email: clientRow['Email'] };
      await showStep2();
    } else {
      await loadDashboard({ username: clientRow['Username'], email: clientRow['Email'] }, clientRow);
    }
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
    if (getSession()) {
      clearSession();
      showView('login');
      alertBox('loginAlert', 'You were logged out due to inactivity.', 'error');
    }
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
