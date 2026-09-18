const { test } = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./helpers.cjs');
const experience = load('lib/experience.ts');
const plain = value => JSON.parse(JSON.stringify(value));
const draft = { version: 1, userId: 'player', sessionId: 'session', teamId: 'team', teamName: 'Team', lane: 3, lineup: ['player', 'friend'], playerBalls: { player: [10, 100, 50], friend: [40] }, updatedAt: Date.now(), previousBest: 120 };

test('game drafts survive serialization and are scoped to the signed-in player', () => {
  assert.deepEqual(plain(experience.parseGameDraft(JSON.stringify(draft), 'player')), draft);
  assert.equal(experience.parseGameDraft(JSON.stringify(draft), 'someone-else'), null);
  for (const invalid of ['invalid json', JSON.stringify({ ...draft, lane: 99 }), JSON.stringify({ ...draft, version: 2 }), JSON.stringify({ ...draft, playerBalls: { player: [5000] } })]) assert.equal(experience.parseGameDraft(invalid, 'player'), null);
});
test('resume keeps unsent balls but authoritative submitted scores win', () => {
  assert.deepEqual(plain(experience.restoreBalls({ player: [30, 40, 50], friend: [] }, draft, 'session')), { player: [30, 40, 50], friend: [40] });
  assert.deepEqual(plain(experience.restoreBalls({ player: [], friend: [] }, draft, 'new-session')), { player: [], friend: [] });
  assert.deepEqual(plain(experience.restoreBalls({ friend: [], player: [] }, draft, 'session')), { friend: [], player: [] });
});
test('menu normalization uses known categories and stable ordering without inventing dish categories', () => {
  const rows = [{ id: '2', name: 'Wings (Large)', category: 'buffalo-wings', photo_url: null }, { id: '1', name: 'Cola', category: 'drinks', photo_url: null }, { id: '3', name: 'Uncatalogued item', category: 'Uncatalogued item', photo_url: null }];
  const known = [{ id: 'ref', name: 'Wings', category: 'appetizers', photo_url: 'https://images.example.test/real-wings.jpg' }];
  const result = experience.prepareMenu(rows, known);
  assert.deepEqual(plain(result.map(r => r.category)), ['appetizers', 'drinks', 'menu']);
  assert.equal(result[0].photo_url, known[0].photo_url);
  assert.deepEqual(plain(experience.prepareMenu([...rows].reverse(), known)), plain(result));
});
test('score goals respect skee-ball scoring increments and the nine-ball maximum', () => {
  assert.equal(experience.nextScoreTarget(450, 'skeeball'), 460);
  assert.equal(experience.nextScoreTarget(890, 'skeeball'), 900);
  assert.equal(experience.nextScoreTarget(900, 'skeeball'), null);
  assert.equal(experience.nextScoreTarget(1200, 'pinball'), 1300);
  assert.equal(experience.nextScoreTarget(0, 'arcade'), 1);
});
test('venue dates use Eastern time on both sides of UTC midnight and daylight saving', () => {
  assert.equal(experience.venueDate(new Date('2026-09-19T02:00:00Z')), '2026-09-18');
  assert.equal(experience.venueDate(new Date('2026-01-02T04:30:00Z')), '2026-01-01');
});
test('RSVP targets the upcoming Monday and scheduled times sort chronologically', () => {
  assert.equal(experience.nextLeagueMonday(new Date('2026-09-18T17:00:00Z')), '2026-09-21');
  assert.equal(experience.nextLeagueMonday(new Date('2026-09-21T17:00:00Z')), '2026-09-21');
  assert(experience.scheduleMinutes('8:00 PM') < experience.scheduleMinutes('10:00 PM'));
  assert.equal(experience.scheduleMinutes('12:00 AM'), 0);
  assert.equal(experience.scheduleMinutes('12:00 PM'), 720);
  assert.equal(experience.scheduleMinutes('TBD'), Infinity);
});
test('Square normalization reads reporting-category IDs, photos, and ignores deleted variants', () => {
  const { normalizeSquareCatalogItems } = load('api/square/_shared.ts');
  const items = [{ id: 'dish', type: 'ITEM', item_data: { name: 'Wings', reporting_category: { id: 'starters' }, image_ids: ['photo'], variations: [{ id: 'v', item_variation_data: { name: 'Regular', price_money: { amount: 1200 } } }, { id: 'deleted', is_deleted: true, item_variation_data: { price_money: { amount: 500 } } }] } }];
  const result = normalizeSquareCatalogItems(items, new Map([['starters', 'Appetizers']]), new Map([['photo', 'https://images.example.test/wings.jpg']]));
  assert.equal(result.length, 1); assert.equal(result[0].category, 'appetizers'); assert.equal(result[0].photo_url, 'https://images.example.test/wings.jpg'); assert.equal(result[0].price, 12);
  assert.equal(normalizeSquareCatalogItems(items, new Map())[0].category, 'menu');
});
