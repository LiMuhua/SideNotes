/**
 * 设置页里显示路径的一段（原型 pathText）：等宽小字，只占一行，放不下时末尾省略，不把别的控件挤乱。
 * 被截断时悬停显示完整路径；双击复制完整路径并提示（双击不选中文字）。数据目录、快照目录与云端的远程文件夹共用。
 */

import { useState } from 'react';
import * as bridge from '../../core/bridge';
import { useToast } from '../../hooks/useToast';

export function PathText({ label, path }: { label: string; path: string }) {
  const toast = useToast();
  const [full, setFull] = useState<string | undefined>(undefined);
  return (
    <code
      className="settings-path"
      aria-label={label}
      title={full}
      onMouseEnter={(event) => {
        const node = event.currentTarget;
        setFull(node.scrollWidth > node.clientWidth ? path : undefined);
      }}
      onMouseDown={(event) => {
        if (event.detail > 1) event.preventDefault();
      }}
      onDoubleClick={(event) => {
        event.preventDefault();
        void bridge
          .writeClipboardText(path)
          .then(() => toast('已复制目录路径'))
          .catch(() => toast('无法复制目录路径', null, true));
      }}
    >
      {path}
    </code>
  );
}
