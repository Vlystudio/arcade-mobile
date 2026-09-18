const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');
const { root, load } = require('./helpers.cjs');
const { groupSlots } = load('lib/group-scoring.ts');
const id = n => '00000000-0000-0000-0000-'+String(n).padStart(12,'0');
test('group scoring enforces a single phone, safe drafts and rematches', async t => {
 const db = new PGlite();
 const file = name => fs.readFileSync(path.join(root,name),'utf8');
 try {
  await db.exec(file('tests/fixtures/schema.sql'));
  await db.exec('ALTER TABLE skeeball_sessions ADD COLUMN created_by uuid');
  await db.exec('CREATE TABLE team_bans(team_id uuid,user_id uuid)');
  for(let n=1;n<=4;n++) await db.query('INSERT INTO profiles(id,username) VALUES($1,$2)',[id(n),'Player '+n]);
  await db.query("INSERT INTO teams(id,name) VALUES($1,'Group')",[id(10)]);
  await db.query("INSERT INTO teams(id,name) VALUES($1,'Other group')",[id(11)]);
  for(let n=1;n<=3;n++) await db.query("INSERT INTO team_members VALUES($1,$2,'member')",[id(10),id(n)]);
  await db.query("INSERT INTO games(id,name,type) VALUES($1,'Skee','skeeball')",[id(20)]);
  await db.query("INSERT INTO lanes(game_id,lane_number) VALUES($1,3)",[id(20)]);
  await db.query("INSERT INTO skeeball_league_matches(id,week_of) VALUES($1,date_trunc('week',now() AT TIME ZONE 'America/New_York')::date)",[id(30)]);
  await db.query("INSERT INTO skeeball_sessions(id,team_id,lane_number,league_match_id,week_of) VALUES($1,$2,3,$3,date_trunc('week',now() AT TIME ZONE 'America/New_York')::date)",[id(40),id(10),id(30)]);
  for(let n=1;n<=3;n++) await db.query('INSERT INTO skeeball_session_players VALUES($1,$2,$3)',[id(40),id(n),n]);
  await db.exec(file('supabase/migrations/20260918152047_project_review_security.sql'));
  await db.exec(file('supabase/migrations/20260918181426_skeeball_group_handoff.sql'));
  const as = async n => { await db.exec('RESET ROLE'); await db.query("SELECT set_config('request.jwt.claims',$1,false)",[JSON.stringify({sub:id(n),role:'authenticated',aal:'aal1'})]); await db.exec('SET ROLE authenticated'); };
  const scalar = async (sql,args=[]) => Object.values((await db.query(sql,args)).rows[0])[0];
  const a='a'.repeat(64), b='b'.repeat(64);
  const balls=JSON.parse(JSON.stringify(groupSlots([id(1),id(2),id(3)]))).map(s=>({...s,score:40}));
  const control = (key,action='read',payload=null,revision=null) => scalar('SELECT rpc_skeeball_group_control($1,$2,$3,$4,$5)',[id(40),key,action,payload&&JSON.stringify(payload),revision]);
  await t.test('outsiders cannot view, claim, or inspect the device key',async()=>{
   await as(4); await assert.rejects(control(a)); await assert.rejects(control(a,'claim'));
   await as(1); await assert.rejects(db.query('SELECT * FROM private.skeeball_scoring_controls'));
   assert.equal((await control(a)).claimed,false);
  });
  await t.test('first claim wins, including two phones signed into the same account',async()=>{
   await as(1); assert.equal((await control(a,'claim')).can_score,true);
   assert.equal((await control(b,'claim')).can_score,false);
   await as(2); const viewer=await control(b,'claim');
   assert.equal(viewer.can_score,false); assert.equal(viewer.owner_id,id(1));
   assert.equal('device_hash' in viewer,false);
   await assert.rejects(control(b,'save',balls.slice(0,3),0));
   await assert.rejects(control(b,'submit',balls));
   await assert.rejects(db.query('SELECT rpc_skeeball_submit_balls($1,$2)',[id(40),JSON.stringify(balls)]));
  });
  await t.test('drafts validate order and revision, and allow correcting or undoing a handoff',async()=>{
   await as(1); const saved=await control(a,'save',balls.slice(0,3),0); assert.equal(saved.revision,1);
   await assert.rejects(control(a,'save',balls.slice(0,4),0));
   await assert.rejects(control(a,'save',[{...balls[0],player_user_id:id(2)}],1));
   await assert.rejects(control(a,'save',[{...balls[0],score:999}],1));
   assert.equal((await control(a)).balls.length,3);
   assert.equal((await control(a,'save',balls.slice(0,2),1)).revision,2);
   const corrected=balls.slice(0,3).map((x,i)=>i===2?{...x,score:100}:x);
   await control(a,'save',corrected,2);
   await as(2); assert.equal((await control(b)).balls[2].score,100);
   await assert.rejects(db.query('UPDATE skeeball_session_players SET shoot_position=3 WHERE session_id=$1 AND player_user_id=$2',[id(40),id(1)]));
  });
  await t.test('submission completes atomically and cannot be overwritten from an old client',async()=>{
   await as(1); assert.equal((await control(a,'submit',balls)).ok,true);
   assert.equal(await scalar('SELECT status FROM skeeball_sessions WHERE id=$1',[id(40)]),'completed');
   assert.equal(await scalar('SELECT count(*) FROM scores'),3);
   assert.equal((await control(a,'submit',balls)).ok,true);
   await as(2); await assert.rejects(db.query('SELECT rpc_skeeball_submit_balls($1,$2)',[id(40),JSON.stringify(balls.map(x=>({...x,score:100})))]));
   assert.equal(await scalar('SELECT sum(score) FROM skeeball_ball_scores'),360);
  });
  await t.test('rematch waits for the round, preserves lineup, and deduplicates repeated taps',async()=>{
   await as(1);
   const again=()=>scalar('SELECT rpc_skeeball_group_rematch($1,$2)',[id(40),a]);
   await assert.rejects(again(),/other teams/);
   await db.exec('RESET ROLE'); await db.query("UPDATE skeeball_league_matches SET status='completed' WHERE id=$1",[id(30)]);
   await db.query("UPDATE lanes SET status='inactive' WHERE lane_number=3");
   await as(1); await assert.rejects(again(),/not available/);
   await db.exec('RESET ROLE'); await db.query("UPDATE lanes SET status='available' WHERE lane_number=3");
   await db.query('INSERT INTO team_bans VALUES($1,$2)',[id(10),id(1)]);
   await as(1); await assert.rejects(again(),/cannot check in/);
   await db.exec('RESET ROLE'); await db.query('DELETE FROM team_bans');
   await db.query("INSERT INTO skeeball_sessions(id,team_id,lane_number,status) VALUES($1,$2,3,'active')",[id(41),id(11)]);
   await as(1); await assert.rejects(again(),/now in use/);
   await db.exec('RESET ROLE'); await db.query('DELETE FROM skeeball_sessions WHERE id=$1',[id(41)]);
   await as(1); const next=await again(); assert.equal(next.ok,true); assert.notEqual(next.session.id,id(40));
   assert.equal((await again()).session.id,next.session.id);
   const lineup=(await db.query('SELECT player_user_id FROM skeeball_session_players WHERE session_id=$1 ORDER BY shoot_position',[next.session.id])).rows.map(x=>x.player_user_id);
   assert.deepEqual(lineup,[id(1),id(2),id(3)]);
   const nextState=await scalar('SELECT rpc_skeeball_group_control($1,$2)',[next.session.id,a]); assert.equal(nextState.can_score,true); assert.deepEqual(nextState.balls,[]);
  });
 } finally { await db.close(); }
});
