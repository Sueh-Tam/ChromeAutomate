import { MSG } from '../shared/messages.js';
import {
  BLOCK_TYPES,
  collectAvailableVars,
  createBlock,
  createDefaultFlow,
  createFilterChecklistTemplate,
  duplicateBlock,
  findBlockLocation,
  insertBlockIntoFlow,
  moveBlock,
  moveBlockToPosition,
  parseListInput,
  removeBlock,
  wrapRootBlocksInLoopList,
} from '../shared/flow-model.js';

const STORAGE_KEY = 'ca_workspace_v1';

let draggedBlockId = null;
let dragAllowed = false;

function clearAllDragIndicators() {
  document.querySelectorAll('.is-dragging').forEach((el) => el.classList.remove('is-dragging'));
  document.querySelectorAll('.drop-target-top').forEach((el) => el.classList.remove('drop-target-top'));
  document.querySelectorAll('.drop-target-bottom').forEach((el) => el.classList.remove('drop-target-bottom'));
  document.querySelectorAll('.drop-target-branch').forEach((el) => el.classList.remove('drop-target-branch'));
  blocksContainer?.classList.remove('drop-target-container');
}

window.addEventListener('mouseup', () => {
  dragAllowed = false;
});

const appState = {
  flows: [],
  activeFlowId: null,
  recording: false,
  execution: {
    status: 'idle',
    currentBlockId: null,
    summary: 'Pronto para gravar ou executar.',
  },
  recordTarget: null, // { parentId, branch, label } | null
  expandedSelectors: new Set(),
  recordingSessions: new Map(), // sessionId -> blockId
};

// DOM refs
const flowSelect = document.getElementById('flowSelect');
const btnNewFlow = document.getElementById('btnNewFlow');
const btnRenameFlow = document.getElementById('btnRenameFlow');
const btnDeleteFlow = document.getElementById('btnDeleteFlow');
const btnToggleSettings = document.getElementById('btnToggleSettings');
const btnExportFlow = document.getElementById('btnExportFlow');
const btnImportFlow = document.getElementById('btnImportFlow');
const fileImportInput = document.getElementById('fileImportInput');

const settingsPanel = document.getElementById('settingsPanel');
const settingStepDelay = document.getElementById('settingStepDelay');
const settingTimeout = document.getElementById('settingTimeout');
const settingStopOnError = document.getElementById('settingStopOnError');

const btnRecord = document.getElementById('btnRecord');
const btnRun = document.getElementById('btnRun');
const btnPause = document.getElementById('btnPause');
const btnStopExec = document.getElementById('btnStopExec');

const recordTargetBanner = document.getElementById('recordTargetBanner');
const recordTargetLabel = document.getElementById('recordTargetLabel');
const btnClearRecordTarget = document.getElementById('btnClearRecordTarget');

const statusBar = document.getElementById('statusBar');
const statusText = document.getElementById('statusText');

const wrapHelperBanner = document.getElementById('wrapHelperBanner');
const btnWrapInLoop = document.getElementById('btnWrapInLoop');
const blocksContainer = document.getElementById('blocksContainer');

function getActiveFlow() {
  return appState.flows.find((f) => f.id === appState.activeFlowId) || appState.flows[0];
}

let saveTimer = null;
function saveFlows(immediate = false) {
  const flow = getActiveFlow();
  if (flow) flow.updatedAt = Date.now();

  const persist = () => {
    chrome.storage.local.set({
      [STORAGE_KEY]: {
        flows: appState.flows,
        activeFlowId: appState.activeFlowId,
      },
    });
  };

  if (immediate) {
    if (saveTimer) clearTimeout(saveTimer);
    persist();
  } else {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(persist, 250);
  }
}

async function loadFlows() {
  const data = await chrome.storage.local.get(STORAGE_KEY);
  const stored = data?.[STORAGE_KEY];
  if (stored && Array.isArray(stored.flows) && stored.flows.length > 0) {
    appState.flows = stored.flows;
    appState.activeFlowId = stored.activeFlowId || stored.flows[0].id;
  } else {
    const initial = createDefaultFlow('Minha Automação');
    appState.flows = [initial];
    appState.activeFlowId = initial.id;
    saveFlows(true);
  }
}

async function sendBg(msg) {
  const res = await chrome.runtime.sendMessage(msg);
  if (res && res.ok === false && res.error) {
    throw new Error(res.error);
  }
  return res;
}

function setLocalError(message) {
  appState.execution = {
    ...appState.execution,
    status: 'error',
    summary: message,
  };
  renderStatusAndControls();
}

// --- Rendering ---

function renderFlowSelect() {
  flowSelect.innerHTML = '';
  for (const flow of appState.flows) {
    const opt = document.createElement('option');
    opt.value = flow.id;
    opt.textContent = flow.name;
    if (flow.id === appState.activeFlowId) opt.selected = true;
    flowSelect.appendChild(opt);
  }

  const active = getActiveFlow();
  if (active) {
    settingStepDelay.value = active.settings?.stepDelayMs ?? 300;
    settingTimeout.value = active.settings?.elementTimeoutMs ?? 6000;
    settingStopOnError.checked = active.settings?.stopOnError !== false;
  }
}

