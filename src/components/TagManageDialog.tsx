/**
 * 管理标签。
 *
 * 对应原型 app.js 的 manageTag：只修改标签、保留记录内容，
 * 可在所有记录中重命名（与已有标签同名时合并），或经二次确认后全局移除。
 */

import { useState } from 'react';
import { Icon } from './Icon';
import { ConfirmDialog, Modal } from './Modal';
import { TagInput } from './TagInput';
import * as store from '../core/store';
import { isValidTag } from '../core/tags';
import { useToast } from '../hooks/useToast';

export interface TagManageDialogProps {
  tag: string;
  onClose: () => void;
  /** 重命名成功，参数为新标签名。 */
  onRenamed: (next: string) => void;
  /** 全局移除成功。 */
  onRemoved: () => void;
}

export function TagManageDialog({ tag, onClose, onRenamed, onRemoved }: TagManageDialogProps) {
  const toast = useToast();
  const [name, setName] = useState(tag);
  const [confirming, setConfirming] = useState(false);

  const rename = async (): Promise<void> => {
    const next = name.trim().replace(/^#/, '');
    if (!isValidTag(next)) {
      toast('标签最多40字；使用文字、数字、下划线或短横线，避免十六进制色值', null, true);
      return;
    }
    if (!(await store.renameTag(tag, next))) {
      toast('标签未更新，本地保存失败，请重试', null, true);
      return;
    }
    onRenamed(next);
    toast('标签已更新，相同标签已合并');
  };

  if (confirming) {
    return (
      <ConfirmDialog
        title={`移除 #${tag}？`}
        description="从所有记录中移除此标签；记录正文与附件保留。"
        confirmLabel="移除标签"
        onConfirm={async () => {
          if (!(await store.removeTagEverywhere(tag))) {
            toast('标签未移除，本地保存失败，请重试', null, true);
            return false;
          }
          onRemoved();
          return true;
        }}
        onCancel={() => setConfirming(false)}
      />
    );
  }

  return (
    <Modal
      title={`管理 #${tag}`}
      className="tag-manage-modal"
      onClose={onClose}
      footer={
        <>
          <button
            type="button"
            className="button danger"
            data-action=""
            aria-label="移除此标签"
            title="移除此标签"
            onClick={() => setConfirming(true)}
          >
            <Icon name="trash" />
            移除此标签
          </button>
          <button
            type="button"
            className="button primary"
            data-action=""
            aria-label="重命名 / 合并"
            title="重命名 / 合并"
            onClick={() => void rename()}
          >
            <Icon name="edit" />
            重命名 / 合并
          </button>
        </>
      }
    >
      <p className="modal-hint">只修改标签，保留记录内容。</p>
      <TagInput
        className="form-control tag-name-input"
        aria-label="标签名称"
        value={name}
        exclude={[tag]}
        onValueChange={setName}
        onKeyDown={(event) => {
          if (event.key !== 'Enter' || event.nativeEvent.isComposing) return;
          event.preventDefault();
          void rename();
        }}
      />
    </Modal>
  );
}
