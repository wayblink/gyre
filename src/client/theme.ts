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

export function getThemeStyleOption(name: ThemeStyleName) {
  return STYLE_OPTIONS.find((option) => option.name === name) ?? STYLE_OPTIONS[0];
}

export function getThemeColorOption(name: ThemeColorName) {
  return COLOR_OPTIONS.find((option) => option.name === name) ?? COLOR_OPTIONS[0];
}
