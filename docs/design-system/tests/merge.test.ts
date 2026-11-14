/**
 * 合并成一条（第四次反馈）：Playground 的合并规则（playground/src/model/merge.ts）与交互原型的 merge.js 相同。
 *
 * - 共同标签作标题，其余标签各成一个二级小节，只有共同标签的记录放在最前，带多个其他标签的合成一节；
 * - 清单格式下每条记录是一个待办，段落格式下整段放入；标签取并集；
 * - 合并到已有卡片时按小标题追加，没有的小节加在最后。
 */

import { describe, expect, it } from 'vitest';
import { parse } from '@/core/tags';
import type { Note } from '@/core/types';
import { commonTags, composeInto, composeNew, defaultFormat, defaultTitle } from '../playground/src/model/merge';

let sequence = 0;
function note(text: string): Note {
  sequence += 1;
  return {
    id: `n${sequence}`,
    text,
    emoji: '',
    images: [],
    pinned: false,
    collapsed: false,
    status: 'active',
    previousStatus: 'active',
    order: null,
    createdAt: sequence,
    updatedAt: sequence,
    deletedAt: null,
  };
}

describe('合并成一条', () => {
  it('用户的例子：共同标签作标题，其余标签各成一节，标签取并集', () => {
    const a = note('A123\n\n#采购 #装修');
    const b = note('B456\n\n#采购 #日常');
    expect(commonTags([a, b])).toEqual(['采购']);
    expect(defaultTitle([a, b])).toBe('采购');
    expect(defaultFormat([a, b])).toBe('list');
    const merged = parse(composeNew([a, b], { title: '采购', format: 'list' }));
    expect(merged.body).toBe('采购\n\n## 装修\n- [ ] A123\n\n## 日常\n- [ ] B456');
    expect(merged.tags).toEqual(['采购', '装修', '日常']);
  });

  it('只有共同标签的放在最前，带两个其他标签的合成一节；段落格式整段放入', () => {
    const plain = note('牛奶\n\n#采购');
    const both = note('电池 ×4\n第二行\n\n#采购 #装修 #日常');
    const merged = parse(composeNew([both, plain], { title: '采购', format: 'text', tag: '采购' }));
    expect(merged.body).toBe('采购\n\n牛奶\n\n## 装修 · 日常\n电池 ×4\n第二行');
  });

  it('清单格式：多出来的行缩进在待办下面，已勾选的保持勾选', () => {
    const done = note('- [x] 鸡蛋\n两盒\n\n#采购');
    const merged = parse(composeNew([done, note('醋\n\n#采购')], { title: '采购', format: 'list' }));
    expect(merged.body).toBe('采购\n\n- [x] 鸡蛋\n  两盒\n- [ ] 醋');
  });

  it('合并到已有卡片：按小标题追加，没有的小节加在最后，只有共同标签的加在第一个小标题之前', () => {
    const target = note('采购\n\n- [ ] 牛奶\n\n## 装修\n- [ ] A123\n\n#采购 #装修');
    const egg = note('鸡蛋\n\n#采购');
    const screw = note('螺丝\n\n#采购 #装修');
    const pen = note('笔\n\n#采购 #文具');
    const merged = parse(composeInto(target, [egg, screw, pen], { format: 'list' }));
    expect(merged.body).toBe('采购\n\n- [ ] 牛奶\n- [ ] 鸡蛋\n\n## 装修\n- [ ] A123\n- [ ] 螺丝\n\n## 文具\n- [ ] 笔');
    expect(merged.tags).toEqual(['采购', '装修', '文具']);
  });
});
