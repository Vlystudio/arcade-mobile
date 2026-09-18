const {test}=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const {load,response,cors}=require('./helpers.cjs');
const sdk='https://esm.sh/@supabase/supabase-js@2.106.0';

test('native sessions use persistent storage and web keeps redirect detection',()=>{
 for(const platform of ['android','web']){
  let options;const storage={getItem(){},setItem(){},removeItem(){}};
  load('lib/supabase.ts',{'@supabase/supabase-js':{createClient:(url,key,opts)=>{options=opts}},
   '@react-native-async-storage/async-storage':storage,'react-native':{Platform:{OS:platform}}},
   {process:{env:{EXPO_PUBLIC_SUPABASE_URL:'https://example.test',EXPO_PUBLIC_SUPABASE_ANON_KEY:'public'}}});
  assert.equal(options.auth.persistSession,true);
  assert.equal(options.auth.detectSessionInUrl,platform==='web');
  if(platform!=='web')assert.equal(options.auth.storage,storage);
 }
});

test('legacy queue recovery moves only verified participation and preserves foreign entries',async()=>{
 const legacy=[{session_id:'mine',balls:[],ts:1},{session_id:'other',balls:[],ts:2}];
 const state=new Map([['pending_skee_submits_v1',JSON.stringify(legacy)]]);
 let lookup;
 const query={select(){return this},eq(k,v){if(k==='session_id')lookup=v;return this},maybeSingle:async()=>({data:lookup==='mine'?{}:null})};
 const q=load('lib/offline-queue.ts',{'@react-native-async-storage/async-storage':{
  getItem:async k=>state.get(k)??null,setItem:async(k,v)=>state.set(k,v)},
  'expo-network':{},'react-native':{},'./supabase':{supabase:{from:()=>query}}});
 await q.recoverLegacySubmissions('a');
 assert.equal((await q.pendingSubmissions('a'))[0].session_id,'mine');
 assert.equal(JSON.parse(state.get('pending_skee_submits_v1'))[0].session_id,'other');
 await q.recoverLegacySubmissions('a');assert.equal(await q.pendingCount('a'),1);
});

test('approved moderation derives its destination and rejects provider failure',async()=>{
 for(const fails of [false,true]){
  let handler;const uploads=[],removals=[];
  const svc={auth:{getUser:async()=>({data:{user:{id:'a'}}})},from:()=>({upsert:async()=>({})}),
   storage:{from:bucket=>({
    createSignedUrl:async()=>({data:{signedUrl:'https://storage.test/owned'}}),
    upload:async(path)=>{uploads.push({bucket,path});return{}},
    remove:async paths=>{removals.push({bucket,paths});return{}},
    getPublicUrl:path=>({data:{publicUrl:'https://storage.test/'+path}}),
   })}};
  load('supabase/functions/moderate-image/index.ts',{
   [sdk]:{createClient:()=>svc},'../_shared/cors.ts':cors,
   '../_shared/image-bytes.ts':{readStorageImage:async()=>new Uint8Array([1])},
   'https://esm.sh/@aws-sdk/client-rekognition@3.1135.0':{
    RekognitionClient:class{async send(){if(fails)throw Error('provider down');return{ModerationLabels:[]}}},
    DetectModerationLabelsCommand:class{}},
  },{Deno:{env:{get:()=> 'configured'},serve:h=>handler=h}});
  const res=await handler(new Request('https://app.test/moderate',{method:'POST',
   headers:{Authorization:'Bearer valid','Content-Type':'application/json'},
   body:JSON.stringify({bucket:'media-quarantine',path:'a/avatars/file.jpg',record_type:'avatar',record_id:'a',
    publish_to_bucket:'avatars',publish_to_path:'victim/avatar.jpg',image_url:'http://localhost/'})}));
  assert.equal(res.status,fails?503:200);
  if(fails){assert.equal(uploads.length,0);assert.notEqual((await res.json()).ok,true)}
  else{assert.deepEqual(uploads,[{bucket:'avatars',path:'a/avatar.jpg'}]);assert.equal(removals[0].paths[0],'a/avatars/file.jpg')}
 }
});

test('deletion rejects wrong passwords and missing MFA before any destructive work',async()=>{
 for(const mfa of [false,true]){
  let handler,calls=0,mutations=0;
  const jwt='header.'+Buffer.from(JSON.stringify({aal:'aal1'})).toString('base64url')+'.signature';
  const admin={auth:{getUser:async()=>({data:{user:{id:'u',email:'u@test',factors:mfa?[{status:'verified'}]:[]}}})},
   from(){mutations++;throw Error('must not mutate')},storage:{from(){mutations++;throw Error('must not mutate')}}};
  load('supabase/functions/delete-account/index.ts',{[sdk]:{createClient:()=>++calls===1?admin:{
   auth:{signInWithPassword:async()=>({data:{user:null},error:{message:'bad password'}})}}},'../_shared/cors.ts':cors},
   {atob, Deno:{env:{get:()=> 'configured'},serve:h=>handler=h}});
  const res=await handler(new Request('https://app.test/delete',{method:'POST',headers:{Authorization:'Bearer '+jwt,'Content-Type':'application/json'},body:JSON.stringify({password:'wrong'})}));
  assert.equal(res.status,mfa?403:401);assert.equal(mutations,0);
 }
});

