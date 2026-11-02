/**
 * 字体组合框。
 *
 * 对应原型 settings.js 的 fontPicker：展开即列出常用字体与系统已安装的字体，输入时按输入内容
 * 过滤候选，回车选用排在第一位的候选；没有匹配的字体时不更改设置并提示，避免写入不存在的字体名后
 * 静默回落到系统默认字体。列表末尾固定一项「系统默认」。桌面端由后端读取系统字体，
 * 不再需要网页的字体访问授权；浏览器预览读不到系统字体，只列出常用字体。
 */

import { useEffect, useState } from 'react';
import * as bridge from '../../core/bridge';
import { matchFonts, resolveFont } from '../../core/fonts';
import { useToast } from '../../hooks/useToast';
import { Combobox, type ComboOption } from './Combobox';

/** 常见字体：随应用打包的默认字体在前，其余与原型列表一致。「系统默认」固定在列表末尾。 */
const FONTS = [
  'Maple Mono NF CN',
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
const DEFAULT_OPTION: ComboOption = { value: DEFAULT_LABEL, label: DEFAULT_LABEL, className: 'font-default-option' };

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
  const toast = useToast();
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

  const families = [...new Set([...FONTS, ...fonts, value].filter((family) => family && family !== DEFAULT_LABEL))];

  /** 输入时只列出匹配的字体（见 matchFonts），末尾固定「系统默认」。 */
  const options = (typed: string | null): ComboOption[] => [
    ...matchFonts(families, typed ?? '').map((family) => ({ value: family, label: family })),
    DEFAULT_OPTION,
  ];

  return (
    <Combobox
      className="settings-font-combobox"
      text={saved}
      selected={saved}
      label="字体"
      placeholder="选择或输入字体"
      options={options}
      onCommit={(raw) => {
        const family = resolveFont(families, raw, DEFAULT_LABEL);
        if (family === null) {
          toast(`没有匹配“${raw.trim()}”的字体，字体未更改`, null, true);
          return false;
        }
        return onChoose(family.slice(0, 120));
      }}
    />
  );
}
