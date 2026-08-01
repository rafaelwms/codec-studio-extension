/**
 * Codec Studio — orquestração da interface.
 *
 * Regras de ouro deste arquivo:
 *  1. Nenhuma requisição de rede, nenhum eval, nenhum innerHTML com dado do usuário.
 *  2. Todo texto do usuário entra no DOM via textContent ou nós de texto.
 *  3. A conversão é síncrona e local; o "tempo" mostrado é medição real.
 */

import { CodecError } from '../core/base64.js';
import { highlight } from './highlight.js';
import {
  applyTranslations, detectLanguage, formatMs, getLanguage,
  LANGUAGES, plural, refreshFormats, setLanguage, t,
} from './i18n.js';
import { createOptionsPanel, TARGET_OPTIONS } from './options.js';
import { loadPrefs, savePrefs } from './prefs.js';
import { getSurface, isValidPair, runConversion, SURFACES, targetsFor } from './surfaces.js';

/* ------------------------------------------------------------------ estado */

/** Padrões de cada formato de destino, espelhando os defaults do núcleo. */
const OPTION_DEFAULTS = {
  base64: { alphabet: 'standard', padding: true, wrap: false },
  text: { strict: false },
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
};

const AUTO_CONVERT_LIMIT = 400_000;
const MAX_FILE_BYTES = 5 * 1024 * 1024;

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
  };
}

function convert({ animate = true } = {}) {
  const text = dom.input.value;
  updateInputMetrics(text);

  if (!text.trim()) {
    clearOutput();
    return;
  }

  const started = performance.now();
  try {
    const result = runConversion(text, prefs.from, prefs.to, conversionOptions());
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
    renderOutput(result.output, result.highlight, animate);
    renderWarnings(result.warnings);
    updateOutputMetrics(result.output, elapsed);
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
  select.replaceChildren();
  for (const surface of surfaces) {
    const option = document.createElement('option');
    option.value = surface.id;
    option.textContent = surfaceLabel(surface);
    select.append(option);
  }
  select.value = selected;
}

function renderOptions() {
  const state = optionState();
  const count = optionsPanel.render(state);
  dom.optionsCount.textContent = count > 0 ? String(count) : '';
}

function renderOutput(text, language, animate) {
  dom.output.classList.toggle('is-plain', language === 'plain');
  dom.output.replaceChildren(highlight(text, language));

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

function renderWarnings(warnings) {
  dom.warnings.replaceChildren();
  for (const warning of warnings || []) {
    const chip = document.createElement('span');
    chip.className = 'warning';
    chip.textContent = warning;
    dom.warnings.append(chip);
  }
}

function renderError(error) {
  runtime.hasError = true;
  runtime.output = '';

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
  dom.output.replaceChildren();
  dom.warnings.replaceChildren();
  dom.errorCard.hidden = true;
  dom.outputMetrics.textContent = t('ui.metrics.none');
  dom.timing.textContent = '';
}

const byteLength = (text) => new TextEncoder().encode(text).length;

function updateInputMetrics(text) {
  const chars = text.length;
  const label = plural(chars, 'char');
  // Recontar bytes a cada tecla fica caro em textos enormes.
  dom.inputMetrics.textContent =
    chars > 200_000 ? label : `${label} · ${plural(byteLength(text), 'byte')}`;
}

function updateOutputMetrics(text, elapsed) {
  const lines = text ? text.split('\n').length : 0;
  dom.outputMetrics.textContent = `${plural(text.length, 'char')} · ${plural(lines, 'line')}`;
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
  dom.swapBtn.classList.toggle('is-flipped');

  withTransition(() => {
    const { from, to } = prefs;
    prefs.from = to;
    prefs.to = from;
    if (carry) dom.input.value = carry;
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

function downloadOutput() {
  if (!runtime.output) {
    showToast(t('ui.toast.nothingToDownload'), 'error');
    return;
  }

  const surface = getSurface(prefs.to);
  const base = surface.kind === 'lang'
    ? (runtime.rootType || prefs.shared.rootName || 'Model').replace(/[^\w$]/g, '') || 'Model'
    : 'payload';

  const blob = new Blob([runtime.output], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${base}.${surface.extension}`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  showToast(t('ui.toast.downloaded', { name: link.download }));
}

function loadSample() {
  dom.input.value = t(`ui.sample.${prefs.from}`);
  convert({ animate: true });
  dom.input.focus();
}

function clearAll() {
  dom.input.value = '';
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
  try {
    dom.input.value = await file.text();
    convert({ animate: true });
    showToast(t('ui.toast.fileLoaded', { name: file.name }));
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

  const panel = dom.inputPanel;
  panel.addEventListener('dragover', (event) => {
    event.preventDefault();
    panel.classList.add('is-dragging');
  });
  panel.addEventListener('dragleave', (event) => {
    if (event.relatedTarget && panel.contains(event.relatedTarget)) return;
    panel.classList.remove('is-dragging');
  });
  panel.addEventListener('drop', (event) => {
    event.preventDefault();
    panel.classList.remove('is-dragging');
    loadFile(event.dataTransfer?.files?.[0]);
  });
  document.addEventListener('dragover', (event) => event.preventDefault());
  document.addEventListener('drop', (event) => event.preventDefault());

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
  updateInputMetrics('');
  clearOutput();
  bindEvents();
  dom.input.focus();
}

init();
