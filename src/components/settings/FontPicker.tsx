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
import { FOLLOW_THEME_LABEL, SYSTEM_FONT_LABEL, matchFonts, resolveFont } from '../../core/fonts';
import { THEME_FONTS, surfaceSpec } from '../../core/surfaces';
import type { SurfaceMode } from '../../core/types';
import { useToast } from '../../hooks/useToast';
import { Combobox, type ComboOption } from './Combobox';

/** 常见字体与五套主题用到的字体（与原型 settings.js 的 FONTS 相同）。「跟随主题」在最前，「系统默认」固定在列表末尾。 */
const FONTS = [
  'Maple Mono NF CN',
  'Microsoft YaHei UI',
  'Microsoft YaHei',
  'Segoe UI Variable Text',
  'Segoe UI',
  'SimSun',
  'KaiTi',
  'Georgia',
  'Inter',
  'Archivo',
  'Cascadia Mono',
  'Consolas',
  'Noto Sans CJK SC',
];

const SYSTEM_OPTION: ComboOption = { value: SYSTEM_FONT_LABEL, label: SYSTEM_FONT_LABEL, className: 'font-default-option' };

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

/**
 * 字体组合框：空值显示为「跟随主题」，候选写出当前主题与它的界面字体；其余候选用各自的字体显示。
 */
export function FontPicker({
  value,
  surface,
  onChoose,
}: {
  value: string;
  surface: SurfaceMode;
  onChoose: (family: string) => Promise<boolean>;
}) {
  const toast = useToast();
  const saved = value || FOLLOW_THEME_LABEL;
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

  const families = [
    ...new Set([...FONTS, ...fonts, value].filter((family) => family && family !== SYSTEM_FONT_LABEL && family !== FOLLOW_THEME_LABEL)),
  ];
  const follow: ComboOption = {
    value: FOLLOW_THEME_LABEL,
    label: FOLLOW_THEME_LABEL,
    detail: `${surfaceSpec(surface).name} · ${THEME_FONTS[surface]}`,
  };

  /** 输入时只列出匹配的字体（见 matchFonts）；最前是「跟随主题」，末尾固定「系统默认」。 */
  const options = (typed: string | null): ComboOption[] => [
    ...(typed && !FOLLOW_THEME_LABEL.includes(typed.trim()) ? [] : [follow]),
    ...matchFonts(families, typed ?? '').map((family) => ({
      value: family,
      label: family,
      fontFamily: `"${family.replace(/["\\]/g, '')}"`,
    })),
    SYSTEM_OPTION,
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
        const family = resolveFont(families, raw);
        if (family === null) {
          toast(`没有匹配“${raw.trim()}”的字体，字体未更改`, null, true);
          return false;
        }
        return onChoose(family.slice(0, 120));
      }}
    />
  );
}
