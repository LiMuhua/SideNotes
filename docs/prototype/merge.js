'use strict';

/**
 * @brief 合并成一条（第四次反馈）：把零散的记录汇总到一张卡片里整理，例如随手记下的一条条采购。
 * @details
 * - 入口：按标签筛选时筛选条上的「合并」（合并筛出来的全部记录）；多选后右键「合并成一条…」；
 *   多选后右键其中一张「合并到这条」（其余选中的追加进这张已有的卡片）。
 * - 结构：所有来源共有的标签作卡片标题（按标签合并时就是筛选的标签；没有共同标签时用第一条的标题），可以在弹窗里改；
 *   其余标签各成一个二级小节，按列表中第一次出现的顺序排。只有共同标签的记录放在最前，不加小标题；
 *   带两个以上其他标签的记录合成一节，小标题写成「装修 · 日常」，不拆成两份。标签行取所有来源标签的并集。
 * - 内容：清单格式下每条记录是一个待办，多出来的行缩进在待办下面；段落格式下每条记录整段放入，之间空一行。
 *   来源都只有一行时默认清单，否则默认段落。
 * - 合并到已有卡片：标题不变；按小标题对号，新内容追加到同名小节的末尾，没有的小节加在最后；只有共同标签的内容加在第一个小标题之前。
 * - 弹窗：标题、格式、实时预览与「保留原记录」，点「合并」或 Ctrl+Enter 才写入。合并后新卡片放在原来第一条的位置并进入编辑，
 *   原记录移到回收站；提示条一次撤销全部恢复。正文中的图片随段落带过来，缩略条中的图片放到后面（每条最多 12 张）。
 * 依赖 app.js 的全局状态与函数（state、ui、el、icon、button、openModal、closeModal、persistSnapshot、renderNotes、toast、
 * beginEdit、finishEdit、cancelEdit、noteParts、noteTitle、tagKey、compareNoteOrder、createId），只在调用时使用。
 */