function renderStatusAndControls() {
  const isRec = appState.recording;
  const execStatus = appState.execution.status;
  const isRunning = execStatus === 'running';
  const isPaused = execStatus === 'paused';
  const isBusy = isRunning || isPaused;

  // Record button
  btnRecord.classList.toggle('recording', isRec);
  btnRecord.querySelector('span:last-child').textContent = isRec ? 'Parar Gravação' : 'Gravar';
  btnRecord.disabled = isBusy;

  // Run / Pause / Stop buttons
  btnRun.classList.toggle('hidden', isBusy);
  btnPause.classList.toggle('hidden', !isBusy);
  btnStopExec.classList.toggle('hidden', !isBusy);
  btnPause.querySelector('span').textContent = isPaused ? '▶ Retomar' : '⏸ Pausar';
  btnRun.disabled = isRec;

  // Record target banner
  if (appState.recordTarget) {
    recordTargetBanner.classList.remove('hidden');
    recordTargetLabel.textContent = appState.recordTarget.label;
  } else {
    recordTargetBanner.classList.add('hidden');
  }

  // Status bar
  statusBar.className = 'status-bar';
  if (isRec) {
    statusBar.classList.add('status-recording');
    statusText.textContent = '🔴 Gravando interações na página ativa...';
  } else {
    statusBar.classList.add(`status-${execStatus || 'idle'}`);
    statusText.textContent = appState.execution.summary || 'Pronto para gravar ou executar.';
  }

  // Highlight executing block without re-rendering whole tree
  document.querySelectorAll('.block-card.executing').forEach((el) => el.classList.remove('executing'));
  if (appState.execution.currentBlockId) {
    const activeCard = document.querySelector(
      `.block-card[data-block-id="${CSS.escape(appState.execution.currentBlockId)}"]`
    );
    if (activeCard) {
      activeCard.classList.add('executing');
      activeCard.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }

  // Update live loop current item badges & banners
  const activeLoops = appState.execution?.activeLoops || {};
  document.querySelectorAll('[data-loop-banner]').forEach((banner) => {
    const loopId = banner.getAttribute('data-loop-banner');
    const loopInfo = activeLoops[loopId];
    if (loopInfo) {
      banner.classList.remove('hidden');
      const valEl = banner.querySelector('.loop-live-val');
      const counterEl = banner.querySelector('.loop-live-counter');
      if (valEl) valEl.textContent = loopInfo.type === 'count' ? `Ciclo ${loopInfo.item}` : `"${loopInfo.item}"`;
      if (counterEl) counterEl.textContent = `(${loopInfo.index} de ${loopInfo.total})`;
    } else {
      banner.classList.add('hidden');
    }
  });

  document.querySelectorAll('[data-loop-pill]').forEach((pill) => {
    const loopId = pill.getAttribute('data-loop-pill');
    const loopInfo = activeLoops[loopId];
    if (loopInfo) {
      pill.classList.remove('hidden');
      pill.textContent = loopInfo.type === 'count'
        ? `▶ Ciclo ${loopInfo.item} (${loopInfo.index}/${loopInfo.total})`
        : `▶ ${loopInfo.item} (${loopInfo.index}/${loopInfo.total})`;
    } else {
      pill.classList.add('hidden');
    }
  });
}

function getBlockMeta(type) {
  switch (type) {
    case BLOCK_TYPES.LOOP_LIST:
      return { icon: '🔁', title: 'Repetir Lista' };
    case BLOCK_TYPES.LOOP_COUNT:
      return { icon: '🔄', title: 'Repetir N×' };
    case BLOCK_TYPES.IF_CONDITION:
      return { icon: '❓', title: 'Se (Condição)' };
    case BLOCK_TYPES.TYPE:
      return { icon: '✏️', title: 'Digitar' };
    case BLOCK_TYPES.CLICK:
      return { icon: '🖱️', title: 'Clicar' };
    case BLOCK_TYPES.CHECKBOX:
      return { icon: '☑️', title: 'Checklist' };
    case BLOCK_TYPES.SELECT:
      return { icon: '📋', title: 'Selecionar' };
    case BLOCK_TYPES.WAIT:
      return { icon: '⏱', title: 'Aguardar' };
    case BLOCK_TYPES.SET_VAR:
      return { icon: '🏷️', title: 'Variável' };
    case BLOCK_TYPES.BREAK:
      return { icon: '🛑', title: 'Parar Repetição' };
    case BLOCK_TYPES.CONTINUE:
      return { icon: '⏭', title: 'Próximo Item' };
    default:
      return { icon: '🧩', title: type };
  }
}

function formatTargetSummary(target) {
  if (!target) return 'Nenhum elemento';
  return target.label || target.text || target.primary || 'Nenhum elemento';
}

function createVarChips(availableVars, currentValue, onSet, onAppend) {
  const wrap = document.createElement('div');
  wrap.className = 'var-chips';

  // Ensure 'item' is always suggested if any loop exists or user might wrap it
  const vars = availableVars.length > 0 ? availableVars : ['item'];
  const firstVar = vars[0];
  const hasTemplate = String(currentValue || '').includes('{{');

  if (!hasTemplate && firstVar) {
    const replaceBtn = document.createElement('button');
    replaceBtn.type = 'button';
    replaceBtn.className = 'var-chip replace-chip';
    replaceBtn.textContent = `Usar {{${firstVar}}}`;
    replaceBtn.title = `Substituir valor por {{${firstVar}}}`;
    replaceBtn.addEventListener('click', () => onSet(`{{${firstVar}}}`));
    wrap.appendChild(replaceBtn);
  }

  for (const v of vars) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'var-chip';
    btn.textContent = `+ {{${v}}}`;
    btn.title = `Inserir variável {{${v}}}`;
    btn.addEventListener('click', () => onAppend(`{{${v}}}`));
    wrap.appendChild(btn);
  }

  return wrap;
}

