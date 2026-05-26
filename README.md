# Kumon Check-In — Multi-Center SaaS

A professional student check-in/check-out kiosk system for Kumon centers.
Each center owner signs up, gets their own dashboard, and generates a kiosk link for their front desk.

---

## 🛠 One-Time Setup

### 1. Create a Supabase project (free, no credit card)
1. Go to [supabase.com](https://supabase.com) → **New Project**
2. Give it a name, set a strong DB password, pick a region
3. Go to **SQL Editor → New Query**, paste the contents of `schema.sql`, click **Run**
4. Go to **Settings → Database → Connection string → URI** — copy that URL

### 2. Configure environment variables
Edit `.env` (local) and add these to Vercel's dashboard too:
```
DATABASE_URL=       ← Supabase connection string
JWT_SECRET=         ← node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
GMAIL_USER=         ← Gmail address for sending alerts
GMAIL_APP_PASSWORD= ← Gmail app password
BASE_URL=           ← Your Vercel URL e.g. https://kumon.vercel.app
CRON_SECRET=        ← Any random string
```

### 3. Deploy to Vercel
```bash
npm install -g vercel
vercel
```
After deploying, update `BASE_URL` in Vercel env vars to your actual URL, then redeploy once.

---

## How it works

**Center owners:** Sign up at `/signup.html` → admin portal at `/admin.html` → add students, set time limits, copy kiosk link → open that link on the front-desk tablet

**Students:** Open the kiosk → find name → select subject → check in. When done → click name → Check Out.

**Alerts:** Students over their time limit trigger an email to all configured alert recipients. Vercel Cron fires every minute as a backup, plus alerts fire inline on every kiosk poll.

---

## File structure
```
server.js        Express server + Vercel serverless entry
schema.sql       Run once in Supabase SQL Editor
vercel.json      Vercel config + cron
public/
  index.html     Student kiosk
  signup.html    Center owner signup
  login.html     Center owner login
  admin.html     Admin dashboard
```

## Local dev
```bash
npm install
npm start   # → http://localhost:3000
```
