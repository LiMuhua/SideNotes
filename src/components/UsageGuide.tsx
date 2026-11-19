/**
 * 使用指南。
 *
 * 卡片上原本用悬停提示（title）说明单击、双击、右键与长按等操作，鼠标停留就会弹出，干扰阅读；
 * 这些说明集中到这里：首次启动时显示一次（设置中记下 guideSeen），之后可从侧栏空白处的右键菜单再次打开。
 */

import { Modal } from './Modal';
import { useShortcut } from '../hooks/useShortcut';

/** 指南条目：分组标题与要点；写到的快捷键取当前设置。 */
function guideSections(keys: { save: string; search: string }): ReadonlyArray<{ title: string; tips: readonly string[] }> {
  return [
  {
    title: '卡片',
    tips: [
      '指针移到卡片上或单击即选中（绿色边框），按 Ctrl+C 复制；双击进入编辑。',
      '右键卡片打开更多操作；按住卡片拖动可以排序，拖到页签或回收站即移动过去。',
      '正文较长时渐隐显示，双击卡片查看全文；最大高度可在设置中调整。',
    ],
  },
  {
    title: '编辑',
    tips: [
      `${keys.save} 保存，Esc 取消。新建卡片保存后侧栏保持展开，可以接着记下一条。`,
      '支持 Markdown 快捷键与 #标签；粘贴截图或文件会保存一份副本，插入到光标处。',
      '点击图片或文件查看详情，可以修改引用、更换文件或另存为；按住 Ctrl 点击直接打开。',
      '从资源管理器把文件拖到卡片上即可插入；在卡片上停留片刻会进入编辑，可以放到具体位置。',
    ],
  },
  {
    title: '侧栏',
    tips: [
      '鼠标移到屏幕边缘呼出侧栏，移开后自动收起；固定按钮可以让它保持展开。',
      `${keys.search} 搜索，输入 # 按标签查找。`,
      '空白处右键打开侧栏菜单，按住 Ctrl 右键在卡片上也可以，Shift+F10 也能打开；双击空白处收起或展开全部卡片。',
      '在空白处拖动框选卡片；按住 Ctrl 拖动时从卡片上开始也是框选。',
    ],
  },
  {
    title: '记录窗口',
    tips: [
      '把卡片拖出侧栏打开记录窗口，拖到已经打开的窗口上并进它的标签页；预览里的待办可以直接勾选。',
      '拖动窗口的标题栏或标签页到另一个窗口的标题栏上即合并，拖到窗口外拆开；合并后的窗口默认置顶。',
      '记录窗口被别的程序挡住时，拖动中按住 Ctrl，挡住的窗口会用虚线框标出来，移上去即可并进去。',
    ],
  },
  ];
}

export function UsageGuide({ onClose }: { onClose: () => void }) {
  const save = useShortcut('save');
  const search = useShortcut('search');
  return (
    <Modal
      title="使用指南"
      className="usage-guide-modal"
      onClose={onClose}
      footer={
        <button type="button" className="button primary" onClick={onClose}>
          知道了
        </button>
      }
    >
      {guideSections({ save, search }).map((section) => (
        <section key={section.title} className="usage-guide-section">
          <h3>{section.title}</h3>
          <ul>
            {section.tips.map((tip) => (
              <li key={tip}>{tip}</li>
            ))}
          </ul>
        </section>
      ))}
    </Modal>
  );
}
