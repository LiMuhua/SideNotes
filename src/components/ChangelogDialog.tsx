/**
 * 版本与更新弹窗。
 *
 * 结构与类名沿用原型 app.js 的 showChangelog：版本摘要、更新说明与「检查更新」。
 * 桌面端只列出当前版本的更新内容，按分号拆成要点；弹窗收窄，内容不会出现滚动条。
 * 完整的版本历史保留在 core/changelog.ts。原型中只在演示模式出现的更新模拟与测试数据按钮不在桌面端提供。
 */

import { Icon } from './Icon';
import { Modal } from './Modal';
import { CHANGELOG } from '../core/changelog';
import { useToast } from '../hooks/useToast';

/** 把一句更新说明按分号拆成要点，去掉句末的句号。 */
function points(summary: string): string[] {
  return summary
    .split('；')
    .map((item) => item.trim().replace(/。$/, ''))
    .filter(Boolean);
}

export function ChangelogDialog({ onClose }: { onClose: () => void }) {
  const toast = useToast();
  const latest = CHANGELOG[0];
  return (
    <Modal title="版本与更新" className="changelog-modal" footer={null} onClose={onClose}>
      <p className="version-summary">{`SideNotes ${__APP_VERSION__}`}</p>
      <ul className="update-notes">
        {points(latest.summary).map((point) => (
          <li key={point}>{point}</li>
        ))}
      </ul>
      <div className="update-actions">
        <button
          type="button"
          className="button secondary"
          data-action=""
          aria-label="检查更新"
          onClick={() => toast('更新服务待桌面端接入')}
        >
          <Icon name="restore" />
          检查更新
        </button>
      </div>
    </Modal>
  );
}