function createTargetPickerRow(targetObj, requestId, onTargetEdited) {
  const row = document.createElement('div');
  row.className = 'target-row';

  const pill = document.createElement('div');
  const hasTarget = Boolean(targetObj?.primary || targetObj?.text || targetObj?.label);
  pill.className = `target-pill${hasTarget ? '' : ' missing'}`;
  pill.textContent = hasTarget ? formatTargetSummary(targetObj) : 'Elemento não definido (use 🎯)';
  pill.title = targetObj?.primary || '';

  const pickBtn = document.createElement('button');
  pickBtn.type = 'button';
  pickBtn.className = 'mini-btn';
  pickBtn.textContent = '🎯';
  pickBtn.title = 'Selecionar elemento na página';
  pickBtn.addEventListener('click', async () => {
    try {
      await sendBg({ type: MSG.PICK_ELEMENT, requestId });
    } catch (err) {
      setLocalError(err.message);
    }
  });

  const testBtn = document.createElement('button');
  testBtn.type = 'button';
  testBtn.className = 'mini-btn';
  testBtn.textContent = '👁';
  testBtn.title = 'Destacar elemento na página';
  testBtn.addEventListener('click', async () => {
    try {
      const res = await sendBg({ type: MSG.HIGHLIGHT_TARGET, target: targetObj });
      if (!res?.found) {
        setLocalError('Elemento não encontrado na página atual.');
      }
    } catch (err) {
      setLocalError(err.message);
    }
  });

  row.append(pill, pickBtn, testBtn);

  // Collapsible advanced selector
  const wrapper = document.createElement('div');
  wrapper.className = 'field-group';
  wrapper.appendChild(row);

  const toggleBtn = document.createElement('button');
  toggleBtn.type = 'button';
  toggleBtn.className = 'selector-toggle';
  const isOpen = appState.expandedSelectors.has(requestId);
  toggleBtn.textContent = isOpen ? 'Seletor avançado ▴' : 'Seletor avançado ▾';

  const details = document.createElement('div');
  details.className = `selector-details${isOpen ? '' : ' hidden'}`;

  const selInput = document.createElement('input');
  selInput.className = 'input';
  selInput.placeholder = 'Seletor CSS (ex: #filtro ou input[name="codigo"])';
  selInput.value = targetObj?.primary || '';
  selInput.addEventListener('input', () => {
    targetObj.primary = selInput.value;
    pill.textContent = formatTargetSummary(targetObj);
    pill.classList.toggle('missing', !(targetObj.primary || targetObj.text || targetObj.label));
    saveFlows();
    onTargetEdited?.();
  });

  const txtInput = document.createElement('input');
  txtInput.className = 'input';
  txtInput.placeholder = 'Texto fallback (opcional, aceita {{item}})';
  txtInput.value = targetObj?.text || '';
  txtInput.addEventListener('input', () => {
    targetObj.text = txtInput.value;
    saveFlows();
  });

  details.append(selInput, txtInput);

  toggleBtn.addEventListener('click', () => {
    const nowOpen = !appState.expandedSelectors.has(requestId);
    if (nowOpen) appState.expandedSelectors.add(requestId);
    else appState.expandedSelectors.delete(requestId);
    details.classList.toggle('hidden', !nowOpen);
    toggleBtn.textContent = nowOpen ? 'Seletor avançado ▴' : 'Seletor avançado ▾';
  });

  wrapper.append(toggleBtn, details);
  return wrapper;
}

function renderBranch(flow, parentBlock, branchKey, branchLabel, blocks) {
  const section = document.createElement('div');
  section.className = 'branch-section';

  section.addEventListener('dragover', (e) => {
    if (!draggedBlockId) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'move';
    section.classList.add('drop-target-branch');
  });

  section.addEventListener('dragleave', (e) => {
    if (!section.contains(e.relatedTarget)) {
      section.classList.remove('drop-target-branch');
    }
  });

  section.addEventListener('drop', (e) => {
    if (!draggedBlockId) return;
    e.preventDefault();
    e.stopPropagation();
    const sourceId = draggedBlockId;
    clearAllDragIndicators();

    const targetIndex = blocks ? blocks.length : 0;
    const moved = moveBlockToPosition(flow, sourceId, parentBlock.id, branchKey, targetIndex);
    if (moved) {
      saveFlows(true);
      renderBlocks();
    }
  });

  const header = document.createElement('div');
  header.className = 'branch-header';

  const title = document.createElement('span');
  title.textContent = branchLabel;

  const actions = document.createElement('div');
  actions.className = 'branch-actions';

  const isTargetingHere =
    appState.recordTarget?.parentId === parentBlock.id && appState.recordTarget?.branch === branchKey;

  const recHereBtn = document.createElement('button');
  recHereBtn.type = 'button';
  recHereBtn.className = `mini-btn${isTargetingHere ? ' active-rec' : ''}`;
  recHereBtn.textContent = isTargetingHere ? '🔴 Gravando aqui' : '🔴 Gravar aqui';
  recHereBtn.title = 'Definir este bloco como destino dos próximos passos gravados ou adicionados';
  recHereBtn.addEventListener('click', () => {
    if (isTargetingHere) {
      appState.recordTarget = null;
    } else {
      const meta = getBlockMeta(parentBlock.type);
      appState.recordTarget = {
        parentId: parentBlock.id,
        branch: branchKey,
        label: `${meta.title} (${branchLabel})`,
      };
    }
    renderAll();
  });

  actions.appendChild(recHereBtn);
  header.append(title, actions);
  section.appendChild(header);

  if (!blocks || blocks.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'branch-empty';
    empty.textContent = 'Nenhum passo aqui. Clique em "🔴 Gravar aqui" e depois em Gravar.';
    section.appendChild(empty);
  } else {
    for (const child of blocks) {
      section.appendChild(renderBlockCard(flow, child));
    }
  }

  return section;
}

