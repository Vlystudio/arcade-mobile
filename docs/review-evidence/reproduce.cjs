const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { createRequire } = require('node:module');
const root = path.resolve(__dirname, '../..');
const projectRequire = createRequire(path.join(root, 'package.json'));
const ts = projectRequire('typescript');
const cors = { handleCorsPreflight: () => false, applyCors() {}, rejectDisallowedOrigin: () => null, handleCors: () => null, corsHeaders: () => ({}) };
const quiet = { log() {}, warn() {}, error() {} };
function load(file, mocks = {}, globals = {}, sourceOverride) {
  const source = sourceOverride ?? fs.readFileSync(path.join(root, file), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  const mod = { exports: {} };
  vm.runInNewContext(code, { module: mod, exports: mod.exports, require: id => id in mocks ? mocks[id] : projectRequire(id), console: quiet, Buffer, URL, Request, Response, setTimeout, clearTimeout, process: { env: {} }, ...globals }, { filename: file });
  return mod.exports;
}
function response() {
  return { statusCode: 200, headers: {}, body: null, setHeader(k,v) { this.headers[k] = v; }, status(n) { this.statusCode = n; return this; }, json(b) { this.body = b; return this; }, end(s) { this.body = JSON.parse(s); } };
}
function offline(rpc) {
  const state = new Map();
  const store = { getItem: async k => state.get(k) ?? null, setItem: async (k,v) => state.set(k,v) };
  return load('lib/offline-queue.ts', { '@react-native-async-storage/async-storage': store, './supabase': { supabase: { rpc } } });
}
async function main() {
  const results = [];
  const run = async (name, fn) => { const detail = await fn(); results.push({ name, reproduced: true, detail }); };
  await run('offline rejection is counted as success and removed', async () => {
    const q = offline(async () => ({ data: { error: 'unauthorized', message: 'Login required.' }, error: null }));
    await q.queueSubmit({ session_id: 'session-a', balls: [] });
    const done = await q.flushQueue();
    assert.equal(done, 1); assert.equal(await q.pendingCount(), 0);
    return { done, remaining: await q.pendingCount() };
  });
  await run('enqueue during an in-flight flush loses the new submission', async () => {
    let release, entered;
    const arrived = new Promise(r => entered = r);
    const hold = new Promise(r => release = r);
    const q = offline(async () => { entered(); await hold; return { data: { ok: true }, error: null }; });
    await q.queueSubmit({ session_id: 'session-a', balls: [] });
    const work = q.flushQueue(); await arrived;
    await q.queueSubmit({ session_id: 'session-b', balls: [] });
    assert.equal(await q.pendingCount(), 2);
    release(); await work; assert.equal(await q.pendingCount(), 0);
    return 'session-b was never submitted and no longer exists in the queue';
  });
  await run('Square completed payment does not confirm registration', async () => {
    const calls = [];
    const svc = { rpc: async () => ({}), from(table) { calls.push(table); return { insert: async () => ({ error: null }), select() { return this; }, eq() { return this; }, maybeSingle: async () => ({ data: null, error: null }), update() { return this; } }; } };
    const env = { SUPABASE_URL: 'https://example.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'test', SQUARE_WEBHOOK_SIGNATURE_KEY: 'test-signature', SQUARE_WEBHOOK_NOTIFICATION_URL: 'https://example.test/api/square/webhook' };
    const h = load('api/square/webhook.ts', { '@supabase/supabase-js': { createClient: () => svc }, '../_cors': cors }, { process: { env } }).default;
    const event = { event_id: 'test-payment', type: 'payment.updated', data: { object: { payment: { id: 'pay-1', order_id: 'ord-1', status: 'COMPLETED' } } } };
    const body = JSON.stringify(event);
    const signature = crypto.createHmac('sha256', env.SQUARE_WEBHOOK_SIGNATURE_KEY).update(env.SQUARE_WEBHOOK_NOTIFICATION_URL + body).digest('base64');
    const res = response(); await h({ method: 'POST', body, headers: { 'x-square-hmacsha256-signature': signature } }, res);
    assert.equal(res.statusCode, 200); assert(!calls.includes('team_registrations'));
    return { status: res.statusCode, touchedTables: calls };
  });
  await run('Square documented order.updated payload is ignored', async () => {
    const calls = [];
    const svc = { rpc: async () => ({}), from(table) { calls.push(table); return { insert: async () => ({ error: null }) }; } };
    const env = { SUPABASE_URL: 'https://example.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'test', SQUARE_WEBHOOK_SIGNATURE_KEY: 'test-signature', SQUARE_WEBHOOK_NOTIFICATION_URL: 'https://example.test/api/square/webhook' };
    const h = load('api/square/webhook.ts', { '@supabase/supabase-js': { createClient: () => svc }, '../_cors': cors }, { process: { env } }).default;
    const body = JSON.stringify({ event_id: 'test-order', type: 'order.updated', data: { object: { order_updated: { order_id: 'ord-1', state: 'COMPLETED', version: 2 } } } });
    const signature = crypto.createHmac('sha256', env.SQUARE_WEBHOOK_SIGNATURE_KEY).update(env.SQUARE_WEBHOOK_NOTIFICATION_URL + body).digest('base64');
    const res = response(); await h({ method: 'POST', body, headers: { 'x-square-hmacsha256-signature': signature } }, res);
    assert.equal(res.statusCode, 200); assert.deepEqual(calls, ['square_webhook_events']);
    return { status: res.statusCode, touchedTables: calls };
  });
  await run('Square retry is discarded after processing fails', async () => {
    const seen = new Set(); let lookups = 0;
    const svc = { rpc: async () => ({}), from(table) {
      if (table === 'square_webhook_events') return { insert: async row => { if(seen.has(row.event_id)) return {error:{code:'23505'}};seen.add(row.event_id);return {error:null}; } };
      return { select() { return this; }, eq() { return this; }, maybeSingle: async () => { lookups++; return { error: { message: 'simulated temporary database failure' } }; } };
    } };
    const env = { SUPABASE_URL: 'https://example.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'test', SQUARE_WEBHOOK_SIGNATURE_KEY: 'test-signature', SQUARE_WEBHOOK_NOTIFICATION_URL: 'https://example.test/api/square/webhook' };
    const h = load('api/square/webhook.ts', { '@supabase/supabase-js': { createClient: () => svc }, '../_cors': cors }, { process: { env } }).default;
    const body = JSON.stringify({ event_id: 'retry-test', type: 'payment.updated', data: { object: { payment: { id: 'pay-2', order_id: 'ord-2', status: 'COMPLETED' } } } });
    const signature = crypto.createHmac('sha256', env.SQUARE_WEBHOOK_SIGNATURE_KEY).update(env.SQUARE_WEBHOOK_NOTIFICATION_URL + body).digest('base64');
    const req = { method: 'POST', body, headers: { 'x-square-hmacsha256-signature': signature } };
    const a=response(),b=response();await h(req,a);await h(req,b);
    assert.equal(a.statusCode,500);assert.equal(b.statusCode,200);assert.equal(b.body.duplicate,true);assert.equal(lookups,1);
    return { firstStatus:a.statusCode,retryStatus:b.statusCode,retryBody:b.body,processingAttempts:lookups };
  });
  await run('moderate-image performs caller-chosen service-role writes without authentication', async () => {
    let handler;const writes=[];
    const svc={storage:{from(bucket){return {upload:async (p,bytes,opts)=>{writes.push({operation:'upload',bucket,path:p,upsert:opts.upsert});return {error:null};},remove:async paths=>{writes.push({operation:'remove',bucket,paths});return {error:null};},getPublicUrl:p=>({data:{publicUrl:'https://example.test/'+p}})};}},from(){throw Error('unexpected DB call');}};
    const env={SUPABASE_URL:'https://example.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'test',IS_PRODUCTION:'true',AWS_ACCESS_KEY_ID:'test',AWS_SECRET_ACCESS_KEY:'test'};
    load('supabase/functions/moderate-image/index.ts',{'https://esm.sh/@supabase/supabase-js@2':{createClient:()=>svc},'https://esm.sh/@aws-sdk/client-rekognition@3':{RekognitionClient:class{async send(){return {ModerationLabels:[]};}},DetectModerationLabelsCommand:class{}},'../_shared/cors.ts':cors},{Deno:{env:{get:k=>env[k]},serve:h=>handler=h},fetch:async ()=>new Response(new Uint8Array([1,2,3]),{status:200})});
    const res=await handler(new Request('https://example.test/moderate-image',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({image_url:'https://fixture.test/clean.jpg',bucket:'avatars',path:'other-user/existing.jpg',record_type:'avatar',record_id:'other-user',publish_to_bucket:'avatars',publish_to_path:'other-user/replacement.jpg'})}));
    assert.equal(res.status,200);assert.equal(writes.length,2);assert.equal(writes[0].upsert,true);
    return {status:res.status,writes};
  });
  await run('Vercel image moderation generates an invalid AWS date then allows failed moderation', async () => {
    let amzDate;
    const h=load('api/moderation/_image.ts',{'../_cors':cors,'../_ratelimit':{checkRateLimit:async()=>true}},{process:{env:{AWS_ACCESS_KEY_ID:'test',AWS_SECRET_ACCESS_KEY:'test'}},fetch:async (url,options)=>{if(String(url).includes('amazonaws.com')){amzDate=options.headers['X-Amz-Date'];return new Response('invalid date',{status:400});}return new Response(new Uint8Array([1,2,3]));}}).default;
    const res=response();await h({method:'POST',headers:{},body:{imageUrl:'https://fixture.test/image.jpg'}},res);
    assert(!/^\d{8}T\d{6}Z$/.test(amzDate));assert.equal(res.body.flagged,false);
    return {amzDate,response:res.body};
  });
  await run('unescaped user-controlled markup reaches printable HTML', async () => {
    const file='src/app/leagues.tsx';
    const source=fs.readFileSync(path.join(root,file),'utf8');
    const parsed=ts.createSourceFile(file,source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
    let printer;
    function visit(node){if(ts.isFunctionDeclaration(node)&&node.name?.text==='printSchedule')printer=node;ts.forEachChild(node,visit);}
    visit(parsed);assert(printer);
    const name='<img src=x onerror=alert(1)>';
    const validate=load('lib/validation.ts');assert.equal(validate.validateTeamName(name).ok,true);
    let html;
    const win={document:{write:s=>html=s,close(){}},focus(){},print(){}};
    const query={select(){return this;},eq(){return this;},order:async()=>({data:[{slot_time:'6:00 PM',teams:{name}}]})};
    const fn=load(file,{}, {Platform:{OS:'web'},supabase:{from:()=>query},skeeSeasons:[],skeeSeasonId:'all',skeeStandings:[],window:{open:()=>win},setTimeout(){}},'export '+printer.getText(parsed)).printSchedule;
    await fn();assert(html.includes(name));
    return 'Team-name validation accepts HTML, and the actual print function writes it unescaped; no browser script was executed.';
  });
  fs.writeFileSync(path.join(__dirname,'reproductions.json'),JSON.stringify(results,null,2));
  console.log(JSON.stringify(results,null,2));
}
main().catch(e=>{console.error(e);process.exitCode=1;});
