/**
 * Codec Studio — orquestração da interface.
 *
 * Regras de ouro deste arquivo:
 *  1. Nenhuma requisição de rede, nenhum eval, nenhum innerHTML com dado do usuário.
 *  2. Todo texto do usuário entra no DOM via textContent ou nós de texto.
 *  3. A conversão é síncrona e local; o "tempo" mostrado é medição real.
 */

import { CodecError } from '../core/base64.js';
import {
  detectFileType, FILE_TYPES, isTextBytes, replaceExtension, sanitizeFileName, toDataUri,
} from '../core/files.js';
import { highlight } from './highlight.js';
import {
  applyTranslations, detectLanguage, formatMs, getLanguage,
  LANGUAGES, plural, refreshFormats, setLanguage, t,
} from './i18n.js';
import { createOptionsPanel, TARGET_OPTIONS } from './options.js';
import { loadPrefs, savePrefs } from './prefs.js';
import { getSurface, isValidPair, runConversion, SAMPLE_PDF_BASE64, SURFACES, targetsFor } from './surfaces.js';

/* ------------------------------------------------------------------ estado */

/** Padrões de cada formato de destino, espelhando os defaults do núcleo. */
const OPTION_DEFAULTS = {
  base64: { alphabet: 'standard', padding: true, wrap: false, dataUri: false },
  text: { strict: false },
  file: { strict: false },
  json: { values: 'example' },
  yaml: { values: 'example' },
  java: { style: 'record', packageName: '', jackson: true, jacksonAll: false, primitives: true, separateFiles: false },
  csharp: { style: 'class', namespaceName: '', jsonAttributes: true, jsonAttributesAll: false, nullableAnnotations: true },
  typescript: { style: 'interface', exportTypes: true, optionalMarker: true, readonlyFields: false, useDate: false },
  dart: { finalFields: true, jsonMethods: true, namedParameters: true },
  swift: { style: 'struct', codable: true, letConstants: true, codingKeys: true },
  go: { packageName: 'main', jsonTags: true, omitempty: true, pointerOptionals: true, useTime: true },
};

const DEFAULT_PREFS = {
  theme: 'dark',
  language: '', // vazio = seguir o idioma do navegador
  from: 'json',
  to: 'java',
  shared: { rootName: 'Root', detectDateTime: true },
  options: structuredClone(OPTION_DEFAULTS),
};

const prefs = loadPrefs(DEFAULT_PREFS);

/** Estado volátil (nunca persistido). */
const runtime = {
  output: '',
  highlight: 'plain',
  hasError: false,
  detectedTypes: [],
  rootType: '',
  /** Rascunho por formato de origem: trocar de formato não faz perder o texto. */
  drafts: {},
  /** Arquivo de entrada ({name, bytes, type, mime}): só em memória, nunca nas preferências. */
  file: null,
  /** Base64 grande demais para o editor; quando existe, substitui o conteúdo dele. */
  heldText: null,
  /** Resultado de Base64 → Arquivo. */
  decoded: null,
  /** O usuário editou o nome de saída, então ele não é mais gerado. */
  nameTouched: false,
  saveExt: '',
  detectedExt: '',
};

const AUTO_CONVERT_LIMIT = 400_000;
const MAX_FILE_BYTES = 100 * 1024 * 1024;
/** Acima disso o editor e o <pre> travam; o conteúdo segue inteiro na memória. */
const EDITABLE_CHARS = 2_000_000;
const OUTPUT_PREVIEW_CHARS = 200_000;
const IMAGE_PREVIEW_BYTES = 10 * 1024 * 1024;

/* -------------------------------------------------------------------- DOM */

const $ = (selector) => document.querySelector(selector);

