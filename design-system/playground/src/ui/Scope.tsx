/**
 * 令牌作用域。
 *
 * 把设计方向、明暗主题与平台写到容器的 data 属性上，令牌文件按这些属性取值；
 * 容器内的浮层、提示条与组件共享同一个方向说明。每个窗口（侧栏、速记浮窗、设置窗口）与组件页、
 * 令牌页都在各自的作用域内渲染，使用的是同一套令牌，不存在「展示用」与「实际用」两份数值。
 */

import { forwardRef, useMemo, type CSSProperties, type ReactNode } from 'react';
import { DIRECTION_BY_ID, type DirectionId } from '../directions';
import { usePlayground } from '../shell/state';
import { cx, DirectionContext, FormContext, type FormFactor } from './context';
import { LayerRoot } from './layer';
import { ToastProvider } from './Tabs';

export interface TokenScopeProps {
  /** 不传时跟随全局设置；方案对比页为每个场景单独指定。 */
  direction?: DirectionId;
  className?: string;
  style?: CSSProperties;
  /** 提示条弹出的位置（设置中的「通知位置」）。 */
  toast?: string;
  /** 窗口形态：手机上不显示快捷键提示。 */
  form?: FormFactor;
  children: ReactNode;
}

export const TokenScope = forwardRef<HTMLDivElement, TokenScopeProps>(function TokenScope({ direction, className, style, toast, form = 'desktop', children }, ref) {
  const playground = usePlayground();
  const id = direction ?? playground.direction;
  // 手机上没有实体键盘：方向说明里的「界面上直接显示快捷键」在这里关闭，组件不必各自判断。
  const spec = useMemo(() => (form === 'phone' ? { ...DIRECTION_BY_ID[id], inlineShortcuts: false } : DIRECTION_BY_ID[id]), [id, form]);
  return (
    <DirectionContext.Provider value={spec}>
      <FormContext.Provider value={form}>
        <div
          ref={ref}
          className={cx('sn-scope', className)}
          data-sn-direction={id}
          data-sn-theme={playground.resolvedTheme}
          data-platform={playground.platform}
          data-form={form}
          data-toast={toast}
          style={style}
        >
          <LayerRoot>
            <ToastProvider>{children}</ToastProvider>
          </LayerRoot>
        </div>
      </FormContext.Provider>
    </DirectionContext.Provider>
  );
});
