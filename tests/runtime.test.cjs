const {test}=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const {load,response,cors}=require('./helpers.cjs');
function offline(rpc,userId='a',failWrite=false){
 const state=new Map();
 const q=load('lib/offline-queue.ts',{'@react-native-async-storage/async-storage':{
  getItem:async k=>state.get(k)??null,setItem:async(k,v)=>{if(failWrite)throw Error('disk full');state.set(k,v)},
 },'expo-network':{addNetworkStateListener:()=>({remove(){}})},'react-native':{AppState:{addEventListener:()=>({remove(){}})}},
 './supabase':{supabase:{rpc,auth:{getSession:async()=>({data:{session:{user:{id:userId}}}})}}}});
 return q;
}
test('offline queue retains server rejections with a recovery message',async()=>{
 const q=offline(async()=>({data:{error:'unauthorized',message:'Login required'}}));
 await q.queueSubmit('a',{session_id:'s',balls:[]});
 assert.equal(await q.flushQueue('a'),0);assert.equal(await q.pendingCount('a'),1);
 assert.equal((await q.pendingSubmissions('a'))[0].last_error,'Login required');
});
test('explicit discard removes only the confirmed session from the correct account',async()=>{
 const q=offline(async()=>({data:{ok:true}}));
 await q.queueSubmit('a',{session_id:'ended',balls:[]});
 await q.queueSubmit('a',{session_id:'other',balls:[]});
 await q.queueSubmit('b',{session_id:'ended',balls:[]});
 await q.discardQueuedSubmission('a','ended');
 assert.equal((await q.pendingSubmissions('a'))[0].session_id,'other');
 assert.equal(await q.pendingCount('a'),1); assert.equal(await q.pendingCount('b'),1);
});
test('concurrent enqueue survives a flush, including edits to the same session',async()=>{
 let enter,release;const arrived=new Promise(r=>enter=r),hold=new Promise(r=>release=r);
 const q=offline(async()=>{enter();await hold;return {data:{ok:true}}});
 await q.queueSubmit('a',{session_id:'s',balls:[]});
 const work=q.flushQueue('a');await arrived;
 await q.queueSubmit('a',{session_id:'new',balls:[]});await q.queueSubmit('a',{session_id:'s',balls:[{score:20}]});
 release();await work;
 assert.equal(await q.pendingCount('a'),2);
});
test('queue replay is account scoped and a failed local save is reported',async()=>{
 let calls=0;const q=offline(async()=>{calls++;return{data:{ok:true}}},'b');
 await q.queueSubmit('a',{session_id:'s',balls:[]});await q.flushQueue('a');assert.equal(calls,0);
 assert.equal(await q.pendingCount('a'),1);
 await assert.rejects(offline(async()=>({}), 'a',true).queueSubmit('a',{session_id:'s',balls:[]}));
});
test('replayed submissions use the atomic completion RPC and only explicit success removes them',async()=>{
 let rpc;const q=offline(async(name)=>{rpc=name;return{data:{ok:true}}});
 await q.queueSubmit('a',{session_id:'s',balls:[]});assert.equal(await q.flushQueue('a'),1);
 assert.equal(rpc,'rpc_skeeball_submit_and_complete');assert.equal(await q.pendingCount('a'),0);
});
test('offline group submissions retain the scoring phone and use atomic group completion',async()=>{
 let call;const q=offline(async(name,args)=>{call={name,args};return {data:{ok:true}}});
 await q.queueSubmit('a',{session_id:'group',balls:[],group_device_key:'local-device-key'});
 assert.equal(await q.flushQueue('a'),1);
 assert.equal(call.name,'rpc_skeeball_group_control');
 assert.equal(call.args.p_device_key,'local-device-key');
 assert.equal(call.args.p_action,'submit');
 assert.equal(await q.pendingCount('a'),0);
});
test('transient auth failures do not invalidate sessions',()=>{
 const {isInvalidSession}=load('lib/auth-errors.ts');
 assert.equal(isInvalidSession({status:503}),false);assert.equal(isInvalidSession({status:0}),false);
 assert.equal(isInvalidSession({status:401}),true);assert.equal(isInvalidSession({code:'user_not_found'}),true);
});
test('print and CSV exports neutralize active content',()=>{
 const {escapeHtml,csvCell}=load('lib/export-text.ts');
 assert.equal(escapeHtml('<img src=x onerror="alert(1)">'), '&lt;img src=x onerror=&quot;alert(1)&quot;&gt;');
 assert.equal(csvCell(' \t=HYPERLINK("url")'), '"\' \t=HYPERLINK(""url"")"');
 assert.equal(csvCell('Normal & team'),'"Normal & team"');
});
test('private message images require a conversation path and signed URL',async()=>{
 let signed;
 const helper=load('lib/message-media.ts',{'./supabase':{supabase:{storage:{from:bucket=>({createSignedUrl:async(path)=>{signed={bucket,path};return{data:{signedUrl:'signed'}}}})}}}},
 {process:{env:{EXPO_PUBLIC_SUPABASE_URL:'https://project.supabase.co'}}});
 assert.equal(await helper.resolveMessageImage('storage://message-media/conversation/user/photo.jpg','conversation'),'signed');
 assert.equal(signed.bucket,'message-media');
 assert.equal(await helper.resolveMessageImage('storage://message-media/other/user/photo.jpg','conversation'),null);
 assert.equal(await helper.resolveMessageImage('https://attacker.test/photo.jpg','conversation'),null);
});
function webhook(rpc){
 const env={SQUARE_WEBHOOK_SIGNATURE_KEY:'test-key',SQUARE_WEBHOOK_NOTIFICATION_URL:'https://app.test/api/square/webhook'};
 const h=load('api/square/webhook.ts',{'@supabase/supabase-js':{createClient:()=>({rpc})},'../_cors':cors,
 './_shared':{assertSquareConfigured:()=>({configured:true}),getSquareLocationId:()=> 'loc',
 squareRequest:async path=>path.startsWith('/v2/orders/')?{order:{id:'order',location_id:'loc',total_money:{amount:1000,currency:'USD'},tenders:[{payment_id:'payment'}]}}:
 path.startsWith('/v2/locations/')?{location:{merchant_id:'merchant'}}:
 {payment:{id:'payment',order_id:'order',location_id:'loc',status:'COMPLETED',amount_money:{amount:1000,currency:'USD'}}}}},{process:{env}}).default;
 return async(event,valid=true)=>{
 const body=JSON.stringify(event),signature=crypto.createHmac('sha256',env.SQUARE_WEBHOOK_SIGNATURE_KEY).update(env.SQUARE_WEBHOOK_NOTIFICATION_URL+body).digest('base64');
 const res=response();await h({method:'POST',body,headers:{'x-square-hmacsha256-signature':valid?signature:'bad'}},res);return res;
 };
}
test('Square documented payment and order events reconcile the saved order',async()=>{
 const calls=[];const h=webhook(async(name,args)=>{calls.push({name,args});return{data:{ok:true}}});
 for(const [type,object] of [['payment.updated',{payment:{id:'payment',order_id:'order'}}],['order.updated',{order_updated:{order_id:'order',state:'COMPLETED'}}]]){
  assert.equal((await h({event_id:type,type,merchant_id:'merchant',data:{object}})).statusCode,200);
 }
 assert.equal(calls.length,2);assert(calls.every(c=>c.name==='process_square_webhook'&&c.args.p_verified_paid));
 assert.equal((await h({event_id:'e',type:'order.updated',data:{object:{order_updated:{order_id:'order'}}}},false)).statusCode,401);
});
test('failed Square processing is retried; no early event insert discards it',async()=>{
 let tries=0;const h=webhook(async()=>++tries===1?{error:{message:'temporary'}}:{data:{ok:true}});
 const event={event_id:'retry',type:'order.updated',merchant_id:'merchant',data:{object:{order_updated:{order_id:'order'}}}};
 assert.equal((await h(event)).statusCode,500);assert.equal((await h(event)).statusCode,200);assert.equal(tries,2);
});
test('moderation rejects unauthenticated and cross-owner operations before storage access',async()=>{
 let handler;let storageCalls=0;
 const svc={auth:{getUser:async()=>({data:{user:{id:'user-a'}}})},storage:{from(){storageCalls++;throw Error('must not access storage')} }};
 load('supabase/functions/moderate-image/index.ts',{
  'https://esm.sh/@supabase/supabase-js@2.106.0':{createClient:()=>svc},
  'https://esm.sh/@aws-sdk/client-rekognition@3.1135.0':{},'../_shared/cors.ts':cors,'../_shared/image-bytes.ts':{},
 },{Deno:{env:{get:()=> 'test'},serve:h=>handler=h}});
 const req=(body,auth)=>new Request('https://app.test/moderate',{method:'POST',headers:{'Content-Type':'application/json',...(auth?{Authorization:'Bearer test'}:{})},body:JSON.stringify(body)});
 const body={bucket:'media-quarantine',path:'user-b/avatars/file.jpg',record_type:'avatar',record_id:'user-b',image_url:'http://localhost'};
 assert.equal((await handler(req(body,false))).status,401);
 assert.equal((await handler(req(body,true))).status,403);
 assert.equal(storageCalls,0);
});
test('moderation proxy refuses URLs and never approves provider failure',async()=>{
 const h=load('api/moderation/_image.ts',{'@supabase/supabase-js':{createClient:()=>({functions:{invoke:async()=>({error:{message:'AWS failed'}})}})},
 '../_cors':cors,'../_ratelimit':{checkRateLimit:async()=>true}}).default;
 let res=response();await h({method:'POST',headers:{authorization:'Bearer t'},body:{imageUrl:'http://localhost'}},res);assert.equal(res.statusCode,400);
 res=response();await h({method:'POST',headers:{authorization:'Bearer t'},body:{path:'c/u/f.jpg'}},res);assert.equal(res.statusCode,503);assert.notEqual(res.body.ok,true);
});
test('bounded image downloads reject oversized content and redirects',async()=>{
 let options;
 const image=load('supabase/functions/_shared/image-bytes.ts',{},{
 fetch:async(url,opts)=>{options=opts;return new Response(new Uint8Array([1]),{headers:{'content-type':'image/jpeg','content-length':String(6*1024*1024)}})}
 });
 await assert.rejects(image.readStorageImage('https://project.supabase.co/generated-url'),/image_too_large/);
 assert.equal(options.redirect,'error');assert(options.signal);
});
test('account deletion requires the actual password; a JWT alone is insufficient',async()=>{
 let handler;let mutations=0;
 load('supabase/functions/delete-account/index.ts',{
 'https://esm.sh/@supabase/supabase-js@2.106.0':{createClient:()=>({auth:{getUser:async()=>({data:{user:{id:'u',email:'a@test'}}})},from(){mutations++;throw Error('unexpected')}})},
 '../_shared/cors.ts':cors,
 },{Deno:{env:{get:()=> 'test'},serve:h=>handler=h}});
 const res=await handler(new Request('https://app.test/delete',{method:'POST',headers:{Authorization:'Bearer token','Content-Type':'application/json'},body:'{}'}));
 assert.equal(res.status,400);assert.equal(mutations,0);
});
test('identical authorized AI requests share an in-flight result',async()=>{
 const {cachedServiceWork}=load('api/_service-work.ts');let calls=0;
 const work=async()=>{calls++;return{ok:true}};
 await Promise.all([cachedServiceWork('coach','stats-v1',work),cachedServiceWork('coach','stats-v1',work)]);
 assert.equal(calls,1);
 await cachedServiceWork('coach','stats-v2',work);assert.equal(calls,2);
});
