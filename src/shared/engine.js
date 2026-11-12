import {
  BLOCK_TYPES,
  interpolate,
  interpolateTarget,
  parseBooleanLike,
  parseListInput,
} from './flow-model.js';

const SIGNAL_NONE = null;
const SIGNAL_BREAK = 'BREAK';
const SIGNAL_CONTINUE = 'CONTINUE';

/**
 * Evaluates variable-based conditions synchronously.
 * Returns null if the condition requires DOM inspection.
 */
export function evaluateVarCondition(condition, vars) {
  const kind = condition?.kind;
  const rawVar = vars[condition?.varName || ''];
  const actual = rawVar === undefined || rawVar === null ? '' : String(rawVar);
  const expected = interpolate(condition?.value ?? '', vars);

  switch (kind) {
    case 'var_equals':
      return actual.trim() === expected.trim();
    case 'var_not_equals':
      return actual.trim() !== expected.trim();
    case 'var_contains':
      return actual.toLowerCase().includes(expected.toLowerCase());
    case 'var_not_empty':
      return actual.trim().length > 0;
    default:
      return null;
  }
}

/**
 * Executes a Flow using the provided driver and controller.
 *
 * driver: {
 *   executeAction(action, settings): Promise<void>,
 *   checkCondition(condition, settings): Promise<boolean>,
 *   wait(ms): Promise<void>,
 *   onProgress(info): void,
 * }
 * controller: {
 *   shouldStop(): boolean,
 *   waitIfPaused(): Promise<void>,
 * }
 */
export async function runFlow(flow, driver, controller) {
  const settings = {
    stepDelayMs: 300,
    elementTimeoutMs: 6000,
    stopOnError: true,
    ...(flow.settings || {}),
  };

  const vars = {};
  let loopContextLabel = '';
  let stepsExecuted = 0;

  const checkControl = async () => {
    await controller.waitIfPaused();
    if (controller.shouldStop()) {
      throw new Error('__EXECUTION_STOPPED__');
    }
  };

  const smartWait = async (totalMs) => {
    const ms = Math.max(0, Number(totalMs) || 0);
    if (ms === 0) return;
    const chunk = 250;
    let remaining = ms;
    while (remaining > 0) {
      await checkControl();
      const slice = Math.min(chunk, remaining);
      await driver.wait(slice);
      remaining -= slice;
    }
  };

  const report = (blockId, summary) => {
    const prefix = loopContextLabel ? `[${loopContextLabel}] ` : '';
    driver.onProgress?.({
      status: 'running',
      currentBlockId: blockId,
      summary: `${prefix}${summary}`,
      vars: { ...vars },
      stepsExecuted,
    });
  };

  const execBlockList = async (blocks) => {
    for (const block of blocks || []) {
      await checkControl();
      if (block.enabled === false) continue;

      const signal = await execBlock(block);
      if (signal === SIGNAL_BREAK || signal === SIGNAL_CONTINUE) {
        return signal;
      }
    }
    return SIGNAL_NONE;
  };

  const execBlock = async (block) => {
    await checkControl();

    switch (block.type) {
      case BLOCK_TYPES.SET_VAR: {
        const name = (block.varName || '').trim();
        if (name) {
          vars[name] = interpolate(block.value ?? '', vars);
          report(block.id, `Variável "${name}" = "${vars[name]}"`);
        }
        return SIGNAL_NONE;
      }

      case BLOCK_TYPES.BREAK:
        report(block.id, 'Parando repetição');
        return SIGNAL_BREAK;

      case BLOCK_TYPES.CONTINUE:
        report(block.id, 'Pulando para o próximo item');
        return SIGNAL_CONTINUE;

      case BLOCK_TYPES.WAIT: {
        if (block.mode === 'selector') {
          const target = interpolateTarget(block.target, vars);
          report(block.id, `Aguardando elemento aparecer...`);
          await driver.executeAction(
            {
              type: 'wait_selector',
              target,
              timeoutMs: Number(block.timeoutMs) || settings.elementTimeoutMs,
            },
            settings
          );
        } else {
          const ms = Number(block.ms) || 0;
          report(block.id, `Aguardando ${ms}ms...`);
          await smartWait(ms);
        }
        stepsExecuted++;
        return SIGNAL_NONE;
      }

      case BLOCK_TYPES.LOOP_LIST: {
        const itemVar = (block.itemVar || 'item').trim() || 'item';
        const resolvedListText = interpolate(block.listText || '', vars);
        const items = parseListInput(resolvedListText, block.delimiter ?? ',');

        const prevItem = vars[itemVar];
        const prevIndice = vars.indice;
        const prevIndex = vars.index;
        const prevTotal = vars.total;
        const prevContext = loopContextLabel;

        vars.total = items.length;
        report(block.id, `Iniciando lista com ${items.length} item(ns)`);

        try {
          for (let i = 0; i < items.length; i++) {
            await checkControl();
            vars[itemVar] = items[i];
            vars.index = i;
            vars.indice = i + 1;
            loopContextLabel = `Item ${i + 1}/${items.length}: "${items[i]}"`;

            report(block.id, `Processando`);
            const signal = await execBlockList(block.children || []);
            if (signal === SIGNAL_BREAK) {
              break;
            }
          }
        } finally {
          loopContextLabel = prevContext;
          if (prevItem === undefined) delete vars[itemVar];
          else vars[itemVar] = prevItem;
          if (prevIndice === undefined) delete vars.indice;
          else vars.indice = prevIndice;
          if (prevIndex === undefined) delete vars.index;
          else vars.index = prevIndex;
          if (prevTotal === undefined) delete vars.total;
          else vars.total = prevTotal;
        }
        return SIGNAL_NONE;
      }

      case BLOCK_TYPES.LOOP_COUNT: {
        const rawCount = interpolate(String(block.count ?? 1), vars);
        const count = Math.max(0, Math.floor(Number(rawCount) || 0));
        const indexVar = (block.indexVar || 'indice').trim() || 'indice';

        const prevVar = vars[indexVar];
        const prevIndice = vars.indice;
        const prevContext = loopContextLabel;

        try {
          for (let i = 1; i <= count; i++) {
            await checkControl();
            vars[indexVar] = i;
            vars.indice = i;
            loopContextLabel = `Ciclo ${i}/${count}`;
            report(block.id, `Executando ciclo`);

            const signal = await execBlockList(block.children || []);
            if (signal === SIGNAL_BREAK) {
              break;
            }
          }
        } finally {
          loopContextLabel = prevContext;
          if (prevVar === undefined) delete vars[indexVar];
          else vars[indexVar] = prevVar;
          if (prevIndice === undefined) delete vars.indice;
          else vars.indice = prevIndice;
        }
        return SIGNAL_NONE;
      }

      case BLOCK_TYPES.IF_CONDITION: {
        const cond = block.condition || {};
        let passed = evaluateVarCondition(cond, vars);
        if (passed === null) {
          const resolvedCond = {
            ...cond,
            target: interpolateTarget(cond.target, vars),
            value: interpolate(cond.value ?? '', vars),
          };
          report(block.id, `Verificando condição (${cond.kind})...`);
          passed = await driver.checkCondition(resolvedCond, settings);
        } else {
          report(block.id, `Condição avaliada: ${passed ? 'Verdadeira' : 'Falsa'}`);
        }

        const branch = passed ? block.thenBlocks : block.elseBlocks;
        if (branch && branch.length > 0) {
          return await execBlockList(branch);
        }
        return SIGNAL_NONE;
      }

      case BLOCK_TYPES.TYPE:
      case BLOCK_TYPES.CLICK:
      case BLOCK_TYPES.CHECKBOX:
      case BLOCK_TYPES.SELECT: {
        const resolvedAction = resolveActionBlock(block, vars);
        report(block.id, describeActionExecution(resolvedAction));

        try {
          await driver.executeAction(resolvedAction, settings);
          stepsExecuted++;
        } catch (err) {
          if (settings.stopOnError) {
            throw err;
          }
          report(block.id, `Aviso (ignorado): ${err.message}`);
        }

        if (settings.stepDelayMs > 0) {
          await smartWait(settings.stepDelayMs);
        }
        return SIGNAL_NONE;
      }

      default:
        return SIGNAL_NONE;
    }
  };

  try {
    await execBlockList(flow.blocks || []);
    driver.onProgress?.({
      status: 'completed',
      currentBlockId: null,
      summary: `Concluído com sucesso (${stepsExecuted} ações executadas).`,
      vars: { ...vars },
      stepsExecuted,
    });
    return { status: 'completed', stepsExecuted };
  } catch (err) {
    if (err && err.message === '__EXECUTION_STOPPED__') {
      driver.onProgress?.({
        status: 'stopped',
        currentBlockId: null,
        summary: `Execução interrompida pelo usuário (${stepsExecuted} ações).`,
        vars: { ...vars },
        stepsExecuted,
      });
      return { status: 'stopped', stepsExecuted };
    }
    driver.onProgress?.({
      status: 'error',
      currentBlockId: null,
      summary: `Erro: ${err?.message || String(err)}`,
      error: err?.message || String(err),
      vars: { ...vars },
      stepsExecuted,
    });
    return { status: 'error', error: err?.message || String(err), stepsExecuted };
  }
}

