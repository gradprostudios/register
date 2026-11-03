// The one place both portals (index.html and admin.html) get their Supabase project from.
// Publishable/anon keys only. Never put a service_role or secret key in a frontend file.

// LIVE project (rkxuwluybpynxvguhqpn).
const SUPABASE_URL = "https://rkxuwluybpynxvguhqpn.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_uBCFBzLjcvRSK5ZcIevXZw_GzhneWhJ";

// TEST project (goionmhlyaxtikapljes). To switch back, comment out the two LIVE lines above
// and uncomment these two. Test needs db/test_social_link_rpc_names.sql for connected accounts.
// const SUPABASE_URL = "https://goionmhlyaxtikapljes.supabase.co";
// const SUPABASE_ANON_KEY = "sb_publishable_m-RLzMQ-Qp23vK27JGTFHg_cX2skEmz";

// admin.html sets window.SB_AUTH_STORAGE_KEY so the staff login is stored apart from the
// student portal's short-lived OTP/Google sessions (same origin, different keys).
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY,
  window.SB_AUTH_STORAGE_KEY ? { auth: { storageKey: window.SB_AUTH_STORAGE_KEY } } : {});
