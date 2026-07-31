/**
 * Codec Studio — orquestração da interface.
 *
 * Regras de ouro deste arquivo:
 *  1. Nenhuma requisição de rede, nenhum eval, nenhum innerHTML com dado do usuário.
 *  2. Todo texto do usuário entra no DOM via textContent ou nós de texto.
 *  3. A conversão é síncrona e local; o "tempo" mostrado é medição real.
 */

import { CodecError, decodeText, encodeText, looksLikeBase64 } from '../core/base64.js';
import { jsonToJava } from '../core/json-to-java.js';
import { javaToJson } from '../core/java-to-json.js';
import { highlight } from './highlight.js';
import { createOptionsBar } from './options.js';
import { loadPrefs, savePrefs } from './prefs.js';

/* ------------------------------------------------------------------ estado */

const DEFAULT_PREFS = {
  theme: 'dark',
  tool: 'base64',
  base64: {
    direction: 'encode',
    alphabet: 'standard',
    padding: true,
    wrap: false,
    strict: false,
  },
  'json-java': {
    direction: 'json-to-java',
    style: 'record',
    rootClassName: 'Root',
    packageName: '',
    jackson: true,
    primitives: true,
    dateTypes: true,
    separateFiles: false,
    values: 'example',
    rootType: '',
  },
};

const prefs = loadPrefs(DEFAULT_PREFS);

/** Estado volátil (nunca persistido). */
const runtime = {
  detectedTypes: [],
  output: '',
  language: 'plain',
  hasError: false,
  autoDirection: null,
  /** Rascunho por ferramenta: alternar as abas não faz perder o texto. */
  drafts: { base64: '', 'json-java': '' },
};

const AUTO_CONVERT_LIMIT = 400_000; // acima disso, conversão só sob demanda
const MAX_FILE_BYTES = 5 * 1024 * 1024;

const numberFormat = new Intl.NumberFormat('pt-BR');
const msFormat = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2, minimumFractionDigits: 2 });

/* -------------------------------------------------------------------- DOM */

const $ = (selector) => document.querySelector(selector);

