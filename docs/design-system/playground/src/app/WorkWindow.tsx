/**
 * 场景中的工作窗口：模拟用户正在使用的编辑器，侧栏与浮窗浮在它之上。
 *
 * 内容足够「杂乱」（代码、文字、色块），用来检验半透明主题在复杂背景上的可读性
 * （Glance：「背后的画面越杂乱，就磨得越砂」）。它不是 SideNotes 的界面，不使用设计令牌。
 */

const LINES: ReadonlyArray<{ indent: number; text: string; kind?: 'heading' | 'code' | 'comment' }> = [
  { indent: 0, text: '# 季度规划：桌面端体验', kind: 'heading' },
  { indent: 0, text: '目标：记录不打断工作。用户在写代码、开会、看文档时，随手记下一句话、一条命令或一张截图。' },
  { indent: 0, text: '## 本周', kind: 'heading' },
  { indent: 1, text: '- 侧栏贴边唤出，移开即收起；固定后保持展开' },
  { indent: 1, text: '- 速记浮窗：Ctrl+Shift+Space，保存后回到原窗口' },
  { indent: 1, text: '- 标签联想、筛选条、回收站撤销' },
  { indent: 0, text: 'export function debounce<T extends (...args: never[]) => void>(fn: T, ms = 200) {', kind: 'code' },
  { indent: 1, text: 'let timer = 0;', kind: 'code' },
  { indent: 1, text: '// 连续调用只执行最后一次', kind: 'comment' },
  { indent: 1, text: 'return (...args: Parameters<T>) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), ms); };', kind: 'code' },
  { indent: 0, text: '}', kind: 'code' },
  { indent: 0, text: '## 风险', kind: 'heading' },
  { indent: 1, text: '- 透明窗口在 Linux 上没有系统模糊，需要退回实心表面' },
  { indent: 1, text: '- 高分屏下 1px 描边的清晰度；125% 与 150% 缩放都要检查' },
  { indent: 0, text: '会议纪要：五套主题都要实现，设置里随时切换，默认用终端；下周给出正式规范。' },
];

export function WorkWindow() {
  return (
    <div className="sn-work" aria-hidden="true">
      <div className="sn-work-titlebar">
        <span className="sn-work-dots">
          <i />
          <i />
          <i />
        </span>
        <span className="sn-work-title">季度规划.md — 编辑器</span>
      </div>
      <div className="sn-work-body">
        <div className="sn-work-tree">
          {['docs', 'src', 'components', 'core', 'styles', 'tests', 'README.md', 'package.json'].map((item, index) => (
            <span key={item} className="sn-work-file" style={{ paddingLeft: `${(index > 0 && index < 6 ? 1 : 0) * 14 + 10}px` }}>
              {item}
            </span>
          ))}
        </div>
        <div className="sn-work-editor">
          {Array.from({ length: 3 }, (_, round) =>
            LINES.map((line, index) => (
              <p key={`${round}-${index}`} className={`sn-work-line is-${line.kind ?? 'text'}`} style={{ paddingLeft: `${line.indent * 20}px` }}>
                <span className="sn-work-ln">{round * LINES.length + index + 1}</span>
                {line.text}
              </p>
            )),
          )}
        </div>
        <div className="sn-work-preview">
          <span className="sn-work-swatch is-a" />
          <span className="sn-work-swatch is-b" />
          <span className="sn-work-swatch is-c" />
          <span className="sn-work-swatch is-d" />
        </div>
      </div>
    </div>
  );
}
