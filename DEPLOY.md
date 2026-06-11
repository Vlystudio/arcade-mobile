# Branching & Deploy Workflow

Three-stage pipeline: **sandbox → staging → master**.

```
sandbox          staging           master
(dev/local test) (QA)              (LIVE — real users)
     |                |                  |
     | merge when     | merge when QA    |
     | feature works  | passes           |
     +--------------->+----------------->+
```

## Branches

| Branch    | Purpose                                   | EAS update branch/channel | Who deploys |
|-----------|--------------------------------------------|----------------------------|--------------|
| `sandbox` | Active development, quick local testing     | `sandbox`                  | anyone, often |
| `staging` | QA — exercise the full feature before it's live | `staging`              | after sandbox testing looks good |
| `master`  | Production — what real users run            | `production`               | only after QA signs off on staging |

CI (`.github/workflows/security.yml`) runs type-check, lint, audit, and secret scanning on pushes/PRs to all three branches.

## Backends

| Environment | Supabase project | Used by |
|-------------|-------------------|---------|
| `production` | `arcade-score-app` (`ahtynqcogyqhcrvqdsmi`) | `master` branch / `production` channel — real users, real data |
| `sandbox` + `staging` | `arcade-score-app-staging` (`nyhpfvivyhsbvgfrmact`, free tier) | `sandbox` and `staging` channels — shared non-prod database for dev/QA testing |

The staging project's schema is a snapshot of production's `public` schema (tables, RLS, functions — restored via `pg_dump --schema-only`). It has **no production data** — it starts empty (only the seed data from `seed-games.sql`/`seed-menu.sql`/`seed-admin-policies.sql`, since those run as part of the production schema). When you change the schema (new run-order script), re-apply it to the staging project too so sandbox/staging stays in sync.

Credentials for the staging project's Supabase URL/anon key live in `.env.staging` (gitignored) and are also baked into the `development`, `preview`, and `staging` profiles in `eas.json` via their `"env"` blocks.

## Day-to-day flow

1. **Develop & test locally / in sandbox**
   ```bash
   git checkout sandbox
   git pull
   # make changes, run `npm start`, test in Expo Go / dev client
   git add -A && git commit -m "..."
   git push
   ```
   To test against the staging Supabase project locally, copy `.env.staging` over `.env` temporarily (or `cp .env .env.local.bak && cp .env.staging .env`).

   Optionally push an OTA update so others can test on the sandbox channel (uses the staging Supabase project, via `.env.staging`):
   ```bash
   set -a && source .env.staging && set +a && CI=1 node --use-system-ca \
     "<path-to-eas-cli>" update --branch sandbox --message "..."
   ```

2. **Promote to staging for QA**
   ```bash
   git checkout staging
   git merge sandbox
   git push
   set -a && source .env.staging && set +a && CI=1 node --use-system-ca \
     "<path-to-eas-cli>" update --branch staging --message "..."
   ```
   QA testers run a build with `channel: staging` (the `staging` profile in `eas.json`) and test the OTA update there. This build/update points at the staging Supabase project (`arcade-score-app-staging`), not production.

3. **Promote to production after QA passes**
   ```bash
   git checkout master
   git merge staging
   git push
   set -a && source .env && set +a && CI=1 node --use-system-ca \
     "<path-to-eas-cli>" update --branch production --environment production --message "..."
   ```
   This is the command that ships to live users — only run it after staging has been QA'd.

## Notes

- The live app currently resolves OTA updates from the `production` EAS branch — this is unchanged by this workflow.
- `staging` and `sandbox` are new EAS update branches; they're created automatically the first time you `eas update --branch staging` / `--branch sandbox`.
- To get physical devices onto the `staging` or `sandbox` channels, build with the matching `eas.json` profile (`eas build --profile staging` / `--profile preview`) and install that build — it will then receive OTA updates pushed to that channel.
- Always run the EAS deploy command via Bash (not PowerShell) with the appropriate env file sourced — `.env` for production, `.env.staging` for sandbox/staging — see `set -a && source <file> && set +a` above.