const dom = {
  root: document.documentElement,
  tabs: $('.tabs'),
  tabButtons: [...document.querySelectorAll('.tab')],
  options: $('#options'),
  workspace: $('#workspace'),
  inputPanel: $('.panel--input'),
  outputPanel: $('#output-panel'),
  input: $('#input'),
  output: $('#output'),
  placeholder: $('#placeholder'),
  inputTitle: $('#input-title'),
  outputTitle: $('#output-title'),
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

const optionsBar = createOptionsBar(dom.options, handleOptionChange);

/* ---------------------------------------------------------------- rótulos */

const LABELS = {
  base64: {
    encode: { input: 'Texto', output: 'Base64', placeholder: 'Digite o texto que deve virar Base64…' },
    decode: { input: 'Base64', output: 'Texto', placeholder: 'Cole o Base64 para decodificar…' },
    auto: { input: 'Texto ou Base64', output: 'Resultado', placeholder: 'Cole qualquer um dos dois — a direção é detectada…' },
  },
  'json-java': {
    'json-to-java': { input: 'JSON', output: 'Java', placeholder: '{\n  "id": 1,\n  "nome": "Ana"\n}' },
    'java-to-json': { input: 'Java', output: 'JSON', placeholder: 'public record Pessoa(Long id, String nome) { }' },
  },
};

const SAMPLES = {
  base64: {
    encode: 'Olá, mundo! Codec Studio funciona 100% offline. 🔒',
    decode: 'T2zDoSwgbXVuZG8hIENvZGVjIFN0dWRpbyBmdW5jaW9uYSAxMDAlIG9mZmxpbmUuIPCflJI=',
    auto: 'T2zDoSwgbXVuZG8h',
  },
  'json-java': {
    'json-to-java': JSON.stringify(
      {
        id: 1024,
        full_name: 'Ana Souza',
        email: 'ana@exemplo.com',
        active: true,
        score: 9.75,
        created_at: '2026-07-30T10:15:30Z',
        address: { city: 'São Paulo', state: 'SP', zip: '01310-000' },
        orders: [
          { sku: 'CS-100', quantity: 2, total: 199.9 },
          { sku: 'CS-200', quantity: 1, total: 49.9, note: 'presente' },
        ],
        tags: ['premium', 'beta'],
      },
      null,
      2,
    ),
    'java-to-json': `public class Pedido {
    private Long id;
    private String cliente;

    @JsonProperty("criado_em")
    private OffsetDateTime criadoEm;

    private BigDecimal total;
    private Status status;
    private List<Item> itens;

    public static class Item {
        private String sku;
        private int quantidade;
        private BigDecimal preco;
    }
}

enum Status { ABERTO, PAGO, CANCELADO }`,
  },
};

/* --------------------------------------------------------------- conversão */

function toolState() {
  return { tool: prefs.tool, ...prefs[prefs.tool], detectedTypes: runtime.detectedTypes };
}

function renderOptions() {
  optionsBar.render(toolState());
  requestAnimationFrame(updateOptionsOverflow);
}

function currentDirection() {
  return prefs[prefs.tool].direction;
}

function runConversion(text) {
  const options = prefs[prefs.tool];

  if (prefs.tool === 'base64') {
    let direction = options.direction;
    if (direction === 'auto') {
      direction = looksLikeBase64(text) ? 'decode' : 'encode';
      runtime.autoDirection = direction;
    } else {
      runtime.autoDirection = null;
    }

    if (direction === 'encode') {
      const result = encodeText(text, {
        urlSafe: options.alphabet === 'url',
        padding: options.padding,
        lineLength: options.wrap ? 76 : 0,
      });
      return { output: result.output, warnings: result.warnings, language: 'plain', bytes: result.bytes };
    }

    const result = decodeText(text, { strict: options.strict });
    return {
      // Conteúdo binário é mostrado como dump hexadecimal: mais útil do que U+FFFD.
      output: result.binary ? result.hex : result.output,
      warnings: result.warnings,
      language: 'plain',
      bytes: result.bytes,
    };
  }

  if (options.direction === 'json-to-java') {
    runtime.detectedTypes = [];
    const result = jsonToJava(text, {
      rootClassName: options.rootClassName || 'Root',
      packageName: options.packageName,
      style: options.style,
      jackson: options.jackson,
      primitives: options.primitives,
      detectDateTime: options.dateTypes,
      nested: options.separateFiles ? 'separate' : 'inner',
    });
    return { output: result.output, warnings: result.warnings, language: 'java' };
  }

  const result = javaToJson(text, { rootType: options.rootType, values: options.values });
  const changed =
    result.types.length !== runtime.detectedTypes.length ||
    result.types.some((type, index) => type !== runtime.detectedTypes[index]);
  runtime.detectedTypes = result.types;
  if (!options.rootType || !result.types.includes(options.rootType)) {
    prefs[prefs.tool].rootType = result.rootName;
  }
  if (changed) renderOptions();
  return { output: result.output, warnings: result.warnings, language: 'json' };
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
    const result = runConversion(text);
    const elapsed = performance.now() - started;

    runtime.hasError = false;
    runtime.output = result.output;
    runtime.language = result.language;

    dom.errorCard.hidden = true;
    renderOutput(result.output, result.language, animate);
    renderWarnings(result.warnings);
    updateOutputMetrics(result.output, elapsed);
    updateLabels();
  } catch (error) {
    renderError(error);
  }
}

let debounceTimer = 0;
function scheduleConvert() {
  clearTimeout(debounceTimer);
  updateInputMetrics(dom.input.value);
  if (dom.input.value.length > AUTO_CONVERT_LIMIT) {
    dom.timing.textContent = 'entrada grande — use o botão Converter';
    return;
  }
  debounceTimer = setTimeout(() => convert({ animate: true }), 140);
}

