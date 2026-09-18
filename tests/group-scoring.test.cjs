const { test } = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./helpers.cjs');
const scoring = load('lib/group-scoring.ts');
const plain = v => JSON.parse(JSON.stringify(v));
test('handoff follows all supported lineups and stops after nine balls', () => {
  for (let n = 1; n <= 3; n++) {
    const ids = ['a','b','c'].slice(0,n), slots = plain(scoring.groupSlots(ids));
    assert.equal(slots.length,9);
    for (let ball=0;ball<9;ball++) {
      const turn=scoring.groupTurn(ids,ball);
      assert.equal(turn.playerId,ids[Math.floor(ball/3)%n]);
      assert.equal(turn.ball,ball%3+1);
    }
    assert.equal(scoring.groupTurn(ids,9),null);
    const records=slots.map((slot,i)=>({...slot,score:i%2?100:10}));
    assert.deepEqual(plain(scoring.orderedGroupBalls(ids,scoring.groupBallMap(ids,records))),records);
  }
  assert.deepEqual(plain(scoring.groupSlots(['a','a'])),[]);
});
test('partial rounds, corrections and undo retain player attribution', () => {
  const ids=['a','b'];
  const records=plain(scoring.groupSlots(ids)).map(slot=>({...slot,score:40}));
  records[2].score=100;
  for(const count of [0,3,4,6,8,9]) {
    const partial=records.slice(0,count);
    assert.deepEqual(plain(scoring.orderedGroupBalls(ids,scoring.groupBallMap(ids,partial))),partial);
  }
  assert.equal(scoring.groupTurn(ids,6).playerId,'a');
  assert.equal(scoring.groupTurn(ids,5).playerId,'b');
  assert.deepEqual(plain(scoring.orderedGroupBalls(ids,{a:[10],b:[100,100]})),[{player_user_id:'a',ball_number:1,score:10}]);
});
