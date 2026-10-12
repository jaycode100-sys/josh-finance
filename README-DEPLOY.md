# JOSH Finance — host on pages.dev + Supabase (SECURE)

Static site (no build). Folder `JOSH/` is the site root.

## 0. First run — permanent superadmin (no secret in git)
1. Open the app → username `josh` → a strong password (min 12 chars, mixed) → **Register**.
2. First-ever `josh` becomes **👑 superadmin, approved forever**. The seat then locks — no one else can claim it.
3. The password is hashed (PBKDF2-SHA256, 210k iterations, 16-byte salt) and the field is wiped. **The repo never contains any password.**

## 1. Approvals — how users join
- Anyone else: Register → sees **“waiting for admin approval”**. Record stays **pending forever** until decided.
- Further Login/Register attempts show **“approval pending”** / **“account yet to be approved”**.
- Superadmin `josh`: topbar 🔔 bell + 👑 dashboard lists queue (Approve/Reject), full user list with status pills. Polls local + Supabase cloud every 90s.
- Cloud mirror holds **status/role only** (`user_approvals`) — never passwords/salts/hashes, which stay on each device. A user approved in cloud still Registers once per new device to set that device's password (by design).

## 2. Supabase setup
1. supabase.com → New project → SQL Editor → Run `supabase.sql`, then `supabase-approval.sql`.
2. Project Settings → API → copy URL + `anon` key (never `service_role` in frontend).
3. App → Sync card → paste → **Connect** → **Push to cloud** / **Pull cloud queue**.
4. `supabase-config.js` stays placeholders in git — configure at runtime (localStorage), not in the repo.

## 3. GitHub via SSH (recommended over HTTPS)
- **Why SSH is better:** no tokens in URLs, no expiry pasting, private key never leaves your PC, supports signed commits, per-host keys. HTTPS needs a PAT that can leak in logs/history.
- Key already at `~/.ssh/id_ed25519.pub` (ed25519). Add to GitHub: Settings → SSH and GPG keys → New SSH key → paste `.pub` → `ssh -T git@github.com` should say “Hi jaycode100-sys!”.
- Remote is `git@github.com:jaycode100-sys/josh-finance.git`. Push: `git push -u origin main`.
- Protect repo: Settings → Branches → protect `main`; enable 2FA on the account.

## 4. Deploy to Cloudflare Pages (pages.dev)
- Dash → Workers & Pages → Create → Pages → Connect Git → `jaycode100-sys/josh-finance`, build = none, output = `/` → `https://josh-finance.pages.dev`.
- HTTPS enforced. No server. Supabase handles sync.

## 5. Security notes
- PBKDF2-SHA256 210k + salt + timing-safe compare + 5-try/5-min lockout + 12h sessions + strength meter + instant field wipe.
- Pending rows are never auto-deleted. Rejected users stay rejected until superadmin re-approves.
- For full multi-device password auth (not just status), migrate to Supabase Auth + Edge Function bcrypt + RLS `auth.uid()` — static-only hashing can't safely share verifiers.
