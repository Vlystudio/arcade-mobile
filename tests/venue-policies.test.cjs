const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');
const { root } = require('./helpers.cjs');

test('public venues remain readable while writes require admin MFA', async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      CREATE ROLE anon; CREATE ROLE authenticated;
      CREATE SCHEMA auth;
      GRANT USAGE ON SCHEMA auth TO anon, authenticated;
      CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql AS
        $$ SELECT current_setting('request.jwt.claims',true)::jsonb $$;
      CREATE FUNCTION public.is_platform_admin() RETURNS boolean LANGUAGE sql AS
        $$ SELECT COALESCE((auth.jwt()->>'admin')::boolean,false) $$;
      CREATE TABLE public.venues(id integer PRIMARY KEY,name text);
      INSERT INTO public.venues VALUES(1,'Arcade');
      GRANT ALL ON public.venues TO anon, authenticated;
    `);
    const migration = fs.readdirSync(path.join(root, 'supabase/migrations')).find(name => name.endsWith('_release_schema_hardening.sql'));
    await db.exec(fs.readFileSync(path.join(root, 'supabase/migrations', migration), 'utf8'));
    await db.exec('SET ROLE anon');
    assert.equal((await db.query('SELECT count(*)::int n FROM venues')).rows[0].n, 1);
    await assert.rejects(db.exec("INSERT INTO venues VALUES(2,'Unauthorized')"));
    await assert.rejects(db.exec('TRUNCATE venues'));
    await db.exec('RESET ROLE; SET ROLE authenticated');
    for (const claims of [{ admin: false, aal: 'aal2' }, { admin: true, aal: 'aal1' }]) {
      await db.query("SELECT set_config('request.jwt.claims',$1,false)", [JSON.stringify(claims)]);
      assert.equal((await db.query("UPDATE venues SET name='Unauthorized' RETURNING id")).rows.length, 0);
      await assert.rejects(db.exec("INSERT INTO venues VALUES(2,'Unauthorized')"));
    }
    await db.query("SELECT set_config('request.jwt.claims',$1,false)", [JSON.stringify({ admin: true, aal: 'aal2' })]);
    assert.equal((await db.query("UPDATE venues SET name='Allowed' RETURNING id")).rows.length, 1);
    await db.exec("INSERT INTO venues VALUES(2,'Second venue')");
    assert.equal((await db.query('SELECT count(*)::int n FROM venues')).rows[0].n, 2);
  } finally {
    await db.close();
  }
});