const dom = {
  root: document.documentElement,
  fromSelect: $('#from-format'),
  toSelect: $('#to-format'),
  options: $('#options'),
  popover: $('#options-popover'),
  backdrop: $('#popover-backdrop'),
  optionsBtn: $('[data-action="options"]'),
  optionsCount: $('#options-count'),
  workspace: $('#workspace'),
  inputPanel: $('.panel--input'),
  outputPanel: $('#output-panel'),
  input: $('#input'),
  output: $('#output'),
  inputMetrics: $('#input-metrics'),
  outputMetrics: $('#output-metrics'),
  timing: $('#timing'),
  warnings: $('#warnings'),
  errorCard: $('#error-card'),
  errorTitle: $('#error-title'),
  errorHint: $('#error-hint'),
  convertBtn: $('[data-action="convert"]'),
  swapBtn: $('[data-action="swap"]'),
  copyBtn: $('[data-action="copy"]'),
  toast: $('#toast'),
  sampleBtn: $('[data-action="sample"]'),
  downloadBtn: $('.panel__tools [data-action="download"]'),
  fileInput: $('#file-input'),
  filePick: $('#file-pick'),
  fileEmpty: $('#file-empty'),
  filePickHint: $('#file-pick-hint'),
  fileCard: $('#file-card'),
  fileCardPreview: $('#file-card-preview'),
  fileCardBadge: $('#file-card-badge'),
  fileCardName: $('#file-card-name'),
  fileCardMeta: $('#file-card-meta'),
  fileResult: $('#file-result'),
  savePreview: $('#save-preview'),
  saveBadge: $('#save-badge'),
  saveLabel: $('#save-label'),
  saveMeta: $('#save-meta'),
  saveName: $('#save-name'),
  saveType: $('#save-type'),
};

const optionsPanel = createOptionsPanel(dom.options, handleOptionChange);

/* ---------------------------------------------------------------- conversão */

const surfaceLabel = (surface) => (surface.labelKey ? t(surface.labelKey) : surface.label);

/** Estado achatado que os controles de opção consultam. */
function optionState() {
  const from = getSurface(prefs.from);
  const to = getSurface(prefs.to);
  return {
    from: prefs.from,
    to: prefs.to,
    fromFamily: from.family === 'text' ? 'text' : from.kind,
    toFamily: to.family === 'text' ? 'text' : to.kind,
    detectedTypes: runtime.detectedTypes,
    rootType: runtime.rootType,
    ...prefs.shared,
    ...prefs.options[prefs.to],
  };
}

/** Opções entregues ao núcleo: as do destino, mais as compartilhadas. */
function conversionOptions() {
  return {
    ...prefs.shared,
    ...prefs.options[prefs.to],
    rootType: runtime.rootType || undefined,
    mime: runtime.file?.mime,
  };
}

/** O que está sendo convertido: o editor, ou o Base64 grande demais para ele. */
function currentText() {
  return prefs.from === 'base64' && runtime.heldText !== null ? runtime.heldText : dom.input.value;
}

function setInputText(text, sourceId) {
  const held = sourceId === 'base64' && text.length > EDITABLE_CHARS;
  runtime.heldText = held ? text : null;
  dom.input.value = held ? '' : text;
}

function convert({ animate = true } = {}) {
  const fromFile = prefs.from === 'file';
  const text = fromFile ? '' : currentText();
  renderSourceMode();
  updateInputMetrics(text);

  if (fromFile ? !runtime.file : !text.trim()) {
    clearOutput();
    return;
  }

  const started = performance.now();
  try {
    const source = fromFile ? runtime.file.bytes : text;
    const result = runConversion(source, prefs.from, prefs.to, conversionOptions());
    const elapsed = performance.now() - started;

    // A lista de tipos vem do documento: alimenta o seletor de raiz.
    const changed = result.detectedTypes.join() !== runtime.detectedTypes.join();
    runtime.detectedTypes = result.detectedTypes;
    if (changed) {
      if (!result.detectedTypes.includes(runtime.rootType)) runtime.rootType = result.rootName || '';
      renderOptions();
    }

    runtime.hasError = false;
    runtime.output = result.output;
    runtime.highlight = result.highlight;

    dom.errorCard.hidden = true;
    runtime.decoded = result.file || null;
    dom.fileResult.hidden = !result.file;
    if (result.file) {
      dom.output.replaceChildren();
      renderFileResult(result.file);
      dom.outputMetrics.textContent = formatBytes(result.file.bytes.length);
      dom.timing.textContent = formatMs(elapsed);
    } else {
      renderOutput(result.output, result.highlight, animate);
      updateOutputMetrics(result.output, elapsed);
    }
    renderWarnings(outputWarnings(result), result.binary);
  } catch (error) {
    renderError(error);
  }
}

