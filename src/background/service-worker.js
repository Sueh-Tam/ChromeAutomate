import { MSG } from '../shared/messages.js';
import { runFlow } from '../shared/engine.js';

const CONTENT_FILES = [
  'src/content/selector.js',
  'src/content/recorder.js',
  'src/content/actor.js',
];

// Open Side Panel automatically when clicking the toolbar icon (Chrome 116+)
if (chrome.sidePanel?.setPanelBehavior) {
  chrome.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: true })
    .catch((err) => console.warn('setPanelBehavior error:', err));
}

const state = {
  recording: false,
  recordingTabId: null,
  execution: {
    status: 'idle',
    currentBlockId: null,
    summary: 'Pronto para gravar ou executar.',
    vars: {},
    activeLoops: {},
    stepsExecuted: 0,
    tabId: null,
  },
};

let execControl = {
  stopRequested: false,
  paused: false,
  resumeResolver: null,
};

function broadcastState() {
  chrome.runtime
    .sendMessage({
      type: MSG.STATE_UPDATE,
      state: {
        recording: state.recording,
        recordingTabId: state.recordingTabId,
        execution: { ...state.execution },
      },
    })
    .catch(() => {
      // Side panel might be closed
    });
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (!tab || !tab.id) {
    throw new Error('Nenhuma aba ativa encontrada.');
  }
  const url = tab.url || '';
  if (
    url.startsWith('chrome://') ||
    url.startsWith('edge://') ||
    url.startsWith('chrome-extension://') ||
    url.startsWith('about:')
  ) {
    throw new Error('Não é possível gravar ou executar em páginas internas do navegador.');
  }
  return tab;
}

async function waitForTabComplete(tabId, timeoutMs = 15000) {
  const tab = await chrome.tabs.get(tabId);
  if (tab.status === 'complete') return;

  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(onUpdated);
      resolve(); // proceed best-effort after timeout
    }, timeoutMs);

    function onUpdated(updatedId, info) {
      if (updatedId === tabId && info.status === 'complete') {
        clearTimeout(timer);
        chrome.tabs.onUpdated.removeListener(onUpdated);
        resolve();
      }
    }
    chrome.tabs.onUpdated.addListener(onUpdated);
  });
}

async function ensureContentScripts(tabId) {
  try {
    const ping = await chrome.tabs.sendMessage(tabId, { type: MSG.PING });
    if (ping?.ok) return;
  } catch {
    // Not injected yet
  }

  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: CONTENT_FILES,
    });
  } catch (err) {
    throw new Error(
      `Não foi possível acessar a página (${err?.message || 'permissão negada'}). Recarregue a aba e tente novamente.`
    );
  }
}

async function sendTabMessageWithRetry(tabId, message) {
  await waitForTabComplete(tabId);
  await ensureContentScripts(tabId);
  try {
    return await chrome.tabs.sendMessage(tabId, message);
  } catch (err) {
    // Page might have navigated mid-command
    await new Promise((r) => setTimeout(r, 400));
    await waitForTabComplete(tabId);
    await ensureContentScripts(tabId);
    return await chrome.tabs.sendMessage(tabId, message);
  }
}

// Re-attach recorder if the user navigates while recording
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo) => {
  if (state.recording && tabId === state.recordingTabId && changeInfo.status === 'complete') {
    try {
      await ensureContentScripts(tabId);
      await chrome.tabs.sendMessage(tabId, { type: MSG.START_RECORDING });
    } catch {
      // ignore if navigated to restricted page
    }
  }
});

async function handleStartRecording() {
  if (state.execution.status === 'running' || state.execution.status === 'paused') {
    throw new Error('Pare a execução atual antes de iniciar uma gravação.');
  }
  const tab = await getActiveTab();
  await ensureContentScripts(tab.id);
  await chrome.tabs.sendMessage(tab.id, { type: MSG.START_RECORDING });
  state.recording = true;
  state.recordingTabId = tab.id;
  broadcastState();
}

async function handleStopRecording() {
  const tabId = state.recordingTabId;
  state.recording = false;
  state.recordingTabId = null;
  if (tabId) {
    try {
      await chrome.tabs.sendMessage(tabId, { type: MSG.STOP_RECORDING });
    } catch {
      // Tab might have closed
    }
  }
  broadcastState();
}

