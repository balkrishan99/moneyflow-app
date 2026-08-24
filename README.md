# MoneyFlow

Personal finance + shared group expenses, in one app. React (Vite) frontend,
two small Vercel serverless functions for storage and AI category suggestions.

## What changed from the original artifact preview

- **Storage**: `window.storage` (artifact-only) → `/api/kv`, a serverless
  function backed by a real Redis database (via Vercel's Marketplace Redis
  integration, Upstash). This is what makes Groups actually sync between
  different people's browsers/devices.
- **AI category suggestions**: the app used to call Anthropic directly from
  the browser, using credentials the artifact sandbox injected for you. A
  real deployment can't do that safely — so this now calls `/api/ai-suggest`,
  a serverless function that holds your own Anthropic API key server-side.
  This feature is optional; the rest of the app works fine without it.

## 1. Push this to GitHub

```bash
git init
git add .
git commit -m "MoneyFlow"
```

Create a new GitHub repo and push this folder to it.

## 2. Import into Vercel

1. Go to [vercel.com/new](https://vercel.com/new) and import the GitHub repo.
2. Vercel will auto-detect Vite. Leave the default build settings
   (`npm run build`, output directory `dist`).
3. Click **Deploy**. It'll go live even before you add storage — you just
   won't be able to save anything yet.

## 3. Add a Redis database (required for saving data)

1. In your Vercel project, go to **Storage** → **Marketplace Database
   Providers** → choose **Upstash** (Redis) → follow the prompts to create
   a free database.
2. Connect it to this project. Vercel automatically sets the
   `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` environment
   variables for you — no manual copy-pasting needed.
3. Redeploy (Vercel usually does this automatically after connecting
   storage; if not, trigger a redeploy from the Deployments tab).

Without this step, the app loads but nothing you add will persist or sync.

## 4. (Optional) Enable AI category suggestions

1. Get an API key from [console.anthropic.com](https://console.anthropic.com/).
2. In your Vercel project: **Settings** → **Environment Variables** → add
   `ANTHROPIC_API_KEY` with that value.
3. Redeploy.

If you skip this, the ✨ "suggest category" button will just show a friendly
error toast — everything else keeps working.

## Local development

```bash
npm install
npm run dev
```

`/api/*` routes don't run under plain `vite dev`. To test the full app
locally including storage and AI suggestions, use the Vercel CLI instead:

```bash
npm i -g vercel
vercel dev
```

Copy `.env.example` to `.env.local` and fill in values for local testing
(`vercel dev` will also prompt to pull your project's real env vars if you've
already deployed once).

## Before you invite other people

Sign-in here is **name only** — there's no password. Anyone who knows a name
can read and write that person's data, and group data is inherently shared
with anyone who knows the group. This is fine for a small group of people who
already trust each other, but it is not real account security. If you want
that, the natural next step is adding real auth (e.g.
[Vercel's Auth integrations](https://vercel.com/marketplace?category=authentication)
or NextAuth/Clerk/Auth.js) and checking the caller's identity inside
`api/kv.js` before it reads or writes a given key.

## Project structure

```
├── api/
│   ├── kv.js            # storage — GET/POST/DELETE against Redis
│   └── ai-suggest.js    # AI category suggestion proxy
├── src/
│   ├── App.jsx           # the whole app
│   ├── storage.js         # client wrapper around /api/kv
│   └── main.jsx           # React entry point
├── index.html
├── vite.config.js
└── package.json
```
