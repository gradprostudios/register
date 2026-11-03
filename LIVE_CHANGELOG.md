# Live switch: changelog (2026-11-03)

Nothing was deployed. No SQL was run on live and no live database object was changed.

## supabase-client.js
- Now points at the **live** project `https://rkxuwluybpynxvguhqpn.supabase.co` with the live publishable key (`sb_publishable_uBCF…hWhJ`, from the original portal script.js).
- The test URL and key are kept in a commented block. To switch back, swap the two pairs of lines.
- Only a publishable key is in any frontend file. No service or secret key.
- Both `index.html` and `admin.html` already load this one file. No other file has a URL or key.

## script.js (student portal): calls changed

| Where | Before (test name) | Now (live name) |
|---|---|---|
| Connected accounts list | `list_social_links(p_token)` | `student_list_social_links(p_token)` |
| Disconnect | `unlink_social(p_token, p_password, p_provider)` | `student_unlink_social(p_token, p_password, p_provider)` |
| Connect, step 1 | `create_link_token(p_token, p_password)` | `student_create_link_token(p_token, p_password)` |
| Connect, step 2 (Google return) | `link_social(p_token, p_provider)` | `student_link_social(p_link_token, p_provider)`. Called while the Google auth session still exists, before `signOut()` |

- The old live functions `create_link_token`, `link_social`, `unlink_social` and `list_social_links` use a username + plaintext password signature. The portal no longer calls any of them.
- **`social_register`**: the result is read with `Array.isArray(data) ? data[0] : data` (the existing `firstRow()`), so the live JSON object `{username, is_new}` and the test one-row array both work.
  - Order is unchanged: `social_register`, then `student_session_from_oauth`, both before `signOut()`. Then the portal session token is used.
- **`appointments` table**: removed the unused `savePendingPackageSelection()`. It inserted straight into `appointments`, plus `package_selections`, and nothing called it.
  - No `appointments` reference is left. The Appointments tab uses `student_booking_state` only.
- **Connected-account "Invalid credentials"**: the message now says that an account made with Google has no password yet, and that the student can set one with "Forgot password" (`student_reset_password`).
- Unchanged and already matching live: `student_username_available`, `student_login`, `student_register`, `student_session_from_oauth`, `student_logout`, `student_get_profile`, `student_save_profile`, `student_reset_lookup`, `student_reset_password`, `student_booking_state`, `get_slot_availability`, `book_slot`, `student_reschedule`, `student_cancel_booking`, `withdraw_request`.
  - The only direct table reads are `Details` (dropdowns) and `announcements`.
  - No `Clients` reads or writes.

## admin-script.js / admin.html (staff portal)
- **Removed** the "N students of this school registered so far" hint under *Total students* in Slot Settings.
  - It counted rows directly from `Clients` (`select … from Clients where School ilike …`), which breaks the "no direct Clients" rule.
  - There is no live RPC for this count. Staff type the school's total manually, as before.
- Staff login is unchanged:
  - Supabase Auth email/password, then a read of the staff member's own `staff_profiles` row.
  - The staff session is stored separately from the student portal (`gps-staff-auth`).
- Every other admin call already uses the live RPC names: `staff_generate_slots`, `staff_rebuild_slots`, `staff_apply_capacity`, `staff_set_blocked_dates`, `staff_update_slot`, `staff_set_day_closed`, `staff_list_bookings`, `staff_list_requests`, `staff_list_events`, `staff_resolve_request`, `staff_move_booking`, `staff_set_booking_status`, `staff_unbooked_students`.
  - Staff also read and write `slot_settings`, `time_slots` and `announcements` directly.

## Database load
- No `setInterval` or polling database calls exist in either portal.
  - The only timers are the carousel autoplay (images only) and the 5-minute inactivity logout.
- Data loads only on sign-in, on tab or page open, and after a student or staff action.

## New file (not applied anywhere)
- `db/test_social_link_rpc_names.sql`: **TEST project only.** It adds the four `student_*` connected-account names to test as thin wrappers, so this same frontend still works when switched back to test. Never run it on live.

## Before deploying, in the Supabase dashboard for live
- Authentication → URL Configuration: add the site URL(s) you will deploy to under Redirect URLs.
  - Google sign-in and Connect return there.
- Authentication → Attack Protection: the portal sends a Cloudflare Turnstile token with the register and resend email-code requests (site key `0x4AAAAAAD4Y5yYW8B-1flNT`).
  - Make sure the live project's CAPTCHA setting matches. If CAPTCHA is on for live but the secret doesn't match, the email code is never sent.
  - Login (`student_login`) only checks the widget in the browser.
