# MoneyFlow

Personal finance + shared group expenses, in one app. React (Vite) frontend,
Vercel serverless functions for auth, storage, and AI category suggestions.

## What's new in this update: real login

- **Storage**: `window.storage` (artifact-only) → `/api/kv`, a serverless
  function backed by a real Redis database (via Vercel's Marketplace Redis
  integration, Upstash). This is what makes Groups actually sync between
  different people's browsers/devices.
- **AI category suggestions**: the app used to call an AI provider directly from
  the browser, using credentials the artifact sandbox injected for you. A
   real deployment can't do that safely — so this now calls `/api/ai-suggest`,
   a serverless function that holds your NVIDIA API key server-side.
  This feature is optional; the rest of the app works fine without it.

Sign-in used to be "type any name, no password." That's gone. Now:

- **Real accounts** — email + password, with passwords hashed (bcrypt)
  before they're ever stored. Plain-text passwords never touch the database.
- **Real sessions** — a signed, httpOnly session cookie (JWT), so the token
  can't be read or forged from JavaScript in the browser.
- **Real per-account privacy** — your personal data (accounts, transactions,
  budgets, goals) is locked server-side to your account. The API rejects any
  attempt to read or write someone else's personal data, even if you know
  their internal ID.

**What's still a known limitation:** groups don't yet have per-member access
control tied to accounts — any signed-in user can open any group by its ID.
That's a big step up from "anyone on the internet, no login required," but
it isn't full multi-tenant isolation. See "Tightening group access" below if
you want to close that gap.

## Updating your existing deployment

You already have this deployed with MongoDB connected. To add real login:

1. **Copy these files into your repo**, at the same paths, overwriting the
   old versions:
   - `src/App.jsx`
   - `api/kv.js`
   - `api/ai-suggest.js`
   - `package.json`
   - `.env.example`
   - `README.md` (this file)

   **And add these new files/folders**, which didn't exist before:
   - `lib/mongodb.js`
   - `lib/auth.js`
   - `api/auth/signup.js`
   - `api/auth/login.js`
   - `api/auth/logout.js`
   - `api/auth/me.js`

2. Install the new dependencies:
   ```bash
   npm install
   ```
   (adds `bcryptjs`, `jsonwebtoken`, `cookie`; also removes the unused
   `@upstash/redis` package left over from before you switched to MongoDB)

3. **Add one new environment variable** in Vercel: **Settings** →
   **Environment Variables** → add `JWT_SECRET`. Generate a value with:
   ```bash
   openssl rand -base64 32
   ```
   Your existing `MONGODB_URI` and (optional) `ANTHROPIC_API_KEY` stay as
   they are — nothing to change there.

4. Commit, push, redeploy.

<<<<<<< HEAD
1. Get an API key from [build.nvidia.com](https://build.nvidia.com/).
2. In your Vercel project: **Settings** → **Environment Variables** → add
   `NVIDIA_API_KEY` with that value. Keep it server-side; do not add it to
   frontend code or variables prefixed with `VITE_`.
   You can optionally add `NVIDIA_MODEL` to specify the model (defaults to `meta/llama-3.1-8b-instruct`).
3. Redeploy.
=======
5. Open the site — you'll land on a real Sign up / Log in screen. Existing
   data saved under the old name-only scheme (`mf:user:{name}` documents in
   MongoDB) is orphaned by this change, since accounts are now keyed by a
   generated account ID instead of a typed name. If you had real data you
   care about, see "Migrating old demo data" below before you deploy this.
>>>>>>> d4699d2462d3e56567cdfedafcc5ca02a59c9154

## Migrating old demo data (optional)

If you had transactions/budgets/goals saved under your old typed name and
want to keep them: sign up for a real account first, note the `accountId`
Vercel logs or that `/api/auth/me` returns, then in MongoDB Atlas's data
browser manually copy the `value` field from the old
`{"_id": "mf:user:YourOldName"}` document in `kv_store` into a new document
with `{"_id": "mf:user:{your new accountId}"}`. There's no in-app migration
tool for this — it's a one-time manual step.

## Tightening group access further

Right now any signed-in account can read/write any group if they know (or
guess) its ID. To lock groups down to just their members, the natural next
step is: store each group member as `{ accountId, name }` instead of a bare
name string, and check in `api/kv.js` that `session.accountId` is actually
listed in a group's members before allowing access to that `mf:group:*` key.
That's a real code change (it touches how splits/balances match members by
name throughout `App.jsx`), not just a config tweak — happy to build it if
you want to take this further.

## Fresh deployment (if you're starting over)

1. Push this repo to GitHub, import into Vercel — it auto-detects Vite.
2. **Storage** → **Marketplace Database Providers** → **MongoDB Atlas** →
   create + connect a database. This sets `MONGODB_URI` automatically.
3. **Settings** → **Environment Variables** → add `JWT_SECRET` (see above).
4. *(Optional)* add `ANTHROPIC_API_KEY` for AI category suggestions.
5. Deploy.

## Local development

```bash
npm install
npm run dev
```

`/api/*` routes don't run under plain `vite dev`. To test the full app
locally, including login, storage, and AI suggestions, use the Vercel CLI:

```bash
npm i -g vercel
vercel dev
```

<<<<<<< HEAD
Copy `.env.example` to `.env.local` and fill in values for local testing. Put
your key on this line in the project root file
`moneyflow-app/.env.local`:

```text
NVIDIA_API_KEY=your-key-goes-here
```

Replace only the placeholder locally; never commit `.env.local`. The file is
already ignored by Git. `vercel dev` will also prompt to pull your project's
real env vars if you've already deployed once.

## Before you invite other people

Sign-in here is **name only** — there's no password. Anyone who knows a name
can read and write that person's data, and group data is inherently shared
with anyone who knows the group. This is fine for a small group of people who
already trust each other, but it is not real account security. If you want
that, the natural next step is adding real auth (e.g.
[Vercel's Auth integrations](https://vercel.com/marketplace?category=authentication)
or NextAuth/Clerk/Auth.js) and checking the caller's identity inside
`api/kv.js` before it reads or writes a given key.
=======
Copy `.env.example` to `.env.local` and fill in values for local testing
(`vercel dev` will also offer to pull your project's real env vars once
you've deployed at least once).
>>>>>>> d4699d2462d3e56567cdfedafcc5ca02a59c9154

## Project structure

```
├── api/
│   ├── auth/
│   │   ├── signup.js     # create account, hash password, start session
│   │   ├── login.js      # verify password, start session
│   │   ├── logout.js     # clear session cookie
│   │   └── me.js         # return the current session's account, if any
│   ├── kv.js              # storage — locked to the signed-in account for mf:user:* keys
│   └── ai-suggest.js      # AI category suggestion proxy (requires sign-in)
├── lib/
│   ├── mongodb.js         # shared pooled MongoDB connection
│   └── auth.js            # password hashing, JWT sessions, cookies
├── src/
│   ├── App.jsx             # the whole app
│   ├── storage.js           # client wrapper around /api/kv
│   └── main.jsx              # React entry point
├── index.html
├── vite.config.js
└── package.json
```
