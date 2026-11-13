/**
 * Flow & Block data model, variable interpolation, list parsing, and tree helpers.
 */

export const BLOCK_TYPES = {
  TYPE: 'type',
  CLICK: 'click',
  CHECKBOX: 'checkbox',
  SELECT: 'select',
  WAIT: 'wait',
  LOOP_LIST: 'loop_list',
  LOOP_COUNT: 'loop_count',
  IF_CONDITION: 'if_condition',
  SET_VAR: 'set_var',
  BREAK: 'break',
  CONTINUE: 'continue',
};

export function createId(prefix = 'blk') {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}_${crypto.randomUUID().slice(0, 8)}`;
  }
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

export function emptyTarget() {
  return {
    primary: '',
    fallbacks: [],
    tag: '',
    inputType: '',
    label: '',
    text: '',
  };
}

export function createBlock(type, overrides = {}) {
  const base = {
    id: createId('blk'),
    type,
    enabled: true,
    note: '',
  };

  switch (type) {
    case BLOCK_TYPES.TYPE:
      return {
        ...base,
        target: emptyTarget(),
        value: '',
        clearFirst: true,
        pressEnter: false,
        ...overrides,
      };
    case BLOCK_TYPES.CLICK:
      return {
        ...base,
        target: emptyTarget(),
        ...overrides,
      };
    case BLOCK_TYPES.CHECKBOX:
      return {
        ...base,
        target: emptyTarget(),
        mode: 'check', // 'check' | 'uncheck' | 'toggle' | 'variable'
        value: '{{item}}',
        ...overrides,
      };
    case BLOCK_TYPES.SELECT:
      return {
        ...base,
        target: emptyTarget(),
        value: '',
        ...overrides,
      };
    case BLOCK_TYPES.WAIT:
      return {
        ...base,
        mode: 'delay', // 'delay' | 'selector'
        ms: 800,
        target: emptyTarget(),
        timeoutMs: 10000,
        ...overrides,
      };
    case BLOCK_TYPES.LOOP_LIST:
      return {
        ...base,
        listText: '',
        delimiter: ',',
        itemVar: 'item',
        children: [],
        ...overrides,
      };
    case BLOCK_TYPES.LOOP_COUNT:
      return {
        ...base,
        count: 3,
        indexVar: 'indice',
        children: [],
        ...overrides,
      };
    case BLOCK_TYPES.IF_CONDITION:
      return {
        ...base,
        condition: {
          kind: 'exists', // exists | not_exists | text_contains | element_checked | var_equals | var_not_equals | var_contains | var_not_empty
          target: emptyTarget(),
          varName: 'item',
          value: '',
        },
        thenBlocks: [],
        elseBlocks: [],
        showElse: false,
        ...overrides,
      };
    case BLOCK_TYPES.SET_VAR:
      return {
        ...base,
        varName: 'valor',
        value: '',
        ...overrides,
      };
    case BLOCK_TYPES.BREAK:
    case BLOCK_TYPES.CONTINUE:
      return {
        ...base,
        ...overrides,
      };
    default:
      throw new Error(`Tipo de bloco desconhecido: ${type}`);
  }
}

export function createDefaultFlow(name = 'Minha Automação') {
  return {
    id: createId('flow'),
    name,
    settings: {
      stepDelayMs: 300,
      elementTimeoutMs: 6000,
      stopOnError: true,
    },
    blocks: [],
    updatedAt: Date.now(),
  };
}

export function createFilterChecklistTemplate() {
  const flow = createDefaultFlow('Exemplo: Lista + Filtro + Checkbox');
  const loop = createBlock(BLOCK_TYPES.LOOP_LIST, {
    listText: '1001, 1002, 1003',
    delimiter: ',',
    itemVar: 'item',
    children: [
      createBlock(BLOCK_TYPES.TYPE, {
        value: '{{item}}',
        clearFirst: true,
        note: 'Selecione o campo de texto usando 🎯',
      }),
      createBlock(BLOCK_TYPES.CLICK, {
        note: 'Selecione o botão Filtrar usando 🎯',
      }),
      createBlock(BLOCK_TYPES.WAIT, {
        mode: 'delay',
        ms: 500,
      }),
      createBlock(BLOCK_TYPES.CHECKBOX, {
        mode: 'check',
        note: 'Selecione o checkbox usando 🎯',
      }),
    ],
  });
  flow.blocks = [loop];
  return flow;
}

/**
 * Parses a list string using the configured delimiter (default ',').
 * Trims entries and discards empty tokens.
 */
export function parseListInput(rawText, delimiter = ',') {
  if (rawText === null || rawText === undefined) return [];
  const text = String(rawText);
  if (!text.trim()) return [];

  let pattern;
  if (delimiter === '\\n' || delimiter === '\n') {
    pattern = /\r?\n/;
  } else if (delimiter === 'auto') {
    pattern = /[,;\r\n]+/;
  } else {
    pattern = delimiter;
  }

  return text
    .split(pattern)
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

/**
 * Replaces {{varName}} placeholders with values from vars map.
 */
export function interpolate(template, vars = {}) {
  if (template === null || template === undefined) return '';
  const str = String(template);
  return str.replace(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g, (_, key) => {
    const val = vars[key];
    return val === undefined || val === null ? '' : String(val);
  });
}

export function interpolateTarget(target, vars = {}) {
  if (!target) return emptyTarget();
  return {
    ...target,
    primary: interpolate(target.primary || '', vars),
    fallbacks: Array.isArray(target.fallbacks)
      ? target.fallbacks.map((sel) => interpolate(sel, vars))
      : [],
    text: interpolate(target.text || '', vars),
    label: interpolate(target.label || '', vars),
  };
}

/**
 * Evaluates a dynamic checkbox value ("true", "1", "sim", "marcar", etc.).
 */
export function parseBooleanLike(value) {
  const normalized = String(value ?? '').trim().toLowerCase();
  return ['true', '1', 'sim', 'yes', 'on', 'marcar', 'checked', 'x'].includes(normalized);
}

export function getChildLists(block) {
  if (!block) return [];
  if (block.type === BLOCK_TYPES.LOOP_LIST || block.type === BLOCK_TYPES.LOOP_COUNT) {
    return [{ key: 'children', list: block.children || (block.children = []) }];
  }
  if (block.type === BLOCK_TYPES.IF_CONDITION) {
    return [
      { key: 'thenBlocks', list: block.thenBlocks || (block.thenBlocks = []) },
      { key: 'elseBlocks', list: block.elseBlocks || (block.elseBlocks = []) },
    ];
  }
  return [];
}

export function findBlockLocation(blocks, blockId, parent = null, branch = null) {
  for (let i = 0; i < blocks.length; i++) {
    const blk = blocks[i];
    if (blk.id === blockId) {
      return { list: blocks, index: i, block: blk, parent, branch };
    }
    for (const childInfo of getChildLists(blk)) {
      const found = findBlockLocation(childInfo.list, blockId, blk, childInfo.key);
      if (found) return found;
    }
  }
  return null;
}

export function removeBlock(blocks, blockId) {
  const loc = findBlockLocation(blocks, blockId);
  if (!loc) return null;
  const [removed] = loc.list.splice(loc.index, 1);
  return removed;
}

export function moveBlock(blocks, blockId, direction) {
  const loc = findBlockLocation(blocks, blockId);
  if (!loc) return false;
  const newIndex = loc.index + direction;
  if (newIndex < 0 || newIndex >= loc.list.length) return false;
  const [item] = loc.list.splice(loc.index, 1);
  loc.list.splice(newIndex, 0, item);
  return true;
}

export function duplicateBlock(block) {
  const cloned = JSON.parse(JSON.stringify(block));
  const reassignIds = (node) => {
    node.id = createId('blk');
    for (const childInfo of getChildLists(node)) {
      childInfo.list.forEach(reassignIds);
    }
  };
  reassignIds(cloned);
  return cloned;
}

export function isDescendant(parentBlock, candidateChildId) {
  if (!parentBlock || !candidateChildId) return false;
  for (const childInfo of getChildLists(parentBlock)) {
    for (const child of childInfo.list) {
      if (child.id === candidateChildId) return true;
      if (isDescendant(child, candidateChildId)) return true;
    }
  }
  return false;
}

export function moveBlockToPosition(flow, sourceBlockId, targetParentId = null, targetBranch = null, targetIndex = null) {
  if (!flow || !Array.isArray(flow.blocks) || !sourceBlockId) return false;
  const loc = findBlockLocation(flow.blocks, sourceBlockId);
  if (!loc) return false;

  // Cannot drop a block into itself or any of its descendants
  if (targetParentId) {
    if (targetParentId === sourceBlockId) return false;
    if (isDescendant(loc.block, targetParentId)) return false;
  }

  // Determine target list
  let targetList;
  if (!targetParentId) {
    targetList = flow.blocks;
  } else {
    const parentLoc = findBlockLocation(flow.blocks, targetParentId);
    if (!parentLoc) return false;
    const branch = targetBranch || 'children';
    if (!Array.isArray(parentLoc.block[branch])) {
      parentLoc.block[branch] = [];
    }
    targetList = parentLoc.block[branch];
  }

  // Remove block from current location
  const [removed] = loc.list.splice(loc.index, 1);

  // If moving within the same list and targetIndex was beyond the original index,
  // compensate for the removal
  let insertIdx = targetIndex;
  if (loc.list === targetList && typeof targetIndex === 'number' && loc.index < targetIndex) {
    insertIdx = targetIndex - 1;
  }

  if (typeof insertIdx !== 'number' || insertIdx < 0 || insertIdx >= targetList.length) {
    targetList.push(removed);
  } else {
    targetList.splice(insertIdx, 0, removed);
  }

  return true;
}

export function insertBlockIntoFlow(flow, newBlock, containerTarget = null) {
  if (containerTarget && containerTarget.parentId) {
    const loc = findBlockLocation(flow.blocks, containerTarget.parentId);
    if (loc) {
      const branch = containerTarget.branch || 'children';
      if (!Array.isArray(loc.block[branch])) {
        loc.block[branch] = [];
      }
      loc.block[branch].push(newBlock);
      return true;
    }
  }
  flow.blocks.push(newBlock);
  return true;
}

export function wrapRootBlocksInLoopList(flow, listText = '') {
  if (!flow.blocks.length) {
    const loop = createBlock(BLOCK_TYPES.LOOP_LIST, { listText });
    flow.blocks.push(loop);
    return loop;
  }
  const existing = flow.blocks.splice(0, flow.blocks.length);
  const loop = createBlock(BLOCK_TYPES.LOOP_LIST, {
    listText,
    children: existing,
  });
  flow.blocks.push(loop);
  return loop;
}

export function collectAvailableVars(blocks) {
  const vars = new Set();
  const walk = (list) => {
    for (const blk of list) {
      if (blk.type === BLOCK_TYPES.LOOP_LIST) {
        vars.add(blk.itemVar || 'item');
        vars.add('indice');
        vars.add('total');
      } else if (blk.type === BLOCK_TYPES.LOOP_COUNT) {
        vars.add(blk.indexVar || 'indice');
      } else if (blk.type === BLOCK_TYPES.SET_VAR && blk.varName) {
        vars.add(blk.varName);
      }
      for (const childInfo of getChildLists(blk)) {
        walk(childInfo.list);
      }
    }
  };
  walk(blocks || []);
  return Array.from(vars);
}