export function resolveActionBlock(block, vars) {
  const target = interpolateTarget(block.target, vars);
  if (block.type === BLOCK_TYPES.TYPE) {
    return {
      type: BLOCK_TYPES.TYPE,
      target,
      value: interpolate(block.value ?? '', vars),
      clearFirst: block.clearFirst !== false,
      pressEnter: Boolean(block.pressEnter),
    };
  }
  if (block.type === BLOCK_TYPES.CLICK) {
    return {
      type: BLOCK_TYPES.CLICK,
      target,
    };
  }
  if (block.type === BLOCK_TYPES.CHECKBOX) {
    let resolvedMode = block.mode || 'check';
    if (resolvedMode === 'variable') {
      const val = interpolate(block.value ?? '', vars);
      resolvedMode = parseBooleanLike(val) ? 'check' : 'uncheck';
    }
    return {
      type: BLOCK_TYPES.CHECKBOX,
      target,
      mode: resolvedMode,
    };
  }
  if (block.type === BLOCK_TYPES.SELECT) {
    return {
      type: BLOCK_TYPES.SELECT,
      target,
      value: interpolate(block.value ?? '', vars),
    };
  }
  return block;
}

function describeActionExecution(action) {
  const label = action.target?.label || action.target?.text || action.target?.primary || 'elemento';
  switch (action.type) {
    case BLOCK_TYPES.TYPE:
      return `Digitando "${action.value}" em ${label}`;
    case BLOCK_TYPES.CLICK:
      return `Clicando em ${label}`;
    case BLOCK_TYPES.CHECKBOX:
      return `${action.mode === 'uncheck' ? 'Desmarcando' : action.mode === 'toggle' ? 'Alternando' : 'Marcando'} ${label}`;
    case BLOCK_TYPES.SELECT:
      return `Selecionando "${action.value}" em ${label}`;
    default:
      return `Executando ${action.type}`;
  }
}

