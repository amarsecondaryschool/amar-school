# Amar Secondary School App – Complete Free Setup Guide

You will do 5 parts. Everything is free. Allow about 45–60 minutes the first time.

| Part | What you do | Where |
|---|---|---|
| 1 | Make the free database | supabase.com |
| 2 | Paste 3 SQL files | Supabase SQL Editor |
| 3 | Copy 2 values into `config.js` | this folder |
| 4 | Put the files on GitHub and turn on the free website | github.com |
| 5 | Install on an Android phone and set up the school | Chrome on Android |

A computer makes this easier, but a phone also works.

---

## What you have (and what is honest)

**Works in this version (written, but not yet tested against a live database – see "If something fails"):**
- Splash screen, 3 login types (School Admin, Teacher, Parent), English / नेपाली switch.
- Admin: add classes, sections, subjects; add and edit students (search, filter by class, CSV export); add teachers and assign classes and subjects; add parents and link them to students; create accounts, reset passwords, activate or deactivate accounts.
- Teacher: sees own name, assigned classes and subjects.
- Parent: sees own linked child (switch if more than one child).
- Database rules that stop teachers and parents from seeing other people's data.
- Automatic logout after inactivity (15 minutes).

**Not built yet (the cards say "Not available yet"):** attendance, marks, Nepal grading and GPA, report card PDFs, fees, homework, timetables, notices, notifications, library, transport, staff leave, calendar. These come in later steps, one at a time.

**This is a web app that installs like an app.** It is not an APK. You install it from Chrome in about 10 seconds (Part 5).

---

## PART 1 – Create the free database (Supabase)

1. Open **https://supabase.com** → **Start your project** → sign up (GitHub or email).
2. Click **New project**.
   - **Name:** `amar-school`
   - **Database password:** click *Generate a password*, then **copy it and save it** somewhere safe.
   - **Region:** choose the closest to Nepal (for example *Southeast Asia (Singapore)* or *South Asia (Mumbai)* if shown).
   - **Plan:** Free.
3. Click **Create new project** and wait 1–2 minutes until it finishes.

### Turn off public sign-up (important for safety)
1. Left menu → **Authentication** → **Sign In / Providers** (may be called *Providers* or *Settings*).
2. Turn **OFF** "Allow new users to sign up".
3. Save. Now only the school admin can create accounts.

---

## PART 2 – Create the tables and security (paste 3 SQL files)

1. In Supabase, left menu → **SQL Editor** → **New query**.
2. Open file `supabase/1_foundation.sql`, select everything, copy, paste into the editor, click **Run**.
   You should see "Success. No rows returned."
3. Click **New query** again. Do the same with `supabase/2_admin_functions.sql`.
4. Open `supabase/3_first_admin.sql` in a text editor. Change these three values:
   - `v_login` – your Special School ID (for example `ADMIN001`)
   - `v_password` – a strong password, at least 8 characters
   - `v_name` – your name
   Then paste it into a new query and **Run it once**.
   **Write your ID and password down. Do not run this file twice.**

If any step shows a red error, stop and send me the exact error text.

---

## PART 3 – Connect the app to your database

1. In Supabase, click the **gear icon (Project Settings)** → **API** (or **API Keys**).
2. Copy two things:
   - **Project URL** – looks like `https://abcdxyz.supabase.co`
   - **anon public** key (newer screens call it the **publishable** key) – a long text.
3. **NEVER copy the `service_role` / secret key. It must stay secret.**
4. Open `config.js` and paste the values between the quotes:

```js
window.AMAR_CONFIG = {
  SUPABASE_URL: "https://abcdxyz.supabase.co",
  SUPABASE_ANON_KEY: "paste-the-long-anon-key-here"
};
```

The anon key is meant to be public. The database rules in Part 2 are what protect the data.

---

## PART 4 – Put the app on GitHub and publish it free

1. Go to **https://github.com** → **Sign up** (free) and verify your email.
2. Click **+** (top right) → **New repository**.
   - **Repository name:** `amar-school`
   - Choose **Public** (free GitHub websites need Public).
   - Tick **Add a README file**. Click **Create repository**.
