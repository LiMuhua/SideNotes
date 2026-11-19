/**
 * 字体组合框。
 *
 * 展开即列出「跟随主题」、常用字体与系统已安装的字体，末尾固定「系统默认」（原型第二版 settings.js 的 fontPicker）。
 * 输入时按名称筛选；没有对得上的字体时，第一项提示「“名称”不可用」，第二项是「使用系统默认字体」
 * （2026-11-18 用户要求，原型输入时列表不变、末尾多一项「使用“名称”」）。回车选用筛出的第一项；
 * 没有对得上的字体时回车不提交。桌面端由后端读取系统字体；浏览器预览读不到系统字体，只列出常用字体。
 * 筛出的候选按对得上的程度排序（名称开头的在前，见 core/fonts 的 filterFonts）；列表始终在输入框下方（T112）。
 */

import { useEffect, useState } from 'react';
import * as bridge from '../../core/bridge';
import { FOLLOW_THEME_LABEL, SYSTEM_FONT_LABEL, filterFonts, typedFont } from '../../core/fonts';
import { THEME_FONTS, surfaceSpec } from '../../core/surfaces';
import type { SurfaceMode } from '../../core/types';
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

  /** 全部候选：最前是「跟随主题」，末尾固定「系统默认」。 */
  const all: ComboOption[] = [
    follow,
    ...families.map((family) => ({
      value: family,
      label: family,
      fontFamily: `"${family.replace(/["\\]/g, '')}"`,
    })),
    SYSTEM_OPTION,
  ];
  /** 按输入筛选；一项都没有时给出不可用的提示与「使用系统默认字体」。 */
  const options = (typed: string | null): ComboOption[] => {
    if (typed === null) return all;
    const found = filterFonts(all, typed);
    if (found.length) return found;
    const name = typed.trim();
    return [
      { value: '', label: `“${name}”不可用`, className: 'font-unavailable-option', disabled: true },
      { value: SYSTEM_FONT_LABEL, label: '使用系统默认字体' },
    ];
  };
  /** 回车：名称与候选完全相同（不分大小写）时用这一项，否则用筛出的第一项；没有对得上的字体时不提交。 */
  const pickOnEnter = (typed: string, choices: ComboOption[]): string | null => {
    const exact = typedFont(families, typed);
    if (exact.known) return exact.family || FOLLOW_THEME_LABEL;
    const first = choices[0];
    return first && !first.disabled ? first.value : null;
  };

  return (
    <Combobox
      className="settings-font-combobox"
      text={saved}
      selected={saved}
      label="字体"
      placeholder="选择或输入字体"
      options={options}
      pickOnEnter={pickOnEnter}
      stayBelow
      onCommit={(raw) => {
        const chosen = typedFont(families, raw);
        // 列表之外的名称不保存，输入框回到已保存的字体。
        return chosen.known ? onChoose(chosen.family) : false;
      }}
    />
  );
}
