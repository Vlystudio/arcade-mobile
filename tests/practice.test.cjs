const { test } = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./helpers.cjs');
const group = load('lib/group-scoring.ts');
const { validPracticeGame, parsePractice, completePractice } = load('lib/practice.ts', { './group-scoring': group });
const { validRecentGroup } = load('lib/recent-group.ts', { '@react-native-async-storage/async-storage': {} });
const players=[{id:'a',name:'Alex'},{id:'b',name:'Sam'}];
const draft={version:1,id:'practice-1',players,balls:[],startedAt:1000,completedAt:null};
test('practice restores valid partial scores but rejects corrupt order and invalid games',()=>{
 const balls=group.groupSlots(['a','b']).map(slot=>({...slot,score:50}));
 assert.equal(validPracticeGame({...draft,balls:balls.slice(0,5)}),true);
 assert.equal(validPracticeGame({...draft,balls:[{...balls[0],player_user_id:'b'}]}),false);
 assert.equal(validPracticeGame({...draft,balls:[{...balls[0],score:999}]}),false);
 assert.equal(validPracticeGame({...draft,balls:balls.slice(0,8),completedAt:2000}),false);
 assert.equal(parsePractice('invalid').draft,null);
 assert.equal(parsePractice(JSON.stringify({version:1,draft,history:[{...draft,completedAt:2000}],names:['Alex','Sam']})).history.length,0);
});
test('practice completion preserves history and cannot save an incomplete scorecard',()=>{
 const state={version:1,draft,history:[],names:['Alex','Sam']};
 assert.throws(()=>completePractice(state,2000));
 const balls=group.groupSlots(['a','b']).map(slot=>({...slot,score:50}));
 const next=completePractice({...state,draft:{...draft,balls}},2000);
 assert.equal(next.draft,null); assert.equal(next.history[0].completedAt,2000);
 assert.equal(next.history[0].balls.filter(b=>b.player_user_id==='a').length,6);
 assert.equal(parsePractice(JSON.stringify(next)).history.length,1);
});
test('recent groups are scoped to a team and still require the current player and roster',()=>{
 const raw=JSON.stringify({version:1,teamId:'team',lineup:['b','a'],updatedAt:1000});
 assert.deepEqual(Array.from(validRecentGroup(raw,'team',['a','b','c'],'a')),['b','a']);
 assert.equal(validRecentGroup(raw,'other',['a','b'],'a'),null);
 assert.equal(validRecentGroup(raw,'team',['a','c'],'a'),null);
 assert.equal(validRecentGroup(raw,'team',['a','b','c'],'c'),null);
 assert.equal(validRecentGroup(JSON.stringify({version:1,teamId:'team',lineup:['a','a']}),'team',['a'],'a'),null);
});