function renderBlockCard(flow, block) {
  const availableVars = collectAvailableVars(flow.blocks);
  const meta = getBlockMeta(block.type);

  const card = document.createElement('div');
  card.className = `block-card block-type-${block.type}${block.enabled === false ? ' disabled-block' : ''}`;
  card.dataset.blockId = block.id;
  card.draggable = true;

  if (appState.execution.currentBlockId === block.id) {
    card.classList.add('executing');
  }

  // Drag & drop handlers on block card
  card.addEventListener('dragstart', (e) => {
    if (!dragAllowed) {
      e.preventDefault();
      return;
    }
    draggedBlockId = block.id;
    card.classList.add('is-dragging');
    e.dataTransfer.setData('text/plain', block.id);
    e.dataTransfer.effectAllowed = 'move';
  });

  card.addEventListener('dragend', () => {
    dragAllowed = false;
    draggedBlockId = null;
    clearAllDragIndicators();
  });

  card.addEventListener('dragover', (e) => {
    if (!draggedBlockId || draggedBlockId === block.id) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'move';

    const rect = card.getBoundingClientRect();
    const isTop = e.clientY - rect.top < rect.height / 2;
    card.classList.toggle('drop-target-top', isTop);
    card.classList.toggle('drop-target-bottom', !isTop);
  });

  card.addEventListener('dragleave', (e) => {
    if (!card.contains(e.relatedTarget)) {
      card.classList.remove('drop-target-top', 'drop-target-bottom');
    }
  });

  card.addEventListener('drop', (e) => {
    if (!draggedBlockId || draggedBlockId === block.id) return;
    e.preventDefault();
    e.stopPropagation();

    const rect = card.getBoundingClientRect();
    const isTop = e.clientY - rect.top < rect.height / 2;
    const sourceId = draggedBlockId;
    clearAllDragIndicators();

    const locTarget = findBlockLocation(flow.blocks, block.id);
    if (!locTarget) return;

    const targetIndex = isTop ? locTarget.index : locTarget.index + 1;
    const targetParentId = locTarget.parent ? locTarget.parent.id : null;
    const targetBranch = locTarget.branch || null;

    const moved = moveBlockToPosition(flow, sourceId, targetParentId, targetBranch, targetIndex);
    if (moved) {
      saveFlows(true);
      renderBlocks();
    }
  });

  // Header
  const header = document.createElement('div');
  header.className = 'block-header';
  header.addEventListener('mousedown', (e) => {
    if (!e.target.closest('button, input, select, textarea, a, .var-chip, .mini-btn')) {
      dragAllowed = true;
    }
  });

  const titleWrap = document.createElement('div');
  titleWrap.className = 'block-title-wrap';

  const dragHandle = document.createElement('span');
  dragHandle.className = 'drag-handle';
  dragHandle.textContent = '⋮⋮';
  dragHandle.title = 'Arraste para mover o bloco';
  dragHandle.addEventListener('mousedown', () => {
    dragAllowed = true;
  });

  const badge = document.createElement('span');
  badge.className = 'block-badge';
  badge.textContent = `${meta.icon} ${meta.title}`;

  const summary = document.createElement('span');
  summary.className = 'block-target-summary';
  if (block.type === BLOCK_TYPES.LOOP_LIST) {
    const cnt = parseListInput(block.listText, block.delimiter).length;
    summary.textContent = `${cnt} ${cnt === 1 ? 'item' : 'itens'}`;
  } else if (block.type === BLOCK_TYPES.TYPE) {
    summary.textContent = block.value ? `"${block.value}"` : '';
  } else if (block.target) {
    summary.textContent = formatTargetSummary(block.target);
  }

  titleWrap.append(dragHandle, badge, summary);

  if (block.type === BLOCK_TYPES.LOOP_LIST || block.type === BLOCK_TYPES.LOOP_COUNT) {
    const livePill = document.createElement('span');
    livePill.className = 'loop-live-pill hidden';
    livePill.setAttribute('data-loop-pill', block.id);
    titleWrap.appendChild(livePill);
  }

  const actions = document.createElement('div');
  actions.className = 'block-actions';

  const makeActBtn = (icon, title, onClick) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'mini-btn';
    b.textContent = icon;
    b.title = title;
    b.addEventListener('click', onClick);
    return b;
  };

  actions.append(
    makeActBtn(block.enabled === false ? '🚫' : '✅', block.enabled === false ? 'Ativar bloco' : 'Desativar bloco', () => {
      block.enabled = block.enabled === false;
      saveFlows(true);
      renderBlocks();
    }),
    makeActBtn('↑', 'Mover para cima', () => {
      if (moveBlock(flow.blocks, block.id, -1)) {
        saveFlows(true);
        renderBlocks();
      }
    }),
    makeActBtn('↓', 'Mover para baixo', () => {
      if (moveBlock(flow.blocks, block.id, 1)) {
        saveFlows(true);
        renderBlocks();
      }
    }),
    makeActBtn('📋', 'Duplicar', () => {
      const loc = findBlockLocation(flow.blocks, block.id);
      if (loc) {
        loc.list.splice(loc.index + 1, 0, duplicateBlock(block));
        saveFlows(true);
        renderBlocks();
      }
    }),
    makeActBtn('🗑', 'Excluir', () => {
      removeBlock(flow.blocks, block.id);
      if (appState.recordTarget?.parentId === block.id) {
        appState.recordTarget = null;
      }
      saveFlows(true);
      renderAll();
    })
  );

  header.append(titleWrap, actions);
  card.appendChild(header);

  // Body
  const body = document.createElement('div');
  body.className = 'block-body';

  switch (block.type) {
    case BLOCK_TYPES.LOOP_LIST: {
      const grp = document.createElement('div');
      grp.className = 'field-group';

      const liveBanner = document.createElement('div');
      liveBanner.className = 'loop-live-banner hidden';
      liveBanner.setAttribute('data-loop-banner', block.id);
      liveBanner.innerHTML = `
        <span class="loop-live-pulse"></span>
        <span class="loop-live-label">Item atual:</span>
        <span class="loop-live-val"></span>
        <span class="loop-live-counter"></span>
      `;

      const lbl = document.createElement('div');
      lbl.className = 'field-label';
      const lblText = document.createElement('span');
      lblText.textContent = 'Lista de valores (separados por vírgula):';
      const countPill = document.createElement('span');
      countPill.className = 'count-pill';
      const updateCount = () => {
        const items = parseListInput(block.listText, block.delimiter);
        countPill.textContent = `${items.length} ${items.length === 1 ? 'item' : 'itens'}`;
        summary.textContent = countPill.textContent;
      };
      updateCount();
      lbl.append(lblText, countPill);

      const ta = document.createElement('textarea');
      ta.className = 'textarea';
      ta.placeholder = 'Ex: 1001, 1002, 1003, 1004';
      ta.value = block.listText || '';
      ta.addEventListener('input', () => {
        block.listText = ta.value;
        updateCount();
        saveFlows();
      });

      const row2 = document.createElement('div');
      row2.className = 'row-2';

      const sepGrp = document.createElement('div');
      sepGrp.className = 'field-group';
      const sepLbl = document.createElement('span');
      sepLbl.className = 'field-label';
      sepLbl.textContent = 'Separador';
      const sepSel = document.createElement('select');
      sepSel.className = 'select';
      [
        [',', 'Vírgula (,)'],
        [';', 'Ponto e vírgula (;)'],
        ['\\n', 'Quebra de linha'],
        ['auto', 'Automático (, ; linha)'],
      ].forEach(([val, text]) => {
        const o = document.createElement('option');
        o.value = val;
        o.textContent = text;
        if ((block.delimiter ?? ',') === val) o.selected = true;
        sepSel.appendChild(o);
      });
      sepSel.addEventListener('change', () => {
        block.delimiter = sepSel.value;
        updateCount();
        saveFlows(true);
      });
      sepGrp.append(sepLbl, sepSel);

      const varGrp = document.createElement('div');
      varGrp.className = 'field-group';
      const varLbl = document.createElement('span');
      varLbl.className = 'field-label';
      varLbl.textContent = 'Nome da variável';
      const varInp = document.createElement('input');
      varInp.className = 'input';
      varInp.value = block.itemVar || 'item';
      varInp.addEventListener('input', () => {
        block.itemVar = varInp.value.trim() || 'item';
        saveFlows();
      });
      varGrp.append(varLbl, varInp);

      row2.append(sepGrp, varGrp);
      grp.append(liveBanner, lbl, ta, row2);
      body.appendChild(grp);

      body.appendChild(
        renderBranch(flow, block, 'children', `Passos para cada {{${block.itemVar || 'item'}}}:`, block.children)
      );
      break;
    }

    case BLOCK_TYPES.LOOP_COUNT: {
      const liveBanner = document.createElement('div');
      liveBanner.className = 'loop-live-banner hidden';
      liveBanner.setAttribute('data-loop-banner', block.id);
      liveBanner.innerHTML = `
        <span class="loop-live-pulse"></span>
        <span class="loop-live-label">Ciclo atual:</span>
        <span class="loop-live-val"></span>
        <span class="loop-live-counter"></span>
      `;
      body.appendChild(liveBanner);

      const row2 = document.createElement('div');
      row2.className = 'row-2';

      const cntGrp = document.createElement('div');
      cntGrp.className = 'field-group';
      const cntLbl = document.createElement('span');
      cntLbl.className = 'field-label';
      cntLbl.textContent = 'Quantidade';
      const cntInp = document.createElement('input');
      cntInp.type = 'number';
      cntInp.min = '1';
      cntInp.className = 'input';
      cntInp.value = block.count ?? 3;
      cntInp.addEventListener('input', () => {
        block.count = Number(cntInp.value) || 1;
        saveFlows();
      });
      cntGrp.append(cntLbl, cntInp);

      const varGrp = document.createElement('div');
      varGrp.className = 'field-group';
      const varLbl = document.createElement('span');
      varLbl.className = 'field-label';
      varLbl.textContent = 'Variável índice';
      const varInp = document.createElement('input');
      varInp.className = 'input';
      varInp.value = block.indexVar || 'indice';
      varInp.addEventListener('input', () => {
        block.indexVar = varInp.value.trim() || 'indice';
        saveFlows();
      });
      varGrp.append(varLbl, varInp);

      row2.append(cntGrp, varGrp);
      body.appendChild(row2);
      body.appendChild(renderBranch(flow, block, 'children', 'Passos repetidos:', block.children));
      break;
    }

    case BLOCK_TYPES.IF_CONDITION: {
      const cond = (block.condition = block.condition || { kind: 'exists', target: {}, varName: 'item', value: '' });

      const condSel = document.createElement('select');
      condSel.className = 'select';
      [
        ['exists', 'Elemento existe na tela'],
        ['not_exists', 'Elemento NÃO existe na tela'],
        ['text_contains', 'Texto na tela/elemento contém'],
        ['element_checked', 'Checkbox está marcado'],
        ['var_equals', 'Variável é igual a'],
        ['var_not_equals', 'Variável é diferente de'],
        ['var_contains', 'Variável contém'],
        ['var_not_empty', 'Variável não está vazia'],
      ].forEach(([val, text]) => {
        const o = document.createElement('option');
        o.value = val;
        o.textContent = text;
        if (cond.kind === val) o.selected = true;
        condSel.appendChild(o);
      });
      condSel.addEventListener('change', () => {
        cond.kind = condSel.value;
        saveFlows(true);
        renderBlocks();
      });
      body.appendChild(condSel);

      const isVarCond = cond.kind.startsWith('var_');
      if (isVarCond) {
        const row2 = document.createElement('div');
        row2.className = 'row-2';

        const varInp = document.createElement('input');
        varInp.className = 'input';
        varInp.placeholder = 'Nome variável (ex: item)';
        varInp.value = cond.varName || '';
        varInp.addEventListener('input', () => {
          cond.varName = varInp.value;
          saveFlows();
        });
        row2.appendChild(varInp);

        if (cond.kind !== 'var_not_empty') {
          const valInp = document.createElement('input');
          valInp.className = 'input';
          valInp.placeholder = 'Valor esperado';
          valInp.value = cond.value || '';
          valInp.addEventListener('input', () => {
            cond.value = valInp.value;
            saveFlows();
          });
          row2.appendChild(valInp);
        }
        body.appendChild(row2);
      } else {
        cond.target = cond.target || { primary: '', fallbacks: [] };
        body.appendChild(createTargetPickerRow(cond.target, `${block.id}::cond`));

        if (cond.kind === 'text_contains') {
          const valInp = document.createElement('input');
          valInp.className = 'input';
          valInp.placeholder = 'Texto esperado (aceita {{item}})';
          valInp.value = cond.value || '';
          valInp.addEventListener('input', () => {
            cond.value = valInp.value;
            saveFlows();
          });
          body.appendChild(valInp);
        }
      }

      body.appendChild(renderBranch(flow, block, 'thenBlocks', 'Então execute:', block.thenBlocks));

      if (block.showElse || (block.elseBlocks && block.elseBlocks.length > 0)) {
        body.appendChild(renderBranch(flow, block, 'elseBlocks', 'Senão execute:', block.elseBlocks));
      } else {
        const addElseBtn = document.createElement('button');
        addElseBtn.type = 'button';
        addElseBtn.className = 'btn-link';
        addElseBtn.style.alignSelf = 'flex-start';
        addElseBtn.textContent = '+ Adicionar bloco "Senão"';
        addElseBtn.addEventListener('click', () => {
          block.showElse = true;
          saveFlows(true);
          renderBlocks();
        });
        body.appendChild(addElseBtn);
      }
      break;
    }

    case BLOCK_TYPES.TYPE: {
      block.target = block.target || {};
      body.appendChild(createTargetPickerRow(block.target, block.id));

      const valGrp = document.createElement('div');
      valGrp.className = 'field-group';
      const valLbl = document.createElement('span');
      valLbl.className = 'field-label';
      valLbl.textContent = 'Valor para digitar (ou variável):';

      const valInp = document.createElement('input');
      valInp.className = 'input';
      valInp.placeholder = 'Digite um texto ou {{item}}';
      valInp.value = block.value ?? '';
      valInp.addEventListener('input', () => {
        block.value = valInp.value;
        summary.textContent = block.value ? `"${block.value}"` : '';
        saveFlows();
      });

      const chips = createVarChips(
        availableVars,
        block.value,
        (newVal) => {
          block.value = newVal;
          valInp.value = newVal;
          summary.textContent = `"${newVal}"`;
          saveFlows(true);
          renderBlocks();
        },
        (token) => {
          block.value = `${valInp.value}${token}`;
          valInp.value = block.value;
          summary.textContent = `"${block.value}"`;
          saveFlows(true);
        }
      );

      valGrp.append(valLbl, valInp, chips);
      body.appendChild(valGrp);

      const opts = document.createElement('div');
      opts.className = 'inline-options';

      const clearLbl = document.createElement('label');
      const clearCb = document.createElement('input');
      clearCb.type = 'checkbox';
      clearCb.checked = block.clearFirst !== false;
      clearCb.addEventListener('change', () => {
        block.clearFirst = clearCb.checked;
        saveFlows(true);
      });
      clearLbl.append(clearCb, 'Limpar campo antes');

      const enterLbl = document.createElement('label');
      const enterCb = document.createElement('input');
      enterCb.type = 'checkbox';
      enterCb.checked = Boolean(block.pressEnter);
      enterCb.addEventListener('change', () => {
        block.pressEnter = enterCb.checked;
        saveFlows(true);
      });
      enterLbl.append(enterCb, 'Pressionar Enter');

      opts.append(clearLbl, enterLbl);
      body.appendChild(opts);
      break;
    }

    case BLOCK_TYPES.CLICK: {
      block.target = block.target || {};
      body.appendChild(createTargetPickerRow(block.target, block.id));
      break;
    }

    case BLOCK_TYPES.CHECKBOX: {
      block.target = block.target || {};
      body.appendChild(createTargetPickerRow(block.target, block.id));

      const modeSel = document.createElement('select');
      modeSel.className = 'select';
      [
        ['check', 'Marcar (garantir marcado)'],
        ['uncheck', 'Desmarcar'],
        ['toggle', 'Alternar (clicar)'],
        ['variable', 'Usar variável (true/1/sim = marcar)'],
      ].forEach(([val, text]) => {
        const o = document.createElement('option');
        o.value = val;
        o.textContent = text;
        if ((block.mode || 'check') === val) o.selected = true;
        modeSel.appendChild(o);
      });
      modeSel.addEventListener('change', () => {
        block.mode = modeSel.value;
        saveFlows(true);
        renderBlocks();
      });
      body.appendChild(modeSel);

      if (block.mode === 'variable') {
        const valInp = document.createElement('input');
        valInp.className = 'input';
        valInp.placeholder = 'Ex: {{marcar}} ou {{item}}';
        valInp.value = block.value ?? '{{item}}';
        valInp.addEventListener('input', () => {
          block.value = valInp.value;
          saveFlows();
        });
        body.appendChild(valInp);
        body.appendChild(
          createVarChips(
            availableVars,
            block.value,
            (v) => {
              block.value = v;
              valInp.value = v;
              saveFlows(true);
            },
            (t) => {
              block.value = `${valInp.value}${t}`;
              valInp.value = block.value;
              saveFlows(true);
            }
          )
        );
      }
      break;
    }

    case BLOCK_TYPES.SELECT: {
      block.target = block.target || {};
      body.appendChild(createTargetPickerRow(block.target, block.id));

      const valInp = document.createElement('input');
      valInp.className = 'input';
      valInp.placeholder = 'Valor ou texto da opção (aceita {{item}})';
      valInp.value = block.value ?? '';
      valInp.addEventListener('input', () => {
        block.value = valInp.value;
        saveFlows();
      });
      body.appendChild(valInp);
      body.appendChild(
        createVarChips(
          availableVars,
          block.value,
          (v) => {
            block.value = v;
            valInp.value = v;
            saveFlows(true);
          },
          (t) => {
            block.value = `${valInp.value}${t}`;
            valInp.value = block.value;
            saveFlows(true);
          }
        )
      );
      break;
    }

    case BLOCK_TYPES.WAIT: {
      const modeSel = document.createElement('select');
      modeSel.className = 'select';
      [
        ['delay', 'Tempo fixo (milissegundos)'],
        ['selector', 'Aguardar elemento aparecer na tela'],
      ].forEach(([val, text]) => {
        const o = document.createElement('option');
        o.value = val;
        o.textContent = text;
        if ((block.mode || 'delay') === val) o.selected = true;
        modeSel.appendChild(o);
      });
      modeSel.addEventListener('change', () => {
        block.mode = modeSel.value;
        saveFlows(true);
        renderBlocks();
      });
      body.appendChild(modeSel);

      if (block.mode === 'selector') {
        block.target = block.target || {};
        body.appendChild(createTargetPickerRow(block.target, block.id));
        const toInp = document.createElement('input');
        toInp.type = 'number';
        toInp.className = 'input';
        toInp.placeholder = 'Timeout máximo (ms)';
        toInp.value = block.timeoutMs ?? 10000;
        toInp.addEventListener('input', () => {
          block.timeoutMs = Number(toInp.value) || 10000;
          saveFlows();
        });
        body.appendChild(toInp);
      } else {
        const msInp = document.createElement('input');
        msInp.type = 'number';
        msInp.min = '0';
        msInp.step = '100';
        msInp.className = 'input';
        msInp.value = block.ms ?? 800;
        msInp.addEventListener('input', () => {
          block.ms = Number(msInp.value) || 0;
          saveFlows();
        });
        body.appendChild(msInp);
      }
      break;
    }

    case BLOCK_TYPES.SET_VAR: {
      const row2 = document.createElement('div');
      row2.className = 'row-2';

      const nameInp = document.createElement('input');
      nameInp.className = 'input';
      nameInp.placeholder = 'Nome (ex: codigo)';
      nameInp.value = block.varName || '';
      nameInp.addEventListener('input', () => {
        block.varName = nameInp.value.trim();
        saveFlows();
      });

      const valInp = document.createElement('input');
      valInp.className = 'input';
      valInp.placeholder = 'Valor (aceita {{item}})';
      valInp.value = block.value ?? '';
      valInp.addEventListener('input', () => {
        block.value = valInp.value;
        saveFlows();
      });

      row2.append(nameInp, valInp);
      body.appendChild(row2);
      break;
    }

    default:
      break;
  }

  if (body.children.length > 0) {
    card.appendChild(body);
  }
  return card;
}