test('username sign-in exposes no identity mapping on failed authentication',async()=>{
 let handler,credentials;
 const admin={rpc:async name=>({data:name==='consume_service_quota'?true:'private@example.test'})};
 const client={auth:{signInWithPassword:async data=>{credentials=data;return{data:{session:null},error:{message:'private@example.test'}}}}};
 load('supabase/functions/password-login/index.ts',{[sdk]:{createClient:(url,key)=>key==='service'?admin:client},'../_shared/cors.ts':cors},
  {crypto:crypto.webcrypto,Deno:{env:{get:key=>key==='SUPABASE_SERVICE_ROLE_KEY'?'service':'public'},serve:h=>handler=h}});
 const res=await handler(new Request('https://app.test/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({identifier:'username',password:'wrong'})}));
 assert.equal(credentials.email,'private@example.test');assert.equal(res.status,401);
 assert(!JSON.stringify(await res.json()).includes('private@example.test'));
 assert.equal(res.headers.get('cache-control'),'no-store');
});

test('registration authorization stops anonymous and other-user checkout creation',async()=>{
 const auth=load('api/_auth.ts');let squareCalls=0;
 const db={auth:{getUser:async()=>({data:{user:{id:'a'}}})},from:()=>({
  select(){return this},eq(){return this},maybeSingle:async()=>({data:{user_id:'b',status:'pending_payment'}})})};
 const handler=load('api/square/registration.ts',{'@supabase/supabase-js':{createClient:()=>db},
  '../_auth':auth,'../_cors':cors,'../_ratelimit':{checkRateLimit:async()=>true},
  './_shared':{sendJson:(res,status,body)=>res.status(status).json(body),squareRequest:async()=>{squareCalls++}}}).default;
 for(const authorized of [false,true]){
  const res=response();await handler({method:'POST',headers:authorized?{authorization:'Bearer verified'}:{},body:{registrationId:'00000000-0000-0000-0000-000000000001'}},res);
  assert.equal(res.statusCode,authorized?403:401);
 }
 assert.equal(squareCalls,0);
});

test('food checkout status needs the order capability and confirmed provider payment',async()=>{
 let paymentStatus='PENDING';
 const order={id:'order',metadata:{app_order_id:'unguessable-client-id'},location_id:'loc',total_money:{amount:1000,currency:'USD'},tenders:[{payment_id:'payment'}]};
 const h=load('api/square/orders.ts',{'../_ratelimit':{checkRateLimit:async()=>true},'../_cors':cors,
  '../../lib/validation':{},
  './_shared':{assertSquareConfigured:()=>({configured:true,locationId:'loc'}),
   sendJson:(res,status,body)=>res.status(status).json(body),
   squareRequest:async path=>path.includes('/orders/')?{order}:{payment:{order_id:'order',status:paymentStatus,amount_money:{amount:1000,currency:'USD'}}}
  }}).default;
 const call=async id=>{const res=response();await h({method:'POST',headers:{},body:{action:'status',squareOrderId:'order',localOrderId:id}},res);return res};
 assert.equal((await call('wrong')).statusCode,404);
 assert.equal((await call('unguessable-client-id')).body.paid,false);
 paymentStatus='COMPLETED';assert.equal((await call('unguessable-client-id')).body.paid,true);
});

test('pending checkouts are durable and account/location scoped',async()=>{
 const state=new Map();
 const checkout=load('lib/checkout-state.ts',{'@react-native-async-storage/async-storage':{
  getItem:async k=>state.get(k)??null,setItem:async(k,v)=>state.set(k,v),removeItem:async k=>state.delete(k)}});
 const fingerprint=checkout.checkoutFingerprint('arcade_bar',[{squareVariationId:'v',quantity:2}]);
 await checkout.saveCheckout('a:arcade_bar',{fingerprint,localOrderId:'retry-key'});
 assert.equal((await checkout.readCheckout('a:arcade_bar')).localOrderId,'retry-key');
 assert.equal(await checkout.readCheckout('b:arcade_bar'),null);
 assert.equal(await checkout.readCheckout('a:vinyl_hall'),null);
});

test('web monitoring queues startup errors and strips sensitive event context',async()=>{
 const listeners=new Map(),captured=[];let options;
 const sentry=load('src/lib/sentry.web.ts',{'@sentry/browser':{
  init:opts=>{options=opts},captureMessage:m=>captured.push(m),captureException:e=>captured.push(e.message),
 }},{window:{addEventListener:(type,fn)=>listeners.set(type,fn),removeEventListener:type=>listeners.delete(type)}});
 const ready=sentry.init({dsn:'test',sendDefaultPii:true});
 listeners.get('error')({error:Error('startup')});
 const message=sentry.captureMessage('queued');
 await ready;await message;
 assert.deepEqual(captured,['startup','queued']);assert.equal(listeners.size,0);
 const clean=options.beforeSend({extra:{password:'secret'},user:{id:'u',email:'private@test'},
  request:{url:'https://app.test/reset?token=secret',data:'private',headers:{Authorization:'Bearer secret'}}});
 assert.equal(clean.extra,undefined);assert.equal(clean.user.email,undefined);
 assert.equal(clean.request.data,undefined);assert.equal(clean.request.url,'https://app.test/reset');
 assert.equal(options.sendDefaultPii,false);
});

test('push registration retries failures and sign-out deletes before another account registers',async()=>{
 let userId='a',fail=true;const state=new Map(),events=[];
 const client={auth:{getSession:async()=>({data:{session:{user:{id:userId}}}})},
  rpc:async(name,args)=>{events.push('register:'+userId);return fail?{error:{message:'offline'}}:{}},
  from:()=>({delete:()=>({eq:async()=>{events.push('delete:'+userId);return{}}})})};
 const push=load('src/lib/push.ts',{'expo-constants':{expoConfig:{extra:{eas:{projectId:'test'}}}},
  'react-native':{Platform:{OS:'android'}},'../../lib/supabase':{supabase:client},
  '@react-native-async-storage/async-storage':{getItem:async k=>state.get(k)??null,setItem:async(k,v)=>state.set(k,v),removeItem:async k=>state.delete(k)},
  'expo-crypto':{randomUUID:()=>crypto.randomUUID()},'expo-device':{isDevice:true},
  'expo-notifications':{AndroidImportance:{DEFAULT:3},setNotificationChannelAsync:async()=>{},getPermissionsAsync:async()=>({status:'granted'}),getExpoPushTokenAsync:async()=>({data:'ExpoPushToken[device]'})},
 });
 await push.registerForPush('a');fail=false;
 await push.registerForPush('a');await push.registerForPush('a');
 await push.unregisterForPush();userId='b';await push.registerForPush('b');
 assert.deepEqual(events,['register:a','register:a','delete:a','register:b']);
});

test('account deletion consumes all storage pages and stops on failed cleanup',async()=>{
 for(const failure of [false,true]){
  let handler,clients=0,inventory=0,removed=0,deleted=0;
  const jwt='h.'+Buffer.from(JSON.stringify({aal:'aal2'})).toString('base64url')+'.s';
  const admin={
   auth:{getUser:async()=>({data:{user:{id:'u',email:'u@test'}}}),admin:{signOut:async()=>({}),deleteUser:async()=>{deleted++;return{}}}},
   from:()=>({upsert:async()=>({}),update:()=>({eq:async()=>({})})}),
   storage:{from:()=>({remove:async names=>{removed+=names.length;return failure?{error:{message:'storage down'}}:{}}})},
   rpc:async name=>name==='account_storage_inventory'?{data:++inventory===1?Array.from({length:100},(_,i)=>({bucket_id:'avatars',name:String(i)})):inventory===2?[{bucket_id:'avatars',name:'last'}]:[]}:{},
  };
  load('supabase/functions/delete-account/index.ts',{[sdk]:{createClient:()=>++clients===1?admin:{
   auth:{signInWithPassword:async()=>({data:{user:{id:'u'}}}),signOut:async()=>({})}}},'../_shared/cors.ts':cors},
   {atob,Deno:{env:{get:()=> 'configured'},serve:h=>handler=h}});
  const res=await handler(new Request('https://app.test/delete',{method:'POST',headers:{Authorization:'Bearer '+jwt,'Content-Type':'application/json'},body:JSON.stringify({password:'correct-test-password'})}));
  assert.equal(res.status,failure?500:200);assert.equal(deleted,failure?0:1);
  if(!failure){assert.equal(removed,101);assert.equal(inventory,3)}
 }
});

test('public identity batches skip guests, deduplicate and stay below query row limits',async()=>{
 const pages=[];
 const helper=load('lib/public-profiles.ts',{'./supabase':{supabase:{from:table=>{
  assert.equal(table,'public_profiles');return{select(){return this},in:async(key,ids)=>{pages.push(ids);return{data:ids.map(id=>({id,username:id,avatar_url:null}))}}};
 }}}});
 const ids=Array.from({length:451},(_,i)=>String(i));
 const identities=await helper.publicProfilesById([...ids,...ids,null,'']);
 assert.equal(identities.size,451);assert.deepEqual(pages.map(p=>p.length),[200,200,51]);
});
