/**
 * 组件共享的上下文：当前主题与窗口形态。
 *
 * 结构差异（是否在按钮上显示快捷键、列表行的形态等）由主题说明决定，见 `surfaces.ts`；
 * 数值差异全部来自令牌，组件不需要知道当前是哪个主题。
 * 窗口形态区分桌面与手机：手机上没有实体键盘与屏幕边缘的侧栏，不显示快捷键、固定与收起。
 */

import { createContext, useContext } from 'react';
import { SURFACES, type SurfaceSpec } from '../surfaces';

export const SurfaceContext = createContext<SurfaceSpec>(SURFACES[0]);

export function useSurface(): SurfaceSpec {
  return useContext(SurfaceContext);
}

export type FormFactor = 'desktop' | 'phone';

export const FormContext = createContext<FormFactor>('desktop');

export function useFormFactor(): FormFactor {
  return useContext(FormContext);
}

/** 拼接类名，忽略假值。 */
export function cx(...names: Array<string | false | null | undefined>): string {
  return names.filter(Boolean).join(' ');
}