function renderBlocks() {
  const flow = getActiveFlow();
  blocksContainer.innerHTML = '';

  const hasRootLoopList = flow.blocks.some((b) => b.type === BLOCK_TYPES.LOOP_LIST);
  wrapHelperBanner.classList.toggle('hidden', flow.blocks.length === 0 || hasRootLoopList);

  if (flow.blocks.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.innerHTML = `
      <h3>Nenhuma ação gravada ainda</h3>
      <p>Clique em <strong>Gravar</strong> para capturar cliques, digitação e checkboxes na página, ou comece com um modelo pronto:</p>
    `;
    const tmplBtn = document.createElement('button');
    tmplBtn.type = 'button';
    tmplBtn.className = 'btn-sm btn-primary';
    tmplBtn.textContent = '📋 Carregar Modelo: Lista + Filtro + Checkbox';
    tmplBtn.addEventListener('click', () => {
      const sample = createFilterChecklistTemplate();
      flow.blocks = sample.blocks;
      saveFlows(true);
      renderAll();
    });
    empty.appendChild(tmplBtn);
    blocksContainer.appendChild(empty);
    return;
  }

  for (const block of flow.blocks) {
    blocksContainer.appendChild(renderBlockCard(flow, block));
  }
}

function renderAll() {
  renderFlowSelect();
  renderBlocks();
  renderStatusAndControls();
}