let debounceTimer = 0;
function scheduleConvert() {
  clearTimeout(debounceTimer);
  updateInputMetrics(dom.input.value);
  if (dom.input.value.length > AUTO_CONVERT_LIMIT) {
    dom.timing.textContent = t('ui.metrics.largeInput');
    return;
  }
  debounceTimer = setTimeout(() => convert({ animate: true }), 140);
}

/* ------------------------------------------------------------------ render */

function renderFormatSelects() {
  fillSelect(dom.fromSelect, SURFACES, prefs.from);

  const targets = targetsFor(prefs.from);
  if (!targets.some((surface) => surface.id === prefs.to)) {
    prefs.to = targets[0].id;
  }
  fillSelect(dom.toSelect, targets, prefs.to);
}

function fillSelect(select, surfaces, selected) {
  const option = (surface) => {
    const element = document.createElement('option');
    element.value = surface.id;
    element.textContent = surfaceLabel(surface);
    return element;
  };
  const groupOf = (surface) => (surface.family === 'text' ? 'text' : surface.kind);
  const groups = [...new Set(surfaces.map(groupOf))];

  select.replaceChildren();
  if (groups.length < 2) {
    select.append(...surfaces.map(option));
  } else {
    for (const group of groups) {
      const element = document.createElement('optgroup');
      element.label = t(`ui.group.${group}`);
      element.append(...surfaces.filter((surface) => groupOf(surface) === group).map(option));
      select.append(element);
    }
  }
  select.value = selected;
}

/** A entrada é o editor ou um cartão de arquivo; a saída decide quais botões fazem sentido. */
function renderSourceMode() {
  const isFile = prefs.from === 'file';
  const held = prefs.from === 'base64' && runtime.heldText !== null;
  const file = isFile ? runtime.file : null;

  dom.input.hidden = isFile || held;
  dom.filePick.hidden = !isFile && !held;
  dom.fileEmpty.hidden = Boolean(file) || held;
  dom.fileCard.hidden = !file && !held;
  dom.sampleBtn.hidden = isFile;
  dom.copyBtn.hidden = prefs.to === 'file';
  dom.downloadBtn.hidden = prefs.to === 'file';
  dom.filePickHint.textContent = t('ui.file.pick.hint', { size: MAX_FILE_BYTES / 1024 / 1024 });

  if (file) {
    setPreview(dom.fileCardPreview, file.bytes, file.type);
    dom.fileCardBadge.textContent = file.type.ext;
    dom.fileCardName.textContent = file.name;
    dom.fileCardMeta.textContent = `${fileTypeLabel(file)} · ${formatBytes(file.bytes.length)}`;
  } else if (held) {
    setPreview(dom.fileCardPreview, null);
    dom.fileCardBadge.textContent = 'b64';
    dom.fileCardName.textContent = t('ui.file.heldName');
    dom.fileCardMeta.textContent = `${formatBytes(runtime.heldText.length)} · ${t('ui.file.held')}`;
  }
}

const fileTypeLabel = (file) => (file.known ? file.type.label : t('ui.file.unknown'));

const previews = new WeakMap();

/** Imagens passam por data: porque a CSP não libera blob:. SVG em <img> não executa script. */
function setPreview(image, bytes, type) {
  if (bytes && previews.get(image) === bytes) return;
  const show = Boolean(bytes && type?.image && bytes.length <= IMAGE_PREVIEW_BYTES);
  if (bytes) previews.set(image, bytes);
  else previews.delete(image);
  image.hidden = !show;
  if (show) image.src = toDataUri(bytes, type.mime);
  else image.removeAttribute('src');
}

