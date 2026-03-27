// ==UserScript==
// @name         Yamibo Batch Upload
// @namespace    https://bbs.yamibo.com/userscripts
// @version      0.5.0
// @description  Adds batch file selection to Yamibo's attachment uploader.
// @match        https://bbs.yamibo.com/forum.php*
// @run-at       document-idle
// @grant        none
// @noframes
// ==/UserScript==

(function () {
  'use strict';

  const PANEL_ID = 'gm-yamibo-batch-panel';
  const STYLE_ID = 'gm-yamibo-batch-style';
  const MAX_RETRIES = 2;
  const MIN_PANEL_WIDTH = 420;
  const MIN_PANEL_HEIGHT = 360;

  const state = {
    logLines: [],
    elements: {},
    mode: 'img',
    outputItems: [],
    pendingRefresh: null,
    uploadHookInstalled: false,
    finalizeTimer: null,
    imageBatch: {
      active: false,
      items: [],
    },
  };

  function log(message) {
    const stamp = new Date().toLocaleTimeString();
    state.logLines.push(`[${stamp}] ${message}`);
    state.logLines = state.logLines.slice(-200);

    if (state.elements.log) {
      state.elements.log.value = state.logLines.join('\n');
      state.elements.log.scrollTop = state.elements.log.scrollHeight;
    }
  }

  function $(id) {
    return document.getElementById(id);
  }

  function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
  }

  function notifyUser(message, type) {
    if (typeof window.showDialog === 'function') {
      window.showDialog(message, type || 'notice', null, null, 0, null, null, null, null, 6);
      return;
    }

    window.alert(message);
  }

  function prefixIndex(prefix) {
    return prefix ? 1 : 0;
  }

  function ensureStyles() {
    if ($(STYLE_ID)) {
      return;
    }

    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      #${PANEL_ID} {
        position: fixed;
        right: 16px;
        bottom: 16px;
        z-index: 2147483647;
        width: 1080px;
        height: 620px;
        min-width: ${MIN_PANEL_WIDTH}px;
        min-height: ${MIN_PANEL_HEIGHT}px;
        max-width: calc(100vw - 32px);
        max-height: calc(100vh - 32px);
        background: rgba(15, 23, 42, 0.96);
        color: #e5eefc;
        border: 1px solid rgba(148, 163, 184, 0.35);
        border-radius: 14px;
        box-shadow: 0 18px 40px rgba(15, 23, 42, 0.35);
        font: 13px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        overflow: auto;
      }

      #${PANEL_ID} * {
        box-sizing: border-box;
      }

      #${PANEL_ID} .gmyb-header {
        padding: 12px 14px 10px 34px;
        font-weight: 700;
        font-size: 14px;
        border-bottom: 1px solid rgba(148, 163, 184, 0.18);
      }

      #${PANEL_ID} .gmyb-resize {
        position: absolute;
        top: 10px;
        left: 10px;
        width: 14px;
        height: 14px;
        border-radius: 4px;
        border: 1px solid rgba(148, 163, 184, 0.35);
        background:
          linear-gradient(135deg, transparent 32%, rgba(191, 209, 238, 0.8) 32%, rgba(191, 209, 238, 0.8) 40%, transparent 40%),
          linear-gradient(135deg, transparent 54%, rgba(191, 209, 238, 0.8) 54%, rgba(191, 209, 238, 0.8) 62%, transparent 62%);
        cursor: nwse-resize;
      }

      #${PANEL_ID} .gmyb-body {
        padding: 12px 14px 14px;
        display: grid;
        gap: 10px;
        height: calc(100% - 46px);
      }

      #${PANEL_ID} .gmyb-layout {
        display: grid;
        grid-template-columns: minmax(220px, 0.85fr) minmax(260px, 1fr) minmax(260px, 1fr);
        gap: 14px;
        align-items: stretch;
        height: 100%;
      }

      #${PANEL_ID} .gmyb-col {
        display: grid;
        gap: 12px;
        min-width: 0;
        min-height: 0;
      }

      #${PANEL_ID} .gmyb-col-fill {
        grid-template-rows: auto auto minmax(0, 1fr) auto auto;
      }

      #${PANEL_ID} .gmyb-section-title {
        font-weight: 700;
        color: #eff6ff;
      }

      #${PANEL_ID} .gmyb-row {
        display: grid;
        gap: 6px;
      }

      #${PANEL_ID} .gmyb-muted,
      #${PANEL_ID} .gmyb-stats {
        color: #bfd1ee;
      }

      #${PANEL_ID} select,
      #${PANEL_ID} textarea,
      #${PANEL_ID} button {
        border-radius: 10px;
        border: 1px solid rgba(148, 163, 184, 0.32);
      }

      #${PANEL_ID} select,
      #${PANEL_ID} textarea {
        width: 100%;
        background: rgba(15, 23, 42, 0.84);
        color: #eff6ff;
        padding: 8px 10px;
      }

      #${PANEL_ID} textarea {
        min-height: 170px;
        resize: none;
        overflow: auto;
        font: 12px/1.45 Consolas, "SFMono-Regular", monospace;
      }

      #${PANEL_ID} .gmyb-grow {
        min-height: 0;
        height: 100%;
      }

      #${PANEL_ID} .gmyb-output-list {
        display: grid;
        gap: 0;
        overflow: auto;
        border: 1px solid rgba(148, 163, 184, 0.22);
        border-radius: 10px;
        background: rgba(15, 23, 42, 0.52);
      }

      #${PANEL_ID} .gmyb-output-empty {
        padding: 10px;
        color: #9fb4d6;
      }

      #${PANEL_ID} .gmyb-output-item {
        display: grid;
        grid-template-columns: 1fr auto;
        gap: 10px;
        align-items: start;
        padding: 10px;
        border-bottom: 1px solid rgba(148, 163, 184, 0.14);
      }

      #${PANEL_ID} .gmyb-output-item:last-child {
        border-bottom: 0;
      }

      #${PANEL_ID} .gmyb-output-meta {
        display: grid;
        gap: 4px;
        min-width: 0;
      }

      #${PANEL_ID} .gmyb-output-name {
        font-weight: 600;
        color: #eff6ff;
        word-break: break-word;
      }

      #${PANEL_ID} .gmyb-output-tag {
        color: #9fb4d6;
        font: 12px/1.45 Consolas, "SFMono-Regular", monospace;
        word-break: break-all;
      }

      #${PANEL_ID} .gmyb-output-actions {
        display: grid;
        gap: 6px;
        grid-template-columns: repeat(2, minmax(52px, 1fr));
        align-self: center;
      }

      #${PANEL_ID} .gmyb-output-actions button {
        min-width: 52px;
        padding: 6px 8px;
      }

      #${PANEL_ID} button {
        background: linear-gradient(180deg, #1d4ed8, #1e40af);
        color: #eff6ff;
        padding: 8px 10px;
        cursor: pointer;
      }

      #${PANEL_ID} button.gmyb-secondary {
        background: rgba(30, 41, 59, 0.88);
      }

      #${PANEL_ID} button:hover {
        filter: brightness(1.08);
      }

      #${PANEL_ID} .gmyb-actions {
        display: flex;
        gap: 8px;
        flex-wrap: wrap;
      }

      @media (max-width: 820px) {
        #${PANEL_ID} .gmyb-layout {
          grid-template-columns: 1fr;
          height: auto;
        }

        #${PANEL_ID} .gmyb-body {
          height: auto;
        }

        #${PANEL_ID} .gmyb-col-fill {
          grid-template-rows: auto auto minmax(220px, auto) auto auto;
        }
      }
    `;

    document.head.appendChild(style);
  }

  function modeLabel(prefix) {
    return prefix === 'img' ? 'image' : 'attachment';
  }

  function slotPrefix(prefix) {
    return prefix + 'attachnew_';
  }

  function rowPrefix(prefix) {
    return prefix + 'localno_';
  }

  function collectIds(base) {
    return Array.from(document.querySelectorAll(`[id^="${base}"]`)).reduce(function (ids, node) {
      const match = node.id.match(/_(\d+)$/);
      if (match) {
        ids.push(Number(match[1]));
      }
      return ids;
    }, []);
  }

  function maxSlotId(prefix) {
    const ids = collectIds(slotPrefix(prefix));
    if (!ids.length) {
      return 0;
    }
    return Math.max.apply(Math, ids);
  }

  function normalizeAid(prefix) {
    if (typeof window.AID !== 'object' || typeof window.addAttach !== 'function') {
      return;
    }

    const index = prefixIndex(prefix);
    const currentMax = maxSlotId(prefix);
    const wanted = Math.max(1, currentMax + 1);

    if (!window.AID[index] || window.AID[index] <= currentMax) {
      window.AID[index] = wanted;
    }

    if (!currentMax) {
      window.addAttach(prefix);
      window.AID[index] = Math.max(window.AID[index], maxSlotId(prefix) + 1);
    }
  }

  function findEmptyInput(prefix) {
    const nodes = Array.from(document.querySelectorAll(`[id^="${slotPrefix(prefix)}"]`));
    return nodes.find(function (node) {
      return !node.value;
    }) || null;
  }

  function currentQueueCount(prefix) {
    return collectIds(rowPrefix(prefix)).length;
  }

  function uploadStateText() {
    if (window.UPLOADSTATUS === 1) {
      return 'uploading';
    }
    if (window.UPLOADSTATUS === 0) {
      return 'queued';
    }
    if (window.UPLOADSTATUS === 2) {
      return 'idle';
    }
    return 'ready';
  }

  function currentAttachInfo() {
    if (typeof window.CURRENTATTACH !== 'string' || !window.CURRENTATTACH.includes('|')) {
      return null;
    }

    const parts = window.CURRENTATTACH.split('|');
    const id = Number(parts[0]);
    if (!Number.isFinite(id) || id <= 0) {
      return null;
    }

    return {
      id: id,
      prefix: parts[1] || '',
    };
  }

  function statusMessage(statusId) {
    const messageMap = window.STATUSMSG || {};
    if (Object.prototype.hasOwnProperty.call(messageMap, String(statusId))) {
      return messageMap[String(statusId)];
    }
    return 'status ' + statusId;
  }

  function readFrameResponse() {
    const frame = $('attachframe');
    const body = frame && frame.contentWindow && frame.contentWindow.document && frame.contentWindow.document.body;
    const text = body ? (body.textContent || body.innerText || body.innerHTML || '').trim() : '';
    if (!text) {
      return null;
    }

    const parts = text.split('|');
    return {
      parts: parts,
      statusId: parts[0] === 'DISCUZUPLOAD' ? Number(parts[1]) : -1,
    };
  }

  function getQueuedFileName(prefix, id) {
    const input = $(`${prefix}attachnew_${id}`);
    if (!input) {
      return '';
    }

    if (input.files && input.files.length) {
      return input.files[0].name;
    }

    const rawValue = input.value || '';
    if (!rawValue) {
      return '';
    }

    return rawValue.split(/[/\\]/).pop() || '';
  }

  function setOutputText(text) {
    if (state.elements.output) {
      state.elements.output.value = text || '';
    }
  }

  function outputTextFromItems() {
    return state.outputItems.map(function (item) {
      return `[attachimg]${item.aid}[/attachimg]`;
    }).join('\n');
  }

  function splitFileName(fileName) {
    const full = String(fileName || '').trim();
    const match = full.match(/^(.*?)(\.[^.]+)?$/);
    return {
      base: match ? (match[1] || '') : '',
      ext: match ? (match[2] || '') : '',
      full: full,
    };
  }

  function createOutputButton(label, action, index, disabled) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'gmyb-secondary';
    button.textContent = label;
    button.disabled = disabled;
    button.dataset.action = action;
    button.dataset.index = String(index);
    return button;
  }

  function renderOutputItems() {
    if (!state.elements.outputList) {
      setOutputText(outputTextFromItems());
      return;
    }

    state.elements.outputList.innerHTML = '';

    if (!state.outputItems.length) {
      const empty = document.createElement('div');
      empty.className = 'gmyb-output-empty';
      empty.textContent = 'Uploaded images will appear here with filenames so you can reorder them before copying.';
      state.elements.outputList.appendChild(empty);
      setOutputText('');
      return;
    }

    state.outputItems.forEach(function (item, index) {
      const row = document.createElement('div');
      row.className = 'gmyb-output-item';

      const meta = document.createElement('div');
      meta.className = 'gmyb-output-meta';

      const name = document.createElement('div');
      name.className = 'gmyb-output-name';
      name.textContent = `${index + 1}. ${item.fileName || ('Image ' + (index + 1))}`;

      const tag = document.createElement('div');
      tag.className = 'gmyb-output-tag';
      tag.textContent = `[attachimg]${item.aid}[/attachimg]`;

      const actions = document.createElement('div');
      actions.className = 'gmyb-output-actions';

      actions.appendChild(createOutputButton('Top', 'top', index, index === 0));
      actions.appendChild(createOutputButton('Bottom', 'bottom', index, index === state.outputItems.length - 1));
      actions.appendChild(createOutputButton('Up', 'up', index, index === 0));
      actions.appendChild(createOutputButton('Down', 'down', index, index === state.outputItems.length - 1));
      meta.appendChild(name);
      meta.appendChild(tag);
      row.appendChild(meta);
      row.appendChild(actions);
      state.elements.outputList.appendChild(row);
    });

    setOutputText(outputTextFromItems());
  }

  function moveOutputItem(index, direction) {
    const nextIndex = index + direction;
    if (index < 0 || nextIndex < 0 || index >= state.outputItems.length || nextIndex >= state.outputItems.length) {
      return;
    }

    const moved = state.outputItems[index];
    state.outputItems[index] = state.outputItems[nextIndex];
    state.outputItems[nextIndex] = moved;
    renderOutputItems();
  }

  function moveOutputItemTo(index, targetIndex) {
    if (index < 0 || targetIndex < 0 || index >= state.outputItems.length || targetIndex >= state.outputItems.length || index === targetIndex) {
      return;
    }

    const moved = state.outputItems.splice(index, 1)[0];
    state.outputItems.splice(targetIndex, 0, moved);
    renderOutputItems();
  }

  function sortOutputItemsByFileName() {
    if (state.outputItems.length < 2) {
      return;
    }

    state.outputItems.sort(function (left, right) {
      const leftParts = splitFileName(left.fileName);
      const rightParts = splitFileName(right.fileName);

      const baseCompare = leftParts.base.localeCompare(rightParts.base, undefined, {
        numeric: true,
        sensitivity: 'base',
      });
      if (baseCompare !== 0) {
        return baseCompare;
      }

      const extCompare = leftParts.ext.localeCompare(rightParts.ext, undefined, {
        numeric: true,
        sensitivity: 'base',
      });
      if (extCompare !== 0) {
        return extCompare;
      }

      return leftParts.full.localeCompare(rightParts.full, undefined, {
        numeric: true,
        sensitivity: 'base',
      });
    });
    renderOutputItems();
    log('Sorted generated tags by original filename.');
  }

  function clearOutputItems() {
    state.outputItems = [];
    renderOutputItems();
    log('Cleared generated tags.');
  }

  function startPanelResize(event) {
    if (!state.elements.panel) {
      return;
    }

    event.preventDefault();

    const panel = state.elements.panel;
    const rect = panel.getBoundingClientRect();
    const startX = event.clientX;
    const startY = event.clientY;
    const startWidth = rect.width;
    const startHeight = rect.height;

    function onMove(moveEvent) {
      const nextWidth = clamp(startWidth - (moveEvent.clientX - startX), MIN_PANEL_WIDTH, window.innerWidth - 32);
      const nextHeight = clamp(startHeight - (moveEvent.clientY - startY), MIN_PANEL_HEIGHT, window.innerHeight - 32);
      panel.style.width = `${nextWidth}px`;
      panel.style.height = `${nextHeight}px`;
    }

    function onUp() {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    }

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }

  function resetImageBatch() {
    if (state.finalizeTimer) {
      window.clearTimeout(state.finalizeTimer);
      state.finalizeTimer = null;
    }
    state.imageBatch = {
      active: false,
      items: [],
    };
  }

  function getOrCreateBatchItem(slotId, fileName) {
    let item = state.imageBatch.items.find(function (entry) {
      return entry.slotId === slotId;
    }) || null;

    if (item) {
      if (fileName && !item.fileName) {
        item.fileName = fileName;
      }
      return item;
    }

    item = {
      slotId: slotId,
      fileName: fileName || '',
      retries: 0,
      completed: false,
      failed: false,
      errorMessage: '',
      aid: null,
    };
    state.imageBatch.items.push(item);
    return item;
  }

  function extractAidFromResponse(parts) {
    const candidates = parts.slice(2)
      .map(function (part) {
        return Number(part);
      })
      .filter(function (value) {
        return Number.isInteger(value) && value > 0;
      });

    return candidates.length ? candidates[0] : null;
  }

  function finalizeImageBatch(attempt) {
    const batch = state.imageBatch;
    if (!batch.active) {
      return;
    }

    if (batch.items.some(function (item) { return !item.completed && !item.failed; })) {
      scheduleImageBatchFinalize((attempt || 0) + 1);
      return;
    }

    if (window.UPLOADSTATUS !== 2 || window.CURRENTATTACH !== '0') {
      scheduleImageBatchFinalize((attempt || 0) + 1);
      return;
    }

    const failedItems = batch.items.filter(function (item) {
      return item.failed;
    });

    if (failedItems.length) {
      const detail = failedItems.map(function (item) {
        return `${item.fileName || ('slot ' + item.slotId)} (${item.errorMessage || 'failed'})`;
      }).join(', ');
      log('Image batch finished with failures: ' + detail);
      notifyUser('Some image uploads still failed after retry: ' + detail, 'notice');
      resetImageBatch();
      scheduleRefresh();
      return;
    }

    const orderedAids = batch.items.map(function (item) {
      return item.aid;
    }).filter(function (aid) {
      return Number.isInteger(aid) && aid > 0;
    });

    if (orderedAids.length !== batch.items.length) {
      if ((attempt || 0) < 20) {
        scheduleImageBatchFinalize((attempt || 0) + 1);
        return;
      }

      log('Image uploads finished, but the new attachment IDs could not be resolved automatically.');
      notifyUser('Images uploaded, but the script could not resolve all attachment IDs for auto insertion.', 'notice');
      resetImageBatch();
      scheduleRefresh();
      return;
    }

    const uploadedItems = batch.items.map(function (item, index) {
      return {
        fileName: item.fileName || ('Image ' + (index + 1)),
        aid: item.aid,
      };
    });

    state.outputItems = state.outputItems.concat(uploadedItems);
    renderOutputItems();
    log(`Prepared ${uploadedItems.length} uploaded image tag(s). Reorder them by filename in the panel before copying if needed.`);
    notifyUser(`All ${uploadedItems.length} image(s) uploaded. Reorder them by filename in the panel, then copy and paste the generated tags.`, 'right');
    resetImageBatch();
    scheduleRefresh();
  }

  function scheduleImageBatchFinalize(attempt) {
    if (state.finalizeTimer) {
      return;
    }

    state.finalizeTimer = window.setTimeout(function () {
      state.finalizeTimer = null;
      finalizeImageBatch(attempt || 0);
    }, 350);
  }

  function installUploadHook() {
    if (state.uploadHookInstalled || typeof window.uploadNextAttach !== 'function') {
      return;
    }

    const originalUploadNextAttach = window.uploadNextAttach;
    window.uploadNextAttach = function () {
      const info = currentAttachInfo();
      const batch = state.imageBatch;

      if (!batch.active || !info || info.prefix !== 'img') {
        return originalUploadNextAttach.apply(this, arguments);
      }

      const response = readFrameResponse();
      if (!response) {
        return originalUploadNextAttach.apply(this, arguments);
      }
      const parts = response.parts;
      const statusId = response.statusId;
      const item = getOrCreateBatchItem(info.id, getQueuedFileName('img', info.id));
      const fileName = item.fileName || ('slot ' + info.id);
      const message = statusMessage(statusId);

      if (statusId === 0) {
        item.completed = true;
        item.failed = false;
        item.errorMessage = '';
        item.aid = item.aid || extractAidFromResponse(parts);
        log(`Uploaded: ${fileName}`);
        const result = originalUploadNextAttach.apply(this, arguments);
        scheduleRefresh();
        scheduleImageBatchFinalize(0);
        return result;
      }

      if (item.retries < MAX_RETRIES) {
        item.retries += 1;
        log(`Retrying ${fileName} (${item.retries}/${MAX_RETRIES}) after ${message}.`);
        const statusCell = $('imgcpdel_' + info.id);
        if (statusCell) {
          statusCell.innerHTML = '<div class="loadicon" title="Retrying upload..."></div>';
        }
        window.UPLOADSTATUS = 1;
        const form = $('imgattachform_' + info.id);
        if (form) {
          form.submit();
          scheduleRefresh();
          return;
        }
      }

      item.failed = true;
      item.errorMessage = message;
      log(`Upload failed: ${fileName} (${message})`);
      const result = originalUploadNextAttach.apply(this, arguments);
      scheduleRefresh();
      scheduleImageBatchFinalize(0);
      return result;
    };

    state.uploadHookInstalled = true;
  }

  function refreshStats() {
    if (!state.elements.stats) {
      return;
    }

    const prefix = state.mode;
    const queueCount = currentQueueCount(prefix);
    const failed = Number(window.UPLOADFAILED || 0);
    const complete = Number(window.UPLOADCOMPLETE || 0);

    state.elements.stats.textContent =
      `${modeLabel(prefix)} queue: ${queueCount} | status: ${uploadStateText()} | done: ${complete} | failed: ${failed}`;
  }

  function scheduleRefresh() {
    if (state.pendingRefresh) {
      return;
    }

    state.pendingRefresh = window.setTimeout(function () {
      state.pendingRefresh = null;
      refreshStats();
    }, 50);
  }

  function ensurePlainUploadMode(prefix) {
    try {
      if (prefix === 'img' && typeof window.switchImagebutton === 'function') {
        window.switchImagebutton('local');
      } else if (!prefix && typeof window.switchAttachbutton === 'function') {
        window.switchAttachbutton('upload');
      }
    } catch (error) {
      log('Mode switch warning: ' + (error && error.message ? error.message : String(error)));
    }
  }

  function assignFileToInput(input, file) {
    if (!input || !file || typeof DataTransfer !== 'function') {
      return false;
    }

    const transfer = new DataTransfer();
    transfer.items.add(file);

    try {
      input.files = transfer.files;
    } catch (error) {
      return false;
    }

    return input.files && input.files.length === 1 && input.files[0].name === file.name;
  }

  function fileNameFromCurrentAttach() {
    const info = currentAttachInfo();
    if (!info) {
      return '';
    }

    return getQueuedFileName(info.prefix, info.id);
  }

  function handleFrameLoad() {
    const current = currentAttachInfo();
    if (state.imageBatch.active && current && current.prefix === 'img') {
      return;
    }

    const response = readFrameResponse();
    if (!response || response.statusId < 0) {
      return;
    }

    const statusId = response.statusId;
    const fileName = fileNameFromCurrentAttach() || 'current file';
    const message = statusMessage(statusId);

    if (statusId === 0) {
      log(`Uploaded: ${fileName}`);
    } else {
      log(`Upload failed: ${fileName} (${message})`);
    }

    scheduleRefresh();
  }

  function ensureReady(prefix) {
    if (typeof window.addAttach !== 'function' || typeof window.insertAttach !== 'function' || typeof window.uploadAttach !== 'function') {
      log('Yamibo upload helpers are not ready on this page yet.');
      return false;
    }

    if (!$(`${prefix}attachbtnhidden`) || !$(`${prefix}attachbtn`) || !$('attachframe')) {
      log(`Could not find the ${modeLabel(prefix)} upload area on this page.`);
      return false;
    }

    ensurePlainUploadMode(prefix);
    normalizeAid(prefix);
    installUploadHook();
    scheduleRefresh();
    return true;
  }

  function queueFiles(prefix, files) {
    if (!ensureReady(prefix) || !files.length) {
      return;
    }

    if (prefix === 'img' && state.imageBatch.active) {
      log('Wait for the current image batch to finish before queueing more images.');
      return;
    }

    let queued = 0;

    files.forEach(function (file) {
      let input = findEmptyInput(prefix);
      if (!input) {
        normalizeAid(prefix);
        window.addAttach(prefix);
        input = findEmptyInput(prefix);
      }

      if (!input) {
        log(`Could not create a new ${modeLabel(prefix)} slot for ${file.name}.`);
        return;
      }

      if (!assignFileToInput(input, file)) {
        log(`Your browser blocked file injection for ${file.name}.`);
        return;
      }

      const idMatch = input.id.match(/_(\d+)$/);
      if (!idMatch) {
        log(`Could not determine slot id for ${file.name}.`);
        return;
      }

      window.insertAttach(prefix, Number(idMatch[1]));
      if (prefix === 'img') {
        getOrCreateBatchItem(Number(idMatch[1]), file.name);
      }
      queued += 1;
    });

    if (queued) {
      log(`Queued ${queued} ${modeLabel(prefix)} file(s).`);
      if (prefix === 'img') {
        state.imageBatch.active = true;
      }
      window.uploadAttach(0, 0, prefix);
      log(`Started ${modeLabel(prefix)} upload queue.`);
      scheduleRefresh();
      return;
    }

    scheduleRefresh();
  }

  function clearLog() {
    state.logLines = [];
    if (state.elements.log) {
      state.elements.log.value = '';
    }
    log('Log cleared.');
  }

  function ensurePanel() {
    if (!document.body || state.elements.panel) {
      return;
    }

    ensureStyles();

    const panel = document.createElement('section');
    panel.id = PANEL_ID;
    panel.innerHTML = `
      <div class="gmyb-resize" id="${PANEL_ID}-resize" title="Resize panel"></div>
      <div class="gmyb-header">Yamibo Batch Upload</div>
      <div class="gmyb-body">
        <div class="gmyb-layout">
          <div class="gmyb-col">
            <div class="gmyb-row">
              <div class="gmyb-section-title">1. Upload</div>
              <label for="${PANEL_ID}-mode">Upload target</label>
              <select id="${PANEL_ID}-mode">
                <option value="img">Images</option>
                <option value="">Attachments</option>
              </select>
            </div>
            <div class="gmyb-stats" id="${PANEL_ID}-stats">Waiting for Yamibo upload helpers...</div>
            <div class="gmyb-actions">
              <button id="${PANEL_ID}-pick" type="button">Choose Files</button>
            </div>
            <div class="gmyb-muted">Choose files and the site upload queue will start immediately. Failed image uploads are retried automatically.</div>
            <div class="gmyb-row">
              <label for="${PANEL_ID}-log">Activity</label>
              <textarea id="${PANEL_ID}-log" readonly></textarea>
            </div>
            <div class="gmyb-actions">
              <button id="${PANEL_ID}-clear" type="button" class="gmyb-secondary">Clear Log</button>
            </div>
          </div>
          <div class="gmyb-col gmyb-col-fill">
            <div class="gmyb-section-title">2. Arrange</div>
            <label>Uploaded Images</label>
            <div id="${PANEL_ID}-output-list" class="gmyb-output-list gmyb-grow"></div>
            <div class="gmyb-actions">
              <button id="${PANEL_ID}-sort" type="button" class="gmyb-secondary">Sort by Original Filename</button>
            </div>
            <div class="gmyb-muted">Rows show the original filename. Reorder here first.</div>
          </div>
          <div class="gmyb-col gmyb-col-fill">
            <div class="gmyb-section-title">3. Copy</div>
            <label for="${PANEL_ID}-output">Generated Tags</label>
            <textarea id="${PANEL_ID}-output" class="gmyb-grow" spellcheck="false" placeholder="Reorder the uploaded images in the middle, then copy these tags."></textarea>
            <div class="gmyb-actions">
              <button id="${PANEL_ID}-copy" type="button" class="gmyb-secondary">Copy Tags</button>
              <button id="${PANEL_ID}-clear-output" type="button" class="gmyb-secondary">Clear Tags</button>
            </div>
            <div class="gmyb-muted">The tags here always reflect the current order from the middle column.</div>
          </div>
        </div>
      </div>
    `;

    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.multiple = true;
    fileInput.style.display = 'none';

    document.body.appendChild(panel);
    document.body.appendChild(fileInput);

    state.elements = {
      panel: panel,
      resize: panel.querySelector('#' + PANEL_ID + '-resize'),
      mode: panel.querySelector('#' + PANEL_ID + '-mode'),
      stats: panel.querySelector('#' + PANEL_ID + '-stats'),
      pick: panel.querySelector('#' + PANEL_ID + '-pick'),
      copy: panel.querySelector('#' + PANEL_ID + '-copy'),
      sort: panel.querySelector('#' + PANEL_ID + '-sort'),
      clearOutput: panel.querySelector('#' + PANEL_ID + '-clear-output'),
      clear: panel.querySelector('#' + PANEL_ID + '-clear'),
      outputList: panel.querySelector('#' + PANEL_ID + '-output-list'),
      output: panel.querySelector('#' + PANEL_ID + '-output'),
      log: panel.querySelector('#' + PANEL_ID + '-log'),
      fileInput: fileInput,
    };

    state.elements.mode.value = state.mode;
    state.elements.resize.addEventListener('mousedown', startPanelResize);

    state.elements.mode.addEventListener('change', function () {
      state.mode = this.value;
      ensureReady(state.mode);
      refreshStats();
    });

    state.elements.pick.addEventListener('click', function () {
      state.elements.fileInput.accept = state.mode === 'img' ? '.jpg,.jpeg,.gif,.png' : '';
      state.elements.fileInput.click();
    });

    state.elements.fileInput.addEventListener('change', function () {
      queueFiles(state.mode, Array.from(this.files || []));
      this.value = '';
    });

    state.elements.outputList.addEventListener('click', function (event) {
      const button = event.target.closest('button[data-action]');
      if (!button) {
        return;
      }

      const index = Number(button.dataset.index);
      if (!Number.isInteger(index)) {
        return;
      }

      const actions = {
        up: function () { moveOutputItem(index, -1); },
        down: function () { moveOutputItem(index, 1); },
        top: function () { moveOutputItemTo(index, 0); },
        bottom: function () { moveOutputItemTo(index, state.outputItems.length - 1); },
      };

      if (actions[button.dataset.action]) {
        actions[button.dataset.action]();
      }
    });

    state.elements.copy.addEventListener('click', function () {
      const text = state.elements.output ? state.elements.output.value.trim() : '';
      if (!text) {
        log('No generated tags to copy yet.');
        return;
      }

      if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
        navigator.clipboard.writeText(text).then(function () {
          log('Copied generated tags to clipboard.');
        }).catch(function () {
          log('Clipboard copy failed. You can still copy the tags from the panel manually.');
        });
        return;
      }

      state.elements.output.focus();
      state.elements.output.select();
      log('Selected generated tags. Copy them manually if the browser does not copy automatically.');
    });

    state.elements.clearOutput.addEventListener('click', function () {
      clearOutputItems();
    });

    state.elements.sort.addEventListener('click', function () {
      sortOutputItemsByFileName();
    });

    state.elements.clear.addEventListener('click', function () {
      clearLog();
    });

    const frame = $('attachframe');
    if (frame) {
      frame.addEventListener('load', handleFrameLoad, true);
    }

    log('Batch panel ready.');
    ensureReady(state.mode);
    renderOutputItems();
    refreshStats();
  }

  ensurePanel();
})();
