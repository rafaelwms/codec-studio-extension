/**
 * Opções de conversão.
 *
 * Cada formato de destino tem o seu conjunto — não faz sentido oferecer "Lombok"
 * quando o alvo é Go. As opções vivem num popover justamente porque variam: uma
 * barra fixa teria de caber no pior caso e estourava a janela.
 *
 * Os controles são criados por API DOM (nunca innerHTML).
 */

import { getLanguage, t } from './i18n.js';

const segmented = (key, label, options, extra = {}) =>
  ({ type: 'segmented', key, label, options, ...extra });
const toggle = (key, label, extra = {}) => ({ type: 'switch', key, label, ...extra });
const text = (key, label, placeholder, extra = {}) =>
  ({ type: 'text', key, label, placeholder, ...extra });

/** Opções específicas de cada formato de destino. */
export const TARGET_OPTIONS = {
  base64: [
    segmented('alphabet', 'ui.opt.alphabet', [
      { id: 'standard', label: 'ui.opt.standard' },
      { id: 'url', label: 'ui.opt.urlSafe' },
    ]),
    toggle('padding', 'ui.opt.padding'),
    toggle('wrap', 'ui.opt.wrap'),
  ],

  text: [toggle('strict', 'ui.opt.strict')],

  json: [
    segmented('values', 'ui.opt.values', [
      { id: 'example', label: 'ui.opt.example' },
      { id: 'empty', label: 'ui.opt.empty' },
    ], { when: (state) => state.fromFamily === 'lang' }),
  ],

  yaml: [
    segmented('values', 'ui.opt.values', [
      { id: 'example', label: 'ui.opt.example' },
      { id: 'empty', label: 'ui.opt.empty' },
    ], { when: (state) => state.fromFamily === 'lang' }),
  ],

  java: [
    segmented('style', 'ui.opt.style', [
      { id: 'record', label: 'ui.opt.record' },
      { id: 'pojo', label: 'ui.opt.pojo' },
      { id: 'lombok', label: 'ui.opt.lombok' },
    ]),
    text('packageName', 'ui.opt.package', 'ui.opt.packagePlaceholder'),
    toggle('jackson', 'ui.opt.jackson'),
    toggle('jacksonAll', 'ui.opt.jacksonAll', { when: (state) => state.jackson }),
    toggle('primitives', 'ui.opt.primitives', { when: (state) => state.style !== 'record' }),
    toggle('separateFiles', 'ui.opt.separateFiles'),
  ],

  csharp: [
    segmented('style', 'ui.opt.style', [
      { id: 'class', label: 'ui.opt.class' },
      { id: 'record', label: 'ui.opt.record' },
      { id: 'struct', label: 'ui.opt.struct' },
    ]),
    text('namespaceName', 'ui.opt.namespace', 'ui.opt.namespacePlaceholder'),
    toggle('jsonAttributes', 'ui.opt.jsonAttributes'),
    toggle('jsonAttributesAll', 'ui.opt.jsonAttributesAll', { when: (state) => state.jsonAttributes }),
    toggle('nullableAnnotations', 'ui.opt.nullable'),
  ],

  typescript: [
    segmented('style', 'ui.opt.style', [
      { id: 'interface', label: 'ui.opt.interface' },
      { id: 'type', label: 'ui.opt.typeAlias' },
      { id: 'class', label: 'ui.opt.class' },
      { id: 'angular', label: 'ui.opt.angular' },
    ]),
    toggle('exportTypes', 'ui.opt.exportTypes'),
    toggle('optionalMarker', 'ui.opt.optionalMarker'),
    toggle('readonlyFields', 'ui.opt.readonly'),
    toggle('useDate', 'ui.opt.useDate'),
  ],

  dart: [
    toggle('finalFields', 'ui.opt.finalFields'),
    toggle('jsonMethods', 'ui.opt.jsonMethods'),
    toggle('namedParameters', 'ui.opt.namedParameters'),
  ],

  swift: [
    segmented('style', 'ui.opt.style', [
      { id: 'struct', label: 'ui.opt.struct' },
      { id: 'class', label: 'ui.opt.class' },
    ]),
    toggle('codable', 'ui.opt.codable'),
    toggle('letConstants', 'ui.opt.letConstants'),
    toggle('codingKeys', 'ui.opt.codingKeys'),
  ],

  go: [
    text('packageName', 'ui.opt.package', 'ui.opt.goPackagePlaceholder'),
    toggle('jsonTags', 'ui.opt.jsonTags'),
    toggle('omitempty', 'ui.opt.omitempty', { when: (state) => state.jsonTags }),
    toggle('pointerOptionals', 'ui.opt.pointerOptionals'),
    toggle('useTime', 'ui.opt.useTime'),
  ],
};

/** Opções que dependem do par, não do destino sozinho. */
export const SHARED_OPTIONS = [
  // Só há um nome de tipo para escolher quando a origem não nomeia tipos.
  text('rootName', 'ui.opt.className', 'ui.opt.classNamePlaceholder', {
    when: (state) => state.fromFamily === 'data' && state.toFamily === 'lang',
  }),
  toggle('detectDateTime', 'ui.opt.detectDates', {
    when: (state) => state.fromFamily === 'data' && state.toFamily === 'lang',
  }),
  {
    type: 'select',
    key: 'rootType',
    label: 'ui.opt.rootType',
    dynamic: 'detectedTypes',
    when: (state) => state.fromFamily === 'lang' && (state.detectedTypes || []).length > 1,
  },
];

