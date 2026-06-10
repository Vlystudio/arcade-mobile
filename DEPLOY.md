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

## Day-to-day flow

1. **Develop & test locally / in sandbox**
   ```bash
   git checkout sandbox
   git pull
   # make changes, run `npm start`, test in Expo Go / dev client
   git add -A && git commit -m "..."
   git push
   ```
   Optionally push an OTA update so others can test on the sandbox channel:
   ```bash
   set -a && source .env && set +a && CI=1 node --use-system-ca \
     "<path-to-eas-cli>" update --branch sandbox --message "..."
   ```

2. **Promote to staging for QA**
   ```bash
   git checkout staging
   git merge sandbox
   git push
   set -a && source .env && set +a && CI=1 node --use-system-ca \
     "<path-to-eas-cli>" update --branch staging --message "..."
   ```
   QA testers run a build with `channel: staging` (the `staging` profile in `eas.json`) and test the OTA update there.

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
- Always run the EAS deploy command via Bash (not PowerShell) with `.env` sourced — see `set -a && source .env && set +a` above.