3. Upload the files (easiest way):
   - Click **Add file** → **Upload files**.
   - Drag in these 9 files (unzipped, from the zip I gave you), **all at the top level, not inside a folder:**
     `index.html`, `styles.css`, `app.js`, `config.js` (the edited one!), `strings.js`, `sw.js`, `manifest.webmanifest`, `icon-192.png`, `icon-512.png`
   - Click **Commit changes**.
   - You do **not** upload the `supabase` folder or this guide.
   - On a phone where upload is hard: use **Add file → Create new file**, type the exact file name, paste the code, and commit. The two `.png` icons must be uploaded as files, not pasted.
4. Turn on the website:
   - Repository → **Settings** → **Pages** (left menu).
   - **Source:** *Deploy from a branch*. **Branch:** `main`, folder `/ (root)`. Click **Save**.
   - Wait 1–3 minutes and refresh. A green box shows your link:
     **`https://YOURNAME.github.io/amar-school/`**

To change something later: open the file on GitHub → pencil icon → edit → **Commit changes**. The site updates in about a minute.

---

## PART 5 – Install on Android and set up the school

### Install
1. On the Android phone, open **Chrome** and go to your link.
2. Tap the **⋮ menu** (top right) → **Install app** (or **Add to Home screen**) → **Install**.
3. The app "Amar Secondary School" now appears on the home screen and opens full screen.
4. Pick English or नेपाली at the top.

### First login
1. Tap **School Admin** and log in with the ID and password from Part 2.
2. If you see "App is not connected", config.js is wrong (see Troubleshooting).

### Set up the school in this order
1. **Class Management** → add classes (for example `Class 1`, level `1`; `Class 2`, level `2` …) and then add sections (A, B) to each.
2. **Subject Management** → add subjects.
3. **Student Records** → add students.
4. **Teacher Records** → add a teacher with a Teacher ID and password → tap the teacher → assign classes and subjects.
5. **Parent Information** → add a parent with a Parent ID and password → tap the parent → link their child. (Several children can be linked.)
6. **User Accounts** → reset passwords, or deactivate someone who left.
7. Give each teacher and parent their ID and password. Test by logging out and logging in as a teacher and as a parent.

Test the security: log in as a parent and confirm only their own child appears.

---

## Troubleshooting

| Problem | Fix |
|---|---|
| Page is blank | Check all 9 files are at the top level of the repository and Pages is on. Wait 3 minutes. |
| "App is not connected to the school server" | `config.js` still has `YOUR_...` or has a typo. Edit it on GitHub, commit, wait a minute, reload. |
| "Wrong ID or password" | Check the ID and the login type. IDs are not case sensitive. Reset the password in User Accounts. |
| "This account cannot log in here" | The ID is a different role (for example a teacher using the Parent button). |
| "function admin_create_account does not exist" | SQL file 2 was not run. Run it. |
| "permission denied" or empty lists for the admin | SQL file 1 or 3 was not completed. Send me the error. |
| Changes do not appear on the phone | Close the app fully and reopen it. If still old: Chrome → Settings → Site settings → clear data for your site. |
| Error while creating accounts | Account creation in SQL file 2 writes directly to Supabase's login tables. If Supabase changes its internals this can fail. **Send me the exact message** and I will fix it. |

---

## Free limits and costs (check current numbers on supabase.com/pricing and docs.github.com)

- **Supabase free plan:** limited database size, bandwidth and monthly users. A project can be **paused after about a week with no activity**; you restore it from the dashboard. For a small school this is usually enough, but check the current limits.
- **GitHub Pages:** free for public repositories, with fair-use limits.
- **No paid service is needed for this version.** Later push notifications or SMS could have limits or costs; I will tell you before adding them.

## Backup (do this regularly)

- In the app, use **Export list (CSV)** on Student Records.
- In Supabase: **Table Editor** → pick a table → **Export** → CSV. Do this for students, teachers, parents and later for marks and fees.
- Store copies on your computer and on a second place (email to yourself or a USB drive).
- Check Supabase's backup features for your plan in the dashboard (**Database → Backups**). Do not assume free projects have automatic downloadable backups.

## Safety rules

- Never share the `service_role` key, your Supabase password or the admin password.
- Change default passwords. Use strong passwords for the admin.
- Deactivate accounts of people who leave (User Accounts).
- The code on GitHub is public. That is fine because it contains no secrets (only the anon key). The student data is behind login and database rules.
- This system holds children's personal information. Limit who gets admin access.

## If something fails

Send me: (1) which part and step number, (2) the exact error text or a screenshot. I will fix the code and tell you which single file to replace.
