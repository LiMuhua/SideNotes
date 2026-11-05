/**
 * 令牌页：当前方向与主题下的全部令牌。
 *
 * 数值由令牌文件直接解析（与设计系统测试共用 `tokens/parse.ts`），示例则用 var() 引用令牌渲染，
 * 两者不一致时一眼就能看出来。对比度表列出关键组合的实际比值与 WCAG 2.2 的最低要求。
 */

import { useMemo, type CSSProperties } from 'react';
import baseCss from '../../../tokens/base.css?raw';
import editorialCss from '../../../tokens/editorial.css?raw';
import fluentCss from '../../../tokens/fluent.css?raw';
import glassCss from '../../../tokens/glass.css?raw';
import paperCss from '../../../tokens/paper.css?raw';
import workbenchCss from '../../../tokens/workbench.css?raw';
import { GROUP_LABELS, TOKENS, type TokenGroup, type TokenSpec } from '../../../tokens/schema';
import { KEY_CONTRAST_PAIRS, mergeTokens, pairContrast, resolve } from '../../../tokens/parse';
import { DIRECTION_BY_ID, type DirectionId } from '../directions';
import { usePlayground } from '../shell/state';
import { cx } from '../ui/context';
import { TokenScope } from '../ui/Scope';
import { PageIntro, PageSection, PageToc } from './common';

export const DIRECTION_CSS: Record<DirectionId, string> = {
  workbench: workbenchCss,
  editorial: editorialCss,
  paper: paperCss,
  fluent: fluentCss,
  glass: glassCss,
};

/** 某方向某主题下的全部令牌（未展开引用）。 */
export function directionTokens(direction: DirectionId, theme: 'light' | 'dark'): Map<string, string> {
  return mergeTokens(baseCss, DIRECTION_CSS[direction], direction, theme);
}

const COLOR_GROUPS: ReadonlySet<TokenGroup> = new Set(['surface', 'border', 'text', 'accent', 'status', 'code']);
const GROUPS = Object.keys(GROUP_LABELS) as TokenGroup[];

function Sample({ token }: { token: TokenSpec }) {
  const value = `var(${token.name})`;
  if (COLOR_GROUPS.has(token.group)) {
    // 文字类颜色用「Aa 文字」示例，底色类用色块。
    const isText =
      token.group === 'text' ||
      token.name.startsWith('--sn-color-mark-') ||
      (token.group === 'code' && !/-bg$|-active$/.test(token.name)) ||
      (token.group === 'status' && !token.name.endsWith('-subtle')) ||
      /-on-|accent-text$/.test(token.name);
    return isText ? (
      <span className="sn-token-text" style={{ color: value }}>
        Aa 文字
      </span>
    ) : (
      <span className="sn-token-swatch" style={{ background: value }} />
    );
  }
  switch (token.group) {
    case 'shadow':
      return <span className="sn-token-shadow" style={{ boxShadow: value }} />;
    case 'spacing':
      return <span className="sn-token-bar" style={{ width: value }} />;
    case 'radius':
      return <span className="sn-token-radius" style={{ borderRadius: value }} />;
    case 'border-width':
      return <span className="sn-token-line" style={{ borderTopWidth: value }} />;
    case 'opacity':
      return <span className="sn-token-swatch is-accent" style={{ opacity: value }} />;
    case 'motion':
      return token.name.includes('duration') ? <span className="sn-token-motion" style={{ transitionDuration: value } as CSSProperties} /> : null;
    case 'typography':
      if (token.name.startsWith('--sn-font-size') || token.name.endsWith('-size')) return <span style={{ fontSize: value }}>片段 Snippet</span>;
      if (token.name.startsWith('--sn-font-weight') || token.name.endsWith('-weight')) return <span style={{ fontWeight: value }}>片段 Snippet</span>;
      if (token.name.startsWith('--sn-font-')) return <span style={{ fontFamily: value }}>片段 Snippet 0Oo1lI</span>;
      return null;
    default:
      return null;
  }
}

export function TokensPage() {
  const { direction, resolvedTheme } = usePlayground();
  const tokens = useMemo(() => directionTokens(direction, resolvedTheme), [direction, resolvedTheme]);
  const spec = DIRECTION_BY_ID[direction];
  const sections = [{ id: 'tokens-contrast', label: '对比度' }, ...GROUPS.map((group) => ({ id: `tokens-${group}`, label: GROUP_LABELS[group] }))];

  return (
    <TokenScope className="sn-page">
      <div className="sn-page-scroll">
        <div className="sn-page-content">
          <PageIntro
            title="设计令牌"
            description={`「${spec.name}」方向，${resolvedTheme === 'dark' ? '深色' : '浅色'}主题，共 ${TOKENS.length} 个令牌。数值从令牌文件解析，示例用 var() 实际渲染；共享令牌在所有方向中相同。`}
          />
          <PageToc sections={sections} />
          <PageSection id="tokens-contrast" title="对比度" description="正文与图标文字不低于 4.5:1，控件边界与焦点环不低于 3:1（WCAG 2.2 的 1.4.3 与 1.4.11）。半透明表面按叠在纯黑与纯白背景上两种情况中较差的一个计算。">
            <table className="sn-token-table">
              <thead>
                <tr>
                  <th scope="col">组合</th>
                  <th scope="col">示例</th>
                  <th scope="col">对比度</th>
                  <th scope="col">要求</th>
                </tr>
              </thead>
              <tbody>
                {KEY_CONTRAST_PAIRS.map((pair) => {
                  const ratio = pairContrast(tokens, pair);
                  const pass = ratio >= pair.minimum;
                  return (
                    <tr key={pair.label}>
                      <td>{pair.label}</td>
                      <td>
                        <span className="sn-token-pair" style={{ color: `var(${pair.foreground})` }}>
                          {pair.layers.map((layer) => (
                            <span key={layer} className="sn-token-pair-overlay" style={{ background: `var(${layer})` }} />
                          ))}
                          <span className="sn-token-pair-text">Aa 记录</span>
                        </span>
                      </td>
                      <td className="sn-token-ratio">{ratio.toFixed(2)}:1</td>
                      <td>
                        <span className={cx('sn-token-verdict', pass ? 'is-pass' : 'is-fail')}>
                          {pass ? '达标' : '不达标'} · {pair.minimum}:1
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </PageSection>
          {GROUPS.map((group) => (
            <PageSection key={group} id={`tokens-${group}`} title={GROUP_LABELS[group]}>
              <table className="sn-token-table">
                <thead>
                  <tr>
                    <th scope="col">令牌</th>
                    <th scope="col">含义</th>
                    <th scope="col">值</th>
                    <th scope="col">示例</th>
                  </tr>
                </thead>
                <tbody>
                  {TOKENS.filter((token) => token.group === group).map((token) => {
                    const raw = tokens.get(token.name) ?? '';
                    const value = raw ? resolve(tokens, token.name) : '未定义';
                    return (
                      <tr key={token.name}>
                        <td>
                          <code className="sn-token-name">{token.name}</code>
                          {token.shared ? <span className="sn-token-flag">共享</span> : null}
                        </td>
                        <td className="sn-token-meaning">{token.meaning}</td>
                        <td>
                          <code className="sn-token-value">{value}</code>
                          {raw !== value ? <span className="sn-token-raw">{raw}</span> : null}
                        </td>
                        <td className="sn-token-sample">
                          <Sample token={token} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </PageSection>
          ))}
        </div>
      </div>
    </TokenScope>
  );
}
