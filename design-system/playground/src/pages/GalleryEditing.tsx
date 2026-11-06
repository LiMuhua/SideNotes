/**
 * 组件页：编辑模式。
 *
 * 编辑中的卡片用真实的编辑器渲染（不抢焦点），示例正文包含标题、强调、行内代码、链接、待办、引用、代码块与标签，
 * 用来比较五套主题的编辑状态。下方列出编辑模式用到的令牌，色块取当前主题的实际值；结构差异（行号、状态栏）单独说明。
 */

import { useNotes } from '../model/notes';
import { useSurface } from '../ui/context';
import { Demo, PageSection, StateCell } from './common';
import { PanelSample, StaticCard } from './GalleryNotes';

const SAMPLE = [
  '# 周五评审准备',
  '把 **季度复盘** 的数据整理好，*周四* 之前发给产品组。',
  '- [x] 导出图表',
  '- [ ] 写结论，附上 `report.xlsx`',
  '> 评审会改到周五下午三点',
  '议程见 [评审议程](https://example.com/agenda)',
  '```ts',
  "const due = '周五 15:00';",
  '```',
  '#工作 #评审',
].join('\n');

const PARTS: ReadonlyArray<{ token: string; label: string; note: string }> = [
  { token: '--sn-color-editing', label: '编辑底色', note: '取代卡片底色；比平时更实，半透明主题在编辑时几乎不透出背景' },
  { token: '--sn-shadow-editing', label: '外圈与浮起', note: '强调色边框加一圈外圈；其余卡片降到禁用透明度，悬停时恢复' },
  { token: '--sn-color-caret', label: '输入光标', note: '对比度不低于 3:1' },
  { token: '--sn-color-selection', label: '选区', note: '与正文中的选区一致' },
  { token: '--sn-color-syntax', label: 'Markdown 标记与行号', note: '#、**、- 等标记；终端用强调色，像代码的语法着色；对比度不低于 4.5:1' },
  { token: '--sn-color-rule', label: '每行下方的横线', note: '记录纸：编辑时像写在横线纸上；其余主题透明' },
  { token: '--sn-color-editor-underline', label: '编辑区底部的强调线', note: 'Windows 11：与系统输入框获得焦点时一致；其余主题透明' },
];

export function EditingSection() {
  const data = useNotes();
  const surface = useSurface();
  const base = data.notes[0];
  if (!base) return null;
  const note = { ...base, id: 'gallery-editing-sample', text: SAMPLE, emoji: '📝', pinned: false, collapsed: false };

  return (
    <PageSection
      id="gallery-editing"
      title="编辑模式"
      description="双击卡片进入编辑：卡片换成编辑底色并加强调色外圈，其余卡片变淡；Markdown 标记显示出来，图片、待办、标签照常可点。Ctrl+Enter 保存，Esc 取消，点到卡片之外即保存。"
    >
      <Demo
        title="编辑中的卡片"
        note={
          surface.lineNumbers
            ? '终端：左侧显示行号，Markdown 标记用强调色；底部状态栏换成「编辑中」与保存、取消的按键。'
            : '光标、选区、Markdown 标记与编辑底色都来自令牌；切换主题比较五套的编辑状态。'
        }
        wide
      >
        <div className="sn-card-matrix">
          <StateCell label="完整示例（可以直接修改，不会保存）">
            <PanelSample list>
              <StaticCard note={note} active editing editAutoFocus={false} />
            </PanelSample>
          </StateCell>
          <StateCell label="同时显示的其它卡片">
            <PanelSample list>
              <StaticCard note={data.notes[1] ?? base} dimmed />
            </PanelSample>
          </StateCell>
        </div>
      </Demo>
      <Demo title="编辑模式用到的令牌" note="色块是当前主题与明暗模式下的实际值；透明表示这套主题不用这一项。" wide>
        <table className="sn-token-table">
          <thead>
            <tr>
              <th scope="col">部位</th>
              <th scope="col">令牌</th>
              <th scope="col">当前值</th>
              <th scope="col">说明</th>
            </tr>
          </thead>
          <tbody>
            {PARTS.map((part) => (
              <tr key={part.token}>
                <td className="sn-token-text">{part.label}</td>
                <td className="sn-token-name">{part.token}</td>
                <td>
                  {part.token.startsWith('--sn-shadow') ? (
                    <span className="sn-token-shadow" style={{ boxShadow: `var(${part.token})` }} />
                  ) : (
                    <span className="sn-token-swatch" style={{ background: `var(${part.token})` }} />
                  )}
                </td>
                <td className="sn-token-meaning">{part.note}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Demo>
    </PageSection>
  );
}