function renderFileResult(file) {
  if (runtime.detectedExt !== file.type.ext) {
    runtime.detectedExt = file.type.ext;
    runtime.saveExt = '';
  }
  const ext = runtime.saveExt || file.type.ext;

  setPreview(dom.savePreview, file.bytes, file.type);
  dom.saveBadge.textContent = file.type.ext;
  dom.saveLabel.textContent = fileTypeLabel(file);
  dom.saveLabel.hidden = dom.saveLabel.textContent.toLowerCase() === file.type.ext;
  dom.saveMeta.textContent = formatBytes(file.bytes.length);
  fillSaveTypes(file, ext);
  if (!runtime.nameTouched) dom.saveName.value = `${t('ui.file.defaultName')}.${ext}`;
}

/** Os tipos prováveis para este conteúdo primeiro; o resto continua à mão. */
function fillSaveTypes(file, selected) {
  const likely = [file.type, ...file.alternatives];
  const group = (label, types) => {
    const element = document.createElement('optgroup');
    element.label = label;
    for (const type of types) {
      const option = document.createElement('option');
      option.value = type.ext;
      option.textContent = `${type.label} (.${type.ext})`;
      element.append(option);
    }
    return element;
  };
  dom.saveType.replaceChildren(
    group(t('ui.file.typesLikely'), likely),
    group(t('ui.file.typesOther'), FILE_TYPES.filter((type) => !likely.includes(type))),
  );
  dom.saveType.value = selected;
}

function outputWarnings(result) {
  if (result.output.length <= OUTPUT_PREVIEW_CHARS) return result.warnings;
  const shown = OUTPUT_PREVIEW_CHARS.toLocaleString(getLanguage());
  const total = result.output.length.toLocaleString(getLanguage());
  return [...result.warnings, t('ui.output.truncated', { shown, total })];
}

function renderOptions() {
  const state = optionState();
  const count = optionsPanel.render(state);
  dom.optionsCount.textContent = count > 0 ? String(count) : '';
}

function renderOutput(text, language, animate) {
  dom.output.classList.toggle('is-plain', language === 'plain');
  // O resultado inteiro fica em runtime.output; o <pre> só mostra o que consegue renderizar.
  const visible = text.length > OUTPUT_PREVIEW_CHARS ? `${text.slice(0, OUTPUT_PREVIEW_CHARS)}…` : text;
  dom.output.replaceChildren(highlight(visible, language));

  if (!animate || prefersReducedMotion()) return;

  dom.outputPanel.classList.remove('is-converting');
  dom.output.classList.remove('is-revealing');
  void dom.outputPanel.offsetWidth; // força reflow para reiniciar as animações
  dom.outputPanel.classList.add('is-converting');
  dom.output.classList.add('is-revealing');

  clearTimeout(renderOutput.timer);
  renderOutput.timer = setTimeout(() => {
    dom.outputPanel.classList.remove('is-converting');
    dom.output.classList.remove('is-revealing');
  }, 660);
}

function renderWarnings(warnings, offerFile = false) {
  dom.warnings.replaceChildren();
  for (const warning of warnings || []) {
    const chip = document.createElement('span');
    chip.className = 'warning';
    chip.textContent = warning;
    dom.warnings.append(chip);
  }
  if (offerFile) {
    const action = document.createElement('button');
    action.type = 'button';
    action.className = 'warning warning--action';
    action.dataset.action = 'to-file';
    action.textContent = t('ui.file.actionSave');
    dom.warnings.append(action);
  }
}