// --- Event Listeners ---

btnToggleSettings.addEventListener('click', () => {
  settingsPanel.classList.toggle('hidden');
});

settingStepDelay.addEventListener('input', () => {
  const flow = getActiveFlow();
  flow.settings = flow.settings || {};
  flow.settings.stepDelayMs = Math.max(0, Number(settingStepDelay.value) || 0);
  saveFlows();
});

settingTimeout.addEventListener('input', () => {
  const flow = getActiveFlow();
  flow.settings = flow.settings || {};
  flow.settings.elementTimeoutMs = Math.max(500, Number(settingTimeout.value) || 6000);
  saveFlows();
});

settingStopOnError.addEventListener('change', () => {
  const flow = getActiveFlow();
  flow.settings = flow.settings || {};
  flow.settings.stopOnError = settingStopOnError.checked;
  saveFlows(true);
});

flowSelect.addEventListener('change', () => {
  appState.activeFlowId = flowSelect.value;
  appState.recordTarget = null;
  saveFlows(true);
  renderAll();
});

btnNewFlow.addEventListener('click', () => {
  const name = prompt('Nome da nova automação:', `Automação ${appState.flows.length + 1}`);
  if (!name) return;
  const f = createDefaultFlow(name.trim());
  appState.flows.push(f);
  appState.activeFlowId = f.id;
  appState.recordTarget = null;
  saveFlows(true);
  renderAll();
});

