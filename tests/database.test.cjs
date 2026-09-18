const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {PGlite}=require('@electric-sql/pglite');
const {root}=require('./helpers.cjs');
const id=n=>'00000000-0000-0000-0000-'+String(n).padStart(12,'0');
test('security migration executes and enforces database invariants',async t=>{
 const db=new PGlite();
 try {
  await db.exec(fs.readFileSync(path.join(root,'tests/fixtures/schema.sql'),'utf8'));
  await db.exec(fs.readFileSync(path.join(root,'supabase/migrations/20260918152047_project_review_security.sql'),'utf8'));
  for(let n=1;n<=6;n++) await db.query('INSERT INTO profiles(id,username,role,is_admin) VALUES($1,$2,$3,$4)',[id(n),'user'+n,({4:'admin',5:'owner',6:'architect'})[n]??'user',n>=4]);
  const as=async(n,role='authenticated',aal='aal1')=>{await db.exec('RESET ROLE');await db.query("SELECT set_config('request.jwt.claims',$1,false)",[JSON.stringify({sub:id(n),role,aal})]);await db.exec('SET ROLE '+role);};
  const scalar=async(sql,args=[])=>Object.values((await db.query(sql,args)).rows[0])[0];
  const balls=()=>[1,2,3].flatMap((n)=>[1,2,3].map(b=>({player_user_id:id(n),ball_number:b,score:10})));
  await as(6,'service_role','aal2');
  await db.query("INSERT INTO seasons VALUES($1,'active',true)",[id(10)]);
  await t.test('users cannot forge payment-controlled registration fields',async()=>{
   await as(1);
   for(const fields of ["'paid',NULL,NULL","'pending_payment','fake',NULL","'pending_payment',NULL,now()"]){
    await assert.rejects(db.query("INSERT INTO team_registrations(user_id,season_id,registration_type,status,square_order_id,paid_at) VALUES($1,$2,'team',"+fields+")",[id(1),id(10)]));
   }
   await db.query("INSERT INTO team_registrations(id,user_id,season_id,registration_type) VALUES($1,$2,$3,'team')",[id(11),id(1),id(10)]);
  });
  await t.test('one paid entitlement creates only one team',async()=>{
   await as(6,'service_role','aal2');
   await db.query("UPDATE team_registrations SET status='paid' WHERE id=$1",[id(11)]);
   await as(1);
   await db.query("INSERT INTO teams(id,name) VALUES($1,'Team A')",[id(20)]);
   await assert.rejects(db.query("INSERT INTO teams(id,name) VALUES($1,'Extra team')",[id(21)]));
   assert.equal(await scalar('SELECT team_id FROM team_registrations WHERE id=$1',[id(11)]),id(20));
  });
  await t.test('role hierarchy and MFA protect owners and architects',async()=>{
   await as(4,'authenticated','aal2');
   await assert.rejects(db.query("SELECT set_user_role($1,'user')",[id(5)]));
   await assert.rejects(db.query("SELECT set_user_role($1,'user')",[id(6)]));
   await assert.rejects(db.query("SELECT set_user_role($1,'admin')",[id(1)]));
   await as(6);
   await assert.rejects(db.query("SELECT set_user_role($1,'admin')",[id(3)]));
   await as(6,'authenticated','aal2');
   await db.query("SELECT set_user_role($1,'admin')",[id(3)]);
   assert.equal(await scalar('SELECT is_admin FROM profiles WHERE id=$1',[id(3)]),true);
  });
  await as(6,'service_role','aal2');
  await db.query("UPDATE seasons SET registration_required=false");
  await db.query("INSERT INTO games(id,name,type) VALUES($1,'Skee','skeeball')",[id(30)]);
  await db.query("INSERT INTO lanes(game_id,lane_number) VALUES($1,1)",[id(30)]);
  await db.query("INSERT INTO skeeball_league_matches(id,week_of) VALUES($1,'2026-09-14')",[id(40)]);
  await db.query("INSERT INTO skeeball_sessions(id,team_id,lane_number,league_match_id,week_of) VALUES($1,$2,1,$3,'2026-09-14')",[id(41),id(20),id(40)]);
  for(let n=1;n<=3;n++) await db.query("INSERT INTO skeeball_session_players VALUES($1,$2,$3)",[id(41),id(n),n]);
  await t.test('scoring rejects foreign players and invalid allocations without partial writes',async()=>{
   await as(1);
   for(const bad of [
    balls().map((b,i)=>i===8?{...b,score:999}:b),
    balls().map((b,i)=>i===8?{...b,player_user_id:id(5)}:b),
    balls().map((b,i)=>i===8?{...b,ball_number:4}:b),balls().slice(1)
   ]) await assert.rejects(db.query('SELECT rpc_skeeball_submit_balls($1,$2)',[id(41),JSON.stringify(bad)]));
   assert.equal(await scalar('SELECT count(*) FROM skeeball_ball_scores'),0);
   await as(5);
   await assert.rejects(db.query('SELECT rpc_skeeball_submit_balls($1,$2)',[id(41),JSON.stringify(balls())]));
  });
  await t.test('submission plus completion is atomic and repeatable',async()=>{
   await as(1);
   const result=await scalar('SELECT rpc_skeeball_submit_and_complete($1,$2)',[id(41),JSON.stringify(balls())]);
   assert.equal(result.ok,true);
   await db.query('SELECT rpc_skeeball_submit_and_complete($1,$2)',[id(41),JSON.stringify(balls())]);
   assert.equal(await scalar('SELECT count(*) FROM scores'),3);
   await assert.rejects(db.query('SELECT rpc_skeeball_submit_and_complete($1,$2)',[id(41),JSON.stringify(balls().map(b=>({...b,score:20})))]));
  });
  await t.test('forced finalization rejects participants without admin MFA',async()=>{
   await as(1,'authenticated','aal2');
   await assert.rejects(db.query('SELECT rpc_skeeball_finalize_match($1,true)',[id(40)]));
   await as(2);
   assert.equal(await scalar("SELECT count(*) FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname='rpc_skeeball_finalize_match'"),1);
   await as(4);
   await assert.rejects(db.query('SELECT rpc_skeeball_finalize_match($1,true)',[id(40)]));
  });
  await t.test('anonymous and ordinary users cannot advance karaoke',async()=>{
   await as(1,'anon');
   await assert.rejects(db.query('SELECT rpc_karaoke_next(NULL)'));
   await as(1,'authenticated','aal2');
   await assert.rejects(db.query('SELECT rpc_karaoke_next(NULL)'));
   await as(6,'service_role','aal2');
   await db.query("INSERT INTO karaoke_queue(id,video_id,title,channel,requester_name) VALUES($1,'v','Song','','Guest')",[id(50)]);
   await as(4,'authenticated','aal2');
   await assert.rejects(db.query('SELECT rpc_karaoke_next($1)',[id(50)]));
   assert.equal((await scalar('SELECT rpc_karaoke_next(NULL)')).id,id(50));
  });
  await t.test('payment effects roll back on failure; retries recover and deduplicate',async()=>{
   await as(6,'service_role','aal2');
   await db.query("UPDATE team_registrations SET status='pending_payment',square_order_id='order-1',expected_amount_cents=1000,expected_currency='USD',square_location_id='location-1' WHERE id=$1",[id(11)]);
   const event={event_id:'evt-1',type:'payment.updated',merchant_id:'merchant',created_at:'2026-09-18T10:00:00Z'};
   const order={id:'order-1',reference_id:'reg:'+id(11),location_id:'location-1',total_money:{amount:900,currency:'USD'},updated_at:event.created_at};
   const payment={id:'payment-1',status:'COMPLETED',updated_at:event.created_at};
   const call=()=>db.query('SELECT process_square_webhook($1,$2,$3,true)',[event,order,payment]);
   await assert.rejects(call());
   assert.equal(await scalar("SELECT count(*) FROM square_webhook_events WHERE event_id='evt-1'"),0);
   order.total_money.amount=1000;await call();
   assert.equal(await scalar('SELECT status FROM team_registrations WHERE id=$1',[id(11)]),'paid');
   assert.equal((await call()).rows[0].process_square_webhook.duplicate,true);
   const early={...event,event_id:'evt-earlier',created_at:'2026-09-18T09:00:00Z'};
   await db.query('SELECT process_square_webhook($1,$2,$3,false)',[early,{...order,updated_at:early.created_at},{id:'payment-1',status:'PENDING',updated_at:early.created_at}]);
   assert.equal(await scalar("SELECT status FROM square_payment_statuses WHERE square_order_id='order-1'"),'COMPLETED');
   await as(1);
   await assert.rejects(call());
  });
  await t.test('durable quotas deny excess service work and unprivileged calls',async()=>{
   await as(6,'service_role');
   assert.equal(await scalar("SELECT consume_service_quota('test',1,60)"),true);
   assert.equal(await scalar("SELECT consume_service_quota('test',1,60)"),false);
   await as(1);await assert.rejects(db.query("SELECT consume_service_quota('test',999,1)"));
  });

  await t.test('direct profile updates cannot bypass role hierarchy',async()=>{
   await as(4,'authenticated','aal2');
   await assert.rejects(db.query("UPDATE profiles SET role='user',is_admin=false WHERE id=$1",[id(6)]));
   await as(1,'authenticated','aal2');
   await assert.rejects(db.query("UPDATE profiles SET is_admin=true WHERE id=$1",[id(1)]));
  });
  await t.test('push reassignment requires the original device secret',async()=>{
   const secret='s'.repeat(72),token='ExpoPushToken[device_123]';
   await as(1);await db.query('SELECT register_device_push_token($1,$2,$3)',[token,secret,'android']);
   await as(2);
   await assert.rejects(db.query('SELECT register_device_push_token($1,$2,$3)',[token,'x'.repeat(72),'android']));
   await assert.rejects(db.query('SELECT register_device_push_token($1,NULL,$2)',[token,'android']));
   await db.query('SELECT register_device_push_token($1,$2,$3)',[token,secret,'android']);
   await as(6,'service_role');
   assert.equal(await scalar('SELECT user_id FROM push_tokens WHERE token=$1',[token]),id(2));
  });
  await t.test('feed pagination keeps equal-time posts and counts beyond the row cap',async()=>{
   await as(6,'service_role');
   for(let n=100;n<160;n++) await db.query("INSERT INTO posts(id,user_id,content,created_at) VALUES($1,$2,'Post','2026-09-18T12:00:00Z')",[id(n),id(1)]);
   await db.query('INSERT INTO post_likes(post_id,user_id) SELECT $1,$2 FROM generate_series(1,1100)',[id(159),id(2)]);
   await as(1);
   const first=(await db.query("SELECT * FROM rpc_feed_page('following',NULL,NULL,50)")).rows.map(r=>r.rpc_feed_page);
   assert.equal(first.length,50);assert.equal(first[0].like_count,1100);
   const last=first.at(-1);
   const second=(await db.query("SELECT * FROM rpc_feed_page('following',$1,$2,50)",[last.created_at,last.id])).rows.map(r=>r.rpc_feed_page);
   assert.equal(second.length,10);
   assert.equal(new Set([...first,...second].map(p=>p.id)).size,60);
  });
  await t.test('the best old game and season totals survive more than 100 sessions / 1000 ball rows',async()=>{
   await as(6,'service_role');
   for(let n=500;n<650;n++){
    await db.query("INSERT INTO skeeball_sessions(id,team_id,status,league_match_id,week_of) VALUES($1,$2,'completed',$3,$4)",[id(n),id(20),id(40),n===500?'2020-01-06':'2026-09-14']);
    await db.query("INSERT INTO skeeball_ball_scores(session_id,player_user_id,ball_number,score) SELECT $1,$2,b,$3 FROM generate_series(1,9) b",[id(n),id(1),n===500?100:10]);
   }
   const recap=await scalar('SELECT rpc_skeeball_recap_data($1,NULL,NULL)',[id(20)]);
   assert.equal(recap.sessions.length,151);
   assert.equal(recap.balls.reduce((sum,b)=>sum+b.score,0),14400);
   await as(1);
   assert.equal((await db.query('SELECT * FROM rpc_skeeball_team_high_scores(100,0)')).rows[0].total_score,900);
   await assert.rejects(db.query('SELECT rpc_skeeball_recap_data($1,NULL,NULL)',[id(20)]));
  });
  await t.test('missing match/adjustment RPCs enforce membership, week and admin MFA',async()=>{
   await as(2);
   await assert.rejects(db.query("SELECT rpc_skeeball_get_or_create_match(date_trunc('week',now() AT TIME ZONE 'America/New_York')::date)"));
   await as(6,'service_role');
   await db.query("INSERT INTO team_members VALUES($1,$2,'captain')",[id(20),id(1)]);
   await as(1);
   await assert.rejects(db.query("SELECT rpc_skeeball_get_or_create_match('2020-01-06')"));
   assert.equal((await scalar("SELECT rpc_skeeball_get_or_create_match(date_trunc('week',now() AT TIME ZONE 'America/New_York')::date)")).ok,true);
   await assert.rejects(db.query("SELECT rpc_admin_adjust_skeeball_session($1,1,10,'reason')",[id(41)]));
   await as(4,'authenticated','aal2');
   assert.equal((await scalar("SELECT rpc_admin_adjust_skeeball_session($1,1,10,'reason')",[id(41)])).ok,true);
  });
  await t.test('legacy identity lookup is service-only and username availability is boolean',async()=>{
   await as(1);
   await assert.rejects(db.query("SELECT resolve_login_email('user1')"));
   assert.equal(await scalar("SELECT check_username_available('USER1')"),false);
   assert.equal(await scalar("SELECT check_username_available('new_user')"),true);
   assert.equal(await scalar("SELECT check_username_available('<invalid>')"),false);
  });
  await t.test('storage cleanup includes nested objects and excludes other owners',async()=>{
   await as(6,'service_role');
   await db.query("INSERT INTO storage.objects(bucket_id,name) VALUES('media-quarantine',$1),('message-media',$2),('post-photos',$3)",[id(1)+'/post-photos/a.jpg',id(90)+'/'+id(1)+'/a.jpg',id(2)+'/a.jpg']);
   const rows=(await db.query('SELECT * FROM account_storage_inventory($1,100)',[id(1)])).rows;
   assert.equal(rows.length,2);
   await assert.rejects(db.query('SELECT delete_account_data($1)',[id(1)]));
  });
 }finally{await db.close();}
});
