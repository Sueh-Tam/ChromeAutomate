(function (root) {
  const ns = (root.__ChromeAutomate = root.__ChromeAutomate || {});
  if (ns.recorder && ns.recorder.initialized) return;

  const MSG = {
    RECORDED_EVENT: 'CA_RECORDED_EVENT',
    STOP_RECORDING: 'CA_STOP_RECORDING',
    ELEMENT_PICKED: 'CA_ELEMENT_PICKED',
  };

  let isRecording = false;
  let isPicking = false;
  let pickRequestId = null;
  let recordedCount = 0;

  let activeTyping = null; // { el, sessionId, target, timer }
  let recentlyChangedCheckbox = null;

  let hudEl = null;
  let pickerOverlay = null;
  let pickerBanner = null;

  function genSessionId() {
    return `rec_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
  }

  function isTextEditable(el) {
    if (!el || el.nodeType !== 1) return false;
    const tag = (el.tagName || '').toLowerCase();
    if (tag === 'textarea') return true;
    if (el.isContentEditable) return true;
    if (tag === 'input') {
      const t = (el.type || 'text').toLowerCase();
      return !['checkbox', 'radio', 'button', 'submit', 'reset', 'file', 'image', 'range', 'color'].includes(t);
    }
    return false;
  }

  function getEditableValue(el) {
    if (!el) return '';
    if (el.isContentEditable) return (el.innerText || el.textContent || '').trim();
    return el.value ?? '';
  }

  function sendRuntime(payload) {
    try {
      chrome.runtime.sendMessage(payload).catch(() => {});
    } catch {
      // ignore if extension context invalidated
    }
  }

  function updateHudText() {
    if (!hudEl) return;
    const countSpan = hudEl.querySelector('[data-ca-count]');
    if (countSpan) {
      countSpan.textContent = `${recordedCount} ${recordedCount === 1 ? 'ação' : 'ações'}`;
    }
  }

  function showHud() {
    removeHud();
    hudEl = document.createElement('div');
    hudEl.setAttribute('data-ca-ignore', 'true');
    Object.assign(hudEl.style, {
      position: 'fixed',
      top: '14px',
      right: '14px',
      zIndex: '2147483647',
      display: 'flex',
      alignItems: 'center',
      gap: '10px',
      padding: '8px 14px',
      borderRadius: '999px',
      background: 'rgba(15, 23, 42, 0.92)',
      color: '#f8fafc',
      fontFamily: 'system-ui, -apple-system, sans-serif',
      fontSize: '13px',
      fontWeight: '600',
      boxShadow: '0 8px 24px rgba(0,0,0,0.28)',
      border: '1px solid rgba(255,255,255,0.14)',
      backdropFilter: 'blur(6px)',
    });

    const dot = document.createElement('span');
    dot.setAttribute('data-ca-ignore', 'true');
    Object.assign(dot.style, {
      width: '10px',
      height: '10px',
      borderRadius: '50%',
      background: '#ef4444',
      boxShadow: '0 0 0 3px rgba(239,68,68,0.35)',
    });

    const label = document.createElement('span');
    label.setAttribute('data-ca-ignore', 'true');
    label.textContent = 'Gravando • ';

    const countSpan = document.createElement('span');
    countSpan.setAttribute('data-ca-ignore', 'true');
    countSpan.setAttribute('data-ca-count', 'true');
    countSpan.textContent = `${recordedCount} ações`;
    label.appendChild(countSpan);

    const stopBtn = document.createElement('button');
    stopBtn.setAttribute('data-ca-ignore', 'true');
    stopBtn.textContent = 'Parar';
    Object.assign(stopBtn.style, {
      border: 'none',
      borderRadius: '999px',
      padding: '4px 10px',
      background: '#ef4444',
      color: '#fff',
      fontSize: '12px',
      fontWeight: '600',
      cursor: 'pointer',
    });
    stopBtn.addEventListener('click', (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      stopRecording();
      sendRuntime({ type: MSG.STOP_RECORDING });
    });

    hudEl.append(dot, label, stopBtn);
    document.documentElement.appendChild(hudEl);
  }

  function removeHud() {
    if (hudEl) {
      hudEl.remove();
      hudEl = null;
    }
  }

  function emitStep(block, mode = 'add', sessionId = null) {
    if (mode === 'add') {
      recordedCount++;
      updateHudText();
    }
    sendRuntime({
      type: MSG.RECORDED_EVENT,
      mode,
      sessionId,
      block,
    });
  }

  function flushTyping(pressEnter = false) {
    if (!activeTyping) return;
    if (activeTyping.timer) clearTimeout(activeTyping.timer);
    const value = getEditableValue(activeTyping.el);
    const mode = activeTyping.emitted ? 'upsert' : 'add';
    if (!activeTyping.emitted) {
      recordedCount++;
      updateHudText();
    }
    sendRuntime({
      type: MSG.RECORDED_EVENT,
      mode,
      sessionId: activeTyping.sessionId,
      block: {
        type: 'type',
        target: activeTyping.target,
        value,
        clearFirst: true,
        pressEnter: pressEnter || activeTyping.pressEnter,
      },
    });
    activeTyping = null;
  }

  function onInput(e) {
    if (!isRecording) return;
    const raw = e.target;
    if (!raw || raw.closest?.('[data-ca-ignore="true"]')) return;
    if (!isTextEditable(raw)) return;

    if (!activeTyping || activeTyping.el !== raw) {
      flushTyping(false);
      activeTyping = {
        el: raw,
        sessionId: genSessionId(),
        target: ns.selector.buildTarget(raw, document),
        emitted: false,
        pressEnter: false,
        timer: null,
      };
    }

    if (activeTyping.timer) clearTimeout(activeTyping.timer);
    activeTyping.timer = setTimeout(() => {
      if (!activeTyping || activeTyping.el !== raw) return;
      const mode = activeTyping.emitted ? 'upsert' : 'add';
      if (!activeTyping.emitted) {
        activeTyping.emitted = true;
        recordedCount++;
        updateHudText();
      }
      sendRuntime({
        type: MSG.RECORDED_EVENT,
        mode,
        sessionId: activeTyping.sessionId,
        block: {
          type: 'type',
          target: activeTyping.target,
          value: getEditableValue(raw),
          clearFirst: true,
          pressEnter: activeTyping.pressEnter,
        },
      });
    }, 280);
  }

  function onKeyDown(e) {
    if (!isRecording) return;
    if (e.key === 'Enter' && activeTyping && activeTyping.el === e.target) {
      activeTyping.pressEnter = true;
      flushTyping(true);
    }
  }

  function onChange(e) {
    if (!isRecording) return;
    const raw = e.target;
    if (!raw || raw.closest?.('[data-ca-ignore="true"]')) return;
    const tag = (raw.tagName || '').toLowerCase();

    if (tag === 'select') {
      flushTyping(false);
      emitStep({
        type: 'select',
        target: ns.selector.buildTarget(raw, document),
        value: raw.value,
      });
      return;
    }

    if (tag === 'input' && raw.type === 'checkbox') {
      flushTyping(false);
      recentlyChangedCheckbox = raw;
      setTimeout(() => {
        if (recentlyChangedCheckbox === raw) recentlyChangedCheckbox = null;
      }, 120);

      emitStep({
        type: 'checkbox',
        target: ns.selector.buildTarget(raw, document),
        mode: raw.checked ? 'check' : 'uncheck',
      });
      return;
    }

    if (tag === 'input' && raw.type === 'radio') {
      flushTyping(false);
      emitStep({
        type: 'click',
        target: ns.selector.buildTarget(raw, document),
      });
    }
  }

  function onClick(e) {
    if (!isRecording) return;
    if (e.button !== 0) return;
    const raw = e.target;
    if (!raw || raw.closest?.('[data-ca-ignore="true"]')) return;

    const el = ns.selector.resolveSemanticElement(raw, document);
    if (!el) return;

    const tag = (el.tagName || '').toLowerCase();
    // Ignore opening a <select>; wait for change event
    if (tag === 'select' || tag === 'option') return;

    // Ignore focusing a text field (typing records the `type` action cleanly)
    if (isTextEditable(el)) return;

    flushTyping(false);

    // Native checkbox/radio: wait briefly to let change fire first; fallback if custom JS prevented change
    if (tag === 'input' && (el.type === 'checkbox' || el.type === 'radio')) {
      setTimeout(() => {
        if (recentlyChangedCheckbox === el) return;
        if (el.type === 'checkbox') {
          emitStep({
            type: 'checkbox',
            target: ns.selector.buildTarget(el, document),
            mode: el.checked ? 'check' : 'uncheck',
          });
        }
      }, 60);
      return;
    }

    // Custom ARIA checkbox
    if (el.getAttribute?.('role') === 'checkbox') {
      setTimeout(() => {
        const checkedAttr = el.getAttribute('aria-checked');
        emitStep({
          type: 'checkbox',
          target: ns.selector.buildTarget(el, document),
          mode: checkedAttr === 'true' ? 'check' : checkedAttr === 'false' ? 'uncheck' : 'toggle',
        });
      }, 40);
      return;
    }

    emitStep({
      type: 'click',
      target: ns.selector.buildTarget(el, document),
    });
  }

  function onFocusOut(e) {
    if (!isRecording) return;
    if (activeTyping && activeTyping.el === e.target) {
      flushTyping(false);
    }
  }

  // --- Element Picker Mode ---
  function onPickerMove(e) {
    if (!isPicking || !pickerOverlay) return;
    const raw = document.elementFromPoint(e.clientX, e.clientY);
    if (!raw || raw.closest?.('[data-ca-ignore="true"]')) return;
    const el = ns.selector.resolveSemanticElement(raw, document) || raw;
    const rect = el.getBoundingClientRect();
    Object.assign(pickerOverlay.style, {
      display: 'block',
      left: `${rect.left}px`,
      top: `${rect.top}px`,
      width: `${rect.width}px`,
      height: `${rect.height}px`,
    });
  }

  function onPickerClick(e) {
    if (!isPicking) return;
    if (e.target?.closest?.('[data-ca-ignore="true"]')) return;
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();

    const el = ns.selector.resolveSemanticElement(e.target, document) || e.target;
    const target = ns.selector.buildTarget(el, document);
    const reqId = pickRequestId;
    stopPicker();
    ns.selector.highlightElement(el, '#10b981', 900);
    sendRuntime({
      type: MSG.ELEMENT_PICKED,
      requestId: reqId,
      target,
    });
  }

  function onPickerKey(e) {
    if (isPicking && e.key === 'Escape') {
      e.preventDefault();
      stopPicker();
    }
  }

  function startPicker(requestId) {
    stopPicker();
    isPicking = true;
    pickRequestId = requestId;

    pickerOverlay = document.createElement('div');
    pickerOverlay.setAttribute('data-ca-ignore', 'true');
    Object.assign(pickerOverlay.style, {
      position: 'fixed',
      display: 'none',
      zIndex: '2147483646',
      border: '2px solid #10b981',
      background: 'rgba(16, 185, 129, 0.16)',
      borderRadius: '4px',
      pointerEvents: 'none',
      boxSizing: 'border-box',
    });

    pickerBanner = document.createElement('div');
    pickerBanner.setAttribute('data-ca-ignore', 'true');
    pickerBanner.textContent = '🎯 Clique no elemento desejado na página (ESC para cancelar)';
    Object.assign(pickerBanner.style, {
      position: 'fixed',
      top: '14px',
      left: '50%',
      transform: 'translateX(-50%)',
      zIndex: '2147483647',
      padding: '8px 16px',
      borderRadius: '999px',
      background: '#065f46',
      color: '#ecfdf5',
      fontFamily: 'system-ui, sans-serif',
      fontSize: '13px',
      fontWeight: '600',
      boxShadow: '0 8px 20px rgba(0,0,0,0.25)',
      pointerEvents: 'none',
    });

    document.documentElement.append(pickerOverlay, pickerBanner);
    document.addEventListener('mousemove', onPickerMove, true);
    document.addEventListener('click', onPickerClick, true);
    document.addEventListener('keydown', onPickerKey, true);
  }

  function stopPicker() {
    isPicking = false;
    pickRequestId = null;
    document.removeEventListener('mousemove', onPickerMove, true);
    document.removeEventListener('click', onPickerClick, true);
    document.removeEventListener('keydown', onPickerKey, true);
    pickerOverlay?.remove();
    pickerBanner?.remove();
    pickerOverlay = null;
    pickerBanner = null;
  }

  function startRecording() {
    if (isRecording) return;
    stopPicker();
    isRecording = true;
    recordedCount = 0;
    activeTyping = null;

    document.addEventListener('click', onClick, true);
    document.addEventListener('input', onInput, true);
    document.addEventListener('change', onChange, true);
    document.addEventListener('keydown', onKeyDown, true);
    document.addEventListener('focusout', onFocusOut, true);
    showHud();
  }

  function stopRecording() {
    if (!isRecording) return;
    flushTyping(false);
    isRecording = false;

    document.removeEventListener('click', onClick, true);
    document.removeEventListener('input', onInput, true);
    document.removeEventListener('change', onChange, true);
    document.removeEventListener('keydown', onKeyDown, true);
    document.removeEventListener('focusout', onFocusOut, true);
    removeHud();
  }

  ns.recorder = {
    initialized: true,
    startRecording,
    stopRecording,
    startPicker,
    stopPicker,
    isRecording: () => isRecording,
  };
})(typeof window !== 'undefined' ? window : globalThis);