function renderError(error) {
  runtime.hasError = true;
  runtime.output = '';
  runtime.decoded = null;
  dom.fileResult.hidden = true;

  dom.output.replaceChildren();
  dom.warnings.replaceChildren();
  dom.outputMetrics.textContent = t('ui.metrics.none');
  dom.timing.textContent = '';

  const isCodecError = error instanceof CodecError;
  dom.errorTitle.textContent = isCodecError ? error.message : t('ui.error.generic');
  dom.errorHint.textContent = isCodecError && error.hint ? error.hint : String(error?.message || error);
  dom.errorCard.hidden = false;

  if (isCodecError && typeof error.position === 'number') highlightInputPosition(error.position);
}

/** Leva o cursor até o ponto exato do erro na entrada. */
function highlightInputPosition(position) {
  const text = dom.input.value;
  const trimOffset = text.length - text.trimStart().length;
  const index = Math.min(position + trimOffset, text.length);
  dom.input.setSelectionRange(index, Math.min(index + 1, text.length));
}

function clearOutput() {
  runtime.output = '';
  runtime.hasError = false;
  runtime.decoded = null;
  dom.fileResult.hidden = true;
  dom.output.replaceChildren();
  dom.warnings.replaceChildren();
  dom.errorCard.hidden = true;
  dom.outputMetrics.textContent = t('ui.metrics.none');
  dom.timing.textContent = '';
}

const byteLength = (text) => new TextEncoder().encode(text).length;

function formatBytes(bytes) {
  if (bytes < 1024) return plural(bytes, 'byte');
  const megabytes = bytes >= 1024 * 1024;
  const value = bytes / (megabytes ? 1024 * 1024 : 1024);
  return `${value.toLocaleString(getLanguage(), { maximumFractionDigits: 1 })} ${megabytes ? 'MB' : 'KB'}`;
}

function updateInputMetrics(text) {
  if (prefs.from === 'file') {
    dom.inputMetrics.textContent = runtime.file ? formatBytes(runtime.file.bytes.length) : t('ui.metrics.none');
    return;
  }
  const chars = text.length;
  const label = plural(chars, 'char');
  // Recontar bytes a cada tecla fica caro em textos enormes.
  dom.inputMetrics.textContent =
    chars > 200_000 ? label : `${label} · ${plural(byteLength(text), 'byte')}`;
}

function updateOutputMetrics(text, elapsed) {
  // Contar linhas de um resultado enorme custa mais do que a informação vale.
  const lines = text.length > OUTPUT_PREVIEW_CHARS ? '' : ` · ${plural(text ? text.split('\n').length : 0, 'line')}`;
  dom.outputMetrics.textContent = `${plural(text.length, 'char')}${lines}`;
  dom.timing.textContent = formatMs(elapsed);
}

/* ----------------------------------------------------------------- popover */

function toggleOptions(force) {
  const open = force ?? dom.popover.hidden;
  dom.popover.hidden = !open;
  dom.backdrop.hidden = !open;
  dom.optionsBtn.setAttribute('aria-expanded', String(open));
  if (open) {
    renderOptions();
    // Dois quadros: o primeiro aplica o layout, o segundo mede com a animação de
    // entrada já resolvida — medir antes disso dá largura zero no indicador.
    requestAnimationFrame(() => requestAnimationFrame(() => optionsPanel.refresh()));
    dom.popover.querySelector('button, input, select')?.focus();
  } else {
    dom.optionsBtn.focus();
  }
}

function resetOptions() {
  prefs.options[prefs.to] = structuredClone(OPTION_DEFAULTS[prefs.to] || {});
  prefs.shared = structuredClone(DEFAULT_PREFS.shared);
  savePrefs(prefs);
  renderOptions();
  convert({ animate: false });
  showToast(t('ui.toast.optionsReset'));
}

/* ----------------------------------------------------------------- ações */

const prefersReducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

function withTransition(mutate) {
  if (!document.startViewTransition || prefersReducedMotion()) {
    mutate();
    return;
  }
  document.startViewTransition(mutate);
}

function handleOptionChange(key, value) {
  if (key in prefs.shared) {
    if (prefs.shared[key] === value) return;
    prefs.shared[key] = value;
  } else if (key === 'rootType') {
    if (runtime.rootType === value) return;
    runtime.rootType = value;
  } else {
    const target = prefs.options[prefs.to];
    if (target[key] === value) return;
    target[key] = value;
  }

  savePrefs(prefs);
  renderOptions();
  convert({ animate: false });
}