/**
 * @param {HTMLElement} container
 * @param {(key: string, value: any) => void} onChange
 */
export function createOptionsPanel(container, onChange) {
  let signature = '';
  let controls = new Map();

  function visibleSpecs(state) {
    const target = TARGET_OPTIONS[state.to] || [];
    return [...SHARED_OPTIONS, ...target].filter((spec) => !spec.when || spec.when(state));
  }

  function structureSignature(state, specs) {
    return [
      getLanguage(),
      state.to,
      ...specs.map((spec) => (spec.dynamic ? `${spec.key}:${(state[spec.dynamic] || []).join(',')}` : spec.key)),
    ].join('|');
  }

  function build(state, specs) {
    container.replaceChildren();
    controls = new Map();

    specs.forEach((spec, index) => {
      // Um filete separa as opções gerais das específicas do formato.
      if (index > 0 && index === SHARED_OPTIONS.filter((s) => specs.includes(s)).length) {
        const separator = document.createElement('div');
        separator.className = 'field__sep';
        container.append(separator);
      }

      const field = document.createElement('div');
      field.className = 'field';

      const label = document.createElement('span');
      label.className = 'field__label';
      label.textContent = t(spec.label);
      field.append(label);

      const control = createControl(spec, onChange);
      field.append(control.element);
      controls.set(spec.key, control);
      container.append(field);
    });
  }

  return {
    render(state) {
      const specs = visibleSpecs(state);
      const nextSignature = structureSignature(state, specs);
      if (nextSignature !== signature) {
        signature = nextSignature;
        build(state, specs);
      }
      for (const control of controls.values()) control.sync(state);
      container.dataset.empty = t('ui.options.none');
      return specs.length;
    },
    refresh() {
      for (const control of controls.values()) control.reposition?.();
    },
    count(state) {
      return visibleSpecs(state).length;
    },
  };
}

function createControl(spec, onChange) {
  switch (spec.type) {
    case 'segmented': return createSegmented(spec, onChange);
    case 'switch': return createSwitch(spec, onChange);
    case 'text': return createTextInput(spec, onChange);
    case 'select': return createSelect(spec, onChange);
    default: throw new Error(`Controle desconhecido: ${spec.type}`);
  }
}

function createSegmented(spec, onChange) {
  const element = document.createElement('div');
  element.className = 'segmented';
  element.setAttribute('role', 'group');
  element.setAttribute('aria-label', t(spec.label));

  const indicator = document.createElement('span');
  indicator.className = 'segmented__indicator';
  indicator.setAttribute('aria-hidden', 'true');
  element.append(indicator);

  const buttons = spec.options.map((option) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'segmented__option';
    button.textContent = t(option.label);
    button.dataset.value = option.id;
    button.setAttribute('aria-pressed', 'false');
    button.addEventListener('click', () => onChange(spec.key, option.id));
    element.append(button);
    return button;
  });

  function reposition() {
    const active = buttons.find((button) => button.getAttribute('aria-pressed') === 'true') || buttons[0];
    if (!active || !active.offsetWidth) return;
    element.style.setProperty('--indicator-width', `${active.offsetWidth}px`);
    element.style.setProperty('--indicator-x', `${active.offsetLeft - 2}px`);
  }

  return {
    element,
    reposition,
    sync(state) {
      for (const button of buttons) {
        button.setAttribute('aria-pressed', String(button.dataset.value === state[spec.key]));
      }
      requestAnimationFrame(reposition);
    },
  };
}

function createSwitch(spec, onChange) {
  const element = document.createElement('button');
  element.type = 'button';
  element.className = 'switch';
  element.setAttribute('aria-pressed', 'false');
  element.setAttribute('aria-label', t(spec.label));

  const track = document.createElement('span');
  track.className = 'switch__track';
  track.setAttribute('aria-hidden', 'true');
  element.append(track);

  element.addEventListener('click', () => {
    onChange(spec.key, element.getAttribute('aria-pressed') !== 'true');
  });

  return {
    element,
    sync(state) {
      element.setAttribute('aria-pressed', String(Boolean(state[spec.key])));
    },
  };
}

function createTextInput(spec, onChange) {
  const element = document.createElement('input');
  element.type = 'text';
  element.className = 'text-input';
  element.placeholder = spec.placeholder ? t(spec.placeholder) : '';
  element.spellcheck = false;
  element.autocomplete = 'off';
  element.setAttribute('aria-label', t(spec.label));

  element.addEventListener('input', () => onChange(spec.key, element.value));

  return {
    element,
    sync(state) {
      const value = state[spec.key] ?? '';
      if (document.activeElement !== element && element.value !== value) element.value = value;
    },
  };
}

function createSelect(spec, onChange) {
  const element = document.createElement('select');
  element.className = 'select';
  element.setAttribute('aria-label', t(spec.label));
  element.addEventListener('change', () => onChange(spec.key, element.value));

  return {
    element,
    sync(state) {
      const values = state[spec.dynamic] || [];
      const current = state[spec.key] || values[0] || '';
      const existing = [...element.options].map((option) => option.value);
      const changed = existing.length !== values.length || existing.some((value, index) => value !== values[index]);

      if (changed) {
        element.replaceChildren();
        for (const value of values) {
          const option = document.createElement('option');
          option.value = value;
          option.textContent = value;
          element.append(option);
        }
      }
      if (element.value !== current) element.value = current;
    },
  };
}