async function handleStartExecution(flow) {
  if (state.recording) {
    await handleStopRecording();
  }
  if (state.execution.status === 'running' || state.execution.status === 'paused') {
    throw new Error('Uma automação já está em execução.');
  }

  const tab = await getActiveTab();
  await ensureContentScripts(tab.id);

  execControl = {
    stopRequested: false,
    paused: false,
    resumeResolver: null,
  };

  state.execution = {
    status: 'running',
    currentBlockId: null,
    summary: 'Iniciando automação...',
    vars: {},
    activeLoops: {},
    stepsExecuted: 0,
    tabId: tab.id,
  };
  broadcastState();

  const driver = {
    async executeAction(action, settings) {
      const res = await sendTabMessageWithRetry(tab.id, {
        type: MSG.EXEC_ACTION,
        action,
        settings,
      });
      if (!res || !res.ok) {
        throw new Error(res?.error || 'Falha ao executar ação na página.');
      }
    },
    async checkCondition(condition) {
      const res = await sendTabMessageWithRetry(tab.id, {
        type: MSG.CHECK_CONDITION,
        condition,
      });
      if (!res || !res.ok) {
        throw new Error(res?.error || 'Falha ao verificar condição na página.');
      }
      return Boolean(res.passed);
    },
    wait(ms) {
      return new Promise((resolve) => setTimeout(resolve, ms));
    },
    onProgress(info) {
      state.execution = {
        ...state.execution,
        ...info,
      };
      broadcastState();
    },
  };

  const controller = {
    shouldStop() {
      return execControl.stopRequested;
    },
    async waitIfPaused() {
      if (!execControl.paused) return;
      state.execution.status = 'paused';
      state.execution.summary = 'Execução pausada.';
      broadcastState();
      await new Promise((resolve) => {
        execControl.resumeResolver = resolve;
      });
    },
  };

  // Run asynchronously so message response returns immediately
  runFlow(flow, driver, controller).finally(() => {
    execControl.paused = false;
    execControl.resumeResolver = null;
  });
}

function handlePauseExecution() {
  if (state.execution.status === 'running') {
    execControl.paused = true;
    state.execution.status = 'paused';
    state.execution.summary = 'Pausado pelo usuário.';
    broadcastState();
  }
}

function handleResumeExecution() {
  if (state.execution.status === 'paused') {
    execControl.paused = false;
    state.execution.status = 'running';
    broadcastState();
    if (execControl.resumeResolver) {
      execControl.resumeResolver();
      execControl.resumeResolver = null;
    }
  }
}

function handleStopExecution() {
  execControl.stopRequested = true;
  execControl.paused = false;
  if (execControl.resumeResolver) {
    execControl.resumeResolver();
    execControl.resumeResolver = null;
  }
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || !msg.type) return false;

  switch (msg.type) {
    case MSG.GET_STATE:
      sendResponse({
        ok: true,
        state: {
          recording: state.recording,
          recordingTabId: state.recordingTabId,
          execution: { ...state.execution },
        },
      });
      return false;

    case MSG.START_RECORDING:
      handleStartRecording()
        .then(() => sendResponse({ ok: true }))
        .catch((err) => sendResponse({ ok: false, error: err.message }));
      return true;

    case MSG.STOP_RECORDING:
      handleStopRecording()
        .then(() => sendResponse({ ok: true }))
        .catch((err) => sendResponse({ ok: false, error: err.message }));
      return true;

    case MSG.START_EXECUTION:
      handleStartExecution(msg.flow)
        .then(() => sendResponse({ ok: true }))
        .catch((err) => sendResponse({ ok: false, error: err.message }));
      return true;

    case MSG.PAUSE_EXECUTION:
      handlePauseExecution();
      sendResponse({ ok: true });
      return false;

    case MSG.RESUME_EXECUTION:
      handleResumeExecution();
      sendResponse({ ok: true });
      return false;

    case MSG.STOP_EXECUTION:
      handleStopExecution();
      sendResponse({ ok: true });
      return false;

    case MSG.HIGHLIGHT_TARGET:
      getActiveTab()
        .then((tab) =>
          sendTabMessageWithRetry(tab.id, {
            type: MSG.HIGHLIGHT_TARGET,
            target: msg.target,
          })
        )
        .then((res) => sendResponse(res))
        .catch((err) => sendResponse({ ok: false, error: err.message }));
      return true;

    case MSG.PICK_ELEMENT:
      getActiveTab()
        .then((tab) =>
          sendTabMessageWithRetry(tab.id, {
            type: MSG.PICK_ELEMENT,
            requestId: msg.requestId,
          })
        )
        .then((res) => sendResponse(res))
        .catch((err) => sendResponse({ ok: false, error: err.message }));
      return true;

    case MSG.CANCEL_PICK_ELEMENT:
      getActiveTab()
        .then((tab) =>
          chrome.tabs.sendMessage(tab.id, { type: MSG.CANCEL_PICK_ELEMENT })
        )
        .then(() => sendResponse({ ok: true }))
        .catch(() => sendResponse({ ok: true }));
      return true;

    default:
      return false;
  }
});

