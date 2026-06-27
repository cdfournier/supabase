# Operators Guide

Short version for running the local Varro/Soren runtime.

## Common Commands

Run these from:

```bash
cd /Users/chris/Sites/repositories/supabase
```

Install dependencies:

```bash
npm install
```

Start the local development server:

```bash
npm run dev
```

Start on a specific port if `3000` is busy:

```bash
npm run dev -- -p 3001
```

Build and check the app:

```bash
npm run build
```

Run the production-style server after a build:

```bash
npm run start
```

Run production-style on a specific port:

```bash
npm run start -- -p 3001
```

## After Code Changes

For normal local testing, stop the running server with `Ctrl+C`, then restart:

```bash
npm run dev
```

If the change touches runtime tools, prompts, environment variables, or API routes, restart before asking an agent to test.

## Environment

Secrets live in `.env.local`. Do not commit that file.

Use `.env.example` as the checklist for required values:

- `NEXT_PUBLIC_SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `ANTHROPIC_API_KEY`
- `ANTHROPIC_MODEL_SOREN`
- `ANTHROPIC_MODEL_VARRO`
- `OUTPOST_TOKEN_SOREN`
- `OUTPOST_TOKEN_VARRO`

