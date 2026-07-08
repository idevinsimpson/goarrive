// Unit tests for collectOgGroups segment grouping + kind naming.
// Run `npm run build` in functions/ first, then: node scripts/test-og-groups.js

const assert = require('assert');
const { collectOgGroups } = require('../lib/ogImage');

const mv = (n) => ({ name: `m${n}`, thumbnailUrl: `https://x/${n}.jpg` });

// Rick H shape: tabata pair + 2-movement circuit, water break, then a circuit.
{
  const { groups, movementCount } = collectOgGroups({
    blocks: [
      { type: 'Intro' },
      { type: 'Circuit', rounds: 8, movements: [mv(1)] },
      { type: 'Circuit', rounds: 8, movements: [mv(2)] },
      { type: 'Circuit', rounds: 3, movements: [mv(3), mv(4)] },
      { type: 'Water Break' },
      { type: 'Circuit', rounds: 2, movements: [mv(5), mv(6), mv(7)] },
      { type: 'Outro' },
    ],
  });
  assert.strictEqual(groups.length, 2, 'one group per water-break segment');
  assert.strictEqual(groups[0].label, 'Tabata + Superset');
  assert.strictEqual(groups[0].tiles.length, 4, 'first segment merges tabata pair + superset');
  assert.deepStrictEqual(groups[0].tiles.map((t) => t.roundsLabel), ['8x', '8x', '3x', '3x']);
  assert.strictEqual(groups[1].label, 'Circuit');
  assert.strictEqual(groups[1].tiles.length, 3);
  assert.deepStrictEqual(groups[1].tiles.map((t) => t.roundsLabel), ['2x', '2x', '2x']);
  assert.strictEqual(movementCount, 7);
}

// Kind naming: 1 movement = Tabata, 2 = Superset, 3+ = Circuit; dedupe in order.
{
  const { groups } = collectOgGroups({
    blocks: [
      { type: 'Circuit', movements: [mv(1), mv(2), mv(3)] },
      { type: 'Circuit', movements: [mv(4)] },
      { type: 'Circuit', movements: [mv(5)] },
      { type: 'Circuit', movements: [mv(6), mv(7)] },
    ],
  });
  assert.strictEqual(groups.length, 1, 'no specials means one segment');
  assert.strictEqual(groups[0].label, 'Circuit + Tabata + Superset', 'unique kinds joined in order');
  assert.strictEqual(groups[0].tiles.length, 7);
}

// rounds=1 gets no pill; showOnPreview=false movements excluded from count/kind.
{
  const { groups } = collectOgGroups({
    blocks: [
      { type: 'Circuit', rounds: 1, movements: [mv(1), mv(2), { ...mv(3), showOnPreview: false }] },
    ],
  });
  assert.strictEqual(groups[0].label, 'Superset', 'hidden movement does not count toward kind');
  assert.strictEqual(groups[0].tiles.length, 2);
  assert.strictEqual(groups[0].tiles[0].roundsLabel, undefined);
}

// Overflow: >16 tiles folds into a +N tile.
{
  const blocks = [];
  for (let i = 0; i < 20; i++) blocks.push({ type: 'Circuit', movements: [mv(i)] });
  const { groups, movementCount } = collectOgGroups({ blocks });
  assert.strictEqual(movementCount, 20);
  const tiles = groups.flatMap((g) => g.tiles);
  assert.strictEqual(tiles.length, 16);
  assert.strictEqual(tiles[15].extraCount, 5, 'last tile becomes +5 (4 hidden + the replaced one)');
}

console.log('OK — all collectOgGroups tests passed');
