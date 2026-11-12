(function (root) {
  const ns = (root.__ChromeAutomate = root.__ChromeAutomate || {});

  function cssEscape(value) {
    if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
      return CSS.escape(String(value));
    }
    return String(value).replace(/([!"#$%&'()*+,./:;<=>?@[\\\]^`{|}~])/g, '\\$1');
  }

  function isStableId(id) {
    if (!id || typeof id !== 'string') return false;
    const trimmed = id.trim();
    if (!trimmed || trimmed.length > 64) return false;
    // React useId (:r0:, :r1a:), Radix, MUI, Ember, Angular CDK, UUIDs, long numeric suffixes
    if (/^:r[0-9a-zA-Z]+:$/.test(trimmed)) return false;
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(trimmed)) return false;
    if (/^(mui|ember|radix|headlessui|downshift|cdk|ng|react|select2|el-id)-/i.test(trimmed)) return false;
    if (/^\d+$/.test(trimmed)) return false;
    if (/[_-]\d{4,}$/.test(trimmed)) return false;
    if (/^[0-9a-f]{10,}$/i.test(trimmed)) return false;
    return true;
  }

  function isStableClass(cls) {
    if (!cls || typeof cls !== 'string') return false;
    if (cls.length > 48) return false;
    if (/[\[\]:\/!]/.test(cls)) return false; // Tailwind arbitrary/variant classes
    if (/^(css|sc|emotion|svelte|astro|jsx)-[a-zA-Z0-9_-]{4,}$/.test(cls)) return false;
    if (/^_?[a-zA-Z0-9]+_[a-zA-Z0-9]{5,}$/.test(cls)) return false; // CSS Modules hash
    if (/^ng-(touched|untouched|pristine|dirty|valid|invalid|pending|empty|not-empty)$/.test(cls)) return false;
    if (/^(active|focus|focused|hover|selected|open|disabled|checked)$/.test(cls)) return false;
    return true;
  }

  function isElementVisible(el) {
    if (!el || typeof el.getBoundingClientRect !== 'function') return true;
    const style = typeof getComputedStyle === 'function' ? getComputedStyle(el) : null;
    if (style && (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0')) {
      return false;
    }
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function isStyleHidden(el) {
    if (!el || typeof getComputedStyle !== 'function') return false;
    const style = getComputedStyle(el);
    return style.display === 'none' || style.visibility === 'hidden';
  }

  function getAssociatedLabel(el, doc = document) {
    if (!el) return null;
    if (el.id && doc.querySelector) {
      try {
        const lbl = doc.querySelector(`label[for="${cssEscape(el.id)}"]`);
        if (lbl) return lbl;
      } catch {
        // ignore invalid selector
      }
    }
    if (el.closest) {
      const parentLabel = el.closest('label');
      if (parentLabel) return parentLabel;
    }
    return null;
  }

  function isElementInteractable(el, doc = document) {
    if (!el) return false;
    if (isElementVisible(el)) return true;

    const tag = (el.tagName || '').toLowerCase();
    // Custom checkboxes/radios/inputs often hide the native <input> (display:none, opacity:0, or 0x0)
    // and render the clickable control via <label for="..."> or a visible wrapper.
    if (tag === 'input') {
      const assocLabel = getAssociatedLabel(el, doc);
      if (assocLabel && !isStyleHidden(assocLabel)) {
        if (isElementVisible(assocLabel)) return true;
        // Empty <label></label> styled via ::before/::after inside a visible parent
        if (assocLabel.parentElement && isElementVisible(assocLabel.parentElement)) {
          return true;
        }
      }
      // Input with opacity: 0 / sr-only inside a visible container
      const style = typeof getComputedStyle === 'function' ? getComputedStyle(el) : null;
      if (style && style.display !== 'none' && style.visibility !== 'hidden') {
        if (el.parentElement && isElementVisible(el.parentElement)) {
          return true;
        }
      }
    }
    return false;
  }

  function isUnique(selector, doc) {
    try {
      return doc.querySelectorAll(selector).length === 1;
    } catch {
      return false;
    }
  }

  function resolveSemanticElement(rawEl, doc = document) {
    if (!rawEl || rawEl.nodeType !== 1) return null;
    if (rawEl.closest && rawEl.closest('[data-ca-ignore="true"]')) return null;

    // Clicking a <label> for a checkbox/radio should resolve to the underlying input
    const labelEl = rawEl.closest ? rawEl.closest('label') : null;
    if (labelEl) {
      let associated = null;
      if (labelEl.htmlFor) {
        associated = doc.getElementById(labelEl.htmlFor);
      } else if (labelEl.querySelector) {
        associated = labelEl.querySelector('input, select, textarea');
      }
      if (associated && (associated.type === 'checkbox' || associated.type === 'radio')) {
        return associated;
      }
    }

    // Clicking an icon/span inside a button/link/role should resolve to the interactive control
    if (rawEl.closest) {
      const interactive = rawEl.closest(
        'button, a[href], [role="button"], [role="checkbox"], [role="menuitem"], [role="tab"], input, select, textarea'
      );
      if (interactive) return interactive;
    }

    return rawEl;
  }

  function getElementLabel(el, doc = document) {
    if (!el) return '';
    const aria = el.getAttribute?.('aria-label');
    if (aria && aria.trim()) return aria.trim();

    const labelledBy = el.getAttribute?.('aria-labelledby');
    if (labelledBy && doc.getElementById) {
      const ref = doc.getElementById(labelledBy.split(/\s+/)[0]);
      if (ref && ref.textContent?.trim()) return ref.textContent.trim().slice(0, 80);
    }

    if (el.id && doc.querySelector) {
      try {
        const lbl = doc.querySelector(`label[for="${cssEscape(el.id)}"]`);
        if (lbl && lbl.textContent?.trim()) return lbl.textContent.trim().slice(0, 80);
      } catch {
        // ignore invalid selector
      }
    }

    const parentLabel = el.closest?.('label');
    if (parentLabel && parentLabel.textContent?.trim()) {
      return parentLabel.textContent.trim().replace(/\s+/g, ' ').slice(0, 80);
    }

    const placeholder = el.getAttribute?.('placeholder');
    if (placeholder && placeholder.trim()) return placeholder.trim().slice(0, 80);

    const title = el.getAttribute?.('title');
    if (title && title.trim()) return title.trim().slice(0, 80);

    const name = el.getAttribute?.('name');
    if (name && name.trim()) return name.trim().slice(0, 80);

    return '';
  }

  function getElementText(el) {
    if (!el) return '';
    const tag = (el.tagName || '').toLowerCase();
    if (tag === 'input' && (el.type === 'submit' || el.type === 'button' || el.type === 'reset')) {
      return (el.value || '').trim().slice(0, 80);
    }
    if (tag === 'input' || tag === 'textarea' || tag === 'select') {
      return '';
    }
    return (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 80);
  }

  function buildStructuralSelector(el, doc = document) {
    const parts = [];
    let current = el;
    let depth = 0;

    while (current && current.nodeType === 1 && depth < 7) {
      const tag = current.tagName.toLowerCase();
      if (tag === 'html' || tag === 'body') break;

      if (current.id && isStableId(current.id)) {
        const idSel = `#${cssEscape(current.id)}`;
        if (isUnique(idSel, doc)) {
          parts.unshift(idSel);
          break;
        }
      }

      const testId =
        current.getAttribute?.('data-testid') ||
        current.getAttribute?.('data-test') ||
        current.getAttribute?.('data-cy');
      if (testId) {
        const attrName = current.hasAttribute('data-testid')
          ? 'data-testid'
          : current.hasAttribute('data-test')
            ? 'data-test'
            : 'data-cy';
        const testSel = `${tag}[${attrName}="${cssEscape(testId)}"]`;
        if (isUnique(testSel, doc)) {
          parts.unshift(testSel);
          break;
        }
      }

      let segment = tag;
      const classes = Array.from(current.classList || []).filter(isStableClass).slice(0, 2);
      if (classes.length > 0) {
        segment += '.' + classes.map(cssEscape).join('.');
      }

      const parent = current.parentElement;
      if (parent) {
        const sameTagSiblings = Array.from(parent.children || []).filter(
          (c) => c.tagName === current.tagName
        );
        if (sameTagSiblings.length > 1) {
          const idx = sameTagSiblings.indexOf(current) + 1;
          segment += `:nth-of-type(${idx})`;
        }
      }

      parts.unshift(segment);
      const candidate = parts.join(' > ');
      if (isUnique(candidate, doc)) {
        return candidate;
      }

      current = parent;
      depth++;
    }

    return parts.join(' > ');
  }

  function buildTableColumnSelector(el) {
    const td = el.closest?.('td, th');
    const tr = td?.closest?.('tr');
    if (!td || !tr) return '';
    const cells = Array.from(tr.children || []);
    const colIdx = cells.indexOf(td) + 1;
    if (colIdx <= 0) return '';
    const tag = el.tagName.toLowerCase();
    const typeAttr = tag === 'input' && el.type ? `[type="${cssEscape(el.type)}"]` : '';
    return `tbody tr td:nth-child(${colIdx}) ${tag}${typeAttr}`;
  }

  function buildTarget(rawEl, doc = document) {
    const el = resolveSemanticElement(rawEl, doc) || rawEl;
    const tag = (el.tagName || '').toLowerCase();
    const inputType = tag === 'input' ? (el.type || 'text').toLowerCase() : '';
    const label = getElementLabel(el, doc);
    const text = getElementText(el);

    const candidates = [];

    // 1. Test IDs
    for (const attr of ['data-testid', 'data-test', 'data-cy']) {
      const val = el.getAttribute?.(attr);
      if (val) {
        const sel = `[${attr}="${cssEscape(val)}"]`;
        if (isUnique(sel, doc)) candidates.push(sel);
      }
    }

    // 2. Stable ID
    if (el.id && isStableId(el.id)) {
      const sel = `#${cssEscape(el.id)}`;
      if (isUnique(sel, doc)) candidates.push(sel);
    }

    // 3. Form attributes (name, aria-label, placeholder)
    const nameAttr = el.getAttribute?.('name');
    if (nameAttr) {
      const sel = `${tag}${inputType ? `[type="${cssEscape(inputType)}"]` : ''}[name="${cssEscape(nameAttr)}"]`;
      if (isUnique(sel, doc)) candidates.push(sel);
    }

    const ariaLabel = el.getAttribute?.('aria-label');
    if (ariaLabel) {
      const sel = `${tag}[aria-label="${cssEscape(ariaLabel)}"]`;
      if (isUnique(sel, doc)) candidates.push(sel);
    }

    const placeholder = el.getAttribute?.('placeholder');
    if (placeholder) {
      const sel = `${tag}[placeholder="${cssEscape(placeholder)}"]`;
      if (isUnique(sel, doc)) candidates.push(sel);
    }

    // 4. Structural path
    const structural = buildStructuralSelector(el, doc);
    if (structural) candidates.push(structural);

    // 5. Table column selector (very helpful for checkboxes in filtered tables!)
    const tableCol = buildTableColumnSelector(el);
    if (tableCol) candidates.push(tableCol);

    // Deduplicate preserving order
    const uniqueCandidates = Array.from(new Set(candidates.filter(Boolean)));
    const primary = uniqueCandidates[0] || tag;
    const fallbacks = uniqueCandidates.slice(1);

    return {
      primary,
      fallbacks,
      tag,
      inputType,
      label,
      text,
    };
  }

  function pickBestMatch(elements, doc = document) {
    if (!elements || elements.length === 0) return null;
    for (const el of elements) {
      if (el.closest && el.closest('[data-ca-ignore="true"]')) continue;
      if (isElementInteractable(el, doc)) return el;
    }
    return null;
  }

  function findInDocument(target, doc) {
    const selectors = [target.primary, ...(target.fallbacks || [])].filter(Boolean);
    for (const sel of selectors) {
      try {
        const matches = Array.from(doc.querySelectorAll(sel));
        const picked = pickBestMatch(matches, doc);
        if (picked) return picked;
      } catch {
        // invalid CSS selector (e.g. during user edit), continue to fallbacks
      }
    }

    // Fallback by visible text for buttons/links/clickables
    if (target.text) {
      const wanted = target.text.trim().toLowerCase();
      const poolSelector = target.tag
        ? target.tag
        : 'button, a, [role="button"], input[type="submit"], input[type="button"]';
      try {
        const els = Array.from(doc.querySelectorAll(poolSelector));
        const exact = els.find((el) => {
          if (el.closest?.('[data-ca-ignore="true"]')) return false;
          const t = getElementText(el).toLowerCase();
          return t === wanted && isElementInteractable(el, doc);
        });
        if (exact) return exact;

        const partial = els.find((el) => {
          if (el.closest?.('[data-ca-ignore="true"]')) return false;
          const t = getElementText(el).toLowerCase();
          return t.includes(wanted) && isElementInteractable(el, doc);
        });
        if (partial) return partial;
      } catch {
        // ignore
      }
    }

    // Fallback by label / aria-label / placeholder
    if (target.label) {
      const wantedLabel = target.label.trim().toLowerCase();
      const labels = Array.from(doc.querySelectorAll('label'));
      for (const lbl of labels) {
        const txt = (lbl.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase();
        if (txt === wantedLabel || txt.includes(wantedLabel)) {
          if (lbl.htmlFor) {
            const linked = doc.getElementById(lbl.htmlFor);
            if (linked && isElementInteractable(linked, doc)) return linked;
          }
          const nested = lbl.querySelector('input, select, textarea');
          if (nested && isElementInteractable(nested, doc)) return nested;
        }
      }
    }

    // Last-resort DOM match even if hidden (e.g. non-visual custom controls)
    for (const sel of selectors) {
      try {
        const match = doc.querySelector(sel);
        if (match && !match.closest?.('[data-ca-ignore="true"]')) return match;
      } catch {
        // ignore
      }
    }

    return null;
  }

  function findElement(target, doc = document) {
    if (!target) return null;
    const direct = findInDocument(target, doc);
    if (direct) return direct;

    // Also inspect accessible same-origin iframes if any exist
    if (doc.querySelectorAll) {
      try {
        const frames = Array.from(doc.querySelectorAll('iframe, frame'));
        for (const frame of frames) {
          try {
            const frameDoc = frame.contentDocument;
            if (frameDoc) {
              const found = findInDocument(target, frameDoc);
              if (found) return found;
            }
          } catch {
            // Cross-origin frame, ignore
          }
        }
      } catch {
        // ignore
      }
    }

    return null;
  }

  function getVisualTarget(el, doc = document) {
    if (!el) return el;
    if (!isElementVisible(el)) {
      const assocLabel = getAssociatedLabel(el, el.ownerDocument || doc);
      if (assocLabel) return assocLabel;
    }
    return el;
  }

  function highlightElement(el, color = '#6366f1', durationMs = 1600) {
    if (!el || typeof document === 'undefined') return;
    const visualEl = getVisualTarget(el, el.ownerDocument || document);
    try {
      visualEl.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' });
    } catch {
      // ignore
    }
    const rect = visualEl.getBoundingClientRect();
    const box = document.createElement('div');
    box.setAttribute('data-ca-ignore', 'true');
    Object.assign(box.style, {
      position: 'fixed',
      left: `${Math.max(0, rect.left - 3)}px`,
      top: `${Math.max(0, rect.top - 3)}px`,
      width: `${Math.max(16, rect.width + 6)}px`,
      height: `${Math.max(16, rect.height + 6)}px`,
      border: `3px solid ${color}`,
      backgroundColor: 'rgba(99, 102, 241, 0.14)',
      borderRadius: '6px',
      zIndex: '2147483647',
      pointerEvents: 'none',
      boxSizing: 'border-box',
      transition: 'opacity 0.25s ease',
    });
    document.documentElement.appendChild(box);
    setTimeout(() => {
      box.style.opacity = '0';
      setTimeout(() => box.remove(), 260);
    }, durationMs);
  }

  ns.selector = {
    cssEscape,
    isStableId,
    isStableClass,
    isElementVisible,
    isElementInteractable,
    getAssociatedLabel,
    getVisualTarget,
    resolveSemanticElement,
    getElementLabel,
    getElementText,
    buildTarget,
    findElement,
    highlightElement,
  };
})(typeof window !== 'undefined' ? window : globalThis);

