# Supabase migrations

1. Create a Supabase project.
2. Open the SQL editor and run `migrations/0001_initial.sql` (then optionally `0002_embeddings.sql`).
   Or with psql: `psql "$DATABASE_URL" -f supabase/migrations/0001_initial.sql`.
3. Put `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` in `apps/backend/.env`.
4. Seed sources: `pnpm --filter @douala-ai/backend seed`.

See `docs/DATABASE.md` for the schema description and security model.
