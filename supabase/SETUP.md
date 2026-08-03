# Phase 1 — Supabase setup

The Hub uses **Supabase** (a free cloud database with logins) as its backend.
Follow these once; then send me two values and I wire the app to it.

## 1. Create a free Supabase account + project
1. Go to **https://supabase.com** → **Start your project** → sign in (GitHub or email).
2. Click **New project**.
   - **Name:** `sales-order-hub`
   - **Database password:** set a strong one and **save it somewhere** (you rarely need it, but keep it).
   - **Region:** pick the closest (e.g. *South Asia (Mumbai)*).
   - Click **Create new project** and wait ~2 minutes for it to finish setting up.

## 2. Create the tables
1. In the left menu click **SQL Editor** → **New query**.
2. Open the file **`schema.sql`** (in this folder), copy **all** of it, paste into the editor.
3. Click **Run**. You should see *"Success. No rows returned."*
   (This creates the tables, security rules, and the sign-up trigger.)

## 3. Create your admin login
1. Left menu → **Authentication** → **Users** → **Add user** → **Create new user**.
   - Enter **your email** and a password. (Tick "Auto confirm" if shown.)
2. Make yourself the admin: **SQL Editor** → **New query** → paste, replacing the email:
   ```sql
   update public.profiles set role='admin'
   where id = (select id from auth.users where email='YOUR_EMAIL_HERE');
   ```
   → **Run**.

## 4. Add a login for each salesman
Repeat **Authentication → Users → Add user** for each salesman (their email + a
password you give them). Leave them as-is — they're automatically 'salesman'.

## 5. Send me two values (safe to share)
Left menu → **Project Settings** (gear) → **API**. Copy:
- **Project URL** — looks like `https://xxxxxxxx.supabase.co`
- **anon public** key — a long string labelled **anon / public**

Paste **those two** back to me. They're designed to live in the app (public by
design — the security rules protect the data), so they're safe to share.

## ⚠️ Keep this one SECRET
On that same API page there's a **`service_role`** key marked *secret*.
**Do NOT paste it in chat or put it in the app.** We'll use it **only** later,
on your Tally-on-Cloud server, for the master-sync connector — you'll paste it
into a local config file there, not send it to anyone.

---

## What happens next
- **Phase 2:** I add a login screen to the app and connect it to your Supabase
  (using the URL + anon key). Orders start flowing into the shared database.
- **Phase 3:** Admin dashboard — you see every salesman's orders.
- **Tally master sync:** the read-only connector (already drafted in
  `../tally-connector/`) gets extended to push your Tally parties, items and
  price lists **into** these tables (matched by `tally_guid`), so the app's
  masters mirror Tally. This uses the secret `service_role` key on your server.
