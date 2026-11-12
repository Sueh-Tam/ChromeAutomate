import test from 'node:test';
import assert from 'node:assert/strict';
import '../src/content/selector.js';

const { selector } = globalThis.__ChromeAutomate;

test('isStableId rejects dynamic/framework IDs and accepts semantic IDs', () => {
  assert.equal(selector.isStableId('filtro-codigo'), true);
  assert.equal(selector.isStableId('btnFiltrar'), true);

  assert.equal(selector.isStableId(':r0:'), false);
  assert.equal(selector.isStableId(':r1a:'), false);
  assert.equal(selector.isStableId('mui-12345'), false);
  assert.equal(selector.isStableId('radix-23'), false);
  assert.equal(selector.isStableId('550e8400-e29b-41d4-a716-446655440000'), false);
  assert.equal(selector.isStableId('row_1700012345'), false);
  assert.equal(selector.isStableId('12345'), false);
});

test('isStableClass rejects Tailwind/CSS-in-JS/state classes and accepts semantic classes', () => {
  assert.equal(selector.isStableClass('btn-primary'), true);
  assert.equal(selector.isStableClass('filter-input'), true);

  assert.equal(selector.isStableClass('css-1dbjc4n'), false);
  assert.equal(selector.isStableClass('hover:bg-blue-500'), false);
  assert.equal(selector.isStableClass('w-[120px]'), false);
  assert.equal(selector.isStableClass('active'), false);
  assert.equal(selector.isStableClass('ng-dirty'), false);
});

test('buildTarget prefers data-testid or stable id and builds fallbacks', () => {
  const inputEl = {
    nodeType: 1,
    tagName: 'INPUT',
    type: 'text',
    id: 'campo-numero',
    classList: [],
    parentElement: null,
    getAttribute(attr) {
      if (attr === 'name') return 'numero';
      if (attr === 'placeholder') return 'Digite o número';
      return null;
    },
    hasAttribute() {
      return false;
    },
    closest() {
      return null;
    },
  };

  const mockDoc = {
    querySelectorAll(sel) {
      if (sel === '#campo-numero' || sel === 'input[type="text"][name="numero"]' || sel === 'input[placeholder="Digite o número"]') {
        return [inputEl];
      }
      return [];
    },
    querySelector() {
      return null;
    },
  };

  const target = selector.buildTarget(inputEl, mockDoc);
  assert.equal(target.primary, '#campo-numero');
  assert.ok(target.fallbacks.includes('input[type="text"][name="numero"]'));
  assert.equal(target.label, 'Digite o número');
  assert.equal(target.inputType, 'text');
});

test('findElement falls back to button text when primary selector fails', () => {
  const btn = {
    nodeType: 1,
    tagName: 'BUTTON',
    innerText: 'Filtrar',
    getBoundingClientRect: () => ({ width: 80, height: 32 }),
    closest: () => null,
  };

  const mockDoc = {
    querySelectorAll(sel) {
      if (sel === 'button') return [btn];
      return [];
    },
  };

  const found = selector.findElement(
    {
      primary: '#old-missing-id',
      fallbacks: [],
      tag: 'button',
      text: 'Filtrar',
      label: '',
    },
    mockDoc
  );

  assert.equal(found, btn);
});

test('isElementInteractable and findElement handle hidden checkbox input with visible <label for="...">', () => {
  const originalGetComputedStyle = globalThis.getComputedStyle;

  const wrapperDiv = {
    nodeType: 1,
    tagName: 'DIV',
    getBoundingClientRect: () => ({ width: 24, height: 24 }),
    closest: () => null,
  };

  const labelEl = {
    nodeType: 1,
    tagName: 'LABEL',
    id: 'itens.0.encontrado-label',
    htmlFor: 'itens.0.encontrado',
    parentElement: wrapperDiv,
    getBoundingClientRect: () => ({ width: 20, height: 20 }),
    closest: () => null,
  };

  const hiddenCheckbox = {
    nodeType: 1,
    tagName: 'INPUT',
    type: 'checkbox',
    id: 'itens.0.encontrado',
    parentElement: wrapperDiv,
    getBoundingClientRect: () => ({ width: 0, height: 0 }),
    closest: () => null,
  };

  globalThis.getComputedStyle = (el) => {
    if (el === hiddenCheckbox) return { display: 'none', visibility: 'visible', opacity: '1' };
    return { display: 'inline-block', visibility: 'visible', opacity: '1' };
  };

  const mockDoc = {
    querySelectorAll(sel) {
      if (sel === '#itens\\.0\\.encontrado') return [hiddenCheckbox];
      return [];
    },
    querySelector(sel) {
      if (sel === 'label[for="itens\\.0\\.encontrado"]') return labelEl;
      return null;
    },
  };

  try {
    assert.equal(selector.isElementVisible(hiddenCheckbox), false);
    assert.equal(selector.isElementInteractable(hiddenCheckbox, mockDoc), true);
    assert.equal(selector.getVisualTarget(hiddenCheckbox, mockDoc), labelEl);
    assert.equal(
      selector.findElement({ primary: '#itens\\.0\\.encontrado', fallbacks: [] }, mockDoc),
      hiddenCheckbox
    );
  } finally {
    globalThis.getComputedStyle = originalGetComputedStyle;
  }
});

