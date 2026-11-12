import test from 'node:test';
import assert from 'node:assert/strict';
import { BLOCK_TYPES, createBlock, createDefaultFlow } from '../src/shared/flow-model.js';
import { runFlow } from '../src/shared/engine.js';

function createMockController() {
  return {
    stopped: false,
    shouldStop() {
      return this.stopped;
    },
    async waitIfPaused() {},
  };
}

test('runFlow automates comma-separated list -> type -> click filter -> check checkbox', async () => {
  const flow = createDefaultFlow('Lista + Filtro + Checkbox');
  flow.settings.stepDelayMs = 0;

  const loop = createBlock(BLOCK_TYPES.LOOP_LIST, {
    listText: '101, 202, 303',
    delimiter: ',',
    itemVar: 'item',
    children: [
      createBlock(BLOCK_TYPES.TYPE, {
        target: { primary: '#campo-busca' },
        value: '{{item}}',
      }),
      createBlock(BLOCK_TYPES.CLICK, {
        target: { primary: '#btn-filtrar' },
      }),
      createBlock(BLOCK_TYPES.CHECKBOX, {
        target: { primary: 'tbody tr td:nth-child(1) input[type="checkbox"]' },
        mode: 'check',
      }),
    ],
  });
  flow.blocks.push(loop);

  const executed = [];
  const driver = {
    async executeAction(action) {
      executed.push(action);
    },
    async checkCondition() {
      return true;
    },
    async wait() {},
    onProgress() {},
  };

  const result = await runFlow(flow, driver, createMockController());
  assert.equal(result.status, 'completed');
  assert.equal(result.stepsExecuted, 9);

  assert.deepEqual(
    executed.map((a) => [a.type, a.target.primary, a.value ?? a.mode ?? null]),
    [
      ['type', '#campo-busca', '101'],
      ['click', '#btn-filtrar', null],
      ['checkbox', 'tbody tr td:nth-child(1) input[type="checkbox"]', 'check'],
      ['type', '#campo-busca', '202'],
      ['click', '#btn-filtrar', null],
      ['checkbox', 'tbody tr td:nth-child(1) input[type="checkbox"]', 'check'],
      ['type', '#campo-busca', '303'],
      ['click', '#btn-filtrar', null],
      ['checkbox', 'tbody tr td:nth-child(1) input[type="checkbox"]', 'check'],
    ]
  );
});

test('runFlow handles if_condition (DOM and variable), continue, break, and variable checkbox', async () => {
  const flow = createDefaultFlow('Condicional + Break/Continue');
  flow.settings.stepDelayMs = 0;

  const loop = createBlock(BLOCK_TYPES.LOOP_LIST, {
    listText: 'skip, 10, stop, 20',
    children: [
      createBlock(BLOCK_TYPES.IF_CONDITION, {
        condition: { kind: 'var_equals', varName: 'item', value: 'skip' },
        thenBlocks: [createBlock(BLOCK_TYPES.CONTINUE)],
      }),
      createBlock(BLOCK_TYPES.IF_CONDITION, {
        condition: { kind: 'var_equals', varName: 'item', value: 'stop' },
        thenBlocks: [createBlock(BLOCK_TYPES.BREAK)],
      }),
      createBlock(BLOCK_TYPES.IF_CONDITION, {
        condition: { kind: 'exists', target: { primary: '.resultado' } },
        thenBlocks: [
          createBlock(BLOCK_TYPES.CHECKBOX, {
            target: { primary: '#chk' },
            mode: 'variable',
            value: 'sim',
          }),
        ],
        elseBlocks: [
          createBlock(BLOCK_TYPES.CLICK, { target: { primary: '#fallback' } }),
        ],
      }),
    ],
  });
  flow.blocks.push(loop);

  const executed = [];
  const driver = {
    async executeAction(action) {
      executed.push(action);
    },
    async checkCondition(cond) {
      return cond.target.primary === '.resultado';
    },
    async wait() {},
    onProgress() {},
  };

  const result = await runFlow(flow, driver, createMockController());
  assert.equal(result.status, 'completed');
  // Only item '10' executes the checkbox; 'skip' continues, 'stop' breaks before '20'
  assert.equal(executed.length, 1);
  assert.equal(executed[0].type, 'checkbox');
  assert.equal(executed[0].mode, 'check');
});

test('runFlow stops cleanly when controller.shouldStop() becomes true', async () => {
  const flow = createDefaultFlow('Stop Test');
  flow.settings.stepDelayMs = 0;
  flow.blocks.push(
    createBlock(BLOCK_TYPES.LOOP_COUNT, {
      count: 5,
      children: [createBlock(BLOCK_TYPES.CLICK, { target: { primary: '#btn' } })],
    })
  );

  const controller = createMockController();
  let clicks = 0;
  const driver = {
    async executeAction() {
      clicks++;
      if (clicks === 2) controller.stopped = true;
    },
    async checkCondition() {
      return false;
    },
    async wait() {},
    onProgress() {},
  };

  const result = await runFlow(flow, driver, controller);
  assert.equal(result.status, 'stopped');
  assert.equal(clicks, 2);
});

