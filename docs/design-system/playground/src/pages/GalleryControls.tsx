/**
 * 组件页：基础控件。按钮、图标按钮、输入框、选择类控件、快捷键与徽标，各种状态并列展示。
 */

import { useState } from 'react';
import { Button, IconButton, type ButtonProps } from '../ui/Button';
import { SearchInput, TextInput } from '../ui/Field';
import { Badge, Keys, Tag } from '../ui/Misc';
import { Select } from '../ui/Select';
import { Checkbox, Segmented, Switch } from '../ui/Toggle';
import { HelpTip } from '../ui/Tooltip';
import { AppIconPicker } from '../app/AppIconPicker';
import { AppIcon, BrandMark } from '../app/SidebarParts';
import { Demo, DemoRow, PageSection, StateCell } from './common';

const STATES: ReadonlyArray<{ key: string; label: string; props: Partial<ButtonProps> }> = [
  { key: 'default', label: '默认', props: {} },
  { key: 'hover', label: '悬停', props: { force: 'hover' } },
  { key: 'active', label: '按下', props: { force: 'active' } },
  { key: 'focus', label: '键盘焦点', props: { force: 'focus' } },
  { key: 'disabled', label: '禁用', props: { disabled: true } },
];

const VARIANTS: ReadonlyArray<{ variant: NonNullable<ButtonProps['variant']>; label: string; text: string }> = [
  { variant: 'primary', label: '主要', text: '保存' },
  { variant: 'secondary', label: '次要', text: '导出' },
  { variant: 'ghost', label: '幽灵', text: '取消' },
  { variant: 'danger', label: '危险', text: '移入回收站' },
];

export function ControlsSection() {
  const [query, setQuery] = useState('#工作');
  const [on, setOn] = useState(true);
  const [checked, setChecked] = useState(true);
  const [edge, setEdge] = useState<'left' | 'right'>('right');
  const [position, setPosition] = useState('top-center');

  return (
    <PageSection id="gallery-controls" title="基础控件" description="每个区域最多一个主要按钮；危险按钮只用于不可撤销或需要确认的操作。">
      <Demo title="按钮" note="四种外观 × 五种状态；键盘焦点用 2px 焦点环，与悬停区分开。" wide>
        <div className="sn-state-grid" style={{ gridTemplateColumns: `auto repeat(${STATES.length}, minmax(0, 1fr))` }}>
          <span />
          {STATES.map((state) => (
            <span key={state.key} className="sn-state-grid-head">
              {state.label}
            </span>
          ))}
          {VARIANTS.map((row) => (
            <div key={row.variant} className="sn-state-grid-row" role="presentation">
              <span className="sn-state-grid-head">{row.label}</span>
              {STATES.map((state) => (
                <span key={state.key} className="sn-state-grid-cell">
                  <Button variant={row.variant} size="sm" {...state.props}>
                    {row.text}
                  </Button>
                </span>
              ))}
            </div>
          ))}
        </div>
      </Demo>
      <Demo title="图标按钮" note="必须有名称（aria-label），不加悬停提示；需要说明的设置项用问号。">
        <DemoRow>
          <StateCell label="默认">
            <IconButton icon="copy" label="复制记录与附件" />
          </StateCell>
          <StateCell label="悬停">
            <IconButton icon="copy" label="复制" force="hover" />
          </StateCell>
          <StateCell label="键盘焦点">
            <IconButton icon="copy" label="复制" force="focus" />
          </StateCell>
          <StateCell label="已开启">
            <IconButton icon="pin" label="取消固定侧栏" pressed />
          </StateCell>
          <StateCell label="主要">
            <IconButton icon="check" label="保存 · Ctrl+Enter" variant="primary" />
          </StateCell>
          <StateCell label="禁用">
            <IconButton icon="check" label="保存" variant="primary" disabled />
          </StateCell>
        </DemoRow>
      </Demo>
      <Demo title="输入框与搜索框">
        <DemoRow>
          <StateCell label="搜索（有内容）">
            <SearchInput value={query} onValueChange={setQuery} placeholder="搜索记录、#标签…" aria-label="搜索示例" inputSize="sm" />
          </StateCell>
          <StateCell label="文本">
            <TextInput inputSize="sm" defaultValue="600" aria-label="毫秒" />
          </StateCell>
          <StateCell label="出错">
            <TextInput inputSize="sm" invalid defaultValue="20000" aria-label="出错示例" />
          </StateCell>
          <StateCell label="禁用">
            <TextInput inputSize="sm" disabled defaultValue="10" aria-label="禁用示例" />
          </StateCell>
        </DemoRow>
      </Demo>
      <Demo title="开关、复选框、分段与下拉">
        <DemoRow>
          <Switch label="编辑时保持展开" checked={on} onChange={setOn} />
          <Checkbox label="滚动按需加载" checked={checked} onChange={setChecked} />
          <Segmented
            label="显示位置"
            size="sm"
            value={edge}
            onChange={setEdge}
            options={[
              { value: 'left', label: '屏幕左侧' },
              { value: 'right', label: '屏幕右侧' },
            ]}
          />
          <Select
            aria-label="通知位置"
            size="sm"
            value={position}
            onChange={setPosition}
            options={[
              { value: 'top-center', label: '顶部正中' },
              { value: 'top-right', label: '右上角' },
              { value: 'bottom-center', label: '底部正中' },
            ]}
          />
        </DemoRow>
      </Demo>
      <Demo title="快捷键、徽标、标签与问号说明">
        <DemoRow>
          <Keys combo="Ctrl+Shift+Space" />
          <Keys combo="Ctrl+Enter" />
          <Keys combo="Esc" />
          <Badge>18</Badge>
          <Badge tone="accent">新</Badge>
          <Tag label="工作" onClick={() => {}} />
          <Tag label="常用" selected onClick={() => {}} />
          <span className="sn-set-label">
            整理提醒
            <HelpTip label="整理提醒">工作区记录超过这个数时提醒整理</HelpTip>
          </span>
        </DemoRow>
      </Demo>
      <Demo
        title="应用图标与品牌标记"
        note="默认是 211 门缝浅笑 · 靛蓝：靛蓝暗房里，一张便签从门缝探出来浅笑。配色固定，不随主题变化；任务栏、托盘、程序坞、关于页与标题区、速记浮窗、设置窗口的品牌标记都用设置中选用的同一个图标，只是尺寸不同。下面一行是设置中的应用图标选择，与设置窗口共用同一份设置。"
      >
        <DemoRow>
          {[64, 32, 24, 16].map((size) => (
            <AppIcon key={size} size={size} />
          ))}
          <BrandMark />
          <BrandMark small />
        </DemoRow>
        <DemoRow>
          <AppIconPicker />
        </DemoRow>
      </Demo>
    </PageSection>
  );
}