/* ---------------------------------------------------------------- render */

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
  dom.outputMetrics.textContent = '—';
  dom.timing.textContent = '';

  const isCodecError = error instanceof CodecError;
  dom.errorTitle.textContent = isCodecError ? error.message : 'Não foi possível converter.';
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
  dom.outputMetrics.textContent = '—';
  dom.timing.textContent = '';
}

function byteLength(text) {
  return new TextEncoder().encode(text).length;
}

function updateInputMetrics(text) {
  const chars = text.length;
  const label = plural(chars, 'caractere', 'caracteres');
  // Recontar bytes a cada tecla fica caro em textos enormes; aí mostramos só os caracteres.
  dom.inputMetrics.textContent =
    chars > 200_000 ? label : `${label} · ${plural(byteLength(text), 'byte', 'bytes')}`;
}

function plural(count, singular, pluralForm) {
  return `${numberFormat.format(count)} ${count === 1 ? singular : pluralForm}`;
}

function updateOutputMetrics(text, elapsed) {
  const lines = text ? text.split('\n').length : 0;
  dom.outputMetrics.textContent =
    `${plural(text.length, 'caractere', 'caracteres')} · ${plural(lines, 'linha', 'linhas')}`;
  dom.timing.textContent = `${msFormat.format(elapsed)} ms`;
}

function updateLabels() {
  const direction = currentDirection();
  const labels = LABELS[prefs.tool][direction];
  // No modo automático, o título da saída revela a direção que foi detectada.
  const detected = direction === 'auto' && runtime.autoDirection
    ? LABELS[prefs.tool][runtime.autoDirection]
    : null;

  dom.inputTitle.textContent = labels.input;
  dom.outputTitle.textContent = detected ? `${detected.output} · detectado` : labels.output;
  dom.input.placeholder = labels.placeholder;
}

/** Mostra o esmaecimento lateral quando a barra de opções tem conteúdo oculto. */
function updateOptionsOverflow() {
  const bar = dom.options;
  const max = bar.scrollWidth - bar.clientWidth;
  bar.classList.toggle('has-more-right', max > 2 && bar.scrollLeft < max - 1);
  bar.classList.toggle('has-more-left', bar.scrollLeft > 1);
}

function updateTabs() {
  for (const button of dom.tabButtons) {
    const active = button.dataset.tool === prefs.tool;
    button.classList.toggle('is-active', active);
    button.setAttribute('aria-selected', String(active));
    if (active) dom.workspace.setAttribute('aria-labelledby', button.id);
  }
  requestAnimationFrame(() => {
    const active = dom.tabButtons.find((button) => button.dataset.tool === prefs.tool);
    if (!active || !active.offsetWidth) return;
    dom.tabs.style.setProperty('--indicator-width', `${active.offsetWidth}px`);
    dom.tabs.style.setProperty('--indicator-x', `${active.offsetLeft - 3}px`);
  });
}

/* ----------------------------------------------------------------- ações */

