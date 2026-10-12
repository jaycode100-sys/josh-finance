# JOSH Finance 💰 — Personal Tracker & Forecaster

NGN-based tracker with live USD conversion, safe-to-spend, deficit warnings, expense + future-income forecasts, PDF monthly reports, hardened login, and Supabase cloud sync. Static site — deploys free on Cloudflare Pages (`pages.dev`).

![stack](https://img.shields.io/badge/static-HTML%20%2B%20CSS%20%2B%20JS-navy) ![fx](https://img.shields.io/badge/FX-live%20%E2%82%A6%2F%24-emerald) ![pdf](https://img.shields.io/badge/PDF-jsPDF-gold)

## ✨ Features
- **₦100k income base (since Sept 2026)** — preloaded with ₦50,000 Dangote Refinery Shares + ₦30,000 transport
- **Live $ conversion** — daily auto-rate from open.er-api.com + 2026 trend chart
- **Predictions** — safe-to-spend/day, projected deficit, next-month forecast, 5-yr grade growth
- **📄 PDF monthly report** (jsPDF)
- **🔐 Hardened login** — PBKDF2-SHA256 120k + salt, strength meter, 5-try lockout, 12h sessions
- **☁ Supabase sync** — push/pull `finance_states` table, works on pages.dev
- **🎨 Royal theme** — royal blue, navy, emerald, gold + J$ favicon

## 📁 Files
```
index.html  app.js  styles.css  favicon.svg  site.webmanifest
supabase-config.js  supabase.sql  README-DEPLOY.md
```

## 🚀 Deploy (GitHub → pages.dev)
1. Create repo `josh-finance` under `jaycode100-sys` (public).
2. Push this folder (see commands below).
3. Supabase: run `supabase.sql`, copy URL + anon key.
4. Cloudflare Dashboard → Workers & Pages → Connect Git → select `josh-finance`, build = none, output = `/` → `https://josh-finance.pages.dev`.
5. Open live site → Sync card → paste Supabase keys → Connect → Push.

Full steps: [`README-DEPLOY.md`](./README-DEPLOY.md)
