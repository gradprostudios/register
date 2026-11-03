# Live manual test checklist: "GPS Test School"

Use only the test school **GPS Test School**. Do not touch AdDU or any real school's settings or slots.

Use a fresh email you own for the test student, and a Google account you own.

Keep the desktop app running as normal. Nothing here should affect it, so note anything odd it shows.

## 0. Before you start
- [ ] "GPS Test School" exists in `Details.Schools`. If it doesn't, add it from the desktop app or dashboard. The portal never writes Details.
- [ ] Live Redirect URLs include the URL you are testing from.
- [ ] Open the browser DevTools → Network tab. During the whole test, check:
  - no request goes to `/rest/v1/Clients`
  - no request goes to `/rest/v1/appointments`
  - no request repeats on its own every few seconds

## 1. Admin: Slot Settings and slots (`admin.html`)
- [ ] Sign in with the live staff account. The dashboard opens and your name/role shows.
- [ ] Wrong password → error, no dashboard.
- [ ] A non-staff Auth account → "not staff" and signed out.
- [ ] Slot Settings → school **GPS Test School**. Fill in:
  - start and end dates (e.g. next week, 3–4 days)
  - days of the week, hours and lunch break
  - Total students = 40
- [ ] Add one blocked date inside the range. It shows as a chip.
- [ ] The preview shows hourly slots and the per-hour capacity (≈ 40 ÷ number of slots, rounded up).
- [ ] **Save**, then a success message.
- [ ] **Generate slots**, then a success message with the slot count. The blocked date gets no slots.
- [ ] Slots page → pick GPS Test School and a date. The hourly slots show 0 booked.
- [ ] Use the day strip arrows; the blocked date shows no slots.

## 2. Student: register with an email code (`index.html`)
- [ ] Register: username, email, password (8+ characters) and Turnstile. The code email arrives.
- [ ] Enter the code. You land on Step 2 (details).
- [ ] Step 2 → School: type "GPS" and pick **GPS Test School**. Fill in the required fields and save.
- [ ] The dashboard opens and the **booking modal opens by itself** (once for this login).
  - The colours are red, black and white.
  - Times are in Manila time.
- [ ] The dashboard banner reminder and the pinned reminder on the Notice tab both say you haven't booked yet.

## 3. Student: book, see, reschedule, cancel
- [ ] In the modal, pick a date and an hour, then **Confirm**. Success shows.
- [ ] **Appointments** tab shows the booked date and time. The banner and Notice reminders update.
- [ ] **Add to calendar** downloads an .ics file with the right Manila time.
- [ ] **Reschedule**: pick a different hour and confirm. Appointments shows the new time.
  - Picking the same slot shows "That is already your schedule".
- [ ] **Cancel booking**: confirm. Appointments shows no booking, and the reminders come back.
- [ ] Book again (leave this booking for the staff tests).
- [ ] **Sign out**, then log in again with username + password. The booking is still there.
  - The modal does not open again because you are already booked.
- [ ] Inactivity: leave the dashboard alone for 5 minutes. You are logged out.

## 4. Student: forgot password
- [ ] Log out → **Forgot password** → enter the test email. The code arrives.
- [ ] Enter the code and a new password. You can log in with the new password.
- [ ] The old password fails.

## 5. Student: Google sign-in and connected accounts
- [ ] Log out → **Continue with Google** using a Google account not yet registered.
  - You come back to Step 2 with "Signed in with Google…".
  - Finish Step 2 with GPS Test School.
- [ ] Log out and use **Continue with Google** again. You go straight to the dashboard (no Step 2).
- [ ] Profile → Connected accounts, on the Google-only account: enter any password, then Connect/Disconnect.
  - The message should mention setting a password with "Forgot password".
- [ ] Set a password via Forgot password for that Google account. Connected accounts now accepts it.
- [ ] On the **email** test student from step 2:
  - Connected accounts → enter its password → **Connect Google**. Google returns and shows "Google connected".
  - Log out, then **Continue with Google** with that Google account. It opens the same student.
  - **Disconnect** Google with the password. It shows "Not connected".

## 6. Staff: bookings, no-show, unbooked
- [ ] Bookings page (GPS Test School) shows the test student's booking. The CSV downloads.
- [ ] Mark it **No-show**. The status changes.
  - The student's Appointments tab, after a refresh, no longer shows an active booking.
- [ ] Student Activity shows the book / reschedule / cancel events from step 3.
- [ ] Unbooked page (GPS Test School) lists any test student who has finished Step 2 but has no active booking. The CSV downloads.

## 7. Announcements per school
- [ ] Announcements → new announcement, school = GPS Test School, pinned.
- [ ] The test student sees it on the Notice tab, pinned at the top.
- [ ] A student of a different school (or log in as one) does **not** see it.
- [ ] Unpin it, then delete it. It disappears for the student after a refresh.

## 8. Clean up
- [ ] Staff: cancel the remaining test bookings.
- [ ] Close or delete the GPS Test School slots and remove its Slot Settings, or keep them clearly labelled as test.
- [ ] Remove the test students, if your process does that, using the desktop app or dashboard.