function setFormat(side, id) {
  const previous = side === 'from' ? prefs.from : prefs.to;
  if (previous === id) return;

  withTransition(() => {
    if (side === 'from') {
      runtime.drafts[previous] = dom.input.value;
      prefs.from = id;
      dom.input.value = runtime.drafts[id] || '';
      runtime.detectedTypes = [];
      runtime.rootType = '';
    } else {
      prefs.to = id;
    }

    renderFormatSelects();
    savePrefs(prefs);
    renderOptions();
    convert({ animate: false });
  });
}

function setTheme(theme) {
  prefs.theme = theme;
  dom.root.dataset.theme = theme;
  savePrefs(prefs);
}

/**
 * Troca o idioma da interface e do núcleo. Reconverte no fim porque erros, avisos
 * e o cabeçalho do código gerado são texto traduzido.
 */
function applyLanguage(language, { persist = true } = {}) {
  setLanguage(language);
  refreshFormats();
  if (persist) {
    prefs.language = getLanguage();
    savePrefs(prefs);
  }
  applyTranslations();
  renderFormatSelects();
  renderOptions();
  convert({ animate: false });
}

function cycleLanguage() {
  const next = LANGUAGES[(LANGUAGES.indexOf(getLanguage()) + 1) % LANGUAGES.length];
  withTransition(() => applyLanguage(next));
}

/** Inverte origem e destino; o resultado atual vira a nova entrada. */
function swapFormats() {
  if (!isValidPair(prefs.to, prefs.from)) {
    showToast(t('ui.toast.cannotSwap'), 'error');
    return;
  }

  const carry = !runtime.hasError && runtime.output ? runtime.output : null;
  const decoded = runtime.decoded;
  const outputName = sanitizeFileName(dom.saveName.value, t('ui.file.defaultName'));
  const inputName = prefs.from === 'file' ? runtime.file?.name : '';
  dom.swapBtn.classList.toggle('is-flipped');

  withTransition(() => {
    const { from, to } = prefs;
    prefs.from = to;
    prefs.to = from;
    if (decoded) {
      runtime.file = { name: outputName, bytes: decoded.bytes, type: decoded.type, known: decoded.known, mime: decoded.type.mime };
    } else if (carry) {
      setInputText(carry, to);
    }
    // Ida e volta preservam o nome do arquivo.
    if (inputName) {
      dom.saveName.value = inputName;
      runtime.nameTouched = true;
    }
    runtime.detectedTypes = [];
    runtime.rootType = '';

    renderFormatSelects();
    savePrefs(prefs);
    renderOptions();
    convert({ animate: false });
  });
}

async function copyOutput() {
  if (!runtime.output) {
    showToast(t('ui.toast.nothingToCopy'), 'error');
    return;
  }
  try {
    await navigator.clipboard.writeText(runtime.output);
  } catch {
    if (!legacyCopy(runtime.output)) {
      showToast(t('ui.toast.copyBlocked'), 'error');
      return;
    }
  }
  dom.copyBtn.classList.add('is-done');
  dom.copyBtn.textContent = t('ui.panel.copied');
  setTimeout(() => {
    dom.copyBtn.classList.remove('is-done');
    dom.copyBtn.textContent = t('ui.panel.copy');
  }, 1400);
  showToast(t('ui.toast.copied'));
}

function legacyCopy(text) {
  const helper = document.createElement('textarea');
  helper.value = text;
  helper.setAttribute('aria-hidden', 'true');
  helper.style.position = 'fixed';
  helper.style.opacity = '0';
  document.body.append(helper);
  helper.select();
  let ok = false;
  try {
    ok = document.execCommand('copy');
  } catch {
    ok = false;
  }
  helper.remove();
  return ok;
}

function saveBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  showToast(t('ui.toast.downloaded', { name }));
}