btnRenameFlow.addEventListener('click', () => {
  const flow = getActiveFlow();
  const next = prompt('Novo nome da automação:', flow.name);
  if (!next || !next.trim()) return;
  flow.name = next.trim();
  saveFlows(true);
  renderFlowSelect();
});

btnDeleteFlow.addEventListener('click', () => {
  if (appState.flows.length <= 1) {
    const flow = getActiveFlow();
    if (!confirm('Limpar todos os blocos desta automação?')) return;
    flow.blocks = [];
    appState.recordTarget = null;
    saveFlows(true);
    renderAll();
    return;
  }
  const flow = getActiveFlow();
  if (!confirm(`Excluir "${flow.name}"?`)) return;
  appState.flows = appState.flows.filter((f) => f.id !== flow.id);
  appState.activeFlowId = appState.flows[0].id;
  appState.recordTarget = null;
  saveFlows(true);
  renderAll();
});

btnExportFlow.addEventListener('click', () => {
  const flow = getActiveFlow();
  const blob = new Blob([JSON.stringify(flow, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${flow.name.replace(/[^a-z0-9_-]/gi, '_').toLowerCase()}.json`;
  a.click();
  URL.revokeObjectURL(url);
});

btnImportFlow.addEventListener('click', () => {
  fileImportInput.click();
});

fileImportInput.addEventListener('change', async () => {
  const file = fileImportInput.files?.[0];
  fileImportInput.value = '';
  if (!file) return;
  try {
    const parsed = JSON.parse(await file.text());
    if (!parsed || !Array.isArray(parsed.blocks)) {
      throw new Error('Arquivo JSON inválido.');
    }
    const imported = {
      ...createDefaultFlow(parsed.name || 'Automação Importada'),
      ...parsed,
      id: `flow_${Date.now().toString(36)}`,
    };
    appState.flows.push(imported);
    appState.activeFlowId = imported.id;
    appState.recordTarget = null;
    saveFlows(true);
    renderAll();
  } catch (err) {
    setLocalError(`Erro ao importar: ${err.message}`);
  }
});

btnRecord.addEventListener('click', async () => {
  try {
    if (appState.recording) {
      await sendBg({ type: MSG.STOP_RECORDING });
      appState.recording = false;
      appState.recordingSessions.clear();
    } else {
      appState.recordingSessions.clear();
      await sendBg({ type: MSG.START_RECORDING });
      appState.recording = true;
    }
    renderStatusAndControls();
  } catch (err) {
    setLocalError(err.message);
  }
});

btnRun.addEventListener('click', async () => {
  try {
    const flow = getActiveFlow();
    await sendBg({ type: MSG.START_EXECUTION, flow });
  } catch (err) {
    setLocalError(err.message);
  }
});

btnPause.addEventListener('click', async () => {
  try {
    if (appState.execution.status === 'paused') {
      await sendBg({ type: MSG.RESUME_EXECUTION });
    } else {
      await sendBg({ type: MSG.PAUSE_EXECUTION });
    }
  } catch (err) {
    setLocalError(err.message);
  }
});

btnStopExec.addEventListener('click', async () => {
  try {
    await sendBg({ type: MSG.STOP_EXECUTION });
  } catch (err) {
    setLocalError(err.message);
  }
});

btnClearRecordTarget.addEventListener('click', () => {
  appState.recordTarget = null;
  renderStatusAndControls();
  renderBlocks();
});

btnWrapInLoop.addEventListener('click', () => {
  const flow = getActiveFlow();
  wrapRootBlocksInLoopList(flow, '');
  saveFlows(true);
  renderAll();
});

// Allow dropping into the main canvas
blocksContainer.addEventListener('dragover', (e) => {
  if (!draggedBlockId) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  blocksContainer.classList.add('drop-target-container');
});

blocksContainer.addEventListener('dragleave', (e) => {
  if (!blocksContainer.contains(e.relatedTarget)) {
    blocksContainer.classList.remove('drop-target-container');
  }
});

blocksContainer.addEventListener('drop', (e) => {
  if (!draggedBlockId) return;
  e.preventDefault();
  const sourceId = draggedBlockId;
  clearAllDragIndicators();
  const flow = getActiveFlow();
  if (!flow) return;
  const moved = moveBlockToPosition(flow, sourceId, null, null, flow.blocks.length);
  if (moved) {
    saveFlows(true);
    renderBlocks();
  }
});

// Palette add-block buttons
document.querySelectorAll('[data-add-block]').forEach((btn) => {
  btn.addEventListener('click', () => {
    const type = btn.getAttribute('data-add-block');
    const flow = getActiveFlow();
    const blk = createBlock(type);
    insertBlockIntoFlow(flow, blk, appState.recordTarget);
    saveFlows(true);
    renderAll();
  });
});

// Listen to background & content script messages
chrome.runtime.onMessage.addListener((msg) => {
  if (!msg || !msg.type) return;

  if (msg.type === MSG.STATE_UPDATE && msg.state) {
    appState.recording = Boolean(msg.state.recording);
    if (!appState.recording) appState.recordingSessions.clear();
    appState.execution = msg.state.execution || appState.execution;
    renderStatusAndControls();
    return;
  }

  if (msg.type === MSG.RECORDED_EVENT && msg.block) {
    const flow = getActiveFlow();
    if (msg.mode === 'upsert' && msg.sessionId && appState.recordingSessions.has(msg.sessionId)) {
      const existingId = appState.recordingSessions.get(msg.sessionId);
      const loc = findBlockLocation(flow.blocks, existingId);
      if (loc) {
        loc.block.value = msg.block.value;
        loc.block.pressEnter = Boolean(msg.block.pressEnter);
        loc.block.target = msg.block.target;
        saveFlows();
        const card = document.querySelector(`.block-card[data-block-id="${CSS.escape(existingId)}"]`);
        if (card) {
          const inp = card.querySelector('.input[placeholder*="Digite"]');
          if (inp && document.activeElement !== inp) {
            inp.value = msg.block.value ?? '';
          }
          const sum = card.querySelector('.block-target-summary');
          if (sum) sum.textContent = msg.block.value ? `"${msg.block.value}"` : '';
        }
        return;
      }
    }

    const newBlock = createBlock(msg.block.type, msg.block);
    if (msg.sessionId) {
      appState.recordingSessions.set(msg.sessionId, newBlock.id);
    }
    insertBlockIntoFlow(flow, newBlock, appState.recordTarget);
    saveFlows(true);
    renderBlocks();
    renderStatusAndControls();
    return;
  }

  if (msg.type === MSG.ELEMENT_PICKED && msg.requestId && msg.target) {
    const flow = getActiveFlow();
    const [blockId, sub] = String(msg.requestId).split('::');
    const loc = findBlockLocation(flow.blocks, blockId);
    if (loc) {
      if (sub === 'cond' && loc.block.condition) {
        loc.block.condition.target = msg.target;
      } else {
        loc.block.target = msg.target;
      }
      saveFlows(true);
      renderBlocks();
    }
  }
});

// Initialize
(async function init() {
  await loadFlows();
  try {
    const res = await sendBg({ type: MSG.GET_STATE });
    if (res?.state) {
      appState.recording = Boolean(res.state.recording);
      appState.execution = res.state.execution || appState.execution;
    }
  } catch {
    // Background waking up
  }
  renderAll();
})();