function prefersReducedMotion() {
  return matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function withTransition(mutate) {
  if (!document.startViewTransition || prefersReducedMotion()) {
    mutate();
    return;
  }
  document.startViewTransition(mutate);
}

function handleOptionChange(key, value) {
  const options = prefs[prefs.tool];
  if (options[key] === value) return;

  const structural = key === 'direction';
  const apply = () => {
    options[key] = value;
    if (key === 'direction') runtime.autoDirection = null;
    savePrefs(prefs);
    renderOptions();
    updateLabels();
    convert({ animate: !structural });
  };

  if (structural) withTransition(apply);
  else apply();
}

function setTool(tool) {
  if (prefs.tool === tool) return;
  runtime.drafts[prefs.tool] = dom.input.value;
  withTransition(() => {
    prefs.tool = tool;
    dom.input.value = runtime.drafts[tool] || '';
    savePrefs(prefs);
    updateTabs();
    renderOptions();
    updateLabels();
    convert({ animate: false });
  });
}

function setTheme(theme) {
  prefs.theme = theme;
  dom.root.dataset.theme = theme;
  savePrefs(prefs);
}

function swapDirection() {
  const options = prefs[prefs.tool];
  const pairs = {
    base64: { encode: 'decode', decode: 'encode', auto: 'encode' },
    'json-java': { 'json-to-java': 'java-to-json', 'java-to-json': 'json-to-java' },
  };
  const next = pairs[prefs.tool][options.direction];
  // O resultado atual vira a nova entrada — o caminho de volta fica natural.
  const carry = !runtime.hasError && runtime.output ? runtime.output : null;

  dom.swapBtn.classList.toggle('is-flipped');
  withTransition(() => {
    options.direction = next;
    runtime.autoDirection = null;
    if (carry) dom.input.value = carry;
    savePrefs(prefs);
    renderOptions();
    updateLabels();
    convert({ animate: false });
  });
}

async function copyOutput() {
  if (!runtime.output) {
    showToast('Nada para copiar ainda.', 'error');
    return;
  }
  try {
    await navigator.clipboard.writeText(runtime.output);
  } catch {
    if (!legacyCopy(runtime.output)) {
      showToast('O navegador bloqueou a cópia.', 'error');
      return;
    }
  }
  dom.copyBtn.classList.add('is-done');
  dom.copyBtn.textContent = 'Copiado';
  setTimeout(() => {
    dom.copyBtn.classList.remove('is-done');
    dom.copyBtn.textContent = 'Copiar';
  }, 1400);
  showToast('Resultado copiado.');
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
    showToast('Nada para baixar ainda.', 'error');
    return;
  }
  const effectiveDirection = runtime.autoDirection || currentDirection();
  const names = {
    java: `${(prefs['json-java'].rootClassName || 'Root').replace(/[^\w$]/g, '') || 'Root'}.java`,
    json: 'payload.json',
    plain: effectiveDirection === 'encode' ? 'codificado.b64.txt' : 'decodificado.txt',
  };
  const blob = new Blob([runtime.output], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = names[runtime.language] || 'codec-studio.txt';
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  showToast(`Arquivo ${link.download} salvo.`);
}

function loadSample() {
  const direction = currentDirection();
  dom.input.value = SAMPLES[prefs.tool][direction] ?? '';
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
    showToast(`Arquivo muito grande (máx. ${MAX_FILE_BYTES / 1024 / 1024} MB).`, 'error');
    return;
  }
  try {
    dom.input.value = await file.text();
    convert({ animate: true });
    showToast(`${file.name} carregado.`);
  } catch {
    showToast('Não foi possível ler o arquivo.', 'error');
  }
}

/* --------------------------------------------------------------- eventos */

function bindEvents() {
  dom.input.addEventListener('input', scheduleConvert);

  for (const button of dom.tabButtons) {
    button.addEventListener('click', () => setTool(button.dataset.tool));
  }

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
      swap: swapDirection,
      copy: copyOutput,
      download: downloadOutput,
      clear: clearAll,
      sample: loadSample,
      theme: () => setTheme(prefs.theme === 'dark' ? 'light' : 'dark'),
      expand: openInTab,
    };
    actions[trigger.dataset.action]?.();
  });

  document.addEventListener('keydown', (event) => {
    const meta = event.ctrlKey || event.metaKey;
    if (meta && event.key === 'Enter') {
      event.preventDefault();
      convert({ animate: true });
    } else if (meta && !event.shiftKey && event.key.toLowerCase() === 'i') {
      event.preventDefault();
      swapDirection();
    } else if (meta && event.shiftKey && event.key.toLowerCase() === 'c') {
      event.preventDefault();
      copyOutput();
    }
  });

  // Arrastar e soltar arquivos de texto
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

  dom.options.addEventListener('scroll', updateOptionsOverflow, { passive: true });

  window.addEventListener('resize', () => {
    updateTabs();
    optionsBar.refresh();
    updateOptionsOverflow();
  });
}

/* ------------------------------------------------------------------ boot */

function init() {
  dom.root.dataset.theme = prefs.theme;
  updateTabs();
  renderOptions();
  updateLabels();
  updateInputMetrics('');
  bindEvents();
  dom.input.focus();
}

init();