window.NoteMerge = (function createNoteMerge() {
  const MAX_IMAGES = 12;

  /** @brief 按列表中的顺序取出记录（置顶在前）；不在列表里的按记录顺序接在后面。 @param {Array<string>} ids 记录。 @return {Array} 记录。 */
  function ordered(ids) {
    const wanted = new Set(ids), listed = (ui.listItems || []).map(function id(note) { return note.id; }).filter(function chosen(id) { return wanted.has(id); });
    const rest = state.notes.filter(function others(note) { return wanted.has(note.id) && !listed.includes(note.id); }).sort(compareNoteOrder).map(function id(note) { return note.id; });
    return listed.concat(rest).map(function find(id) { return state.notes.find(function same(note) { return note.id === id; }); }).filter(function usable(note) { return note && note.status !== 'trash'; });
  }

  /** @brief 不分大小写判断标签是否在列表里。 @param {Array<string>} list 标签。 @param {string} tag 标签。 @return {boolean} 是否。 */
  function includes(list, tag) { return list.some(function same(item) { return tagKey(item) === tagKey(tag); }); }

  /** @brief 所有记录共有的标签，按第一条中的顺序；按标签合并时筛选的标签排在最前。 @param {Array} notes 记录。 @param {string} first 筛选的标签。 @return {Array<string>} 标签。 */
  function commonTags(notes, first = '') {
    if (!notes.length) return [];
    const lists = notes.map(function tags(note) { return noteParts(note).tags; });
    const common = lists[0].filter(function shared(tag) { return lists.every(function has(list) { return includes(list, tag); }); });
    return first && includes(common, first) ? [common.find(function same(tag) { return tagKey(tag) === tagKey(first); })].concat(common.filter(function rest(tag) { return tagKey(tag) !== tagKey(first); })) : common;
  }

  /** @brief 所有记录标签的并集，按出现的顺序。 @param {Array<Array<string>>} lists 标签。 @return {Array<string>} 标签。 */
  function union(lists) {
    const result = [];
    lists.forEach(function each(list) { list.forEach(function add(tag) { if (!includes(result, tag)) result.push(tag); }); });
    return result;
  }

  /**
   * @brief 一条记录在合并结果中的一块：小节（除共同标签外的标签）与内容。
   * 清单格式：第一行去掉列表、待办、标题标记后写成待办（已勾选的保持勾选），其余行缩进两格放在待办下面。
   * @param {object} note 记录。 @param {Array<string>} common 共同标签。 @param {string} format list 或 text。 @return {{key:string,heading:string,text:string}} 一块。
   */
  function block(note, common, format) {
    const parts = noteParts(note), extra = parts.tags.filter(function own(tag) { return !includes(common, tag); });
    const body = parts.body.replace(/^\s*\n/, '').replace(/\s+$/, '');
    let text = body;
    if (format === 'list') {
      const lines = body.split(/\r?\n/), first = /^\s*(?:#{1,6}\s+)?(?:[-*+]\s+|\d+[.)]\s+)?(?:\[([ xX])\]\s+)?(.*)$/.exec(lines[0] || '');
      const done = Boolean(first && first[1] && first[1] !== ' ');
      const rest = lines.slice(1).map(function indent(line) { return line.trim() ? '  ' + line : ''; }).join('\n').replace(/^\n+/, '').replace(/\s+$/, '');
      text = (done ? '- [x] ' : '- [ ] ') + (first ? first[2] : lines[0]).trim() + (rest ? '\n' + rest : '');
    }
    return { key: extra.map(tagKey).join('\u0000'), heading: extra.join(' · '), text: text };
  }

  /** @brief 一节里的几块：清单逐行接上，段落之间空一行。 @param {Array<string>} texts 内容。 @param {string} format 格式。 @return {string} 原文。 */
  function joinBlocks(texts, format) { return texts.join(format === 'list' ? '\n' : '\n\n'); }

  /** @brief 按小节分组，小节按第一次出现的顺序；没有其他标签的排在最前。 @param {Array} blocks 块。 @return {Array<{key:string,heading:string,texts:Array<string>}>} 小节。 */
  function group(blocks) {
    const sections = [];
    blocks.forEach(function place(item) {
      let section = sections.find(function same(entry) { return entry.key === item.key; });
      if (!section) { section = { key: item.key, heading: item.heading, texts: [] }; sections.push(section); }
      section.texts.push(item.text);
    });
    return sections.filter(function plain(section) { return !section.key; }).concat(sections.filter(function named(section) { return section.key; }));
  }

  /** @brief 合并后的图片：正文图片与缩略条图片按来源顺序，去掉重复，最多 12 张。 @param {Array} notes 记录。 @return {{images:Array,dropped:number}} 图片。 */
  function images(notes) {
    const result = [];
    notes.forEach(function each(note) { (note.images || []).forEach(function add(image) { if (!result.some(function same(item) { return item.id === image.id; })) result.push({ ...image }); }); });
    return { images: result.slice(0, MAX_IMAGES), dropped: Math.max(0, result.length - MAX_IMAGES) };
  }

  /**
   * @brief 合并成一张新卡片的原文：标题、只有共同标签的内容、各小节，最后是标签行。
   * @param {Array} notes 来源。 @param {object} options title、format、tag。 @return {string} 原文。
   */
  function composeNew(notes, options) {
    const common = commonTags(notes, options.tag), sections = group(notes.map(function each(note) { return block(note, common, options.format); }));
    const body = sections.map(function write(section) { return (section.key ? '## ' + section.heading + '\n' : '') + joinBlocks(section.texts, options.format); }).join('\n\n');
    const tags = union([common].concat(notes.map(function tags(note) { return noteParts(note).tags; })));
    return window.NoteContent.compose((options.title.trim() || noteTitle(notes[0])) + '\n\n' + body, tags);
  }

  /**
   * @brief 合并到已有卡片的原文：标题与原有内容不变；按小标题对号，新内容追加到同名小节末尾，没有的小节加在最后；
   * 只有共同标签的内容加在第一个小标题之前。共同标签按来源与这张卡片一起算。
   * @param {object} target 卡片。 @param {Array} notes 来源。 @param {object} options format、tag。 @return {string} 原文。
   */
  function composeInto(target, notes, options) {
    const common = commonTags([target].concat(notes), options.tag), sections = group(notes.map(function each(note) { return block(note, common, options.format); }));
    const parts = noteParts(target), keyOf = function keyOf(heading) { return heading.split(/\s*·\s*/).map(tagKey).join('\u0000'); };
    // 原文按二级小标题切开：第一段是标题与小标题之前的内容，其余每段以小标题开头。
    const regions = [{ key: '', heading: '', lines: [] }];
    parts.body.replace(/\s+$/, '').split(/\r?\n/).forEach(function split(line) {
      const match = /^##\s+(.+?)\s*#*\s*$/.exec(line);
      if (match) regions.push({ key: keyOf(match[1]), heading: line, lines: [] }); else regions[regions.length - 1].lines.push(line);
    });
    const trim = function trim(lines) { while (lines.length && !lines[lines.length - 1].trim()) lines.pop(); return lines; };
    sections.forEach(function append(section) {
      let region = section.key ? regions.find(function same(item) { return item.heading && item.key === section.key; }) : regions[0];
      if (!region) { region = { key: section.key, heading: '## ' + section.heading, lines: [] }; regions.push(region); }
      const lines = trim(region.lines), last = lines[lines.length - 1] || '';
      // 清单接在已有的待办后面不空行；其余情况空一行再接。
      const tight = options.format === 'list' && /^\s*(?:[-*+]|\d+[.)])\s|^\s{2,}\S/.test(last);
      if (lines.length && !tight) lines.push('');
      lines.push(...joinBlocks(section.texts, options.format).split('\n'));
    });
    const out = [];
    regions.forEach(function write(region) {
      if (region.heading) { trim(out); if (out.length) out.push(''); out.push(region.heading); }
      out.push(...trim(region.lines.slice()));
    });
    const tags = union([parts.tags].concat(notes.map(function tags(note) { return noteParts(note).tags; })));
    return window.NoteContent.compose(out.join('\n'), tags);
  }

  /**
   * @brief 打开合并弹窗。
   * @param {object} options ids：来源记录；target：合并到的已有卡片（可选）；tag：按标签合并时筛选的标签（可选）。
   * @return {boolean} 是否打开。
   */
  function open(options = {}) {
    if (ui.editing && !finishEdit()) return false;
    const target = options.target ? state.notes.find(function same(note) { return note.id === options.target && note.status !== 'trash'; }) : null;
    const notes = ordered(options.ids || []).filter(function others(note) { return !target || note.id !== target.id; });
    if (notes.length < (target ? 1 : 2)) { toast('至少要有两条记录才能合并'); return false; }
    const single = notes.every(function oneLine(note) { return noteParts(note).body.trim().split(/\r?\n/).filter(function content(line) { return line.trim(); }).length <= 1; });
    let format = single ? 'list' : 'text';
    const common = commonTags(target ? [target].concat(notes) : notes, options.tag);
    const dialog = openModal(target ? '合并到「' + noteTitle(target) + '」' : '合并 ' + notes.length + ' 条记录', 'merge-modal');
    dialog.modal.querySelector('.modal-header h2').prepend(icon('merge'));
    const fields = el('div', 'merge-fields');
    let title = null;
    if (!target) {
      const field = el('label', 'merge-field');
      title = el('input', 'form-control merge-title');
      title.type = 'text';
      title.value = common.length ? common.join(' · ') : noteTitle(notes[0]);
      title.setAttribute('aria-label', '标题');
      field.append(el('span', 'merge-field-label', '标题'), title);
      fields.append(field);
    }
    const formats = el('div', 'merge-format');
    formats.setAttribute('role', 'group');
    formats.setAttribute('aria-label', '格式');
    const choices = [['list', '清单'], ['text', '段落']].map(function choice(item) {
      const node = el('button', 'merge-format-option', item[1]);
      node.type = 'button';
      node.dataset.format = item[0];
      node.addEventListener('click', function pick() { format = item[0]; refresh(); });
      return node;
    });
    formats.append(...choices);
    const formatField = el('div', 'merge-field');
    formatField.append(el('span', 'merge-field-label', '格式'), formats);
    fields.append(formatField);
    const preview = el('div', 'merge-preview markdown-body');
    preview.setAttribute('aria-label', '合并后的样子');
    const tagRow = el('div', 'merge-preview-tags');
    const previewBox = el('div', 'merge-preview-box');
    previewBox.append(preview, tagRow);
    dialog.body.append(fields, previewBox);
    const keep = el('label', 'merge-keep');
    const keepBox = el('input');
    keepBox.type = 'checkbox';
    keep.append(keepBox, el('span', '', '保留原记录'));
    const apply = button(target ? '合并到这条' : '合并', '', 'check', 'button primary merge-apply');
    dialog.footer.append(keep, apply);

    /** 当前选项下合并后的原文。 @return {string} 原文。 */
    const build = function build() { return target ? composeInto(target, notes, { format: format, tag: options.tag }) : composeNew(notes, { title: title.value, format: format, tag: options.tag }); };
    /** 预览按卡片的排版显示正文，标签行写成标签。 */
    const refresh = function refresh() {
      choices.forEach(function mark(node) { node.setAttribute('aria-pressed', String(node.dataset.format === format)); });
      const parts = window.NoteContent.parse(build());
      preview.replaceChildren();
      window.NoteContent.renderMarkdown(parts.body, preview);
      tagRow.replaceChildren(...parts.tags.map(function chip(tag) { return el('span', 'tag-chip', '#' + tag); }));
    };
    if (title) title.addEventListener('input', refresh);
    dialog.modal.addEventListener('keydown', function byKey(event) { if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') { event.preventDefault(); event.stopPropagation(); apply.click(); } });
    apply.addEventListener('click', function confirmMerge() { if (commit(notes, target, build(), keepBox.checked)) closeModal(); });
    refresh();
    if (title) { title.focus(); title.select(); } else apply.focus();
    return true;
  }

  /**
   * @brief 写入合并结果：新卡片放在原来第一条的位置（或改写已有的卡片），原记录移到回收站（勾了「保留原记录」时不动），
   * 然后进入编辑。提示条一次撤销全部恢复。
   * @param {Array} notes 来源。 @param {object|null} target 已有的卡片。 @param {string} text 合并后的原文。 @param {boolean} keep 保留原记录。
   * @return {boolean} 是否完成。
   */
  function commit(notes, target, text, keep) {
    const now = Date.now(), first = notes[0], previous = new Map(), sources = new Set(notes.map(function id(note) { return note.id; }));
    const gathered = images(target ? [target].concat(notes) : notes);
    let mergedId = target ? target.id : createId(), next = state.notes.map(function update(note) {
      if (target && note.id === target.id) { previous.set(note.id, note); return { ...note, text: text, images: gathered.images, updatedAt: now }; }
      if (!keep && sources.has(note.id)) { previous.set(note.id, note); return { ...note, status: 'trash', previousStatus: 'active', deletedAt: now, updatedAt: now }; }
      return note;
    });
    if (!target) {
      // 排在原来第一条的位置：用它的排序值（没有手动排过序时按创建时间排，换算成同样的值）。
      const order = Number.isFinite(first.order) ? first.order : -first.createdAt;
      const merged = { id: mergedId, text: text, images: gathered.images, emoji: window.NoteEmoji.pick(state.notes.map(function used(note) { return note.emoji; })), order: order, pinned: Boolean(first.pinned), collapsed: false, status: 'active', previousStatus: 'active', deletedAt: null, createdAt: now, updatedAt: now };
      next = [merged].concat(next);
    }
    if (!persistSnapshot(next)) { toast('合并未保存，原记录保持不变', null, true); return false; }
    if (window.NoteInteractions) window.NoteInteractions.clearSelection();
    const result = state.notes.find(function same(note) { return note.id === mergedId; });
    if (result && !window.SidebarTabs.belongs(result, ui.tab)) { const tag = window.SidebarTabs.pinnedTagOf(result); window.SidebarTabs.select(result.pinned && ui.tab === 'pinned' ? 'pinned' : tag ? window.SidebarTabs.tabOf(tag) : 'workspace'); }
    else renderNotes();
    const message = (target ? '已合并到这条 ' : '已合并 ') + notes.length + ' 条' + (keep ? '' : '，原记录在回收站') + (gathered.dropped ? '；图片超过 12 张，后面 ' + gathered.dropped + ' 张没有带过来' : '');
    toast(message, { label: '撤销', run: function undoMerge() {
      if (ui.editing && ui.editing.id === mergedId) cancelEdit();
      const restored = state.notes.filter(function keepNote(note) { return target || note.id !== mergedId; }).map(function restore(note) { return previous.has(note.id) ? previous.get(note.id) : note; });
      if (persistSnapshot(restored)) renderNotes();
    } });
    beginEdit(mergedId);
    return true;
  }

  return Object.freeze({ open: open, composeNew: composeNew, composeInto: composeInto });
})();
