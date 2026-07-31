/**
 * Barra de opções: especificação declarativa + construção dos controles.
 *
 * Os controles são criados por API DOM (nunca innerHTML). A barra só é
 * reconstruída quando a *estrutura* muda (campos que aparecem/somem, lista de
 * tipos detectados); caso contrário apenas sincroniza valores — assim o foco do
 * teclado e a posição do cursor nos campos de texto são preservados.
 */

export const SPECS = {
  base64: [
    {
      type: 'segmented',
      key: 'direction',
      label: 'Direção',
      options: [
        { id: 'encode', label: 'Codificar' },
        { id: 'decode', label: 'Decodificar' },
        { id: 'auto', label: 'Auto' },
      ],
    },
    { type: 'separator' },
    {
      type: 'segmented',
      key: 'alphabet',
      label: 'Alfabeto',
      options: [
        { id: 'standard', label: 'Padrão' },
        { id: 'url', label: 'URL-safe' },
      ],
      when: (state) => state.direction !== 'decode',
    },
    { type: 'switch', key: 'padding', label: 'Padding =', when: (state) => state.direction !== 'decode' },
    { type: 'switch', key: 'wrap', label: 'Quebrar em 76', when: (state) => state.direction !== 'decode' },
    { type: 'switch', key: 'strict', label: 'Modo estrito', when: (state) => state.direction !== 'encode' },
  ],

  'json-java': [
    {
      type: 'segmented',
      key: 'direction',
      label: 'Direção',
      options: [
        { id: 'json-to-java', label: 'JSON → Java' },
        { id: 'java-to-json', label: 'Java → JSON' },
      ],
    },
    { type: 'separator' },
    {
      type: 'segmented',
      key: 'style',
      label: 'Estilo',
      options: [
        { id: 'record', label: 'Record' },
        { id: 'pojo', label: 'POJO' },
        { id: 'lombok', label: 'Lombok' },
      ],
      when: (state) => state.direction === 'json-to-java',
    },
    {
      type: 'text',
      key: 'rootClassName',
      label: 'Classe',
      placeholder: 'Root',
      width: 96,
      when: (state) => state.direction === 'json-to-java',
    },
    {
      type: 'text',
      key: 'packageName',
      label: 'Package',
      placeholder: 'com.exemplo',
      width: 128,
      when: (state) => state.direction === 'json-to-java',
    },
    { type: 'switch', key: 'jackson', label: 'Jackson', when: (state) => state.direction === 'json-to-java' },
    {
      type: 'switch',
      key: 'primitives',
      label: 'Primitivos',
      when: (state) => state.direction === 'json-to-java' && state.style !== 'record',
    },
    { type: 'switch', key: 'dateTypes', label: 'java.time', when: (state) => state.direction === 'json-to-java' },
    {
      type: 'switch',
      key: 'separateFiles',
      label: 'Arquivos separados',
      when: (state) => state.direction === 'json-to-java',
    },
    {
      type: 'segmented',
      key: 'values',
      label: 'Valores',
      options: [
        { id: 'example', label: 'Exemplo' },
        { id: 'empty', label: 'Vazios' },
      ],
      when: (state) => state.direction === 'java-to-json',
    },
    {
      type: 'select',
      key: 'rootType',
      label: 'Raiz',
      dynamic: 'detectedTypes',
      when: (state) => state.direction === 'java-to-json' && (state.detectedTypes || []).length > 1,
    },
  ],
};

/**
 * @param {HTMLElement} container
 * @param {(key: string, value: any) => void} onChange
 */
export function createOptionsBar(container, onChange) {
  let signature = '';
  /** @type {Map<string, {sync: (state: any) => void}>} */
  let controls = new Map();

  function visibleSpecs(state) {
    return SPECS[state.tool].filter((spec) => !spec.when || spec.when(state));
  }

  function structureSignature(state, specs) {
    return specs
      .map((spec) => (spec.dynamic ? `${spec.key}:${(state[spec.dynamic] || []).join(',')}` : spec.key || 'sep'))
      .join('|');
  }

  function build(state, specs) {
    container.replaceChildren();
    controls = new Map();

    for (const spec of specs) {
      if (spec.type === 'separator') {
        const separator = document.createElement('span');
        separator.className = 'field__sep';
        container.append(separator);
        continue;
      }

      const field = document.createElement('div');
      field.className = 'field';

      if (spec.label && spec.type !== 'switch') {
        const label = document.createElement('span');
        label.className = 'field__label';
        label.textContent = spec.label;
        field.append(label);
      }

      const control = createControl(spec, state, onChange);
      field.append(control.element);
      controls.set(spec.key, control);
      container.append(field);
    }
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
    },
    /** Reposiciona os indicadores deslizantes (após mudanças de layout). */
    refresh() {
      for (const control of controls.values()) control.reposition?.();
    },
  };
}

function createControl(spec, state, onChange) {
  switch (spec.type) {
    case 'segmented':
      return createSegmented(spec, onChange);
    case 'switch':
      return createSwitch(spec, onChange);
    case 'text':
      return createTextInput(spec, onChange);
    case 'select':
      return createSelect(spec, onChange);
    default:
      throw new Error(`Controle desconhecido: ${spec.type}`);
  }
}

function createSegmented(spec, onChange) {
  const element = document.createElement('div');
  element.className = 'segmented';
  element.setAttribute('role', 'group');
  if (spec.label) element.setAttribute('aria-label', spec.label);

  const indicator = document.createElement('span');
  indicator.className = 'segmented__indicator';
  indicator.setAttribute('aria-hidden', 'true');
  element.append(indicator);

  const buttons = spec.options.map((option) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'segmented__option';
    button.textContent = option.label;
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

  const track = document.createElement('span');
  track.className = 'switch__track';
  track.setAttribute('aria-hidden', 'true');

  const label = document.createElement('span');
  label.textContent = spec.label;

  element.append(track, label);
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
  element.placeholder = spec.placeholder || '';
  element.spellcheck = false;
  element.autocomplete = 'off';
  element.setAttribute('aria-label', spec.label || spec.key);
  if (spec.width) element.style.setProperty('--input-width', `${spec.width}px`);

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
  element.setAttribute('aria-label', spec.label || spec.key);
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
