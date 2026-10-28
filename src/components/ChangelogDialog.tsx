/**
 * 版本与更新弹窗。
 *
 * 结构、类名与文案对照原型 app.js 的 showChangelog：版本摘要、各版本说明与「检查更新」。
 * 原型中只在演示模式出现的更新模拟与测试数据按钮不在桌面端提供。
 */

import { Icon } from './Icon';
import { Modal } from './Modal';
import { CHANGELOG } from '../core/changelog';
import { useToast } from '../hooks/useToast';

export function ChangelogDialog({ onClose }: { onClose: () => void }) {
  const toast = useToast();
  return (
    <Modal title="版本与更新" className="changelog-modal" footer={null} onClose={onClose}>
      <p className="version-summary">{`SideNotes ${__APP_VERSION__} PREVIEW`}</p>
      <div className="changelog-list">
        {CHANGELOG.map((entry) => (
          <section key={entry.version} className="changelog-entry">
            <h3>{entry.version}</h3>
            <p>{entry.summary}</p>
          </section>
        ))}
      </div>
      <div className="update-actions">
        <button
          type="button"
          className="button secondary"
          data-action=""
          aria-label="检查更新"
          title="检查更新"
          onClick={() => toast('更新服务待桌面端接入')}
        >
          <Icon name="restore" />
          检查更新
        </button>
      </div>
    </Modal>
  );
}
