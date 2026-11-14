/**
 * 组件页：当前主题与明暗下的侧栏组件与基础控件。
 *
 * 示例在令牌作用域内渲染，与桌面场景中的窗口使用同一套令牌与样式；
 * 这里按 13px 的设计基准显示，不做字号缩放。
 */

import { SURFACE_BY_ID } from '../surfaces';
import { usePlayground } from '../shell/state';
import { TokenScope } from '../ui/Scope';
import { PageIntro, PageToc } from './common';
import { ControlsSection } from './GalleryControls';
import { EditingSection } from './GalleryEditing';
import { NotesSection, OverlaySection, PartsSection } from './GalleryNotes';
import { WindowsSection } from './GalleryWindows';

const SECTIONS = [
  { id: 'gallery-cards', label: '记录卡片' },
  { id: 'gallery-editing', label: '编辑模式' },
  { id: 'gallery-parts', label: '侧栏部件' },
  { id: 'gallery-windows', label: '记录窗口' },
  { id: 'gallery-overlays', label: '菜单、弹窗与提示' },
  { id: 'gallery-controls', label: '基础控件' },
];

export function GalleryPage() {
  const { surface, resolvedTheme } = usePlayground();
  const spec = SURFACE_BY_ID[surface];
  return (
    <TokenScope className="sn-page">
      <div className="sn-page-scroll">
        <div className="sn-page-content">
          <PageIntro
            title="组件"
            description={`「${spec.name}」主题，${resolvedTheme === 'dark' ? '深色' : '浅色'}模式。切换主题或明暗后，所有组件随令牌一起变化；卡片、页签、新建卡片都是侧栏中真实的组件。`}
          />
          <PageToc sections={SECTIONS} />
          <NotesSection />
          <EditingSection />
          <PartsSection />
          <WindowsSection />
          <OverlaySection />
          <ControlsSection />
        </div>
      </div>
    </TokenScope>
  );
}
