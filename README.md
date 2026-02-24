# Kanchana Backend

Production-focused Express backend with:
- modular architecture (`controllers`, `routes`, `services`, `repositories`)
- ESM module runtime (`type: module`) with `tsx` dev server
- secure auth (password + Google login + token sessions)
- password reset flow
- encrypted chat history at rest (AES-GCM)
- premium/free route guards
- PayPal payment + subscription (autopay) endpoints
- ImageKit cloud storage for profile/upgrade assets and generated images
- free tier chat via external Kanchana model API (`/v1/chat`)
- Gemini for premium chat/voice and premium image generation
- optional Pinecone vector memory for premium semantic recall
- keep-alive ping route for Render deployments

## Quick Start

1. Install dependencies:
   ```bash
   npm install
   ```
2. Copy env template:
   ```bash
   cp .env.example .env
   ```
3. Fill required values in `.env` (`APP_API_KEY`, `APP_CLIENT_SECRET`, `GEMINI_API_KEY`, DB, Google OAuth callback vars, etc.).
4. Start server:
   ```bash
   npm run dev
   ```

Payment/PayPal vars are optional for initial launch. Keep them blank if you are not enabling billing yet.

## Run Tests (No Env Required)

```bash
npm test
```

Tests run with in-memory repositories and do not require `.env`, MongoDB, Gemini, PayPal, or ImageKit credentials.

Base URL: `http://localhost:5000/api`

## Important Routes

- `GET /api/health`
- `GET /api/ping`
- `POST /api/auth/register`
- `POST /api/auth/login`
- `POST /api/auth/google`
- `GET /api/auth/google/start` (backend OAuth redirect)
- `GET /api/auth/google/callback` (backend OAuth callback)
- `POST /api/auth/forgot-password`
- `POST /api/auth/reset-password`
- `GET /api/auth/me` (auth)
- `POST /api/auth/logout` (auth)
- `PATCH /api/auth/preferences` (auth)
- `POST /api/auth/upgrade` (auth)
- `GET /api/content/simple`
- `GET /api/content/premium` (auth + premium)
- `POST /api/chat/message` (auth)
- `GET /api/chat/history?mode=Lovely` (auth)
- `DELETE /api/chat/history?mode=Lovely` (auth)
- `GET /api/media/imagekit/auth` (auth)
- `POST /api/media/profile-image` (auth)
- `POST /api/media/upgrade-asset` (auth)
- `GET /api/payments/premium/overview` (auth)
- `POST /api/payments/paypal/order` (auth)
- `POST /api/payments/paypal/capture` (auth)
- `POST /api/payments/paypal/subscription` (auth)
- `POST /api/payments/paypal/webhook` (PayPal webhook)

## Deploy Notes (Render)

- Set `NODE_ENV=production`.
- Use strong `ENCRYPTION_KEY`.
- Configure real `CORS_ORIGIN`.
- Add PayPal live keys before enabling live billing.
- Frontend should call `/api/ping` every 5 minutes to keep service warm.

## Publish To GitHub

1. Confirm `.env` is not committed (this repo includes `.gitignore` for that).
2. Run tests before first push:
   ```bash
   npm test
   ```
3. Initialize and commit:
   ```bash
   git init
   git add .
   git commit -m "Initial backend setup"
   ```
4. Create a new empty GitHub repo, then connect and push:
   ```bash
   git branch -M main
   git remote add origin <your-github-repo-url>
   git push -u origin main
   ```

If any secret key was ever shared publicly, rotate it in the provider dashboard before production use.
