import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BLOCK_TYPES,
  collectAvailableVars,
  createBlock,
  createDefaultFlow,
  duplicateBlock,
  interpolate,
  interpolateTarget,
  moveBlock,
  parseBooleanLike,
  parseListInput,
  removeBlock,
  wrapRootBlocksInLoopList,
} from '../src/shared/flow-model.js';

test('parseListInput parses comma-separated numbers and ignores trailing/empty items', () => {
  assert.deepEqual(parseListInput('101, 102 , 103, ', ','), ['101', '102', '103']);
  assert.deepEqual(parseListInput('  ', ','), []);
  assert.deepEqual(parseListInput('10\n20\r\n30\n', '\\n'), ['10', '20', '30']);
  assert.deepEqual(parseListInput('1; 2, 3\n4', 'auto'), ['1', '2', '3', '4']);
});

test('interpolate replaces {{var}} placeholders cleanly', () => {
  assert.equal(interpolate('Filtro: {{item}} (#{{ indice }})', { item: '998', indice: 2 }), 'Filtro: 998 (#2)');
  assert.equal(interpolate('{{missing}}', {}), '');
});

test('interpolateTarget interpolates primary, fallbacks, text, and label', () => {
  const target = {
    primary: 'tr[data-id="{{item}}"] input',
    fallbacks: ['[aria-label="Item {{item}}"]'],
    text: 'Selecionar {{item}}',
    label: 'Linha {{indice}}',
  };
  const resolved = interpolateTarget(target, { item: '42', indice: 1 });
  assert.equal(resolved.primary, 'tr[data-id="42"] input');
  assert.deepEqual(resolved.fallbacks, ['[aria-label="Item 42"]']);
  assert.equal(resolved.text, 'Selecionar 42');
  assert.equal(resolved.label, 'Linha 1');
});

test('parseBooleanLike interprets truthy and falsy Portuguese/English strings', () => {
  for (const t of ['true', '1', 'sim', 'YES', 'marcar', 'on']) {
    assert.equal(parseBooleanLike(t), true);
  }
  for (const f of ['false', '0', 'não', 'nao', 'no', '']) {
    assert.equal(parseBooleanLike(f), false);
  }
});

test('wrapRootBlocksInLoopList wraps recorded root blocks into a loop_list block', () => {
  const flow = createDefaultFlow('Teste');
  const b1 = createBlock(BLOCK_TYPES.TYPE, { value: '123' });
  const b2 = createBlock(BLOCK_TYPES.CLICK);
  const b3 = createBlock(BLOCK_TYPES.CHECKBOX, { mode: 'check' });
  flow.blocks.push(b1, b2, b3);

  const loop = wrapRootBlocksInLoopList(flow, '10, 20, 30');
  assert.equal(flow.blocks.length, 1);
  assert.equal(flow.blocks[0].id, loop.id);
  assert.equal(loop.children.length, 3);
  assert.equal(loop.listText, '10, 20, 30');
});

test('moveBlock, duplicateBlock, removeBlock, and collectAvailableVars work recursively', () => {
  const flow = createDefaultFlow('Teste');
  const loop = createBlock(BLOCK_TYPES.LOOP_LIST, {
    itemVar: 'codigo',
    children: [
      createBlock(BLOCK_TYPES.TYPE, { value: '{{codigo}}' }),
      createBlock(BLOCK_TYPES.CLICK),
    ],
  });
  flow.blocks.push(loop);

  const firstId = loop.children[0].id;
  assert.equal(moveBlock(flow.blocks, firstId, 1), true);
  assert.equal(loop.children[1].id, firstId);

  const dup = duplicateBlock(loop);
  assert.notEqual(dup.id, loop.id);
  assert.notEqual(dup.children[0].id, loop.children[0].id);

  const vars = collectAvailableVars(flow.blocks);
  assert.ok(vars.includes('codigo'));
  assert.ok(vars.includes('indice'));

  const removed = removeBlock(flow.blocks, firstId);
  assert.equal(removed.id, firstId);
  assert.equal(loop.children.length, 1);
});

