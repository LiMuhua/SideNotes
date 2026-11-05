/**
 * 设计系统页面（组件、令牌）共用的结构：页首说明、目录与示例框。
 */

import type { ReactNode } from 'react';
import { cx } from '../ui/context';

export function PageIntro({ title, description }: { title: string; description: ReactNode }) {
  return (
    <header className="sn-page-intro">
      <h1 className="sn-page-title">{title}</h1>
      <p className="sn-page-description">{description}</p>
    </header>
  );
}

/** 页内目录：只滚动页面自身的滚动区。 */
export function PageToc({ sections }: { sections: ReadonlyArray<{ id: string; label: string }> }) {
  return (
    <nav className="sn-page-toc" aria-label="本页目录">
      {sections.map((section) => (
        <button
          key={section.id}
          type="button"
          className="sn-page-toc-link"
          onClick={() => document.getElementById(section.id)?.scrollIntoView({ block: 'start', behavior: 'smooth' })}
        >
          {section.label}
        </button>
      ))}
    </nav>
  );
}

export function PageSection({ id, title, description, children }: { id: string; title: string; description?: string; children: ReactNode }) {
  return (
    <section id={id} className="sn-page-section" aria-labelledby={`${id}-title`}>
      <h2 id={`${id}-title`} className="sn-page-section-title">
        {title}
      </h2>
      {description ? <p className="sn-page-section-description">{description}</p> : null}
      {children}
    </section>
  );
}

/** 一个组件的示例：标题、可选说明，以及示例区。 */
export function Demo({ title, note, children, wide = false }: { title: string; note?: string; children: ReactNode; wide?: boolean }) {
  return (
    <div className={cx('sn-demo', wide && 'is-wide')}>
      <div className="sn-demo-head">
        <h3 className="sn-demo-title">{title}</h3>
        {note ? <p className="sn-demo-note">{note}</p> : null}
      </div>
      <div className="sn-demo-stage">{children}</div>
    </div>
  );
}

/** 状态并列：每一格下方标出状态名。 */
export function StateCell({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="sn-state-cell">
      <div className="sn-state-cell-body">{children}</div>
      <span className="sn-state-cell-label">{label}</span>
    </div>
  );
}

export function DemoRow({ children }: { children: ReactNode }) {
  return <div className="sn-demo-row">{children}</div>;
}
