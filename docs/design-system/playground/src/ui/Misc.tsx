/**
 * 小型展示组件：快捷键、徽标、标签、分隔线、面板、卡片、加载指示、骨架屏、空状态与错误状态。
 */

import type { ReactNode } from 'react';
import { cx } from './context';
import { Icon, type IconName } from './Icon';

/** 快捷键组合，如「Ctrl+Shift+K」，每个键单独一个 kbd。 */
export function Keys({ combo, tone = 'default' }: { combo: string; tone?: 'default' | 'inverse' | 'accent' }) {
  const keys = combo.split('+').map((key) => key.trim()).filter(Boolean);
  return (
    <span className={cx('sn-keys', tone !== 'default' && `is-${tone}`)} aria-label={combo}>
      {keys.map((key, index) => (
        <kbd key={`${key}-${index}`} className="sn-kbd">
          {key}
        </kbd>
      ))}
    </span>
  );
}

/** 计数徽标。 */
export function Badge({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'accent' | 'danger' }) {
  return <span className={cx('sn-badge', tone !== 'neutral' && `is-${tone}`)}>{children}</span>;
}

export interface TagProps {
  label: string;
  selected?: boolean;
  /** 提供时标签可点击，例如按标签筛选。 */
  onClick?: () => void;
  /** 提供时显示移除按钮。 */
  onRemove?: () => void;
  size?: 'sm' | 'md';
}

/** 标签：沿用现有记录的 #标签 语义，与文件夹分开。 */
export function Tag({ label, selected = false, onClick, onRemove, size = 'md' }: TagProps) {
  const content = (
    <>
      <span className="sn-tag-hash" aria-hidden="true">
        #
      </span>
      <span className="sn-tag-label">{label}</span>
    </>
  );
  return (
    <span className={cx('sn-tag', `is-${size}`, selected && 'is-selected', onRemove && 'has-remove')}>
      {onClick ? (
        <button type="button" className="sn-tag-main" aria-pressed={selected} onClick={onClick}>
          {content}
        </button>
      ) : (
        <span className="sn-tag-main">{content}</span>
      )}
      {onRemove ? (
        <button type="button" className="sn-tag-remove" aria-label={`移除标签 ${label}`} onClick={onRemove}>
          <Icon name="x" />
        </button>
      ) : null}
    </span>
  );
}

export function Divider({ vertical = false }: { vertical?: boolean }) {
  return <hr className={cx('sn-divider', vertical && 'is-vertical')} aria-orientation={vertical ? 'vertical' : 'horizontal'} />;
}

export interface PanelProps {
  title: string;
  /** 标题右侧的操作，通常是一两个图标按钮。 */
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}

/** 面板：带标题栏的区域，如设置分组、组件页的示例区。层级靠标题与留白，不额外加阴影。 */
export function Panel({ title, actions, children, className }: PanelProps) {
  return (
    <section className={cx('sn-panel', className)}>
      <header className="sn-panel-head">
        <h3 className="sn-panel-title">{title}</h3>
        {actions ? <div className="sn-panel-actions">{actions}</div> : null}
      </header>
      <div className="sn-panel-body">{children}</div>
    </section>
  );
}

/** 卡片：独立的一块内容，可选为可点击。只在内容需要分块时使用，列表默认不用卡片。 */
export function Card({ children, interactive = false, className }: { children: ReactNode; interactive?: boolean; className?: string }) {
  return <div className={cx('sn-card', interactive && 'is-interactive', className)}>{children}</div>;
}

export function Spinner({ label = '加载中' }: { label?: string }) {
  return (
    <span className="sn-spinner" role="status" aria-label={label}>
      <Icon name="loader" />
    </span>
  );
}

/** 骨架屏：数据加载期间占位，保持布局稳定。 */
export function Skeleton({ lines = 3 }: { lines?: number }) {
  return (
    <div className="sn-skeleton" aria-hidden="true">
      {Array.from({ length: lines }, (_, index) => (
        <span key={index} className="sn-skeleton-line" />
      ))}
    </div>
  );
}

export interface StateProps {
  icon: IconName;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  tone?: 'neutral' | 'danger';
}

/** 空状态与错误状态共用的结构：图标、标题、说明、一个主要操作。 */
export function EmptyState({ icon, title, description, action, tone = 'neutral' }: StateProps) {
  return (
    <div className={cx('sn-state', tone === 'danger' && 'is-danger')} role={tone === 'danger' ? 'alert' : undefined}>
      <span className="sn-state-icon">
        <Icon name={icon} />
      </span>
      <p className="sn-state-title">{title}</p>
      {description ? <p className="sn-state-description">{description}</p> : null}
      {action ? <div className="sn-state-action">{action}</div> : null}
    </div>
  );
}
