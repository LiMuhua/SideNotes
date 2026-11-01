/**
 * 字体组合框。
 *
 * 对应原型 settings.js 的 fontPicker：展开即列出常用字体与系统已安装的字体，输入时按输入内容
 * 过滤候选，也可以直接使用输入的字体名。桌面端由后端读取系统字体，不再需要网页的字体访问授权；
 * 浏览器预览读不到系统字体，只列出常用字体。
 */

import { useEffect, useState } from 'react';
import * as bridge from '../../core/bridge';
import { Combobox, type ComboOption } from './Combobox';

/** 常见字体，与原型列表一致。 */
const FONTS = [
  '系统默认',
  'Microsoft YaHei UI',
  'Microsoft YaHei',
  'Segoe UI',
  'SimSun',
  'KaiTi',
  'Arial',
  'Consolas',
  'Noto Sans CJK SC',
];

const DEFAULT_LABEL = '系统默认';

/* ==================== 系统字体 ==================== */

/** 已读取的系统字体，设置窗口内共享，只读取一次。 */
let installedFonts: string[] = [];
let loading: Promise<string[]> | null = null;

function loadSystemFonts(): Promise<string[]> {
  loading ??= bridge
    .systemFonts()
    .then((fonts) => (installedFonts = fonts))
    .catch(() => installedFonts);
  return loading;
}

/* ==================== 组合框 ==================== */

export function FontPicker({ value, onChoose }: { value: string; onChoose: (family: string) => Promise<boolean> }) {
  const saved = value || DEFAULT_LABEL;
  const [fonts, setFonts] = useState(installedFonts);

  useEffect(() => {
    let alive = true;
    void loadSystemFonts().then((list) => {
      if (alive) setFonts(list);
    });
    return () => {
      alive = false;
    };
  }, []);

  const families = [...new Set([...FONTS, ...fonts, value].filter(Boolean))];

  /** 输入时只列出名称包含输入内容的字体（不区分大小写）；没有同名字体时提供「使用输入的字体」。 */
  const options = (typed: string | null): ComboOption[] => {
    const query = typed?.trim() ?? '';
    const key = query.toLocaleLowerCase();
    const matched = key ? families.filter((family) => family.toLocaleLowerCase().includes(key)) : families;
    const choices: ComboOption[] = matched.map((family) => ({ value: family, label: family }));
    if (query && query !== DEFAULT_LABEL && !families.some((family) => family.toLocaleLowerCase() === key)) {
      choices.push({ value: query, label: `使用“${query}”`, className: 'font-custom-option' });
    }
    return choices;
  };

  return (
    <Combobox
      className="settings-font-combobox"
      text={saved}
      selected={saved}
      label="字体"
      placeholder="选择或输入字体"
      options={options}
      onCommit={(raw) => {
        const family = raw.trim();
        return onChoose(!family || family === DEFAULT_LABEL ? '' : family.slice(0, 120));
      }}
    />
  );
}
