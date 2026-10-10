export type ThemeStyleName = 'flat' | 'glass';
export type ThemeColorName = 'blue' | 'teal' | 'amber';

export interface ThemeOption {
  name: string;
  label: string;
  desc: string;
  swatches: string[];
}

export interface ThemeSelection {
  style: ThemeStyleName;
  color: ThemeColorName;
}

export const STYLE_OPTIONS: Array<ThemeOption & { name: ThemeStyleName }> = [
  {
    name: 'flat',
    label: 'Flat',
    desc: '扁平、克制、偏企业后台的默认观感',
    swatches: ['#ffffff', '#f8fafc', '#0f172a', '#2563eb'],
  },
  {
    name: 'glass',
    label: 'Glass',
    desc: '增加高光、半透明和更强的层次对比',
    swatches: ['#eff6ff', '#dbeafe', '#0f172a', '#60a5fa'],
  },
];

export const COLOR_OPTIONS: Array<ThemeOption & { name: ThemeColorName }> = [
  {
    name: 'blue',
    label: 'Blue',
    desc: '稳健的默认企业蓝',
    swatches: ['#eff6ff', '#3b82f6', '#2563eb', '#0f172a'],
  },
  {
    name: 'teal',
    label: 'Teal',
    desc: '更偏产品和数据工具的青绿色强调',
    swatches: ['#ecfeff', '#14b8a6', '#0f766e', '#0f172a'],
  },
  {
    name: 'amber',
    label: 'Amber',
    desc: '偏暖的金橙色强调，更接近演示型工作台',
    swatches: ['#fffbeb', '#f59e0b', '#d97706', '#1f2937'],
  },
];

export const DEFAULT_THEME: ThemeSelection = {
  style: 'flat',
  color: 'blue',
};

const STORAGE_KEYS = {
  style: 'captable.theme.style',
  color: 'captable.theme.color',
} as const;

export function isThemeStyleName(value: unknown): value is ThemeStyleName {
  return typeof value === 'string' && STYLE_OPTIONS.some((option) => option.name === value);
}

export function isThemeColorName(value: unknown): value is ThemeColorName {
  return typeof value === 'string' && COLOR_OPTIONS.some((option) => option.name === value);
}

export function getStoredTheme(): ThemeSelection {
  try {
    const storedStyle = window.localStorage.getItem(STORAGE_KEYS.style);
    const storedColor = window.localStorage.getItem(STORAGE_KEYS.color);
    return {
      style: isThemeStyleName(storedStyle) ? storedStyle : DEFAULT_THEME.style,
      color: isThemeColorName(storedColor) ? storedColor : DEFAULT_THEME.color,
    };
  } catch {
    return DEFAULT_THEME;
  }
}

export function applyThemeSelection(selection: ThemeSelection) {
  document.documentElement.dataset.themeStyle = selection.style;
  document.documentElement.dataset.themeColor = selection.color;
  try {
    window.localStorage.setItem(STORAGE_KEYS.style, selection.style);
    window.localStorage.setItem(STORAGE_KEYS.color, selection.color);
  } catch {
    // Ignore storage failures; the DOM theme still updates immediately.
  }
}

/**
 * Theme selection plus the settings-page cards that choose it.
 *
 * main.ts owned the current selection and re-rendered the picker from `applyLanguage()`, which meant
 * a language switch rebuilt the theme UI as a side effect of translation. Keeping the selection here
 * lets the page ask for a re-render explicitly.
 */
export type ThemeControlsDeps = {
  el: <T extends HTMLElement>(id: string) => T;
  escapeHtml: (text: unknown) => string;
  /** Localized copy for the color descriptions and the "current" marker. */
  text: (key: 'blueDesc' | 'tealDesc' | 'amberDesc' | 'current') => string;
};

export type ThemeControls = {
  /** Re-apply the stored selection and re-render the picker if it is on screen. */
  apply: () => void;
  setColor: (color: ThemeColorName) => void;
  renderCards: () => void;
};

const COLOR_DESCRIPTIONS: Record<ThemeColorName, 'blueDesc' | 'tealDesc' | 'amberDesc'> = {
  blue: 'blueDesc',
  teal: 'tealDesc',
  amber: 'amberDesc',
};

export function createThemeControls(deps: ThemeControlsDeps): ThemeControls {
  const { el, escapeHtml } = deps;
  let selection = getStoredTheme();

  function renderCards() {
    el('themeColorOptions').innerHTML = COLOR_OPTIONS.map((option) => {
      const desc = deps.text(COLOR_DESCRIPTIONS[option.name]);
      const active = selection.color === option.name;
      return `
      <button
        class="theme-card${active ? ' active' : ''}"
        type="button"
        data-theme-color="${option.name}"
      >
        <span class="theme-card-head">
          <span>
            <strong>${escapeHtml(option.label)}</strong>
            <small>${escapeHtml(desc)}</small>
          </span>
          ${active ? `<span class="theme-check">${escapeHtml(deps.text('current'))}</span>` : ''}
        </span>
        <span class="theme-swatches" aria-hidden="true">
          ${option.swatches.map((color) => `<span class="theme-swatch" style="background-color:${escapeHtml(color)}"></span>`).join('')}
        </span>
      </button>`;
    }).join('');

    document.querySelectorAll<HTMLElement>('[data-theme-color]').forEach((button) => {
      button.addEventListener('click', () => setColor(button.dataset.themeColor as ThemeColorName));
    });
  }

  function apply() {
    applyThemeSelection(selection);
    if (document.getElementById('themeColorOptions')) {
      renderCards();
    }
  }

  function setColor(color: ThemeColorName) {
    if (selection.color === color) return;
    selection = { ...selection, color };
    apply();
  }

  return { apply, setColor, renderCards };
}
