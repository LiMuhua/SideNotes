/**
 * 使用指南。
 *
 * 卡片上原本用悬停提示（title）说明单击、双击、右键与长按等操作，鼠标停留就会弹出，干扰阅读；
 * 这些说明集中到这里：首次启动时显示一次（设置中记下 guideSeen），之后可从侧栏空白处的右键菜单再次打开。
 */

import { Modal } from './Modal';

/** 指南条目：分组标题与要点。 */
const SECTIONS: ReadonlyArray<{ title: string; tips: readonly string[] }> = [
  {
    title: '卡片',
    tips: [
      '单击选中卡片，按 Ctrl+C 复制；双击进入编辑。',
      '右键卡片打开更多操作；按住卡片拖动可以排序，拖到页签或回收站即移动过去。',
      '正文较长时渐隐显示，双击卡片查看全文。',
    ],
  },
  {
    title: '编辑',
    tips: [
      'Ctrl+Enter 保存，Esc 取消。新建卡片保存后侧栏保持展开，可以接着记下一条。',
      '支持 Markdown 快捷键与 #标签；粘贴截图或文件会保存一份副本，插入到光标处。',
    ],
  },
  {
    title: '侧栏',
    tips: [
      '鼠标移到屏幕边缘呼出侧栏，移开后自动收起；固定按钮可以让它保持展开。',
      'Ctrl+F 搜索，输入 # 按标签查找。',
      '空白处右键打开侧栏菜单，双击空白处收起或展开全部卡片。',
    ],
  },
];

export function UsageGuide({ onClose }: { onClose: () => void }) {
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
      {SECTIONS.map((section) => (
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
