# JOSH Finance — host on pages.dev + Supabase

Static site (no build). Folder `JOSH/` is the site root.

## 1. Supabase setup (5 min)
1. Go to https://supabase.com → New project.
2. SQL Editor → paste + Run `supabase.sql` (creates `finance_states` table).
3. Project Settings → API → copy `Project URL` + `anon public` key.
4. Option A (recommended): open app locally → Sync card → paste URL + key → **Connect** → **Push to cloud**.
   Option B: edit `supabase-config.js` with real values before deploying.

## 2. Deploy to Cloudflare Pages (pages.dev)
- Dashboard → Workers & Pages → Create → Pages → Upload assets **or** Connect Git.
- Upload / git folder = contents of `JOSH/` (`index.html`, `styles.css`, `app.js`, `favicon.svg`, `site.webmanifest`, `supabase-config.js`, `supabase.sql` not required online).
- Build command: **none**. Output dir: **/** (root).
- You get `https://josh-xxx.pages.dev`. Custom domain optional.
- HTTPS + CDN + no server needed. Supabase handles sync.

## 3. Security notes
- Local login now uses PBKDF2-SHA256 (120k iterations) + 16-byte salt + 5-try/5-min lockout + 12h expiring sessions.
- Never commit real keys to public git — prefer Option A (localStorage) or Pages env + inject at build.
- For production, tighten `supabase.sql` RLS to per-user (`auth.uid()`) and use Supabase Auth instead of local usernames.
- `supabase-config.js` ships with placeholders — safe to deploy, app runs in local mode until you Connect.
