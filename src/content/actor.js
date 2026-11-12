(function (root) {
  const ns = (root.__ChromeAutomate = root.__ChromeAutomate || {});
  if (ns.actor && ns.actor.initialized) return;

  const MSG = {
    PING: 'CA_PING',
    START_RECORDING: 'CA_START_RECORDING',
    STOP_RECORDING: 'CA_STOP_RECORDING',
    HIGHLIGHT_TARGET: 'CA_HIGHLIGHT_TARGET',
    PICK_ELEMENT: 'CA_PICK_ELEMENT',
    CANCEL_PICK_ELEMENT: 'CA_CANCEL_PICK_ELEMENT',
    EXEC_ACTION: 'CA_EXEC_ACTION',
    CHECK_CONDITION: 'CA_CHECK_CONDITION',
  };

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async function waitForElement(target, timeoutMs = 6000) {
    const start = Date.now();
    while (Date.now() - start <= timeoutMs) {
      const el = ns.selector.findElement(target, document);
      if (el && ns.selector.isElementInteractable(el, el.ownerDocument || document)) {
        return el;
      }
      await sleep(120);
    }
    const desc = target?.label || target?.text || target?.primary || 'elemento';
    throw new Error(`Elemento não encontrado: ${desc}`);
  }

  function setNativeValue(el, value) {
    const tag = (el.tagName || '').toLowerCase();
    const proto =
      tag === 'textarea'
        ? HTMLTextAreaElement.prototype
        : tag === 'select'
          ? HTMLSelectElement.prototype
          : HTMLInputElement.prototype;

    const descriptor = Object.getOwnPropertyDescriptor(proto, 'value');
    if (descriptor && typeof descriptor.set === 'function') {
      descriptor.set.call(el, value);
    } else {
      el.value = value;
    }
  }

  function dispatchInputEvents(el, value) {
    try {
      el.dispatchEvent(
        new InputEvent('input', {
          bubbles: true,
          cancelable: true,
          data: value,
          inputType: 'insertText',
        })
      );
    } catch {
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function isElementChecked(el) {
    if (!el) return false;
    if (el.tagName?.toLowerCase() === 'input') {
      return Boolean(el.checked);
    }
    const aria = el.getAttribute?.('aria-checked');
    if (aria !== null) return aria === 'true';
    return Boolean(el.checked);
  }

  function clickElement(el) {
    const clickTarget = ns.selector.getVisualTarget(el, el.ownerDocument || document) || el;
    try {
      clickTarget.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' });
    } catch {
      // ignore
    }
    try {
      clickTarget.focus?.({ preventScroll: true });
    } catch {
      // ignore
    }
    const win = clickTarget.ownerDocument?.defaultView || window;
    const opts = { bubbles: true, cancelable: true, view: win };
    clickTarget.dispatchEvent(new MouseEvent('mouseover', opts));
    clickTarget.dispatchEvent(new MouseEvent('mousedown', opts));
    clickTarget.dispatchEvent(new MouseEvent('mouseup', opts));
    clickTarget.click();
  }

  async function executeAction(action, settings = {}) {
    const timeoutMs = Number(action.timeoutMs || settings.elementTimeoutMs || 6000);

    if (action.type === 'wait_selector') {
      const el = await waitForElement(action.target, timeoutMs);
      ns.selector.highlightElement(el, '#6366f1', 500);
      return { ok: true };
    }

    const el = await waitForElement(action.target, timeoutMs);
    ns.selector.highlightElement(el, '#4f46e5', 600);

    switch (action.type) {
      case 'type': {
        try {
          el.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' });
        } catch {
          // ignore
        }
        el.focus?.();

        const nextVal = String(action.value ?? '');
        if (el.isContentEditable) {
          if (action.clearFirst !== false) {
            el.textContent = '';
          }
          el.textContent = (action.clearFirst !== false ? '' : el.textContent || '') + nextVal;
          dispatchInputEvents(el, nextVal);
        } else {
          const finalValue = action.clearFirst !== false ? nextVal : `${el.value ?? ''}${nextVal}`;
          if (action.clearFirst !== false) {
            setNativeValue(el, '');
          }
          setNativeValue(el, finalValue);
          dispatchInputEvents(el, nextVal);
        }

        if (action.pressEnter) {
          const keyOpts = {
            key: 'Enter',
            code: 'Enter',
            keyCode: 13,
            which: 13,
            bubbles: true,
            cancelable: true,
          };
          const notCancelled = el.dispatchEvent(new KeyboardEvent('keydown', keyOpts));
          el.dispatchEvent(new KeyboardEvent('keypress', keyOpts));
          el.dispatchEvent(new KeyboardEvent('keyup', keyOpts));
          if (notCancelled && el.form && typeof el.form.requestSubmit === 'function') {
            try {
              el.form.requestSubmit();
            } catch {
              // ignore if form has no valid submitter or throws
            }
          }
        }
        return { ok: true };
      }

      case 'click': {
        clickElement(el);
        return { ok: true };
      }

      case 'checkbox': {
        const current = isElementChecked(el);
        const mode = action.mode || 'check';

        if (mode === 'toggle') {
          clickElement(el);
        } else if (mode === 'check' && !current) {
          clickElement(el);
          if (!isElementChecked(el) && el.tagName?.toLowerCase() === 'input') {
            el.checked = true;
            el.dispatchEvent(new Event('change', { bubbles: true }));
          }
        } else if (mode === 'uncheck' && current) {
          clickElement(el);
          if (isElementChecked(el) && el.tagName?.toLowerCase() === 'input') {
            el.checked = false;
            el.dispatchEvent(new Event('change', { bubbles: true }));
          }
        }
        return { ok: true };
      }

      case 'select': {
        const wanted = String(action.value ?? '').trim();
        const options = Array.from(el.options || []);
        const match =
          options.find((o) => o.value === wanted) ||
          options.find((o) => o.textContent.trim().toLowerCase() === wanted.toLowerCase());

        if (!match) {
          throw new Error(`Opção "${wanted}" não encontrada no select.`);
        }
        setNativeValue(el, match.value);
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        return { ok: true };
      }

      default:
        throw new Error(`Ação não suportada: ${action.type}`);
    }
  }

  function checkCondition(condition) {
    const kind = condition?.kind;
    if (kind === 'exists') {
      const el = ns.selector.findElement(condition.target, document);
      return Boolean(el && ns.selector.isElementInteractable(el, el.ownerDocument || document));
    }
    if (kind === 'not_exists') {
      const el = ns.selector.findElement(condition.target, document);
      return !(el && ns.selector.isElementInteractable(el, el.ownerDocument || document));
    }
    if (kind === 'element_checked') {
      const el = ns.selector.findElement(condition.target, document);
      return Boolean(el && isElementChecked(el));
    }
    if (kind === 'text_contains') {
      const expected = String(condition.value ?? '').trim().toLowerCase();
      if (!expected) return true;
      let text = '';
      if (condition.target && condition.target.primary) {
        const el = ns.selector.findElement(condition.target, document);
        text = el ? el.innerText || el.textContent || '' : '';
      } else {
        text = document.body?.innerText || '';
      }
      return text.toLowerCase().includes(expected);
    }
    return false;
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (!msg || !msg.type) return false;

    switch (msg.type) {
      case MSG.PING:
        sendResponse({ ok: true, recording: ns.recorder?.isRecording?.() || false });
        return false;

      case MSG.START_RECORDING:
        ns.recorder?.startRecording();
        sendResponse({ ok: true });
        return false;

      case MSG.STOP_RECORDING:
        ns.recorder?.stopRecording();
        sendResponse({ ok: true });
        return false;

      case MSG.PICK_ELEMENT:
        ns.recorder?.startPicker(msg.requestId);
        sendResponse({ ok: true });
        return false;

      case MSG.CANCEL_PICK_ELEMENT:
        ns.recorder?.stopPicker();
        sendResponse({ ok: true });
        return false;

      case MSG.HIGHLIGHT_TARGET: {
        const el = ns.selector.findElement(msg.target, document);
        if (el) {
          ns.selector.highlightElement(el, '#6366f1', 1600);
          sendResponse({ ok: true, found: true });
        } else {
          sendResponse({ ok: true, found: false });
        }
        return false;
      }

      case MSG.EXEC_ACTION:
        executeAction(msg.action, msg.settings)
          .then((res) => sendResponse(res))
          .catch((err) => sendResponse({ ok: false, error: err?.message || String(err) }));
        return true;

      case MSG.CHECK_CONDITION:
        try {
          const passed = checkCondition(msg.condition);
          sendResponse({ ok: true, passed });
        } catch (err) {
          sendResponse({ ok: false, error: err?.message || String(err) });
        }
        return false;

      default:
        return false;
    }
  });

  ns.actor = {
    initialized: true,
    executeAction,
    checkCondition,
  };
})(typeof window !== 'undefined' ? window : globalThis);