function downloadOutput() {
  if (runtime.decoded) {
    // octet-stream: o navegador só salva, sem tentar interpretar o conteúdo.
    const blob = new Blob([runtime.decoded.bytes], { type: 'application/octet-stream' });
    saveBlob(blob, sanitizeFileName(dom.saveName.value, t('ui.file.defaultName')));
    return;
  }
  if (!runtime.output) {
    showToast(t('ui.toast.nothingToDownload'), 'error');
    return;
  }

  const surface = getSurface(prefs.to);
  const base = surface.kind === 'lang'
    ? (runtime.rootType || prefs.shared.rootName || 'Model').replace(/[^\w$]/g, '') || 'Model'
    : 'payload';

  const name = prefs.from === 'file' && runtime.file
    ? `${runtime.file.name}.b64.txt`
    : `${base}.${surface.extension}`;
  saveBlob(new Blob([runtime.output], { type: 'text/plain;charset=utf-8' }), name);
}

function loadSample() {
  setInputText(prefs.to === 'file' ? SAMPLE_PDF_BASE64 : t(`ui.sample.${prefs.from}`), prefs.from);
  convert({ animate: true });
  dom.input.focus();
}

function clearAll() {
  dom.input.value = '';
  runtime.heldText = null;
  if (prefs.from === 'file') runtime.file = null;
  runtime.nameTouched = false;
  renderSourceMode();
  clearOutput();
  updateInputMetrics('');
  dom.input.focus();
}

function openInTab() {
  const url = globalThis.chrome?.runtime?.getURL?.('app.html') || 'app.html';
  if (globalThis.chrome?.tabs?.create) chrome.tabs.create({ url });
  else window.open(url, '_blank', 'noopener');
}

let toastTimer = 0;
function showToast(message, kind = 'info') {
  dom.toast.textContent = message;
  dom.toast.dataset.kind = kind;
  dom.toast.classList.add('is-visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => dom.toast.classList.remove('is-visible'), 2200);
}

/* -------------------------------------------------------------- arquivos */

async function loadFile(file) {
  if (!file) return;
  if (file.size > MAX_FILE_BYTES) {
    showToast(t('ui.toast.fileTooLarge', { size: MAX_FILE_BYTES / 1024 / 1024 }), 'error');
    return;
  }
  if (file.size === 0) {
    showToast(t('ui.toast.fileEmpty'), 'error');
    return;
  }
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());

    // Texto vai para o editor do formato atual; o resto só faz sentido como arquivo.
    if (prefs.from !== 'file' && isTextBytes(bytes)) {
      const text = new TextDecoder().decode(bytes);
      if (prefs.from === 'base64' || text.length <= EDITABLE_CHARS) {
        setInputText(text, prefs.from);
        convert({ animate: true });
        showToast(t('ui.toast.fileLoaded', { name: file.name }));
        return;
      }
    }

    const detected = detectFileType(bytes);
    runtime.file = {
      name: file.name,
      bytes,
      type: detected.type,
      known: detected.known,
      mime: detected.known ? detected.type.mime : file.type || detected.type.mime,
    };
    if (prefs.from === 'file') {
      convert({ animate: true });
      showToast(t('ui.toast.fileLoaded', { name: file.name }));
    } else {
      setFormat('from', 'file');
      showToast(t('ui.toast.switchedToFile', { name: file.name }));
    }
  } catch {
    showToast(t('ui.toast.fileError'), 'error');
  }
}

/* --------------------------------------------------------------- eventos */

