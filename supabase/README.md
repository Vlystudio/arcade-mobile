# Database changes

New changes belong in ordered `supabase/migrations/` files created with the Supabase CLI. Treat `../scripts/*.sql` as historical references: replaying an older replacement function after a migration can restore a vulnerability.

The migration upgrades an **existing ArcadeTracker schema**. `baselines/20260918_public.sql` captures the production public schema before this upgrade, including its grants and policies. It contains no application rows and is a reference snapshot, not an ordered migration or a complete Supabase bootstrap: managed schemas, extensions, storage buckets and storage policies also need provisioning. Do not use `../tests/fixtures/schema.sql` as production schema.

Production was backed up and the full database restored into an isolated local PostgreSQL instance before this migration was tested and applied on 18 September 2026. `../lib/database.types.ts` was generated from the migrated production schema. Existing loosely typed queries have not all been converted to use it.

Run `npm test` from the repository root to execute the upgrade in embedded PostgreSQL with authenticated/anonymous/service roles and check targeted invariants. These tests do not replace validation against the complete deployed schema/policies.

See [implementation and rollout notes](../docs/review-fixes-2026-09-18.md) before applying the migration or publishing dependent clients.
