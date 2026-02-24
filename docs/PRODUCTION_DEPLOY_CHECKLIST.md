# Production Deploy Checklist (Render + GitHub)

This checklist is for `kanchana-ai-backend` first production deploy.

## 1. Security First (Before Deploy)

1. Rotate all real keys currently used in local `.env`.
2. Generate a new strong `ENCRYPTION_KEY` (at least 32 chars).
3. Keep `.env` local only. Never commit it.

PowerShell random key helper:

```powershell
-join ((48..57) + (65..90) + (97..122) | Get-Random -Count 64 | ForEach-Object {[char]$_})
```

## 2. GitHub Hardening

1. Open GitHub repo `Settings -> Branches -> Add rule` for `main`.
2. Enable:
   - `Require a pull request before merging`
   - `Require status checks to pass before merging`
3. Select CI check from workflow (usually `test` from `.github/workflows/ci.yml`).

## 3. Render Service Setup

1. Render dashboard -> `New +` -> `Web Service`.
2. Connect GitHub repo `unblemishedgelexy/kanchana-ai-backend`.
3. Use:
   - Runtime: `Node`
   - Build Command: `npm ci`
   - Start Command: `npm start`
4. Region: nearest to primary users.
5. Instance type: start with free/starter, scale later.

## 4. Render Environment Variables

Set these in Render `Environment` tab.

Required for core app:

- `NODE_ENV=production`
- `PORT=10000` (or keep Render default port; app reads `PORT`)
- `CORS_ORIGIN=https://your-frontend-domain.com`
- `FRONTEND_URL=https://your-frontend-domain.com`
- `MONGODB_URI=<your-mongodb-connection-string>`
- `ENCRYPTION_KEY=<new-strong-secret>`
- `TOKEN_TTL_DAYS=30`
- `PASSWORD_RESET_TTL_MINUTES=20`

AI required:

- `APP_API_KEY=<kanchana-api-key>`
- `APP_CLIENT_SECRET=<kanchana-client-secret>`
- `GEMINI_API_KEY=<gemini-api-key>`
- `GUEST_MODE_MESSAGE_LIMIT=7`
- `FREE_MODE_MESSAGE_LIMIT=10`
- `FREE_DAILY_VOICE_SECONDS=300`
- `DEFAULT_VOICE_MESSAGE_SECONDS=60`
- `GUEST_CHAT_RATE_LIMIT_PER_MINUTE=15`

Google OAuth required (if enabled):

- `GOOGLE_CLIENT_ID=<google-client-id>`
- `GOOGLE_CLIENT_SECRET=<google-client-secret>`
- `GOOGLE_OAUTH_REDIRECT_URI=https://<your-backend-domain>/api/auth/google/callback`
- `GOOGLE_AUTH_SUCCESS_REDIRECT=https://<your-frontend-domain>/auth/google/success`
- `GOOGLE_AUTH_ERROR_REDIRECT=https://<your-frontend-domain>/auth/google/error`

ImageKit required (if uploads enabled):

- `IMAGEKIT_PUBLIC_KEY=<imagekit-public-key>`
- `IMAGEKIT_PRIVATE_KEY=<imagekit-private-key>`
- `IMAGEKIT_URL_ENDPOINT=https://ik.imagekit.io/<your-id>`

Optional:

- `AI_DEBUG_LOGS=false`
- `CHAT_DEBUG_LOGS=false`
- `PINECONE_API_KEY=<optional>`
- `PINECONE_INDEX=<optional>`

Payment optional for now (keep blank/disabled until ready):

- `PAYPAL_MODE=sandbox`
- `PAYPAL_CLIENT_ID=`
- `PAYPAL_CLIENT_SECRET=`
- `PAYPAL_WEBHOOK_ID=`
- `PAYPAL_WEBHOOK_SKIP_VERIFY=false`
- `PAYPAL_WEBHOOK_TEST_SECRET=`
- `PREMIUM_PRICE=1.49`
- `PREMIUM_CURRENCY=USD`
- `PREMIUM_PAYPAL_PLAN_ID=`

## 5. Google OAuth Console Setup

In Google Cloud Console:

1. OAuth client -> `Authorized redirect URI` must match exactly:
   - `https://<your-backend-domain>/api/auth/google/callback`
2. Authorized JavaScript origins should include frontend domain:
   - `https://<your-frontend-domain>`

## 6. Deploy and Verify

After first deploy, verify endpoints in PowerShell:

```powershell
$BASE = "https://<your-backend-domain>"
Invoke-RestMethod "$BASE/api/health"
Invoke-RestMethod "$BASE/api/ping"
Invoke-WebRequest "$BASE/api/auth/google/start" -MaximumRedirection 0 -ErrorAction SilentlyContinue
```

Expected:

- `/api/health` -> `ok: true`
- `/api/ping` -> `pong: true`
- `/api/auth/google/start` -> HTTP `302` redirect to Google

Migration step for existing user data (run once after deploy if upgrading an existing DB):

```powershell
npm run migrate:add-role-and-usage
```

## 7. Post-Deploy Monitoring

1. Check Render logs for startup errors.
2. Check GitHub Actions `CI` for green status on `main`.
3. Smoke test app flows:
   - register/login
   - free chat
   - premium chat (if user upgraded)
   - image upload (if ImageKit configured)

## 8. Rollback Plan

If production breaks:

1. Render -> `Events` -> rollback to previous successful deploy.
2. Re-check last env var changes.
3. Re-run `/api/health` and `/api/ping`.