function bindEvents() {
  dom.input.addEventListener('input', scheduleConvert);
  dom.fromSelect.addEventListener('change', () => setFormat('from', dom.fromSelect.value));
  dom.toSelect.addEventListener('change', () => setFormat('to', dom.toSelect.value));

  document.addEventListener('click', (event) => {
    const trigger = event.target.closest('[data-action]');
    if (!trigger) return;
    const actions = {
      convert: () => {
        dom.convertBtn.classList.remove('is-pulsing');
        void dom.convertBtn.offsetWidth;
        dom.convertBtn.classList.add('is-pulsing');
        convert({ animate: true });
      },
      swap: swapFormats,
      copy: copyOutput,
      download: downloadOutput,
      clear: clearAll,
      sample: loadSample,
      'open-file': () => dom.fileInput.click(),
      'to-file': () => setFormat('to', 'file'),
      theme: () => setTheme(prefs.theme === 'dark' ? 'light' : 'dark'),
      language: cycleLanguage,
      expand: openInTab,
      options: () => toggleOptions(),
      'options-close': () => toggleOptions(false),
      'options-reset': resetOptions,
    };
    actions[trigger.dataset.action]?.();
  });

  dom.backdrop.addEventListener('click', () => toggleOptions(false));

  dom.fileInput.addEventListener('change', () => {
    loadFile(dom.fileInput.files?.[0]);
    dom.fileInput.value = ''; // permite escolher o mesmo arquivo de novo
  });
  dom.saveName.addEventListener('input', () => {
    runtime.nameTouched = true;
  });
  dom.saveType.addEventListener('change', () => {
    runtime.saveExt = dom.saveType.value;
    dom.saveName.value = replaceExtension(dom.saveName.value, runtime.saveExt);
  });
  for (const image of [dom.fileCardPreview, dom.savePreview]) {
    image.addEventListener('error', () => {
      image.hidden = true;
    });
  }
  document.addEventListener('paste', (event) => {
    const file = event.clipboardData?.files?.[0];
    if (!file) return;
    event.preventDefault();
    loadFile(file);
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !dom.popover.hidden) {
      event.preventDefault();
      toggleOptions(false);
      return;
    }
    const meta = event.ctrlKey || event.metaKey;
    if (meta && event.key === 'Enter') {
      event.preventDefault();
      convert({ animate: true });
    } else if (meta && !event.shiftKey && event.key.toLowerCase() === 'i') {
      event.preventDefault();
      swapFormats();
    } else if (meta && event.shiftKey && event.key.toLowerCase() === 'c') {
      event.preventDefault();
      copyOutput();
    }
  });

  // Soltar em qualquer ponto da janela carrega o arquivo: errar o alvo não deve abri-lo no lugar do app.
  const panel = dom.inputPanel;
  document.addEventListener('dragover', (event) => {
    event.preventDefault();
    if (event.dataTransfer?.types?.includes('Files')) panel.classList.add('is-dragging');
  });
  document.addEventListener('dragleave', (event) => {
    if (!event.relatedTarget) panel.classList.remove('is-dragging');
  });
  document.addEventListener('drop', (event) => {
    event.preventDefault();
    panel.classList.remove('is-dragging');
    loadFile(event.dataTransfer?.files?.[0]);
  });

  window.addEventListener('resize', () => optionsPanel.refresh());
}

/* ------------------------------------------------------------------ boot */

function init() {
  dom.root.dataset.theme = prefs.theme;
  // Preferência explícita do usuário vence; senão, segue o idioma do navegador.
  setLanguage(prefs.language || detectLanguage());
  refreshFormats();
  applyTranslations();

  // Uma preferência salva pode apontar para um par que não existe mais.
  if (!getSurface(prefs.from)) prefs.from = DEFAULT_PREFS.from;
  if (!isValidPair(prefs.from, prefs.to)) prefs.to = targetsFor(prefs.from)[0].id;
  for (const [id, defaults] of Object.entries(OPTION_DEFAULTS)) {
    prefs.options[id] = { ...defaults, ...(prefs.options[id] || {}) };
  }

  renderFormatSelects();
  renderOptions();
  renderSourceMode();
  updateInputMetrics('');
  clearOutput();
  bindEvents();
  if (/Mac/.test(navigator.platform)) {
    for (const key of document.querySelectorAll('.statusbar kbd')) {
      if (key.textContent === 'Ctrl') key.textContent = '⌘';
    }
  }
  dom.input.focus();
}

init();
