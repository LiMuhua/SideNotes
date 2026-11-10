'use strict';

/* ==================== 数据与界面状态 ==================== */
const STORAGE_KEY = 'sidenotes.prototype.v1';
const DRAFT_KEY = 'sidenotes.prototype.draft.v1';
const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
const FILE_EXAMPLE_REFERENCE = "[思维导图.xmind](sidenotes-file:47f798dc-5356-4626-a5fe-218d5a9834f3?name=%E6%80%9D%E7%BB%B4%E5%AF%BC%E5%9B%BE.xmind)";
const DEFAULT_SETTINGS = normalizeSettings({});
const LEGACY_EXAMPLES = {
  "sample-command": "开发命令\n\nnpm run tauri dev\nnpm run tauri build\n\n# 保持专注，让工具退到身后",
  "sample-goals": "本周的小目标\n\n把侧栏交互打磨顺手。\n留一点时间散步，再读完手边那本书。",
  "sample-idea": "一个小灵感\n\n记录的阻力越小，想法留下来的机会越大。\n让工具像纸条一样轻，随手记下，然后继续。",
  "sample-link": "Tauri 官方文档\n\nhttps://v2.tauri.app/\n\n窗口、快捷键与跨平台能力，之后慢慢研究。",
  "sample-colors": "留住这一组配色\n\n苔绿、鼠尾草与一点奶油白。安静，也很耐看。",
  "sample-yesterday-1": "把事情变简单\n\n先完成一个能够顺畅使用的小闭环，再去添加功能。\n每次只处理眼前最值得做的一件事。",
  "sample-yesterday-2": "周末想去的地方\n\n找一家靠窗的咖啡馆，带上相机和一本书。\n没有安排，也是很好的安排。",
  "sample-archive-1": "旧版本的想法\n\n第一版只围绕侧栏与速记浮窗，把输入和取用做好。",
  "sample-archive-2": "已经整理好的周报\n\n把工作记录归拢成文档，保留过程，继续向前。"
};
const elements = {};
const ui = { tab: 'workspace', query: '', editing: null, composer: false, locked: false, composing: false, pendingImages: 0, modal: null, hideTimer: 0, draftTimer: 0, editTimer: 0, previousFocus: null, storageError: false, storageWriteError: false, editStorageError: false, draftDirty: false, selectedTag: '', expandedTags: new Set(), pendingFilePath: '', listItems: [], visibleCount: 0, listKey: '', listObserver: null, loading: false, sentinel: null, clickTimer: 0, resizing: null, resizeFrame: 0, pinnedReturnPending: false };
let state;
const noteParseCache = new WeakMap(); // 同一记录的标签解析供列表、筛选与卡片复用。

/** @brief 创建 DOM 元素并安全设置文字。 @param {string} tag 标签。 @param {string} className 样式。 @param {string} text 文字。 @return {HTMLElement} 元素。 */
function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** @brief 创建图标。 @param {string} name 图标名称。 @return {SVGElement} 图标。 */
function icon(name) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'icon');
  svg.setAttribute('aria-hidden', 'true');
  const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
  use.setAttribute('href', '#i-' + name);
  svg.append(use);
  return svg;
}

/** @brief 创建动作按钮。 @param {string} label 可访问名称。 @param {string} action 动作。 @param {string} iconName 图标。 @param {string} className 样式。 @return {HTMLButtonElement} 按钮。 */
function button(label, action, iconName, className = 'icon-button') {
  const node = el('button', className);
  node.type = 'button';
  node.dataset.action = action;
  node.setAttribute('aria-label', label);
  node.title = label;
  if (iconName) node.append(icon(iconName));
  if (!className.split(/\s+/).some(function iconOnly(name){return ['icon-button','tag-remove','tags-more','note-image-button'].includes(name);})) node.append(document.createTextNode(label));
  return node;
}

/** @brief 创建稳定标识。 @return {string} 标识。 */
function createId() {
  return window.crypto && window.crypto.randomUUID ? window.crypto.randomUUID() : Date.now().toString(36) + '-' + Math.random().toString(36).slice(2);
}

/** @brief 创建带有 Markdown、标签和文件引用的示例记录。 @return {Array} 示例记录。 */
function createExamples() {
  const now = Date.now();
  const palette = '<svg xmlns="http://www.w3.org/2000/svg" width="720" height="260"><rect width="720" height="260" fill="#eff2e9"/><rect x="20" y="20" width="155" height="170" rx="12" fill="#45694e"/><rect x="195" y="20" width="155" height="170" rx="12" fill="#95ab91"/><rect x="370" y="20" width="155" height="170" rx="12" fill="#d5dfc8"/><rect x="545" y="20" width="155" height="170" rx="12" fill="#f6f4ea"/><text x="20" y="230" font-family="sans-serif" font-size="16" fill="#526449">SideNotes / palette study</text></svg>';
  return [
    {id:'sample-command',text:'常用开发命令\n\n\x60\x60\x60bash\nnpm run tauri dev\nnpm run tauri build\ngit status --short\n\x60\x60\x60\n\n#开发 #命令',pinned:true,hours:-2},
    {id:'sample-goals',text:'本周待办\n\n- [x] 整理侧栏交互\n- [ ] 验证截图粘贴\n- [ ] 补充数据恢复流程\n\n#工作 #待办',pinned:true,hours:-5},
    {id:'sample-idea',text:'侧栏交互调整\n\n**减少记录前的操作。**\n\n记录入口直接展开输入；内容较长时限制卡片高度，展开后查看全文。\n\n> 先记录，再整理。\n\n#产品 #交互',hours:-.1},
    {id:'sample-link',text:'Tauri 窗口文档\n\n[窗口 API](https://v2.tauri.app/reference/javascript/api/namespacewindow/)\n\n需要验证多显示器和中文输入法。\n\n#开发 #参考',hours:-.4},
    {id:'sample-colors',text:'界面配色参考\n\n基础色、强调色与纸张背景。\n\n#设计 #参考 #SideNotes',images:[{id:'sample-palette',name:'界面配色.svg',type:'image/svg+xml',data:'data:image/svg+xml;charset=utf-8,'+encodeURIComponent(palette)}],hours:-1},
    {id:'sample-yesterday-1',text:'版本发布检查\n\n## 数据\n- 数据库迁移前创建备份\n- 图片附件随记录一起导出\n- 验证归档、撤销和回收站\n\n## 窗口\n- 唤出不打断原应用输入\n- 收起后不保留可见边缘条\n- 编辑期间保护未提交内容\n\n## 交付\n确认快捷键冲突、多屏缩放和安装目录权限。\n\n#开发 #发布 #测试 #Windows #SideNotes',hours:-24},
    {id:'sample-file-map',text:'文件引用示例\n\n'+FILE_EXAMPLE_REFERENCE+'\n\n#文件 #示例',hours:-.5},
    {id:'sample-yesterday-2',text:'设计文档位置\n\n[交互设计.pdf](file:///C:/Projects/SideNotes/交互设计.pdf)\n\n打开前检查文件状态；失效时重新定位。\n\n#文件 #设计',hours:-28},
    {id:'sample-archive-1',text:'首轮方案评审\n\n已确认侧栏和快捷速记两个入口。\n\n#产品 #归档',status:'archived',hours:-48},
    {id:'sample-archive-2',text:'上周工作记录\n\n已整理为周报。\n\n#工作 #归档',status:'archived',hours:-72}
  ].map(function completeExample(item){const t=now+item.hours*3600000;return {id:item.id,text:item.text,images:item.images||[],pinned:Boolean(item.pinned),status:item.status||'active',createdAt:t,updatedAt:t};});
}

/** @brief 校验图片数据，拒绝外部请求地址。 @param {object} value 输入。 @return {object|null} 图片。 */
function normalizeImage(value) {
  if (!value || typeof value.data !== 'string' || value.data.length > MAX_IMAGE_BYTES * 1.5) return null;
  if (!/^data:image\/(png|jpeg|jpg|gif|webp|svg\+xml)(;[^,]*)?,/i.test(value.data)) return null;
  return { id: typeof value.id === 'string' ? value.id : createId(), name: String(value.name || '图片').slice(0, 160), type: String(value.type || 'image/png'), data: value.data };
}

/** @brief 校验导入记录。 @param {object} value 输入。 @return {object|null} 记录。 */
function normalizeNote(value) {
  if (!value || typeof value.text !== 'string') return null;
  const images = Array.isArray(value.images) ? value.images.slice(0, 12).map(normalizeImage).filter(Boolean) : [];
  if (!value.text.trim() && !images.length) return null;
  const status = ['active', 'archived', 'trash'].includes(value.status) ? value.status : 'active';
  return { id: typeof value.id === 'string' && value.id.length < 100 ? value.id : createId(), text: window.NoteContent.canonicalize(value.text), emoji:window.NoteEmoji.valid(value.emoji)?value.emoji:'', order:Number.isFinite(value.order)?value.order:null, images: images, pinned: Boolean(value.pinned), collapsed: Boolean(value.collapsed), status: status, previousStatus: value.previousStatus === 'archived' ? 'archived' : 'active', createdAt: Number.isFinite(value.createdAt) && Math.abs(value.createdAt) <= 8640000000000000 ? value.createdAt : Date.now(), updatedAt: Number.isFinite(value.updatedAt) && Math.abs(value.updatedAt) <= 8640000000000000 ? value.updatedAt : Date.now(), deletedAt: Number.isFinite(value.deletedAt) && Math.abs(value.deletedAt) <= 8640000000000000 ? value.deletedAt : null };
}

/** @brief 校验并补全原型设置。 @param {object} value 输入设置。 @return {object} 完整设置。 */
function normalizeSettings(value = {}) {
  if (!value || typeof value !== 'object') value = {};
  const cloud = value.cloud && typeof value.cloud === 'object' ? value.cloud : {};
  const shortcuts = value.shortcuts && typeof value.shortcuts === 'object' ? value.shortcuts : {};
  const surfaces = window.SideNotesSurfaces;
  return {
    // 设置结构版本 3：主题改为五套（旧的 standard 迁移为 terminal），字体默认跟随主题，见 surfaces.js。
    version: surfaces.SETTINGS_VERSION,
    theme: ['light','dark','system'].includes(value.theme) ? value.theme : 'light',
    surface: surfaces.normalizeSurface(value.surface),
    fontFamily: surfaces.normalizeFontFamily(value.fontFamily, value.version),
    // 应用图标：内置图标的 id，或 custom 表示上传的图片（图片单独保存，见 app-icons.js）。
    appIcon: window.SideNotesAppIcons.normalize(value.appIcon),
    fontSize: Math.max(12,Math.min(20,Number(value.fontSize)||16)),
    edge: value.edge === 'left' ? 'left' : 'right', width: Math.min(720,Math.max(360,Number(value.width)||416)),
    hideDelay: [300,600,1000].includes(Number(value.hideDelay)) ? Number(value.hideDelay) : 600,
    protectEditing: value.protectEditing !== false,
    lazyLoading: value.lazyLoading !== false,
    pageSize: Math.max(5,Math.min(100,Math.round(Number(value.pageSize)||10))),
    tidySnoozeUntil: Number(value.tidySnoozeUntil)||0,
    tidyLimit: Number.isFinite(Number(value.tidyLimit)) ? Math.max(0,Math.min(100000,Math.round(Number(value.tidyLimit)))) : 50,
    storageLocation: ['appdata','portable','custom'].includes(value.storageLocation) ? value.storageLocation : 'appdata',
    customDirectory: String(value.customDirectory||'').slice(0,500),
    trashDays: Math.round(Math.max(1,Math.min(365,Number(value.trashDays)||30))),
    cloud: { enabled: cloud.enabled===true, provider: ['synology','google','onedrive'].includes(cloud.provider)?cloud.provider:'synology', endpoint:String(cloud.endpoint||'').slice(0,1000), account:String(cloud.account||'').slice(0,160), folder:String(cloud.folder||'SideNotes').slice(0,300), lastBackup:Number(cloud.lastBackup)||0, lastError:String(cloud.lastError||'').slice(0,500), simulationFailure:cloud.simulationFailure===true, notifications:cloud.notifications===true },
    shortcuts: {capture:String(shortcuts.capture||'Ctrl+Shift+Space'),save:String(shortcuts.save||'Ctrl+Enter'),hide:String(shortcuts.hide||'Escape')}
  };
}

/** @brief 读取本地数据并恢复草稿。 */
function loadState() {
  state = { version: 1, revision: 5, tagUsage: Object.create(null), notes: window.NoteEmoji.ensure(createExamples()), draft: { text: '', images: [], updatedAt: 0 }, settings: { ...DEFAULT_SETTINGS } };
  try {
    let sourceRevision=0;
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const saved = JSON.parse(raw);
      if (!saved || saved.version !== 1 || !Array.isArray(saved.notes)) throw new Error('存档格式不正确');
      sourceRevision=Number(saved.revision)||1;
      state.notes = saved.notes.map(normalizeNote).filter(Boolean);
      state.tagUsage = Object.assign(Object.create(null), saved.tagUsage && typeof saved.tagUsage==='object' ? saved.tagUsage : {});
      if(Number(saved.revision||1)<2){const samples=createExamples();state.notes=state.notes.map(function upgradeSample(note){const sample=samples.find(function same(item){return item.id===note.id;});return sample&&LEGACY_EXAMPLES[note.id]===note.text?{...note,text:sample.text}:note;});}
      state.settings = normalizeSettings(saved.settings);
      if (saved.draft && typeof saved.draft.text === 'string') state.draft = { text: saved.draft.text, images: (Array.isArray(saved.draft.images) ? saved.draft.images : []).map(normalizeImage).filter(Boolean), updatedAt: Number(saved.draft.updatedAt) || 0 };
    }
    const recovery = JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null');
    if (recovery && typeof recovery.text === 'string' && recovery.updatedAt > state.draft.updatedAt) {
      state.draft = { text: recovery.text, images: (Array.isArray(recovery.images) ? recovery.images : []).map(normalizeImage).filter(Boolean), updatedAt: recovery.updatedAt };
      window.setTimeout(function showRecovery() { toast('已恢复上次未提交的草稿'); }, 400);
    }
    const movedExample=sourceRevision<5&&moveFileExampleFromDraft();
    const assigned=window.NoteEmoji.ensure(state.notes);const changed=assigned.some(function changedEmoji(note,index){return note!==state.notes[index];});state.notes=assigned;
    if(!raw||changed||sourceRevision<5||movedExample)persistSnapshot();
  } catch (error) {
    ui.storageWriteError = true;
    ui.storageError = true;
    window.setTimeout(function showStorageFailure() { toast('本地数据无法读取，当前内容仍可使用。请通过设置导出备份。', null, true); }, 500);
  }
}

/** @brief 正常状态仅显示标记，异常与进行中才显示文字。 @param {boolean} failed 写入是否失败。 */
function setStorageStatus(failed) {
  ui.storageWriteError=failed;ui.storageError=failed||ui.editStorageError;
  const sync=window.SideNotesSettings?window.SideNotesSettings.status():{enabled:false,busy:false,lastError:''};
  const cloudError=sync.enabled?sync.lastError:'';
  const busy=ui.pendingImages>0||ui.draftDirty||(sync.enabled&&sync.busy);
  const error=ui.storageError||Boolean(cloudError);
  if(elements.storageStatus){const status=elements.storageStatus;status.replaceChildren();status.classList.toggle('is-cloud',Boolean(sync.enabled));status.classList.toggle('is-busy',busy);status.classList.toggle('is-error',error);
    // 正常时底栏不显示状态（本次提出：去掉绿色圆点）；出错时版本号左边出现警告图标，处理中只写文字。
    if(error)status.append(icon(ui.storageError?'alert':'cloud-off'));
    const message=ui.storageError?'本地保存失败':cloudError?'备份失败':ui.pendingImages?'读取附件…':ui.draftDirty?'保存中…':sync.busy?'备份中…':'';
    if(message)status.append(document.createTextNode(message));const label=message||(sync.enabled?'本地已保存 · 云端连接为模拟':'本地已保存');status.title=label;status.setAttribute('aria-label',label);status.hidden=!message;
  }
  if(elements.syncWarning){elements.syncWarning.hidden=!cloudError;elements.syncWarning.replaceChildren();if(cloudError){elements.syncWarning.append(icon('alert'),el('span','',cloudError),button('重试','retry-cloud','','button secondary compact'));}}
}

/** @brief 原子写入数据，成功后再替换权威状态。 @param {Array} notes 记录。 @param {object} draft 草稿。 @param {object} settings 设置。 @return {boolean} 是否成功。 */
function persistSnapshot(notes = state.notes, draft = state.draft, settings = state.settings) {
  try {
    notes=window.NoteEmoji.ensure(notes);
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, revision: 5, tagUsage: state.tagUsage, notes: notes, draft: draft, settings: settings }));
    state.notes = notes;
    state.draft = draft;
    state.settings = settings;
    ui.draftDirty = false;
    try { localStorage.removeItem(DRAFT_KEY); } catch (error) { /* 主存档已经写入。 */ }
    setStorageStatus(false);
    if(window.SideNotesSettings)window.SideNotesSettings.dataChanged();
    return true;
  } catch (error) {
    setStorageStatus(true);
    return false;
  }
}

/** 保留当前草稿；空间不足时仍尽力保存文字。 */
function persistDraft() {
  window.clearTimeout(ui.draftTimer);
  if (persistSnapshot()) return;
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify(state.draft));
  } catch (error) {
    try { localStorage.setItem(DRAFT_KEY, JSON.stringify({ ...state.draft, images: [] })); } catch (ignored) { /* 草稿继续保留在当前页面。 */ }
  }
}

/** @brief 修改记录并在持久化成功后刷新。 @param {string} id 记录标识。 @param {object} patch 修改。 @return {boolean} 是否成功。 */
function updateNote(id, patch) {
  const next = state.notes.map(function patchRecord(note) { return note.id === id ? { ...note, ...patch, updatedAt: Date.now() } : note; });
  if (!persistSnapshot(next)) {
    toast('保存失败，原记录未改动。请导出备份后重试。', null, true);
    return false;
  }
  renderNotes();
  return true;
}

/** @brief 今天显示二十四小时时分，其他日期显示完整时间。 @param {number} timestamp 时间。 @return {string} 时间文本。 */
function formatTime(timestamp) {
  const d=new Date(timestamp), now=new Date();
  const hm=String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0');
  return d.toDateString()===now.toDateString() ? hm : d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0')+' '+hm;
}

/**
 * @brief 渲染记录卡片。
 * @details 标题最多两行；右侧一格叠放「置顶标记与时间」和操作按钮，悬停、高亮或聚焦时换成按钮，
 * 收起按钮在最右，落在时间原来的位置，标题宽度因此不变（components.md 2.1）。底部只在有标签时出现。
 * 列表按 roving tabindex 只让高亮的一张进入 Tab 顺序，卡片内的按钮也只在这一张上可聚焦。
 * @param {object} note 记录。 @return {HTMLElement} 卡片。
 */
function renderCard(note) {
  const parsed=noteParts(note), lines=parsed.body.split('\n');
  const first=lines.findIndex(function nonempty(line){return Boolean(line.trim());});
  const firstLine=first<0?'':lines[first];
  const fullBody=firstLine.length>120||/^\s*(?:`{3,}|~{3,}|!\[|>|(?:-\s*){3,}$|(?:_\s*){3,}$|(?:\*\s*){3,}$)|^(?: {4}|\t)|^\s*[-*+]\s|^\s*\d+[.)]\s/.test(firstLine)||Boolean(window.NoteContent.filePath(firstLine));
  const title=first<0 ? (note.images.length?'图片记录':'记录') : lines[first].replace(/^#{1,6}\s+|^[-*+]\s+|^\d+\.\s+/,'').replace(/[*\x60~]/g,'').slice(0,120)||'记录';
  const editing=ui.editing&&ui.editing.id===note.id,current=ui.currentId===note.id;
  const card=el('article','note-card'+(note.pinned?' is-pinned':'')+(editing?' is-editing':'')+(note.collapsed?' is-collapsed':'')+(current?' is-current':''));card.dataset.noteId=note.id;card.tabIndex=current||editing?0:-1;card.setAttribute('aria-label',title);if(current)card.setAttribute('aria-current','true');
  const header=el('header','note-header'),mark=el('button','note-emoji',note.emoji||'📝');mark.type='button';mark.dataset.action='choose-emoji';mark.setAttribute('aria-label','更换 Emoji');mark.title='更换 Emoji';
  const titleNode=el('h3','note-title',fullBody?(firstLine.length>120?title:'记录'):title);
  if(!fullBody){titleNode.replaceChildren();window.NoteContent.renderInline(firstLine.replace(/^#{1,6}\s+/,''),titleNode);}
  // 右侧一格：平时是置顶标记与创建时间；点时间收起或展开正文（时间不进入 Tab 顺序，键盘用收起按钮）。
  const side=el('div','note-side'),meta=el('span','note-meta');
  if(note.pinned){const pin=el('span','note-pin');pin.title='已置顶';pin.append(icon('pin'));meta.append(pin);}
  const time=el('button','note-time',formatTime(note.createdAt));time.type='button';time.dataset.action='toggle-note-collapse';time.tabIndex=-1;time.setAttribute('aria-label',(note.collapsed?'展开':'收起')+'正文');time.title='创建：'+new Date(note.createdAt).toLocaleString('zh-CN',{hour12:false})+'\n修改：'+new Date(note.updatedAt).toLocaleString('zh-CN',{hour12:false});
  meta.append(time);side.append(meta);
  header.append(mark,titleNode,side);card.append(header);
  if(editing){
    const input=el('textarea','note-edit-input');input.value=ui.editing.text;input.dataset.editId=note.id;input.setAttribute('aria-label','编辑记录');input.rows=Math.min(12,Math.max(4,ui.editing.text.split('\n').length));
    const actions=el('div','note-edit-actions'),tools=el('div','composer-tools'),confirm=el('div','composer-actions');tools.append(button('添加图片','attach-edit-image','image'),button('引用文件','attach-edit-file','file'));confirm.append(keyHint(['Ctrl','Enter']),button('取消修改 · Esc','cancel-edit','x'),button('保存修改 · Ctrl+Enter','finish-edit','check','icon-button primary'));actions.append(tools,confirm);card.append(input,actions);renderEditAttachments(card);if(window.LiveMarkdown)window.LiveMarkdown.attach(input,{value:ui.editing.text,minHeight:100,maxHeight:300});const editingSession=ui.editing;input.addEventListener('blur',function editInputBlur(){scheduleEditBlur(editingSession);});return card;
  }
  // 操作按钮：置顶（只在工作区与置顶中）排在最前，然后是复制、归档或恢复、更多，收起在最右。
  const actions=el('div','note-actions');
  if(note.status==='active'){const pin=button(note.pinned?'取消置顶':'置顶记录','pin-note',note.pinned?'pin-off':'pin','icon-button note-pin-toggle'+(note.pinned?' is-pinned':''));pin.setAttribute('aria-pressed',String(note.pinned));actions.append(pin);}
  actions.append(button('复制记录与附件 · Ctrl+C','copy-note','copy'),button(note.status==='archived'?'恢复记录':'归档记录','archive-note',note.status==='archived'?'restore':'archive'),button('更多操作 · Shift+F10','more-note','more'));
  const collapse=button(note.collapsed?'展开正文':'收起正文','toggle-note-collapse','chevron-down','icon-button note-collapse'+(note.collapsed?' is-collapsed':''));collapse.setAttribute('aria-expanded',String(!note.collapsed));actions.append(collapse);
  side.append(actions);
  const content=el('div','note-content markdown-body');
  const displayBody=first<0?'':fullBody?parsed.body:lines.slice(first+1).join('\n');
  window.NoteContent.renderMarkdown(displayBody,content,{onTaskToggle:function toggleCardTask(index,checked){const changed=displayBody.slice(0,index)+(checked?'x':' ')+displayBody.slice(index+1),prefix=fullBody||first<0?'':lines.slice(0,first+1).join('\n')+'\n';return updateNote(note.id,{text:window.NoteContent.compose(prefix+changed,parsed.tags)});}});
  note.images.forEach(function renderAttachment(attachment){const preview=button('预览图片：'+attachment.name,'preview-image','', 'note-image-button');preview.dataset.imageId=attachment.id;const image=el('img','note-image');image.src=attachment.data;image.alt=attachment.name;image.loading='lazy';preview.append(image);content.append(preview);});
  // 只有标题行的记录不留正文区，与收起的记录一样只剩标题行。
  if(content.childNodes.length)card.append(content);else card.classList.add('is-single');
  const expanded=button('展开全文','open-note','chevron-down','note-expand');card.append(expanded);
  const likelyLong=parsed.body.length>360||parsed.body.split('\n').length>9||note.images.length>1;
  card.classList.toggle('is-truncated',likelyLong);expanded.hidden=!likelyLong;
  const measureOverflow=function measureOverflow(){if(!content.isConnected)return;const overflow=content.scrollHeight>content.clientHeight+2;card.classList.toggle('is-truncated',overflow);expanded.hidden=!overflow;};
  if(window.requestAnimationFrame)window.requestAnimationFrame(measureOverflow);
  content.querySelectorAll('img').forEach(function remeasureImage(image){image.addEventListener('load',measureOverflow);image.addEventListener('error',measureOverflow);});
  // 底部只在有标签时出现，没有标签时不占位置。
  if(parsed.tags.length){
    const bottom=el('footer','note-bottom'),tags=el('div','note-tags');
    const expandedTags=ui.expandedTags.has(note.id);tags.classList.toggle('tags-expanded',expandedTags);
    parsed.tags.forEach(function renderTag(tag){const chip=button('#'+tag,'filter-tag','','tag-chip');chip.dataset.tag=tag;const remove=button('从此记录移除 #'+tag,'remove-note-tag','x','tag-remove');remove.dataset.tag=tag;const wrap=el('span','tag-chip-wrap');wrap.append(chip,remove);tags.append(wrap);});
    const more=button(expandedTags?'收起标签':'展开并管理标签','expand-tags','more','tags-more');more.dataset.noteId=note.id;tags.append(more);
    bottom.append(tags);card.append(bottom);
  }
  if(!current)card.querySelectorAll('button').forEach(function outOfTabOrder(node){node.tabIndex=-1;});
  card.title='单击选中，双击编辑，长按拖动排序';if(window.requestAnimationFrame)window.requestAnimationFrame(function fit(){fitCardTags(card);});return card;
}

/**
 * @brief 快捷键提示：每个键一个小框。
 * @details 只在终端主题显示（根节点 data-sn-shortcuts="inline"），其余主题由样式隐藏，快捷键留在按钮的工具提示中。
 * @param {string[]} keys 按键。 @return {HTMLElement} 提示。
 */
function keyHint(keys){const node=el('span','key-hint');node.setAttribute('aria-hidden','true');keys.forEach(function key(name){node.append(el('kbd','',name));});return node;}

/** @brief 更新筛选快照并加载首批，保留同一视图已加载数量。 @param {object} options 重置选项。 */
function renderNotes(options={}) {
  ui.tagRefreshPending=false;
  if(ui.listObserver){ui.listObserver.disconnect();ui.listObserver=null;}
  const active=state.notes.filter(function activeNote(n){return n.status==='active';}),archive=state.notes.filter(function archivedNote(n){return n.status==='archived';});
  const counts={workspace:active.length,pinned:active.filter(function pinnedNote(n){return n.pinned;}).length,archive:archive.length};
  document.querySelectorAll('[data-count]').forEach(function count(node){node.textContent=String(counts[node.dataset.count]||0);});
  document.querySelectorAll('.sidebar-tabs [data-tab]').forEach(function tab(node){const selected=node.dataset.tab===ui.tab;node.classList.toggle('active',selected);node.setAttribute('aria-selected',String(selected));node.tabIndex=selected?0:-1;});
  const notes=state.notes.filter(function visible(n){return inCurrentTab(n)&&(!ui.selectedTag||hasTag(n,ui.selectedTag))&&matchesQuery(n,ui.query);}).sort(compareNoteOrder);
  const pinned=notes.filter(function pinned(n){return n.pinned;}),normal=notes.filter(function normal(n){return !n.pinned;});
  const key=[ui.tab,ui.selectedTag,ui.query,state.settings.lazyLoading,state.settings.pageSize].join('|');const same=ui.listKey===key&&!options.reset;
  const target=state.settings.lazyLoading?(same?Math.max(state.settings.pageSize,ui.visibleCount||0):state.settings.pageSize):notes.length;
  const oldScroll=elements.noteList.scrollTop;
  elements.noteList.querySelectorAll('.note-edit-input').forEach(function dispose(input){if(input.liveMarkdown)input.liveMarkdown.destroy();});
  elements.noteList.replaceChildren();
  ui.listItems=pinned.concat(normal);ui.listKey=key;ui.visibleCount=0;ui.sentinel=null;ui.loading=false;
  if(!notes.length){const empty=el('div','empty-state');empty.append(el('h3','',ui.query||ui.selectedTag?'没有匹配的记录':'暂无记录'),el('p','',ui.query||ui.selectedTag?'调整搜索或标签筛选。':'在上方直接输入。'));if(ui.query||ui.selectedTag)empty.append(button('清除筛选','clear-filters','','button secondary'));elements.noteList.append(empty);}
  else appendNextPage(target);
  elements.noteList.scrollTop=same?oldScroll:0;elements.listSummary.textContent=notes.length+' 条'+(ui.selectedTag?' · #'+ui.selectedTag:'');elements.noteList.setAttribute('aria-label',notes.length+' 条记录');syncCardTabStops();elements.clearSearch.hidden=!ui.query;
  renderTagMenu();renderWorkspaceNudge();refreshSearchSummary();if(window.NoteInteractions)window.NoteInteractions.refresh();
}

/** 创建可直接输入的空白卡片，工具与提交操作分别排列。 */
function createComposer() {
  const composer=el('section','sidebar-composer composer-placeholder is-active');composer.id='quick-composer';composer.setAttribute('aria-label','直接记录');
  const input=el('textarea','sidebar-draft-input');input.id='sidebar-draft-input';input.rows=1;input.placeholder="记一条… 支持 Markdown、#标签\nCtrl+Enter 保存，侧栏保持展开";input.setAttribute('aria-label','直接输入新记录，Ctrl+Enter 保存，侧栏保持展开');
  const attachments=el('div','attachment-list');attachments.id='sidebar-attachment-list';
  const footer=el('div','composer-footer'),tools=el('div','composer-tools'),actions=el('div','composer-actions');
  tools.append(button('添加图片','attach-image','image'),button('引用文件','attach-file','file'));
  // 字数紧跟附件工具；终端主题在同一位置写出 Ctrl+Enter（由样式按 data-sn-shortcuts 切换），见 components.md 1.6。
  const count=el('span','composer-count','0 字');elements.composerCount=count;
  actions.append(keyHint(['Ctrl','Enter']),button('收起输入 · Esc','close-composer','x'),button('保存记录，保持侧栏展开','save-sidebar-note','check','composer-submit icon-button primary'));
  footer.append(tools,count,actions);composer.append(input,attachments,footer);
  // 新建卡片独占列表上方的一块区域，不随列表滚动（与 Design Playground 相同），列表滚动时卡片从它下方移出。
  elements.noteList.before(composer);
  elements.sidebarDraft=input;elements.sidebarComposer=composer;elements.sidebarAttachments=attachments;
  input.addEventListener('focus',function activateInput(){ui.composer=true;composer.classList.add('is-active');cancelHide();resizeDraftInput();});
  input.addEventListener('input',resizeDraftInput);
}

/** 同步两个入口的草稿和附件。 */
function renderDraft() {
  if (elements.draftInput.value !== state.draft.text) elements.draftInput.value = state.draft.text;
  if (elements.sidebarDraft.value !== state.draft.text) elements.sidebarDraft.value = state.draft.text;
  const characters = Array.from(state.draft.text).length + ' 字';
  elements.charCount.textContent = characters;
  if (elements.composerCount) elements.composerCount.textContent = characters;
  [elements.attachmentList, elements.sidebarAttachments].forEach(function renderAttachmentList(list) {
    list.replaceChildren();
    state.draft.images.forEach(function appendAttachment(attachment) {
      const item = el('div', 'attachment-item');
      const preview = el('button', 'attachment-preview');
      preview.type = 'button';
      preview.dataset.action = 'preview-draft-image';
      preview.dataset.imageId = attachment.id;
      preview.setAttribute('aria-label', '预览图片：' + attachment.name);
      const image = el('img');
      image.src = attachment.data;
      image.alt = attachment.name;
      preview.append(image);
      const remove = button('移除图片：' + attachment.name, 'remove-draft-image', 'x');
      remove.classList.add('attachment-remove');
      remove.dataset.imageId = attachment.id;
      item.append(preview, remove);
      list.append(item);
    });
  });
  elements.saveNote.disabled = ui.pendingImages > 0 || (!state.draft.text.trim() && !state.draft.images.length);
  const sidebarSave = elements.sidebarComposer.querySelector('[data-action="save-sidebar-note"]');
  sidebarSave.disabled = elements.saveNote.disabled;
  elements.sidebarComposer.hidden = false;
  resizeDraftInput();
  [elements.draftInput,elements.sidebarDraft].forEach(function syncEditor(input){if(input.liveMarkdown&&input.liveMarkdown.getValue()!==state.draft.text)input.liveMarkdown.setValue(state.draft.text);});
  setStorageStatus(ui.storageWriteError);
}

/** @brief 更新共享草稿。 @param {string} text 正文。 */
function changeDraft(text) {
  ui.draftDirty = true;
  state.draft.text = text;
  state.draft.updatedAt = Date.now();
  renderDraft();
  window.clearTimeout(ui.draftTimer);
  ui.draftTimer = window.setTimeout(persistDraft, 220);
}

/** @brief 在所属页签保存新增记录，按钮保留当前窗口，快捷键收起当前窗口。 @param {string} origin 来源。 @param {object} options 提交选项。 */
function saveDraft(origin,options={}){
  if(ui.pendingImages){toast('内容正在读取，请稍候');return;}
  if(!state.draft.text.trim()&&!state.draft.images.length)return;window.clearTimeout(ui.draftTimer);
  const now=Date.now(),targetTab=origin==='sidebar'?ui.tab:'workspace',collapse=Boolean(options.collapse);
  const note={id:createId(),text:window.NoteContent.canonicalize(state.draft.text),images:state.draft.images.map(function clone(image){return {...image};}),pinned:targetTab==='pinned',status:targetTab==='archive'?'archived':'active',collapsed:false,emoji:window.NoteEmoji.pick(state.notes.map(function current(n){return n.emoji;})),createdAt:now,updatedAt:now};
  if(!persistSnapshot([note,...state.notes],{text:'',images:[],updatedAt:now})){persistDraft();toast('没有保存成功，草稿和图片仍在，可导出备份后重试',null,true);renderDraft();return;}
  ui.tab=targetTab;ui.query='';ui.selectedTag='';elements.searchInput.value='';ui.composer=false;renderDraft();renderNotes();
  if(origin==='capture'){
    if(collapse)hideCapture();else showCapture();
  }else if(collapse)hideSidebar(true);else{showSidebar({focus:false});focusNewComposer();}
  toast(targetTab==='pinned'?'已保存并置顶':targetTab==='archive'?'已保存到归档':'已保存到工作区',{label:'查看',run:function reveal(){showSidebar({focus:false});window.setTimeout(function focusSaved(){const card=Array.from(elements.noteList.querySelectorAll('[data-note-id]')).find(function same(n){return n.dataset.noteId===note.id;});if(card){card.scrollIntoView({block:'nearest',behavior:'smooth'});card.focus({preventScroll:true});}},80);}});
}

/** @brief 开始事务式编辑，标签整理和拖动优先于正文。 @param {string} id 记录标识。 */
function beginEdit(id){
  if(ui.skipCardClick||ui.sortPress&&ui.sortPress.active)return;
  if(ui.expandedTags.size){finishTagRename(false);closeExpandedTags();renderNotes();return;}
  if(ui.editing&&ui.editing.id===id)return;if(ui.editing&&!finishEdit())return;
  const note=state.notes.find(function same(n){return n.id===id;});if(!note)return;
  ui.editing={id:id,text:note.text,images:note.images.map(function clone(image){return {...image};}),originalText:note.text,originalImages:note.images};
  cancelHide();renderNotes();const input=elements.noteList.querySelector('textarea[data-edit-id]');if(input){input.focus();const end=input.liveMarkdown?input.liveMarkdown.getValue().length:input.value.length;input.setSelectionRange(end,end);}
}

/** @brief 仅显式提交时写入编辑事务，后台备份不提交当前修改。 @param {boolean} commit 是否提交。 @return {boolean} 是否成功。 */
function flushEdit(commit=false){
  window.clearTimeout(ui.editTimer);if(!ui.editing||!commit)return true;
  if(ui.pendingImages){toast('请等待读取完成后再保存');return false;}
  const editing=ui.editing,note=state.notes.find(function same(n){return n.id===editing.id;});if(!note)return false;
  if(!editing.text.trim()&&!editing.images.length){toast('记录内容为空，可使用删除操作移入回收站',null,true);return false;}
  const next=state.notes.map(function apply(n){return n.id===editing.id?{...n,text:window.NoteContent.canonicalize(editing.text),images:editing.images,updatedAt:Date.now()}:n;});
  const saved=persistSnapshot(next);ui.editStorageError=!saved;setStorageStatus(ui.storageWriteError);if(!saved)toast('编辑未保存，修改仍保留在输入区',null,true);return saved;
}

/** @brief 保存并退出当前记录编辑，保持侧栏可见。 @return {boolean} 是否成功。 */
function finishEdit(){
  window.clearTimeout(ui.editBlurTimer);if(!ui.editing)return true;
  if(!flushEdit(true))return false;
  ui.editing=null;ui.editAttachmentHold=null;ui.pendingEditBlur=null;ui.editStorageError=false;renderNotes();return true;
}

/* ==================== 窗口可见性与图片 ==================== */

/** 取消侧栏延迟隐藏。 */
function cancelHide() {
  window.clearTimeout(ui.hideTimer);
}

/** 按设置延迟隐藏，正在操作的编辑、选择、拖动与菜单始终优先。 */
function scheduleHide(){
  cancelHide();
  /** @brief 检查当前是否允许自动收起。 @return {boolean} 是否应保留侧栏。 */
  function keepVisible(){return ui.locked||ui.modal||window.matchMedia&&window.matchMedia('(max-width: 480px)').matches||ui.resizing||ui.searchOpen||window.NoteMenus&&window.NoteMenus.isOpen()||window.NoteInteractions&&(window.NoteInteractions.isBusy()||window.NoteInteractions.hasSelection())||(state.settings.protectEditing&&(ui.editing||(ui.composer&&(state.draft.text.trim()||state.draft.images.length||ui.pendingImages))||ui.expandedTags.size));}
  if(keepVisible())return;
  ui.hideTimer=window.setTimeout(function hideAfterDelay(){if(!elements.sidebar.matches(':hover')&&!keepVisible())hideSidebar();},state.settings.hideDelay);
}

/** @brief 显示侧栏并在展开动画后复核新建输入焦点。 @param {object} options 聚焦选项。 */
function showSidebar(options={}){
  const wasOpen=elements.sidebar.classList.contains('open')&&!elements.sidebar.inert;
  cancelHide();elements.sidebar.inert=false;elements.sidebar.setAttribute('aria-hidden','false');elements.sidebar.classList.add('open');
  if(!wasOpen&&options.focus!==false&&!ui.modal&&!ui.editing){
    if(ui.searchOpen)toggleSearch(false);
    queueComposerFocus();
  }
}

/** @brief 收起侧栏，手动操作解除固定并提交失焦编辑。 @param {boolean} manual 是否手动收起。 */
function hideSidebar(manual=false){
  if(ui.editing&&!finishEdit())return;
  cancelHide();ui.composerFocusToken=(ui.composerFocusToken||0)+1;persistDraft();
  if(manual){ui.locked=false;const lock=document.getElementById('sidebar-lock');lock.setAttribute('aria-pressed','false');lock.setAttribute('aria-label','固定侧栏');lock.title='固定侧栏';lock.replaceChildren(icon('pin'));}
  if(elements.sidebar.contains(document.activeElement))document.activeElement.blur();
  elements.sidebar.classList.remove('open');elements.sidebar.setAttribute('aria-hidden','true');elements.sidebar.inert=true;closeTagMenu();
  if(window.NoteMenus)window.NoteMenus.close({restoreFocus:false});
}

/** @brief 展开速记浮窗并聚焦真实输入面，用户转移焦点后停止补聚焦。 @param {boolean} focus 是否聚焦。 */
function showCapture(focus=true){
  elements.capture.inert=false;elements.capture.setAttribute('aria-hidden','false');elements.capture.classList.add('open');renderDraft();
  const token=ui.captureFocusToken=(ui.captureFocusToken||0)+1,startFocus=document.activeElement;
  /** 在浮窗显示后补足首次聚焦。 */
  function focusCapture(){
    if(!focus||token!==ui.captureFocusToken||!elements.capture.classList.contains('open')||elements.capture.inert||ui.modal)return;
    const input=elements.draftInput.liveMarkdown?elements.draftInput.liveMarkdown.element:elements.draftInput,active=document.activeElement;
    if(active===input)return;
    if(active!==startFocus&&active!==document.body&&active!==elements.draftInput)return;
    input.focus({preventScroll:true});const end=elements.draftInput.liveMarkdown?elements.draftInput.liveMarkdown.getValue().length:elements.draftInput.value.length;elements.draftInput.setSelectionRange(end,end);
  }
  focusCapture();if(focus)window.requestAnimationFrame(focusCapture);
}

/** 收起速记浮窗，取消补聚焦并保留草稿。 */
function hideCapture(){
  ui.captureFocusToken=(ui.captureFocusToken||0)+1;persistDraft();
  if(elements.capture.contains(document.activeElement))document.activeElement.blur();
  elements.capture.classList.remove('open');elements.capture.setAttribute('aria-hidden','true');elements.capture.inert=true;
}

/** @brief 将浏览器文件转换为内嵌图片。 @param {File} file 文件。 @return {Promise<object>} 图片。 */
function readImage(file) {
  return new Promise(function readImagePromise(resolve, reject) {
    if (!/^image\/(png|jpeg|gif|webp|svg\+xml)$/.test(file.type)) { reject(new Error('支持 PNG、JPG、GIF、WebP 和 SVG 图片')); return; }
    if (file.size > MAX_IMAGE_BYTES) { reject(new Error('单张图片需小于 2 MB，请压缩后再添加')); return; }
    const reader = new FileReader();
    reader.onload = function imageLoaded() { resolve({ id: createId(), name: file.name || '粘贴的截图.png', type: file.type, data: String(reader.result) }); };
    reader.onerror = function imageFailed() { reject(new Error('图片读取失败，文字草稿已保留')); };
    reader.readAsDataURL(file);
  });
}

/** @brief 将图片加入共享草稿。 @param {FileList|Array} files 文件。 */
async function addImages(files) {
  const available = Math.max(0, 12 - state.draft.images.length - ui.pendingImages);
  const selected = Array.from(files).filter(function isImage(file) { return file && file.type.startsWith('image/'); }).slice(0, available);
  if (!selected.length) { toast(available ? '请选择图片文件' : '一条记录最多添加 12 张图片', null, true); return; }
  ui.pendingImages += selected.length;
  renderDraft();
  const results = await Promise.allSettled(selected.map(readImage));
  results.forEach(function applyImageResult(result) {
    ui.pendingImages -= 1;
    if (result.status === 'fulfilled') state.draft.images.push(result.value);
    else toast(result.reason.message, null, true);
  });
  state.draft.updatedAt = Date.now();
  persistDraft();
  renderDraft();resumeEditBlur();
}

/** @brief 移除草稿图片。 @param {string} id 图片标识。 */
function removeDraftImage(id) {
  state.draft.images = state.draft.images.filter(function keepImage(image) { return image.id !== id; });
  state.draft.updatedAt = Date.now();
  persistDraft();
  renderDraft();
}

/* ==================== 对话框、通知与备份 ==================== */

/** @brief 显示提示，可附带撤销操作。 @param {string} message 消息。 @param {object|null} action 操作。 @param {boolean} error 是否错误。 */
function toast(message, action = null, error = false) {
  if (!elements.toastRegion) return;
  const item = el('div', 'toast' + (error ? ' error' : ''));
  if (error) item.setAttribute('role', 'alert');
  item.append(icon(error ? 'alert' : 'check-circle'), el('span', '', message));
  if (action) {
    const control = el('button', 'toast-action', action.label);
    control.type = 'button';
    control.addEventListener('click', function runToastAction() { action.run(); item.remove(); });
    item.append(control);
  }
  const close = button('关闭提示', '', 'x');
  close.addEventListener('click', function closeToast() { item.remove(); });
  item.append(close);
  elements.toastRegion.append(item);
  while (elements.toastRegion.children.length > 3) elements.toastRegion.firstElementChild.remove();
  // 停留 6 秒，带撤销 9 秒；指针停在提示条上或焦点在提示条内时暂停计时（本次提出）。
  let remaining = action ? 9000 : 6000, started = 0, timer = 0;
  const resume = function resumeToast() { window.clearTimeout(timer); started = Date.now(); timer = window.setTimeout(function dismissToast() { item.remove(); }, remaining); };
  const pause = function pauseToast() { window.clearTimeout(timer); remaining = Math.max(1000, remaining - (Date.now() - started)); };
  item.addEventListener('pointerenter', pause);
  item.addEventListener('pointerleave', function leaveToast() { if (!item.contains(document.activeElement)) resume(); });
  item.addEventListener('focusin', pause);
  item.addEventListener('focusout', function blurToast(event) { if (!item.contains(event.relatedTarget) && !item.matches(':hover')) resume(); });
  resume();
}

/** 关闭当前对话框并恢复焦点。 */
function closeModal() {
  elements.modalRoot.replaceChildren();
  ui.modal = null;
  document.getElementById('sidebar-lock').classList.remove('is-linked');
  document.body.classList.remove('has-modal');
  if (ui.previousFocus && ui.previousFocus.isConnected && !ui.previousFocus.closest('[inert]')) ui.previousFocus.focus({ preventScroll: true });
  ui.previousFocus = null;
}

/** @brief 创建具有焦点约束的对话框。 @param {string} title 标题。 @param {string} className 样式。 @return {object} 对话框容器。 */
function openModal(title, className = '') {
  cancelHide();
  ui.previousFocus = document.activeElement;
  const backdrop = el('div', 'modal-backdrop');
  const modal = el('section', 'modal ' + className);
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');
  modal.setAttribute('aria-labelledby', 'active-modal-title');
  modal.tabIndex = -1;
  const header = el('header', 'modal-header');
  const heading = el('h2', '', title);
  heading.id = 'active-modal-title';
  header.append(heading, button('关闭对话框', 'close-modal', 'x'));
  const body = el('div', 'modal-body');
  const footer = el('footer', 'modal-footer');
  modal.append(header, body, footer);
  backdrop.append(modal);
  backdrop.addEventListener('click', function closeOnBackdrop(event) { if (event.target === backdrop) closeModal(); });
  elements.modalRoot.replaceChildren(backdrop);
  document.body.classList.add('has-modal');
  ui.modal = className || 'dialog';
  // 设置打开期间侧栏保持展开，固定按钮显示虚线圈，表示「临时固定」（T31）。
  if (className === 'settings-modal') document.getElementById('sidebar-lock').classList.add('is-linked');
  window.setTimeout(function focusModal() { const focusable = modal.querySelector('[autofocus],input,textarea,select,button'); (focusable || modal).focus(); }, 30);
  return { modal: modal, body: body, footer: footer };
}

/** @brief 显示确认对话框。 @param {object} options 文案和确认操作。 */
function confirmAction(options) {
  const dialog = openModal(options.title, 'confirm-modal');
  dialog.body.append(el('p', 'confirm-description', options.description));
  const cancel = button('取消', 'close-modal', '', 'button secondary');
  const confirm = button(options.confirmLabel || '确认', '', '', 'button danger');
  confirm.addEventListener('click', function applyConfirmation() {
    if (options.run() !== false) closeModal();
  });
  dialog.footer.append(cancel, confirm);
}

/** @brief 显示图片原图。 @param {object} attachment 图片。 */
function previewImage(attachment) {
  if (!attachment) return;
  const dialog = openModal(attachment.name, 'image-modal');
  const image = el('img', 'full-image');
  image.src = attachment.data;
  image.alt = attachment.name;
  dialog.body.append(image);
  const download = el('a', 'button secondary', '保存图片');
  download.href = attachment.data;
  download.download = attachment.name;
  dialog.footer.append(el('span', 'modal-hint', 'Esc 关闭预览'), download);
}

/** @brief 同时复制Emoji、正文与图像表示；文件附件提供真实文件交接。 @param {object} note 记录。 */
async function copyNote(note){
  try{const result=await window.NoteClipboard.copy(note);toast(result.kind==='image'?'已复制文字、富文本和图片表示':result.kind==='rich'?'已复制文字与富文本':'已复制文字');if(result.refs.length||result.imageError)showCopiedAttachments(note,result);}
  catch(error){const dialog=openModal('复制记录','copy-modal');dialog.body.append(el('p','modal-hint','剪贴板权限受限，可选中文字后按 Ctrl+C。'));const input=el('textarea','copy-fallback form-control');input.value=(note.emoji||'📝')+' '+note.text;input.readOnly=true;input.rows=8;dialog.body.append(input);window.setTimeout(function selectText(){input.focus();input.select();},30);}
}
/** @brief 展示浏览器不能写入原生文件剪贴板的真实附件交接入口。 @param {object} note 记录。 @param {object} result 复制结果。 */
function showCopiedAttachments(note,result){const dialog=openModal('复制与附件','clipboard-attachments-modal');dialog.body.append(el('p','modal-hint',result.refs.length?'文字已复制。浏览器无法把任意文件写入微信等应用的文件剪贴板；可保存真实文件后拖入目标应用，或使用系统分享。':'图片复制受限，已保留文字与富文本。'));if(result.imageError)dialog.body.append(el('p','settings-notice',result.imageError));const list=el('div','clipboard-file-list');result.refs.forEach(function row(ref){const item=el('div','clipboard-file-row');item.append(icon('file'),el('span','',window.NoteContent.fileLabel(ref)));const save=button('保存文件','','download','button secondary compact');save.addEventListener('click',async function saveRealFile(){const file=await window.NoteClipboard.file(ref);if(!file){openFileReference(ref);return;}window.NoteClipboard.download(file);});const share=button('系统分享','','external','button secondary compact');share.addEventListener('click',async function shareRealFile(){try{const file=await window.NoteClipboard.file(ref);if(!file){openFileReference(ref);return;}if(!navigator.share||!navigator.canShare||!navigator.canShare({files:[file]})){toast('当前环境不支持文件系统分享，请保存后拖入目标应用');return;}await navigator.share({files:[file],title:(note.emoji||'📝')+' '+file.name});}catch(error){if(error.name!=='AbortError')toast('分享未完成，可保存文件后发送',null,true);}});item.append(save,share);list.append(item);});note.images.forEach(function imageRow(image){const item=el('div','clipboard-file-row');item.append(icon('image'),el('span','',image.name));const save=button('保存图片','','download','button secondary compact');save.addEventListener('click',async function saveImage(){try{const response=await fetch(image.data),blob=await response.blob();window.NoteClipboard.download(new File([blob],image.name,{type:blob.type}));}catch(error){toast('图片读取失败',null,true);}});item.append(save);list.append(item);});dialog.body.append(list);dialog.footer.remove();}


/** @brief 归档或恢复记录，并提供撤销。 @param {object} note 记录。 */
function archiveNote(note) {
  if (ui.editing && !finishEdit()) return;
  const previousStatus = note.status;
  const archived = previousStatus !== 'archived';
  if (!updateNote(note.id, { status: archived ? 'archived' : 'active' })) return;
  toast(archived ? '已归档，需要时仍能找到' : '已移回工作区', { label: '撤销', run: function undoArchive() { updateNote(note.id, { status: previousStatus }); } });
}

/** @brief 删除前请求确认。 @param {object} note 记录。 */
function requestDelete(note) {
  confirmAction({ title: '将这条记录移入回收站？', description: '“' + (note.text.split('\n')[0] || '图片记录').slice(0, 70) + '”会暂存于回收站，可在设置中恢复。', confirmLabel: '移入回收站', run: function moveToTrash() {
    const prior = note.status;
    if (!updateNote(note.id, { status: 'trash', previousStatus: prior, deletedAt: Date.now() })) return false;
    toast('已移入回收站', { label: '撤销', run: function undoDelete() { updateNote(note.id, { status: prior, deletedAt: null }); } });
    return true;
  } });
}

/** @brief 在操作按钮旁显示卡片上下文菜单。 @param {object} note 记录。 @param {HTMLElement|Event} anchor 定位来源。 */
function openNoteOptions(note,anchor){if(window.NoteMenus)window.NoteMenus.open(note,anchor);}

/** 导出当前记录、草稿、图片和设置的 JSON 备份。 */
function exportData() {
  const editingSaved = !hasUnsavedEdit();
  const exportNotes = !editingSaved && ui.editing ? state.notes.map(function keepUnsavedEdit(note) { return note.id === ui.editing.id ? { ...note, text: ui.editing.text, updatedAt: Date.now() } : note; }) : state.notes;
  const payload = { ...state, notes: exportNotes, exportedAt: new Date().toISOString(), application: 'SideNotes Prototype' };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = el('a');
  link.href = url;
  link.download = 'SideNotes-备份-' + new Date().toISOString().slice(0, 10) + '.json';
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(function releaseDownload() { URL.revokeObjectURL(url); }, 1000);
  toast('已生成备份，包含记录、草稿和图片');
}

/** @brief 校验并预览导入备份。 @param {File} file 文件。 */
async function inspectImport(file) {
  if (!file) return;
  if (ui.pendingImages) { toast('图片仍在读取，请完成后再导入备份'); return; }
  if (!finishEdit()) { toast('请先保存当前编辑，或导出备份后重试', null, true); return; }
  if (file.size > 25 * 1024 * 1024) { toast('备份文件超过 25 MB，请选择较小的 JSON 文件', null, true); return; }
  try {
    const parsed = JSON.parse(await file.text());
    const rawNotes = Array.isArray(parsed) ? parsed : parsed.notes;
    if (!Array.isArray(rawNotes) || rawNotes.length > 10000) throw new Error('未找到有效的记录列表');
    const notes = rawNotes.map(normalizeNote);
    if (notes.some(function invalidNote(note) { return !note; })) throw new Error('备份含有无效记录，未导入任何内容');
    const dialog = openModal('导入本地备份', 'import-modal');
    dialog.body.append(el('p', '', '已读取 ' + notes.length + ' 条记录。导入将合并到当前内容，现有记录和当前草稿会保留。'));
    dialog.body.append(el('p', 'modal-hint', '标识相同的记录仅在备份更新时替换；新记录直接加入。图片会一起导入。'));
    const confirm = button('合并导入', '', 'upload', 'button primary');
    confirm.addEventListener('click', function mergeImport() {
      if (ui.pendingImages) { toast('图片仍在读取，请稍后重试'); return; }
      const merged = new Map(state.notes.map(function noteEntry(note) { return [note.id, note]; }));
      notes.forEach(function mergeNote(note) {
        const current = merged.get(note.id);
        if (!current || note.updatedAt > current.updatedAt) merged.set(note.id, note);
      });
      const importedDraft = parsed.draft && typeof parsed.draft.text === 'string' ? { text: parsed.draft.text, images: (Array.isArray(parsed.draft.images) ? parsed.draft.images : []).map(normalizeImage).filter(Boolean), updatedAt: Date.now() } : null;
      const draft = !state.draft.text.trim() && !state.draft.images.length && importedDraft ? importedDraft : state.draft;
      if (!persistSnapshot(Array.from(merged.values()), draft)) { toast('导入未完成，浏览器存储空间不足；当前内容未改动。', null, true); return; }
      closeModal();
      renderNotes();
      renderDraft();
      toast('备份已合并到本地记录');
    });
    dialog.footer.append(button('取消', 'close-modal', '', 'button secondary'), confirm);
  } catch (error) {
    toast('无法导入：' + (error.message || '请选择有效的 JSON 备份'), null, true);
  }
}

/** 打开回收站分类。 */
function openTrash() { window.SideNotesSettings.open('trash'); }

/** @brief 创建设置项。 @param {string} title 名称。 @param {string} description 说明。 @param {HTMLElement} control 控件。 @return {HTMLElement} 设置行。 */
function settingRow(title, description, control) {
  const row = el('label', 'setting-row');
  const copy = el('span', 'setting-copy');
  copy.append(el('span', 'setting-label', title), el('span', 'setting-description', description));
  row.append(copy, control);
  return row;
}

/** @brief 创建设置下拉框。 @param {string} name 名称。 @param {Array} options 选项。 @return {HTMLSelectElement} 下拉框。 */
function settingSelect(name, options) {
  const select = el('select', 'form-control');
  select.dataset.setting = name;
  options.forEach(function appendOption(option) {
    const item = el('option', '', option[1]);
    item.value = option[0];
    item.selected = String(state.settings[name]) === String(option[0]);
    select.append(item);
  });
  return select;
}

/** 应用外观、字体、目录与同步偏好。 */
function applySettings() { window.SideNotesSettings.apply();if(elements.resizer){elements.resizer.dataset.edge=state.settings.edge;elements.resizer.setAttribute('aria-valuenow',String(state.settings.width));}renderWorkspaceNudge();setStorageStatus(ui.storageWriteError);scheduleTagLayout(); }

/** @brief 打开分类设置。 @param {string} section 分类。 */
function openSettings(section='appearance') { window.SideNotesSettings.open(typeof section==='string'?section:'appearance'); }

/** @brief 分发记录、标签与窗口操作。 @param {MouseEvent} event 点击事件。 */
function handleAction(event) {
  const tab=event.target.closest('[data-tab]');if(tab){if(!finishEdit())return;ui.tab=tab.dataset.tab;ui.query='';ui.selectedTag='';elements.searchInput.value='';closeTagMenu();renderNotes();return;}
  const control=event.target.closest('[data-action]');if(!control||control.disabled)return;const action=control.dataset.action,card=control.closest('[data-note-id]'),note=card&&state.notes.find(function find(n){return n.id===card.dataset.noteId;});
  switch(action){
    case 'hide-sidebar':hideSidebar(true);break;
    case 'choose-emoji':if(note){window.clearTimeout(ui.clickTimer);window.NoteEmoji.open(note);}break;
    case 'show-changelog':showChangelog();break;
    case 'load-more':appendNextPage();break;
    case 'hide-capture':hideCapture();break;
    case 'lock-sidebar':ui.locked=!ui.locked;control.setAttribute('aria-pressed',String(ui.locked));control.setAttribute('aria-label',ui.locked?'取消固定侧栏':'固定侧栏');control.title=ui.locked?'取消固定侧栏':'固定侧栏';control.replaceChildren(icon('pin'));if(ui.locked){cancelHide();queueComposerFocus();}break;
    case 'new-note':if(finishEdit()){showSidebar();ui.composer=true;renderDraft();elements.sidebarDraft.focus();}break;
    case 'close-composer':ui.composer=false;persistDraft();elements.sidebarDraft.blur();renderDraft();break;
    case 'capture-to-sidebar':hideCapture();showSidebar();ui.composer=true;renderDraft();elements.sidebarDraft.focus();break;
    case 'save-note':saveDraft('capture');break;case 'save-sidebar-note':saveDraft('sidebar');break;
    case 'attach-image':ui.attachmentTarget=control.closest('#capture')?'capture':'draft';elements.imagePicker.click();break;
    case 'attach-file':{ui.attachmentTarget=control.closest('#capture')?'capture':'draft';const d=openModal('添加文件引用','file-reference-modal');const input=el('input','form-control tag-name-input');input.placeholder='C:\\项目\\设计稿.pdf 或 file:///…';input.setAttribute('aria-label','文件路径');const choose=button('选择本机文件','','folder','button secondary');choose.addEventListener('click',function chooseReference(){closeModal();elements.attachmentPicker.click();});d.body.append(choose,input,el('p','modal-hint','选择文件或输入完整路径；打开时校验或重新定位。'));const add=button('插入引用','','file','button primary');add.addEventListener('click',function insertFile(){const p=input.value.trim();if(!window.NoteContent.filePath(p)){toast('请输入有效的本地绝对路径',null,true);return;}const name=p.split(/[\\/]/).pop()||'文件';changeDraft(state.draft.text+(state.draft.text?'\n\n':'')+'['+name.replace(/[\[\]]/g,'')+']('+p+')');closeModal();});d.footer.append(add);break;}
    case 'remove-draft-image':removeDraftImage(control.dataset.imageId);break;
    case 'preview-draft-image':previewImage(state.draft.images.find(function find(i){return i.id===control.dataset.imageId;}));break;
    case 'preview-image':if(note)previewImage(note.images.find(function find(i){return i.id===control.dataset.imageId;}));break;
    case 'preview-markdown-image':previewImage({name:control.dataset.alt||'图片',data:control.dataset.src});break;
    case 'open-file-reference':openFileReference(control.dataset.filePath);break;
    case 'open-note':if(note)openNote(note);break;
    case 'copy-note':if(note)copyNote(note);break;
    case 'pin-note':if(note)updateNote(note.id,{pinned:!note.pinned});break;
    case 'archive-note':if(note)archiveNote(note);break;
    case 'more-note':if(note)openNoteOptions(note,control);break;
    case 'toggle-note-collapse':if(note&&window.NoteMenus)window.NoteMenus.toggleCollapsed(note);break;
    case 'finish-edit':finishEdit();break;
    case 'cancel-edit':cancelEdit();break;
    case 'toggle-search':toggleSearch(!ui.searchOpen);break;
    case 'collapse-search':toggleSearch(false);break;
    case 'attach-edit-image':ui.editAttachmentHold=ui.editing;ui.attachmentTarget=note.id;elements.imagePicker.click();break;
    case 'attach-edit-file':ui.editAttachmentHold=ui.editing;ui.attachmentTarget=note.id;elements.attachmentPicker.click();break;
    case 'remove-edit-image':removeEditImage(control.dataset.imageId);break;
    case 'filter-tag':if(card){window.clearTimeout(ui.tagClickTimer);if(!ui.expandedTags.has(note.id))ui.tagClickTimer=window.setTimeout(function filterAfterClick(){selectTag(control.dataset.tag);},550);}else selectTag(control.dataset.tag);break;
    case 'clear-tag':ui.selectedTag='';closeTagMenu();renderNotes();break;
    case 'clear-filters':ui.selectedTag='';ui.query='';elements.searchInput.value='';renderNotes();break;
    case 'expand-tags':{const id=note?note.id:control.dataset.noteId;if(!finishTagRename(false))break;const expanded=ui.expandedTags.has(id);ui.expandedTags.clear();if(!expanded)ui.expandedTags.add(id);renderNotes();break;}
    case 'remove-note-tag':if(note)removeNoteTag(note,control.dataset.tag);break;
    case 'toggle-tag-menu':{const show=elements.tagDropdown.hidden;renderTagMenu();elements.tagDropdown.hidden=!show;control.setAttribute('aria-expanded',String(show));break;}
    case 'manage-tag':manageTag(control.dataset.tag);break;
    case 'focus-tag-search':toggleSearch(true);closeTagMenu();elements.searchInput.value='#';ui.query='#';elements.searchInput.focus();elements.searchInput.setSelectionRange(1,1);renderNotes();break;
    case 'snooze-tidy':{const next={...state.settings,tidySnoozeUntil:Date.now()+7*86400000};if(persistSnapshot(state.notes,state.draft,next))renderWorkspaceNudge();break;}
    case 'tidy-workspace':ui.tab='workspace';ui.selectedTag='';ui.query='';elements.searchInput.value='';renderNotes();toast('可将已处理记录归档。');break;
    case 'tidy-settings':openSettings('appearance');break;
    case 'settings':openSettings();break;case 'close-modal':closeModal();break;
    case 'export-data':exportData();break;case 'import-data':elements.importPicker.click();break;case 'open-trash':openTrash();break;
    case 'retry-cloud':window.SideNotesSettings.backupNow({manual:true});break;
    case 'retry-storage':if(flushEdit()&&persistSnapshot()){renderDraft();openSettings('data');toast('本地保存已恢复');}else toast('仍未保存，请导出备份',null,true);break;
    case 'clear-search':toggleSearch(true);ui.query='';elements.searchInput.value='';renderNotes();elements.searchInput.focus();break;
    default:break;
  }
}

/* ==================== 高亮、键盘与复制 ==================== */
/**
 * @brief 高亮一张卡片：悬停与单击共用这一种状态（T66），指针离开后保持。
 * @details 高亮的卡片是 Ctrl+C 复制与键盘操作的对象，也是列表唯一的 Tab 停靠点；它的按钮进入 Tab 顺序，
 * 其余卡片的按钮只响应指针（interactions.md 3.2）。
 * @param {string} id 记录标识，空值清除高亮。 @param {object} options focus 为真时把焦点移到卡片并滚动到可见位置。
 */
function setCurrentCard(id,options={}){
  ui.currentId=id||'';
  elements.noteList.querySelectorAll('.note-card').forEach(function mark(card){
    const current=card.dataset.noteId===ui.currentId;card.classList.toggle('is-current',current);
    if(current)card.setAttribute('aria-current','true');else card.removeAttribute('aria-current');
    card.querySelectorAll('.note-emoji,.note-actions button,.note-bottom button,.note-expand').forEach(function tabStop(node){node.tabIndex=current?0:-1;});
  });
  syncCardTabStops();
  if(options.focus){const card=currentCardElement();if(card){card.focus({preventScroll:true});card.scrollIntoView({block:'nearest'});}}
}
/** @brief 当前高亮的卡片元素。 @return {HTMLElement|null} 卡片。 */
function currentCardElement(){return Array.from(elements.noteList.querySelectorAll('.note-card')).find(function same(card){return card.dataset.noteId===ui.currentId;})||null;}
/** 列表只占一个 Tab 停靠点：编辑中或高亮的卡片，没有时是第一张。 */
function syncCardTabStops(){
  const cards=Array.from(elements.noteList.querySelectorAll('.note-card'));
  const stop=cards.find(function editing(card){return card.classList.contains('is-editing');})||cards.find(function current(card){return card.dataset.noteId===ui.currentId;})||cards[0];
  cards.forEach(function tabStop(card){card.tabIndex=card===stop?0:-1;});
}

/**
 * @brief 卡片列表的键盘操作（interactions.md 3.2）。
 * @details ↑ ↓ 移动并高亮，Home、End 到两端，Enter 编辑，Delete 移入回收站（先确认），
 * Shift+F10 或菜单键在卡片左上角附近打开卡片菜单。只处理焦点落在卡片本身的按键，卡片内的按钮与编辑区各自处理。
 * @param {KeyboardEvent} event 按键。
 */
function handleCardKeyboard(event){
  if(event.defaultPrevented||event.isComposing||!event.target.matches('.note-card')||event.target.classList.contains('is-editing'))return;
  const card=event.target,cards=Array.from(elements.noteList.querySelectorAll('.note-card')),index=cards.indexOf(card);
  const note=state.notes.find(function same(n){return n.id===card.dataset.noteId;});if(!note)return;
  const next=event.key==='ArrowDown'?cards[Math.min(cards.length-1,index+1)]:event.key==='ArrowUp'?cards[Math.max(0,index-1)]:event.key==='Home'?cards[0]:event.key==='End'?cards[cards.length-1]:null;
  if(next&&!event.altKey&&!event.ctrlKey){event.preventDefault();setCurrentCard(next.dataset.noteId,{focus:true});return;}
  if(event.key==='Enter'&&!event.ctrlKey&&!event.altKey&&!event.shiftKey){event.preventDefault();ui.skipCardClick=false;beginEdit(note.id);return;}
  if(event.key==='Delete'&&!event.ctrlKey&&!event.altKey){event.preventDefault();setCurrentCard(note.id);requestDelete(note);return;}
  if(event.key==='ContextMenu'||event.shiftKey&&event.key==='F10'){event.preventDefault();setCurrentCard(note.id);const box=card.getBoundingClientRect();if(window.NoteMenus)window.NoteMenus.open(note,{clientX:box.left+24,clientY:box.top+32});}
}

/** @brief 页签按 WAI-ARIA 页签模式：← → 切换并立即显示，Home、End 到两端。 @param {KeyboardEvent} event 按键。 */
function handleTabKeyboard(event){
  const tabs=Array.from(document.querySelectorAll('.sidebar-tabs [role="tab"]')),index=tabs.indexOf(event.target);
  if(index<0||event.altKey||event.ctrlKey)return;
  const next=event.key==='ArrowRight'?tabs[(index+1)%tabs.length]:event.key==='ArrowLeft'?tabs[(index-1+tabs.length)%tabs.length]:event.key==='Home'?tabs[0]:event.key==='End'?tabs[tabs.length-1]:null;
  if(!next)return;event.preventDefault();next.click();next.focus();
}

/**
 * @brief 复制高亮或多选的记录：有多选时是全部选中的记录，否则是高亮的那一张（interactions.md 第二节）。
 * @return {boolean} 是否有可复制的记录。
 */
function copyCurrentOrSelected(){
  if(!elements.sidebar.classList.contains('open'))return false;
  const ids=window.NoteInteractions&&window.NoteInteractions.hasSelection()?window.NoteInteractions.selectedIds():[];
  if(ids.length>1){
    const chosen=state.notes.filter(function picked(note){return ids.includes(note.id);}).sort(compareNoteOrder);
    const text=chosen.map(function plain(note){return (note.emoji||'📝')+' '+note.text;}).join('\n\n');
    navigator.clipboard.writeText(text).then(function copied(){toast('已复制 '+chosen.length+' 条记录');},function denied(){toast('剪贴板权限受限，请逐条复制',null,true);});
    return true;
  }
  const id=ids[0]||ui.currentId,note=id&&state.notes.find(function same(item){return item.id===id&&item.status!=='trash';});
  if(!note)return false;copyNote(note);return true;
}

/**
 * @brief 问号说明：悬停、获得焦点或点击时显示，Esc 关闭（components.md 第六节）。
 * @param {HTMLElement|null} anchor 包含 .help-button 与 .help-text 的容器。
 */
function initializeHelp(anchor){
  if(!anchor)return;const trigger=anchor.querySelector('.help-button'),message=anchor.querySelector('.help-text');
  const show=function show(shown){message.hidden=!shown;trigger.setAttribute('aria-expanded',String(shown));};
  trigger.addEventListener('click',function toggleHelp(){show(message.hidden);});trigger.addEventListener('focus',function focusHelp(){show(true);});trigger.addEventListener('blur',function blurHelp(){show(false);});
  anchor.addEventListener('mouseenter',function hoverHelp(){show(true);});anchor.addEventListener('mouseleave',function leaveHelp(){if(document.activeElement!==trigger)show(false);});
  trigger.addEventListener('keydown',function closeHelp(event){if(event.key==='Escape'&&!message.hidden){event.preventDefault();event.stopPropagation();show(false);}});
}

/** @brief 先退出当前操作，最后才收起窗口。 @param {KeyboardEvent} event 键盘事件。 */
function handleKeyboard(event){
  if(event.defaultPrevented||event.isComposing||ui.composing||event.keyCode===229)return;
  const escape=event.key==='Escape';
  if(ui.modal){
    if(escape){event.preventDefault();closeModal();}
    if(event.key==='Tab'){
      const controls=Array.from(elements.modalRoot.querySelectorAll('button,a[href],input,textarea,select,[tabindex="0"]')).filter(function enabled(n){return !n.disabled&&!n.hidden;});
      if(!controls.length)return;const first=controls[0],last=controls[controls.length-1];
      if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}
    }return;
  }
  if(escape&&window.NoteMenus&&window.NoteMenus.isOpen()){event.preventDefault();window.NoteMenus.close();return;}
  if(escape&&window.NoteInteractions&&window.NoteInteractions.isBusy()){event.preventDefault();window.NoteInteractions.cancelGesture();return;}
  if(escape&&ui.resizing){event.preventDefault();finishSidebarResize(false);return;}
  if(escape&&ui.expandedTags.size){event.preventDefault();cancelTagRename();closeExpandedTags();return;}
  // Esc 逐级退出（interactions.md 3.4）：菜单与弹窗、拖动、编辑、新建卡片失焦（有草稿时，草稿保留）、多选、搜索，最后收起侧栏。
  if(escape&&elements.tagDropdown&&!elements.tagDropdown.hidden){event.preventDefault();closeTagMenu();elements.tagFilterButton.focus();return;}
  if(ui.editing&&(escape||event.ctrlKey&&event.key==='Enter')){event.preventDefault();if(escape)cancelEdit();else finishEdit();return;}
  if(escape&&elements.sidebarComposer&&elements.sidebarComposer.contains(document.activeElement)&&(state.draft.text.trim()||state.draft.images.length)){event.preventDefault();document.activeElement.blur();ui.composer=false;return;}
  if(escape&&window.NoteInteractions&&window.NoteInteractions.hasSelection()){event.preventDefault();window.NoteInteractions.clearSelection();return;}
  if(escape&&ui.searchOpen){event.preventDefault();ui.query='';elements.searchInput.value='';toggleSearch(false,{focusButton:true});renderNotes();return;}
  // Ctrl+, 打开设置（本次提出），编辑中同样可用；Ctrl+C 复制高亮或多选的记录，有选中文字时保留浏览器的复制。
  if(event.ctrlKey&&!event.shiftKey&&!event.altKey&&(event.key===','||event.code==='Comma')){event.preventDefault();openSettings();return;}
  if((event.ctrlKey||event.metaKey)&&!event.shiftKey&&!event.altKey&&event.code==='KeyC'&&!ui.editing){const typing=event.target&&event.target.closest&&event.target.closest('input,textarea,select,[contenteditable="true"]'),selection=window.getSelection&&window.getSelection();if(!typing&&!(selection&&String(selection).trim())&&copyCurrentOrSelected()){event.preventDefault();return;}}
  if(!ui.sortPress&&(event.key==='Enter'||event.key===' ')){ui.skipCardClick=false;ui.consumeClick=false;}
  if(event.ctrlKey&&!event.shiftKey&&!event.altKey&&(event.code==='KeyF'||event.code==='KeyN')){
    event.preventDefault();ui.skipCardClick=false;if(event.code==='KeyF')toggleSearch(true);else{if(!finishEdit())return;showSidebar({focus:false});focusNewComposer();}return;
  }
  if(event.ctrlKey&&event.shiftKey&&event.code==='Space'){event.preventDefault();showCapture();return;}
  if(event.altKey&&event.shiftKey&&!event.ctrlKey&&event.code==='KeyS'){
    event.preventDefault();ui.skipCardClick=false;if(!finishEdit())return;
    if(elements.capture.classList.contains('open'))hideCapture();
    if(ui.searchOpen)toggleSearch(false);showSidebar({focus:false});focusNewComposer();return;
  }
  if(event.ctrlKey&&event.key==='Enter'&&(elements.capture.contains(event.target)||elements.sidebarComposer.contains(event.target))){event.preventDefault();const fromCapture=elements.capture.contains(event.target);saveDraft(fromCapture?'capture':'sidebar',{collapse:fromCapture});return;}
  if(escape){event.preventDefault();if(elements.capture.classList.contains('open')&&(elements.capture.contains(document.activeElement)||!elements.sidebar.classList.contains('open')))hideCapture();else if(elements.sidebar.classList.contains('open'))hideSidebar(true);else if(elements.capture.classList.contains('open'))hideCapture();}
}

/** @brief 记录固定侧栏在页面内的离开与返回，返回空白处时聚焦新建输入。 @param {MouseEvent} event 点击。 */
function trackPinnedReturn(event){
  if(!ui.locked||ui.modal||!elements.sidebar.classList.contains('open')||elements.sidebar.inert)return;
  const target=event.target,inside=target&&elements.sidebar.contains(target);
  if(!inside){ui.pinnedReturnPending=true;return;}
  const deliberate=target.closest('.note-card,button,a,input,textarea,select,[contenteditable="true"]');
  const shouldFocus=ui.pinnedReturnPending&&!deliberate;
  ui.pinnedReturnPending=false;
  if(shouldFocus)window.setTimeout(function focusReturnedSidebar(){focusNewComposer({resetScroll:false});},0);
}

/** @brief 保存设置更改。 @param {Event} event 更改事件。 */
function changeSetting(event) {
  const control = event.target.closest('[data-setting]');
  if (!control) return;
  const name = control.dataset.setting;
  const value = control.type === 'checkbox' ? control.checked : ['width', 'hideDelay'].includes(name) ? Number(control.value) : control.value;
  const next = normalizeSettings({ ...state.settings, [name]: value });
  if (!persistSnapshot(state.notes, state.draft, next)) { toast('设置未保存，浏览器空间受限。请导出备份后重试。', null, true); return; }
  applySettings();
  const output = document.getElementById('sidebar-width-output');
  if (output) output.textContent = state.settings.width + ' px';
}

/** 连接页面元素并注册交互。 */
function initialize() {
  const ids = { resizer:'sidebar-resizer', versionButton:'app-version', tagDropdown:'tag-dropdown', tagFilterButton:'tag-filter-button', syncWarning:'sync-warning', workspaceNudge:'workspace-nudge', sidebar: 'sidebar', edgeTrigger: 'edge-trigger', capture: 'capture', noteList: 'note-list', listSummary: 'list-summary', searchInput: 'search-input', clearSearch: 'clear-search', storageStatus: 'storage-status', draftInput: 'draft-input', attachmentList: 'attachment-list', imagePicker: 'image-picker', charCount: 'capture-char-count', saveNote: 'save-note', modalRoot: 'modal-root', toastRegion: 'toast-region' };
  Object.entries(ids).forEach(function collectElement(entry) { elements[entry[0]] = document.getElementById(entry[1]); });
  elements.searchInput.type='text';elements.searchInput.setAttribute('role','searchbox');
  loadState();
  createComposer();
  if(window.LiveMarkdown){window.LiveMarkdown.attach(elements.draftInput,{value:state.draft.text,minHeight:100,maxHeight:340});window.LiveMarkdown.attach(elements.sidebarDraft,{value:state.draft.text,minHeight:56,maxHeight:240});}
  initializeSidebarResize();
  initializeListLoading();
  initializeContentDrop();
  refreshVersionBadge();
  initializeHeaderInteractions();
  const importPicker = el('input');
  importPicker.type = 'file';
  importPicker.accept = '.json,application/json';
  importPicker.hidden = true;
  importPicker.id = 'import-picker';
  document.body.append(importPicker);
  elements.importPicker = importPicker;
  const filePicker=el('input');filePicker.type='file';filePicker.hidden=true;filePicker.id='reference-file-picker';document.body.append(filePicker);elements.filePicker=filePicker;
  filePicker.addEventListener('change',function chosenFile(){const file=filePicker.files[0];if(!file)return;const p=ui.pendingFilePath;window.NoteContent.registerFile(p,file);filePicker.value='';openFileReference(p);});
  document.addEventListener('click',function dismissTagMenu(event){if(!event.target.closest('.tag-filter-wrap'))closeTagMenu();});
  window.addEventListener('sidenotes:sync-status',function syncChanged(){setStorageStatus(ui.storageWriteError);});
  window.addEventListener('sidenotes:settings-changed',function settingsChanged(event){const patch=event.detail&&event.detail.patch||{};if(elements.resizer)elements.resizer.dataset.edge=state.settings.edge;if(Object.prototype.hasOwnProperty.call(patch,'lazyLoading')||Object.prototype.hasOwnProperty.call(patch,'pageSize'))renderNotes({reset:true});renderWorkspaceNudge();resizeDraftInput();scheduleTagLayout();setStorageStatus(ui.storageWriteError);});
  applySettings();
  renderNotes();
  renderDraft();
  document.addEventListener('pointerdown', protectTagFocus, true);
  if(!window.PointerEvent)document.addEventListener('mousedown', protectTagFocus, true);
  document.addEventListener('click', dismissTagEditing, true);
  document.addEventListener('click', trackPinnedReturn, true);
  document.addEventListener('click', handleAction);
  document.addEventListener('keydown', handleKeyboard);
  document.addEventListener('compositionstart', function compositionStarted() { ui.composing = true; });
  document.addEventListener('compositionend', function compositionEnded() { ui.composing = false;resumeEditBlur(); });
  document.addEventListener('change', changeSetting);
  document.addEventListener('input', function handleInput(event) {
    if (event.target === elements.draftInput || event.target === elements.sidebarDraft) changeDraft(event.target.liveMarkdown?event.target.liveMarkdown.getValue():event.target.value);
    if (event.target.matches('[data-edit-id]') && ui.editing) {
      ui.editing.text = event.target.liveMarkdown?event.target.liveMarkdown.getValue():event.target.value;
      ui.editStorageError=false;
      setStorageStatus(ui.storageWriteError);
    }
    if (event.target.dataset.setting === 'width') changeSetting(event);
  });
  elements.searchInput.addEventListener('input', function searchNotes() {
    if (!finishEdit()) return;
    ui.query = elements.searchInput.value;
    renderNotes();
    if(ui.query.includes('#')){elements.tagDropdown.hidden=false;elements.tagFilterButton.setAttribute('aria-expanded','true');}
  });
  elements.clearSearch.addEventListener('click', function clearSearch() { ui.query = ''; elements.searchInput.value = ''; renderNotes(); elements.searchInput.focus(); });
  // 单击与悬停共用一种高亮（T66）：高亮的卡片是 Ctrl+C 与键盘操作的对象；双击进入编辑（interactions.md 第二、四节）。
  elements.noteList.addEventListener('pointerover',function highlightOnHover(event){
    if(event.pointerType==='touch'||ui.sortPress||window.NoteInteractions&&window.NoteInteractions.isBusy())return;
    const card=event.target.closest('.note-card');if(card&&card.dataset.noteId!==ui.currentId&&!card.classList.contains('is-editing'))setCurrentCard(card.dataset.noteId);
  });
  elements.noteList.addEventListener('click',function highlightCard(event){
    if(event.defaultPrevented||window.NoteInteractions&&(window.NoteInteractions.isBusy()||window.NoteInteractions.hasSelection())||ui.skipCardClick||ui.expandedTags.size||ui.sortPress&&ui.sortPress.active)return;
    const card=event.target.closest('.note-card'),control=event.target.closest('button,a,input,textarea,select,[contenteditable="true"]');
    if(!card){if(!control&&!event.target.closest('.sidebar-composer,.composer-sticky-slot'))setCurrentCard('');return;}
    if(card.classList.contains('is-editing'))return;setCurrentCard(card.dataset.noteId,{focus:!control});
  });
  elements.noteList.addEventListener('dblclick',function editCardOnDoubleClick(event){
    if(event.defaultPrevented||window.NoteInteractions&&(window.NoteInteractions.isBusy()||window.NoteInteractions.hasSelection())||ui.skipCardClick||ui.sortPress&&ui.sortPress.active)return;
    const tag=event.target.closest('.tag-chip');if(tag){event.preventDefault();window.clearTimeout(ui.tagClickTimer);startTagRename(tag);return;}
    if(event.target.closest('button,a,input,textarea,select,[contenteditable="true"]'))return;const card=event.target.closest('.note-card');if(!card||card.classList.contains('is-editing'))return;event.preventDefault();const selection=window.getSelection();if(selection&&selection.removeAllRanges)selection.removeAllRanges();beginEdit(card.dataset.noteId);
  });
  elements.noteList.addEventListener('keydown', handleCardKeyboard);
  // 键盘把焦点移到卡片上时同样选中这张卡片，与现有应用一致。
  elements.noteList.addEventListener('focusin',function highlightOnFocus(event){
    const card=event.target;if(card.classList&&card.classList.contains('note-card')&&card.dataset.noteId!==ui.currentId&&!card.classList.contains('is-editing'))setCurrentCard(card.dataset.noteId);
  });
  document.querySelector('.sidebar-tabs').addEventListener('keydown', handleTabKeyboard);
  initializeHelp(document.querySelector('#capture .help-anchor'));
  elements.sidebar.addEventListener('mouseenter', cancelHide);
  elements.sidebar.addEventListener('mouseleave', scheduleHide);
  elements.edgeTrigger.addEventListener('mouseenter', showSidebar);
  elements.edgeTrigger.addEventListener('click', showSidebar);
  document.addEventListener('mousemove', function edgeMouseMoved(event) {
    if (ui.modal || event.buttons) return;
    const edge = state.settings.edge;
    if ((edge === 'right' && event.clientX >= window.innerWidth - 3) || (edge === 'left' && event.clientX <= 3)) showSidebar();
  });
  document.getElementById('demo-open-capture').addEventListener('click', function openCaptureFromDemo() { showCapture(); });
  document.getElementById('demo-open-sidebar').addEventListener('click', showSidebar);
  elements.imagePicker.addEventListener('change',function selectedImages(){addPickedAttachments(elements.imagePicker.files,ui.attachmentTarget||'draft');elements.imagePicker.value='';});
  const attachmentPicker=el('input');attachmentPicker.type='file';attachmentPicker.multiple=true;attachmentPicker.hidden=true;document.body.append(attachmentPicker);elements.attachmentPicker=attachmentPicker;attachmentPicker.addEventListener('change',function selectedFiles(){addPickedAttachments(attachmentPicker.files,ui.attachmentTarget||'draft');attachmentPicker.value='';});
  importPicker.addEventListener('change', function selectedImport() { inspectImport(importPicker.files[0]); importPicker.value = ''; });
  [elements.draftInput,elements.sidebarDraft].flatMap(function inputTargets(input){return input.liveMarkdown?[input,input.liveMarkdown.element]:[input];}).forEach(function attachPaste(input) {
    input.addEventListener('paste', function pastedImages(event) {
      const files = Array.from(event.clipboardData && event.clipboardData.items || []).filter(function imageItem(item) { return item.kind === 'file' && item.type.startsWith('image/'); }).map(function itemFile(item) { return item.getAsFile(); }).filter(Boolean);
      if (files.length) { event.preventDefault(); addImages(files); }
    });
  });
  window.addEventListener('beforeunload', function preserveOnExit(event) {
    const editingSaved = !hasUnsavedEdit();
    persistDraft();
    if (ui.pendingImages || !editingSaved || (ui.storageError && (state.draft.text || state.draft.images.length))) { event.preventDefault(); event.returnValue = ''; }
  });
  initializeEditFocus();if(window.NoteInteractions)window.NoteInteractions.initialize();if(window.NoteMenus)window.NoteMenus.initialize();
  if (window.matchMedia) window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function systemThemeChanged() { if (state.settings.theme === 'system') applySettings(); });
  document.addEventListener('visibilitychange', function preserveWhenHidden() { if(document.hidden)persistDraft();else focusPinnedComposer(); });
  window.addEventListener('focus', focusPinnedComposer);
}


/* ==================== 标签、筛选与整理 ==================== */
/** @brief 统一标签编辑与解析器规则，避免标签保存后不可识别。 @param {string} tag 标签。 @return {boolean} 是否有效。 */
function isValidTag(tag){return /^[\p{L}\p{N}_-]{1,40}$/u.test(tag)&&window.NoteContent.parse('#'+tag).tags.some(function same(t){return tagKey(t)===tagKey(tag);});}
/** @brief 获取标签匹配键。 @param {string} tag 标签。 @return {string} 统一匹配键。 */
function tagKey(tag) { return String(tag).normalize('NFKC').toLocaleLowerCase(); }
/** @brief 检查记录的标签。 @param {object} note 记录。 @param {string} tag 标签。 @return {boolean} 是否包含。 */
function hasTag(note,tag) { return noteParts(note).tags.some(function same(item){return tagKey(item)===tagKey(tag);}); }
/** @brief 判断记录是否属于当前页签。 @param {object} note 记录。 @return {boolean} 是否属于。 */
function inCurrentTab(note) { return ui.tab==='archive'?note.status==='archived':note.status==='active'&&(ui.tab!=='pinned'||note.pinned); }
/** @brief 支持正文与多个标签组合搜索。 @param {object} note 记录。 @param {string} query 查询。 @return {boolean} 是否匹配。 */
function matchesQuery(note,query) {
  if(!String(query).trim())return true;
  const parsed=noteParts(note), tags=[];
  const text=String(query).replace(/(?:^|\s)#([\p{L}\p{N}_-]+)/gu,function collect(_,tag){tags.push(tagKey(tag));return ' ';}).trim().toLocaleLowerCase();
  return tags.every(function matchTag(tag){return parsed.tags.some(function prefix(item){return tagKey(item).startsWith(tag);});})&&text.split(/\s+/).filter(Boolean).every(function matchText(word){return (parsed.body+' '+parsed.tags.join(' ')+' '+note.images.map(function name(i){return i.name;}).join(' ')).toLocaleLowerCase().includes(word);});
}
/** @brief 汇总标签并计算固定权重分数。 @return {Array} 候选与分数。 */
function rankedTags() {
  const grouped=new Map();state.notes.filter(inCurrentTab).forEach(function collect(note){noteParts(note).tags.forEach(function tagCount(tag){const key=tagKey(tag);if(!grouped.has(key))grouped.set(key,{tag:tag,count:0,pinned:0,updated:0});const item=grouped.get(key);item.count++;item.pinned+=note.pinned?1:0;item.updated=Math.max(item.updated,note.updatedAt);});});
  const tagQueries=Array.from(ui.query.matchAll(/(?:^|\s)#([\p{L}\p{N}_-]+)/gu));
  const tagMode=tagQueries.length>0;const query=tagKey(tagMode?tagQueries[tagQueries.length-1][1]:ui.query.trim());
  return Array.from(grouped.values()).map(function score(item){const usage=state.tagUsage[tagKey(item.tag)]||{count:0,last:0};const age=(Date.now()-(Number(usage.last)||0))/86400000;item.score=40*Math.log2(1+(Number(usage.count)||0))+30*Math.max(0,1-age/14)+4*Math.min(item.count,10)+3*Math.min(item.pinned,4);item.match=Boolean(query&&(tagMode?tagKey(item.tag).startsWith(query):tagKey(item.tag).includes(query)));item.exact=Boolean(query&&tagKey(item.tag)===query);item.selected=Boolean(ui.selectedTag&&tagKey(ui.selectedTag)===tagKey(item.tag));return item;}).sort(function compare(a,b){return Number(b.exact)-Number(a.exact)||Number(b.match)-Number(a.match)||Number(b.selected)-Number(a.selected)||b.score-a.score||b.updated-a.updated||a.tag.localeCompare(b.tag,'zh-CN');});
}
/** 刷新最多六个候选的标签菜单。 */
function renderTagMenu() {
  if(!elements.tagDropdown)return;
  const trigger=elements.tagFilterButton, label=trigger.querySelector('span');if(label)label.textContent=ui.selectedTag?'#'+ui.selectedTag:'全部标签';
  const menu=elements.tagDropdown;menu.replaceChildren();
  const all=button('全部标签','clear-tag','','tag-option');all.append(el('span','tag-option-count',String(state.notes.filter(inCurrentTab).length)));menu.append(all);
  const candidates=rankedTags();candidates.slice(0,6).forEach(function row(item,index){const group=el('div','tag-option-row'+(index===0&&(item.match||item.selected)?' current-tag-row':''));
    const choice=button('#'+item.tag,'filter-tag','','tag-option');choice.dataset.tag=item.tag;choice.setAttribute('role','menuitem');choice.title='访问频率 40 · 近期访问 30 · 条数 4 · 置顶 3';choice.append(el('span','tag-option-count',String(item.count)));group.append(choice);
    if(index===0&&(item.match||item.selected)){const manage=button('管理 #'+item.tag,'manage-tag','more');manage.dataset.tag=item.tag;group.append(manage);}menu.append(group);});
  const priority=menu.querySelector('.current-tag-row');if(priority)menu.prepend(priority);
  if(!candidates.length)menu.append(el('p','tag-menu-empty',ui.query?'没有匹配的标签':'输入 #标签 创建分组'));
  // 底部只有「搜索标签」一项；候选之外还有标签时，右侧写「另有 N 个」（本次提出）。
  const foot=el('div','tag-menu-footer'),search=button('搜索标签','focus-tag-search','search','tag-option tag-search-button');search.setAttribute('role','menuitem');if(candidates.length>6)search.append(el('span','tag-option-count','另有 '+(candidates.length-6)+' 个'));foot.append(search);menu.append(foot);
}
/** 关闭标签菜单。 */
function closeTagMenu(){if(elements.tagDropdown){elements.tagDropdown.hidden=true;elements.tagFilterButton.setAttribute('aria-expanded','false');}}
/** @brief 选择标签并记录最近访问。 @param {string} tag 标签。 */
function selectTag(tag){if(!finishEdit())return;ui.selectedTag=tag;ui.query='';elements.searchInput.value='';const key=tagKey(tag),old=state.tagUsage[key]||{count:0,last:0};state.tagUsage[key]={count:Math.min(10000,(Number(old.count)||0)+1),last:Date.now()};persistSnapshot();closeTagMenu();renderNotes();}
/** @brief 移除一条记录中的标签。 @param {object} note 记录。 @param {string} tag 标签。 */
function removeNoteTag(note,tag){let text=window.NoteContent.removeTag(note.text,tag);if(!text.trim()&&!note.images.length)text=tag;if(updateNote(note.id,{text:text}))toast('已从此记录移除 #'+tag);}
/** @brief 对标签进行重命名、合并或全局移除。 @param {string} tag 标签。 */
function manageTag(tag){closeTagMenu();const dialog=openModal('管理 #'+tag,'tag-manage-modal');dialog.body.append(el('p','modal-hint','只修改标签，保留记录内容。'));
  const input=el('input','form-control tag-name-input');input.value=tag;input.setAttribute('aria-label','标签名称');dialog.body.append(input);
  const rename=button('重命名 / 合并','','edit','button primary');rename.addEventListener('click',function renameTag(){const next=input.value.trim().replace(/^#/,'');if(!isValidTag(next)){toast('标签最多40字；使用文字、数字、下划线或短横线，避免十六进制色值',null,true);return;}const notes=state.notes.map(function replaceTag(note){if(!hasTag(note,tag))return note;const parsed=noteParts(note);return {...note,text:window.NoteContent.compose(parsed.body,parsed.tags.map(function replace(t){return tagKey(t)===tagKey(tag)?next:t;})),updatedAt:Date.now()};});if(!persistSnapshot(notes))return;const oldUsage=state.tagUsage[tagKey(tag)];if(oldUsage){state.tagUsage[tagKey(next)]=oldUsage;if(tagKey(next)!==tagKey(tag))delete state.tagUsage[tagKey(tag)];persistSnapshot();}if(ui.selectedTag&&tagKey(ui.selectedTag)===tagKey(tag))ui.selectedTag=next;closeModal();renderNotes();toast('标签已更新，相同标签已合并');});
  const remove=button('移除此标签','','trash','button danger');remove.addEventListener('click',function confirmRemove(){confirmAction({title:'移除 #'+tag+'？',description:'从所有记录中移除此标签；记录正文与附件保留。',confirmLabel:'移除标签',run:function removeGroup(){const notes=state.notes.map(function removeAssociation(note){if(!hasTag(note,tag))return note;let text=window.NoteContent.removeTag(note.text,tag);if(!text.trim()&&!note.images.length)text=tag;return {...note,text:text,updatedAt:Date.now()};});if(!persistSnapshot(notes))return false;if(ui.selectedTag&&tagKey(ui.selectedTag)===tagKey(tag))ui.selectedTag='';renderNotes();return true;}});});dialog.footer.append(remove,rename);
}
/** 刷新可忽略的工作区整理提醒。 */
function renderWorkspaceNudge(){if(!elements.workspaceNudge||!state)return;const count=state.notes.filter(function active(n){return n.status==='active';}).length,limit=state.settings.tidyLimit||0;const visible=limit>0&&count>limit&&Date.now()>(state.settings.tidySnoozeUntil||0);const target=elements.workspaceNudge;target.hidden=!visible;target.replaceChildren();if(!visible)return;target.append(icon('info'),el('span','',count+' 条未归档记录，建议整理。'),button('查看','tidy-workspace','','nudge-link'),button('稍后','snooze-tidy','','nudge-link'),button('设置','tidy-settings','settings'));}

/** 调整输入区域的高度边界，不重建正在书写的编辑器。 */
function resizeDraftInput(){const input=elements.sidebarDraft;if(!input)return;const active=ui.composer||Boolean(state.draft.text||state.draft.images.length);elements.sidebarComposer.classList.add('is-active');if(input.liveMarkdown){input.liveMarkdown.element.style.maxHeight=Math.min(340,window.innerHeight*.42)+'px';return;}input.style.height='auto';input.style.height=Math.min(Math.min(300,window.innerHeight*.38),Math.max(active?100:76,input.scrollHeight||40))+'px';}
/* ==================== 全文、文件与更多操作 ==================== */
/** @brief 查看未裁切的 Markdown 全文。 @param {object} note 记录。 */
function openNote(note){if(ui.editing&&!finishEdit())return;const dialog=openModal('记录详情','detail-modal');const body=el('div','detail-source markdown-body');window.NoteContent.renderMarkdown(noteParts(note).body,body);note.images.forEach(function image(a){const b=button('预览 '+a.name,'preview-markdown-image','','note-image-button');b.dataset.src=a.data;b.dataset.alt=a.name;const i=el('img','note-image');i.src=a.data;i.alt=a.name;b.append(i);body.append(b);});dialog.body.append(body);const tags=el('p','detail-tags',noteParts(note).tags.map(function tag(t){return '#'+t;}).join(' '));dialog.body.append(tags);const edit=button('编辑','','edit','button primary');edit.addEventListener('click',function editDetail(){closeModal();showSidebar();beginEdit(note.id);});dialog.footer.append(el('span','modal-hint',formatTime(note.createdAt)),edit);}
/** @brief 下载单条 Markdown。 @param {object} note 记录。 */
function exportNote(note){const blob=new Blob([note.text],{type:'text/markdown;charset=utf-8'}),url=URL.createObjectURL(blob),a=el('a');a.href=url;a.download=(noteParts(note).body.split('\n')[0].replace(/[<>:"/\\|?*]/g,'_').slice(0,50)||'SideNotes')+'.md';document.body.append(a);a.click();a.remove();window.setTimeout(function release(){URL.revokeObjectURL(url);},1000);}
/** @brief 校验并打开文件引用，未授权时要求用户定位文件。 @param {string} filePath 本地路径。 */
async function openFileReference(filePath){const status=await window.NoteContent.checkFile(filePath);const entry=window.NoteContent.files.get(window.NoteContent.fileKey(filePath));const token=window.NoteContent.isFileToken&&window.NoteContent.isFileToken(filePath),label=token?window.NoteContent.fileLabel(filePath):filePath;const dialog=openModal('文件引用','file-reference-modal');dialog.body.append(el('code','file-path',label));const hint=el('p','file-check-status',status==='missing'?'文件已失效，请重新定位。':status==='valid'?(entry&&entry.handle?'已校验，文件可读取。':token?'本次会话所选文件可读取；刷新后需重新定位。':'所选文件副本可读取，原路径未验证。'):token?'引用已保留，请重新选择文件以校验并打开。':'尚未授权校验此文件。');dialog.body.append(hint);dialog.body.append(el('p','modal-hint',token?'浏览器未提供原始完整路径，仅保留文件名和引用标识。':'浏览器只能访问你选择的文件；原路径检查和系统默认应用跳转由桌面端接入。'));
  const locate=button(status==='valid'?'重新定位':'选择文件','','folder','button secondary');locate.addEventListener('click',async function chooseFile(){try{if(window.showOpenFilePicker){const handles=await window.showOpenFilePicker();const handle=handles[0],file=await handle.getFile();window.NoteContent.registerFile(filePath,file,handle);openFileReference(filePath);}else{ui.pendingFilePath=filePath;elements.filePicker.click();}}catch(error){if(error.name!=='AbortError')toast('无法读取所选文件',null,true);}});dialog.footer.append(locate);
  if(status==='valid'&&entry){const open=button('打开所选文件','','external','button primary');open.addEventListener('click',async function openSelected(){try{const latest=await window.NoteContent.checkFile(filePath);if(latest!=='valid'){hint.textContent='文件已失效，请重新定位。';return;}const file=entry.handle?await entry.handle.getFile():entry.file;const url=URL.createObjectURL(file);window.open(url,'_blank','noopener,noreferrer');window.setTimeout(function release(){URL.revokeObjectURL(url);},60000);}catch(error){hint.textContent='文件读取失败，请重新定位。';}});dialog.footer.append(open);}
}


/* ==================== 增量列表与标签布局 ==================== */
/** @brief 缓存不可变记录的标签解析，避免每批加载重复扫描正文。 @param {object} note 记录。 @return {object} 正文和标签。 */
function noteParts(note){let cached=noteParseCache.get(note);if(!cached||cached.text!==note.text){cached={text:note.text,parts:window.NoteContent.parse(note.text)};noteParseCache.set(note,cached);}return cached.parts;}
/** @brief 追加下一批记录，不重建已有卡片。 @param {number} requested 本次数量。 */
function appendNextPage(requested){
  if(ui.loading||!ui.listItems||ui.visibleCount>=ui.listItems.length)return;ui.loading=true;
  if(ui.sentinel)ui.sentinel.remove();const count=Number.isFinite(requested)?requested:state.settings.pageSize;
  const end=Math.min(ui.listItems.length,ui.visibleCount+count),nodes=[];
  for(let index=ui.visibleCount;index<end;index++)nodes.push(renderCard(ui.listItems[index]));
  elements.noteList.append(...nodes);ui.visibleCount=end;ui.loading=false;
  if(end<ui.listItems.length){
    if(!ui.sentinel){ui.sentinel=el('div','load-more-sentinel');ui.sentinel.setAttribute('role','status');}
    ui.sentinel.replaceChildren(el('span','load-more-status','已显示 '+end+' / '+ui.listItems.length+' 条'),button('加载更多','load-more','','load-more-button'));elements.noteList.append(ui.sentinel);
    if(!ui.listObserver&&window.IntersectionObserver){ui.listObserver=new window.IntersectionObserver(function nextBatch(entries){if(entries.some(function visible(entry){return entry.target===ui.sentinel&&entry.isIntersecting;}))appendNextPage();},{root:elements.noteList,rootMargin:'0px 0px 96px 0px',threshold:0});}
    if(ui.listObserver)ui.listObserver.observe(ui.sentinel);
  }else{if(ui.listObserver)ui.listObserver.disconnect();ui.sentinel=null;}
  scheduleTagLayout();if(window.NoteInteractions)window.NoteInteractions.refresh();
}
/** 连接滚动降级入口，批次追加不增加人为等待。 */
function initializeListLoading(){elements.noteList.addEventListener('scroll',function nearListEnd(){if(state.settings.lazyLoading&&ui.sentinel&&elements.noteList.scrollHeight-elements.noteList.scrollTop-elements.noteList.clientHeight<=96)appendNextPage();},{passive:true});}
/** @brief 根据操作区以外的实际宽度展示尽可能多的标签。 @param {HTMLElement} card 记录卡片。 */
function fitCardTags(card){
  const tags=card.querySelector('.note-tags');if(!tags)return;const wraps=Array.from(tags.querySelectorAll('.tag-chip-wrap')),more=tags.querySelector('.tags-more');wraps.forEach(function show(w){w.hidden=false;});
  if(!more||tags.classList.contains('tags-expanded'))return;const width=tags.clientWidth;if(!width)return;
  const reserve=more.getBoundingClientRect().width||24,gap=4,widths=wraps.map(function measure(w){return w.getBoundingClientRect().width;});let used=0,visible=0;
  widths.forEach(function fit(value,index){const next=used+value+(visible?gap:0);if(next+reserve+gap<=width){used=next;visible++;}else wraps[index].hidden=true;});
  const hidden=wraps.length-visible;more.title=hidden?'展开剩余 '+hidden+' 个标签':'管理标签';more.setAttribute('aria-label',more.title);more.dataset.hiddenCount=String(hidden);
}
/** 在同一帧统一检查标签与正文裁切。 */
function scheduleTagLayout(){if(ui.tagFrame)return;const update=function updateCardGeometry(){ui.tagFrame=0;elements.noteList.querySelectorAll('.note-card').forEach(function geometry(card){fitCardTags(card);const content=card.querySelector('.note-content'),expand=card.querySelector('.note-expand');if(content&&expand&&content.clientHeight){const overflow=content.scrollHeight>content.clientHeight+2;card.classList.toggle('is-truncated',overflow);expand.hidden=!overflow;}});};if(window.requestAnimationFrame)ui.tagFrame=window.requestAnimationFrame(update);else update();}
/* ==================== 可拖动侧栏 ==================== */
/** @brief 只更新拖动预览，释放后才写入设置。 @param {number} width 目标宽度。 */
function previewSidebarWidth(width){document.documentElement.style.setProperty('--sidebar-width',width+'px');elements.sidebar.style.width='min('+width+'px,100vw)';elements.resizer.setAttribute('aria-valuenow',String(width));scheduleTagLayout();}
/** @brief 结束拖动并保存或取消。 @param {boolean} commit 是否保存。 */
function finishSidebarResize(commit=true){if(!ui.resizing)return;const drag=ui.resizing;ui.resizing=null;document.body.classList.remove('is-resizing-sidebar');if(!elements.resizer.matches(':hover'))elements.resizer.classList.remove('is-armed');try{if(elements.resizer.hasPointerCapture&&elements.resizer.hasPointerCapture(drag.pointerId))elements.resizer.releasePointerCapture(drag.pointerId);}catch(error){/* 系统可能已取消捕获。 */}if(commit&&drag.current!==drag.width){const settings={...state.settings,width:drag.current};if(!persistSnapshot(state.notes,state.draft,settings)){previewSidebarWidth(drag.width);toast('宽度未保存',null,true);return;}}else previewSidebarWidth(drag.width);elements.resizer.dataset.edge=state.settings.edge;}
/** 连接指针拖动、取消与键盘宽度调整。 */
function initializeSidebarResize(){
  const handle=elements.resizer;handle.setAttribute('aria-valuenow',String(state.settings.width));
  // 指针移上去立即是左右箭头，停留 400ms 后才高亮，只是划过不会闪一下强调色（本次提出）。
  let armTimer=0;handle.addEventListener('pointerenter',function armLater(){window.clearTimeout(armTimer);armTimer=window.setTimeout(function arm(){handle.classList.add('is-armed');},400);});handle.addEventListener('pointerleave',function disarm(){window.clearTimeout(armTimer);if(!ui.resizing)handle.classList.remove('is-armed');});
  handle.addEventListener('pointerdown',function resizeStarted(event){if(event.button!==0||ui.modal)return;event.preventDefault();cancelHide();ui.resizing={x:event.clientX,width:state.settings.width,current:state.settings.width,edge:state.settings.edge,pointerId:event.pointerId};document.body.classList.add('is-resizing-sidebar');if(handle.setPointerCapture)handle.setPointerCapture(event.pointerId);});
  window.addEventListener('pointermove',function resizing(event){if(!ui.resizing)return;const drag=ui.resizing;if(event.pointerId!==undefined&&event.pointerId!==drag.pointerId)return;const zoom=parseFloat(window.getComputedStyle(elements.sidebar).zoom)||1,delta=(event.clientX-drag.x)*(drag.edge==='right'?-1:1)/zoom;drag.current=Math.round(Math.max(360,Math.min(720,window.innerWidth/zoom,drag.width+delta))/4)*4;previewSidebarWidth(drag.current);});
  window.addEventListener('pointerup',function resizeFinished(){finishSidebarResize(true);});window.addEventListener('pointercancel',function resizeCancelled(){finishSidebarResize(false);});window.addEventListener('blur',function resizeFocusLost(){finishSidebarResize(false);});window.addEventListener('resize',function resizeLayout(){scheduleTagLayout();refreshSearchSummary();});
  handle.addEventListener('keydown',function keyboardResize(event){if(event.key!=='ArrowLeft'&&event.key!=='ArrowRight')return;event.preventDefault();const delta=(event.key==='ArrowLeft'?1:-1)*(state.settings.edge==='right'?1:-1)*(event.shiftKey?40:8);const width=Math.max(360,Math.min(720,state.settings.width+delta));if(persistSnapshot(state.notes,state.draft,{...state.settings,width:width}))previewSidebarWidth(width);});
}
/* ==================== 版本与更新 ==================== */
/** 刷新版号及可用更新标记。 */
function refreshVersionBadge(){const flags=window.PrototypeFlags||{version:'0.5.0',availableVersion:''};if(ui.availableVersion===undefined)ui.availableVersion=flags.availableVersion;const version=ui.currentVersion||flags.version;const label=elements.versionButton.querySelector('.version-label');if(label)label.textContent='v'+version;const badge=elements.versionButton.querySelector('.update-badge');if(badge)badge.hidden=!ui.availableVersion;elements.versionButton.classList.toggle('has-update',Boolean(ui.availableVersion));const name=ui.availableVersion?'发现新版本 '+ui.availableVersion+'，点击查看更新内容':'版本 '+version+'，查看更新日志';elements.versionButton.setAttribute('aria-label',name);elements.versionButton.title=name;}
/** 发现新版本：列出这次即将更新的内容，可以「立即更新」或「稍后」，稍后之后角标保留（本次提出；浏览器中为模拟更新）。 */
function showUpdate(){
  const dialog=openModal('发现新版本','update-modal');dialog.body.append(el('p','update-summary','SideNotes '+ui.availableVersion+' · 当前 '+(ui.currentVersion||'0.5.0')));
  const notes=el('ul','update-notes');['五套主题：终端、杂志、记录纸、Windows 11、磨砂玻璃','操作按钮与时间共用标题行右侧，标题最多两行','键盘：↑ ↓ 移动，Enter 编辑，Delete 移入回收站'].forEach(function item(text){notes.append(el('li','',text));});dialog.body.append(notes);
  const later=button('稍后','close-modal','','button secondary'),now=button('立即更新','','download','button primary');now.addEventListener('click',function updateNow(){ui.currentVersion=ui.availableVersion;ui.availableVersion='';refreshVersionBadge();closeModal();toast('更新演示完成');});dialog.footer.append(later,now);
}
/** 显示更新日志及更新服务入口。 */
function showChangelog(){
  if(ui.availableVersion){showUpdate();return;}
  const dialog=openModal('版本与更新','changelog-modal');dialog.body.append(el('p','version-summary','SideNotes '+(ui.currentVersion||'0.5.0')+' PREVIEW'));
  const log=el('div','changelog-list');[['0.5.0','失焦保存、退出层级、开栏聚焦、长按与批量排序、卡片菜单及折叠、回收确认和新版速记浮窗。'],['0.4.1','修复 Markdown 完整复制、按页签新建、侧栏打开聚焦、搜索摘要与设置布局。'],['0.4.0','长按排序、编辑确认与取消、Ctrl+F紧凑搜索、富文本和图片复制、重新组织设置布局。'],['0.3.0','Emoji、实时 Markdown 编辑、每批10条增量列表、侧栏拖动、字体搜索与双击复制。'],['0.2.0','标签分组、Markdown预览、分类设置、材质主题和备份流程。'],['0.1.0','侧栏、快捷速记、共享草稿与本地存储。']].forEach(function entry(item){const row=el('section','changelog-entry');row.append(el('h3','',item[0]),el('p','',item[1]));log.append(row);});dialog.body.append(log);
  const actions=el('div','update-actions');const check=button('检查更新','','restore','button secondary');check.addEventListener('click',function checkUpdate(){if(window.PrototypeFlags.demo){ui.availableVersion='0.5.1';refreshVersionBadge();toast('已显示更新提示示例');showChangelog();}else toast('更新服务待桌面端接入');});actions.append(check);
  if(ui.availableVersion){dialog.body.append(el('p','settings-notice','可用版本 '+ui.availableVersion+'（更新演示）'));const update=button('模拟完成更新','','download','button primary');update.hidden=!window.PrototypeFlags.demo;update.addEventListener('click',function completeDemoUpdate(){ui.currentVersion=ui.availableVersion;ui.availableVersion='';refreshVersionBadge();closeModal();toast('更新演示完成');});actions.append(update);}
  dialog.body.append(actions);
  if(window.PrototypeFlags.demo){const test=el('div','demo-controls');const add=button('生成30条测试记录','','plus','button secondary');add.addEventListener('click',function sampleRows(){const time=Date.now();const notes=Array.from({length:30},function sample(_,index){return {id:'demo-'+createId(),text:'测试记录 '+(index+1)+'\n\n用于检查增量加载、Emoji与卡片交互。\n\n#测试',images:[],pinned:false,status:'active',createdAt:time-index*60000,updatedAt:time-index*60000};});if(persistSnapshot(notes.concat(state.notes))){ui.tab='workspace';ui.selectedTag='';ui.query='';elements.searchInput.value='';renderNotes({reset:true});closeModal();showSidebar();toast('已添加30条测试记录');}});test.append(add);dialog.body.append(test);}
  dialog.footer.remove();
}

/* ==================== 卡片标签编辑 ==================== */
/** @brief 双击标签后就地修改当前记录的标签。 @param {HTMLButtonElement} chip 标签按钮。 */
function startTagRename(chip){
  window.clearTimeout(ui.clickTimer);window.clearTimeout(ui.tagClickTimer);
  const selectedCard=chip.closest('[data-note-id]'),selectedId=selectedCard&&selectedCard.dataset.noteId,selectedTag=chip.dataset.tag;
  if(!finishTagRename(false))return;
  if(ui.tagRefreshPending){renderNotes();chip=Array.from(elements.noteList.querySelectorAll('.tag-chip')).find(function sameTag(button){const card=button.closest('[data-note-id]');return card&&card.dataset.noteId===selectedId&&tagKey(button.dataset.tag)===tagKey(selectedTag);});if(!chip)return;}
  const card=chip.closest('[data-note-id]'),note=card&&state.notes.find(function same(n){return n.id===card.dataset.noteId;});if(!note)return;
  ui.expandedTags.clear();ui.expandedTags.add(note.id);
  elements.noteList.querySelectorAll('.note-tags').forEach(function expand(tags){tags.classList.toggle('tags-expanded',tags.closest('[data-note-id]').dataset.noteId===note.id);});
  const input=el('input','tag-rename-input');input.type='text';input.value=chip.dataset.tag;input.maxLength=40;input.setAttribute('aria-label','修改此记录的标签');input.title='Enter 确认，Esc 取消';
  ui.tagRenaming={id:note.id,tag:chip.dataset.tag,input:input,chip:chip};chip.replaceWith(input);
  input.addEventListener('keydown',function renameKey(event){if(event.isComposing||ui.composing||event.keyCode===229)return;if(event.key==='Enter'){event.preventDefault();event.stopPropagation();finishTagRename();}else if(event.key==='Escape'){event.preventDefault();event.stopPropagation();cancelTagRename();}});
  fitCardTags(card);input.focus();input.select();
}
/** @brief 确认当前记录的标签修改，相同标签自动合并。 @param {boolean} refresh 是否刷新列表。 @return {boolean} 是否完成。 */
function finishTagRename(refresh=true){
  const editing=ui.tagRenaming;if(!editing)return true;
  const next=editing.input.value.trim().replace(/^#/,'');
  if(!isValidTag(next)){toast('标签使用文字、数字、下划线或短横线，最多40字',null,true);editing.input.focus();return false;}
  const note=state.notes.find(function same(n){return n.id===editing.id;});
  if(note&&next!==editing.tag){const parsed=noteParts(note),text=window.NoteContent.compose(parsed.body,parsed.tags.map(function rename(tag){return tagKey(tag)===tagKey(editing.tag)?next:tag;}));const notes=state.notes.map(function change(n){return n.id===note.id?{...n,text:text,updatedAt:Date.now()}:n;});if(!persistSnapshot(notes)){toast('标签未保存，输入仍在',null,true);return false;}ui.tagRefreshPending=true;}
  editing.chip.textContent='#'+next;editing.chip.dataset.tag=next;
  const wrap=editing.input.parentElement,remove=wrap&&wrap.querySelector('.tag-remove');if(remove){remove.dataset.tag=next;remove.setAttribute('aria-label','从此记录移除 #'+next);remove.title='从此记录移除 #'+next;}
  editing.input.replaceWith(editing.chip);ui.tagRenaming=null;
  if(refresh)renderNotes();else renderTagMenu();return true;
}
/** 取消尚未确认的标签名称。 */
function cancelTagRename(){const editing=ui.tagRenaming;if(!editing)return;editing.input.replaceWith(editing.chip);ui.tagRenaming=null;editing.chip.focus();}
/** 收起所有标签整理区域，不触发卡片内容编辑。 */
function closeExpandedTags(){ui.expandedTags.clear();elements.noteList.querySelectorAll('.note-tags').forEach(function close(tags){tags.classList.remove('tags-expanded');const card=tags.closest('.note-card');if(card)fitCardTags(card);});}

/** @brief 指针按下时建立本次手势优先级，先结束标签整理。 @param {PointerEvent} event 指针事件。 */
function protectTagFocus(event){if(event.button!==undefined&&event.button!==0)return;ui.skipCardClick=false;ui.consumeClick=false;exitTagsFirst(event);}

/** @brief 点击阶段继续消费已判定的整理退出与排序手势。 @param {MouseEvent} event 点击事件。 */
function dismissTagEditing(event){if(ui.consumeClick){event.preventDefault();event.stopImmediatePropagation();ui.consumeClick=false;invalidateCardClick();return;}if(exitTagsFirst(event)){ui.consumeClick=false;return;}if(!event.target.closest('.tag-chip'))window.clearTimeout(ui.tagClickTimer);}

/* ==================== 文件与文本拖入 ==================== */
/** @brief 判断拖入目标所属记录入口。 @param {Event} event 拖放事件。 @return {HTMLElement|null} 接收容器。 */
function dropTarget(event){return event.target.closest('.note-card,.sidebar-composer,#capture');}
/** @brief 获取拖入处的源文插入范围，布局不支持时使用当前选区或末尾。 @param {DragEvent} event 拖放事件。 @param {HTMLTextAreaElement} input 输入源。 @return {object|null} 原文范围。 */
function dropRange(event,input){
  if(!input||!input.liveMarkdown)return null;const editor=input.liveMarkdown;
  const point=document.caretPositionFromPoint?document.caretPositionFromPoint(event.clientX,event.clientY):null;
  const range=!point&&document.caretRangeFromPoint?document.caretRangeFromPoint(event.clientX,event.clientY):null;
  const offset=point?editor.sourceOffset(point.offsetNode,point.offset):range?editor.sourceOffset(range.startContainer,range.startOffset):null;
  if(offset!==null)return {start:offset,end:offset,direction:'none'};
  if(editor.element.contains(event.target))return editor.readSelection();
  return {start:editor.getValue().length,end:editor.getValue().length,direction:'none'};
}
/** @brief 在原文范围插入拖入文本，未定位时追加独立段落。 @param {string} source 原文。 @param {string} text 新文本。 @param {object|null} range 插入范围。 @return {object} 合并内容及光标位置。 */
function insertDroppedText(source,text,range){
  if(!text)return {text:source,caret:range?range.end:source.length};
  if(range){const start=Math.max(0,Math.min(source.length,range.start)),end=Math.max(start,Math.min(source.length,range.end));return {text:source.slice(0,start)+text+source.slice(end),caret:start+text.length};}
  const prefix=source?(source.endsWith('\n\n')?'':source.endsWith('\n')?'\n':'\n\n'):'';
  return {text:source+prefix+text,caret:source.length+prefix.length+text.length};
}
/** @brief 将读取后的拖入结果加入共享草稿。 @param {object} payload 文本和图片。 @param {object|null} range 原文范围。 @param {HTMLTextAreaElement} input 输入源。 */
function applyDraftDrop(payload,range,input){
  const available=Math.max(0,12-state.draft.images.length),images=payload.images.slice(0,available);
  if(images.length<payload.images.length)toast('一条记录最多添加12张图片，超出的图片未插入',null,true);
  const inserted=insertDroppedText(state.draft.text,payload.text,range);
  if(inserted.text!==state.draft.text&&input&&input.liveMarkdown)input.liveMarkdown.remember(range||input.liveMarkdown.readSelection());
  ui.draftDirty=true;state.draft={text:inserted.text,images:state.draft.images.concat(images),updatedAt:Date.now()};
  ui.composer=true;persistDraft();renderDraft();
  if(input&&input.liveMarkdown){input.focus();input.setSelectionRange(inserted.caret,inserted.caret);}
}
/** @brief 读取并保存卡片或新增入口的拖入内容，持久化失败保留恢复草稿。 @param {DragEvent} event 拖放事件。 */
async function receiveContentDrop(event){
  const target=dropTarget(event);if(!target||!window.NoteDrop||event.sideNotesDropHandled)return;
  if(ui.sortPress&&ui.sortPress.active)return;
  event.preventDefault();event.stopPropagation();event.sideNotesDropHandled=true;window.clearTimeout(ui.clickTimer);window.clearTimeout(ui.tagClickTimer);ui.clickTimer=0;target.classList.remove('is-drop-target');
  if(!finishTagRename(false))return;closeExpandedTags();
  const id=target.dataset.noteId,input=id?target.querySelector('textarea.note-edit-input'):target===elements.capture?elements.draftInput:elements.sidebarDraft;
  const before=id?(ui.editing&&ui.editing.id===id?ui.editing.text:(state.notes.find(function same(n){return n.id===id;})||{}).text||''):state.draft.text;
  const editingAtDrop=ui.editing&&ui.editing.id===id?ui.editing:null;
  const range=dropRange(event,input);let pending=true;ui.pendingImages++;renderDraft();cancelHide();
  try{
    const payload=await window.NoteDrop.prepare(event.dataTransfer);
    ui.pendingImages--;pending=false;
    (payload.errors||[]).forEach(function warn(message){toast(message,null,true);});
    if(!payload.text&&!payload.images.length)return;
    if(!id){applyDraftDrop(payload,state.draft.text===before?range:null,input);return;}
    if(editingAtDrop){if(ui.editing===editingAtDrop)applyEditPayload(payload,editingAtDrop.text===before?range:null);else toast('编辑已退出，未插入拖入内容');return;}
    if(ui.editing&&ui.editing.id!==id&&!finishEdit()){applyDraftDrop(payload,null,elements.sidebarDraft);toast('当前编辑未保存，拖入内容已放入新增草稿',null,true);return;}
    const note=state.notes.find(function same(n){return n.id===id;});if(!note||note.status==='trash'){applyDraftDrop(payload,null,elements.sidebarDraft);toast('原记录不可用，拖入内容已放入新增草稿',null,true);return;}
    const editing=ui.editing&&ui.editing.id===id,source=editing?ui.editing.text:note.text;
    const inserted=insertDroppedText(source,payload.text,source===before?range:null),available=Math.max(0,12-note.images.length),images=payload.images.slice(0,available);
    if(images.length<payload.images.length)toast('一条记录最多添加12张图片，超出的图片未插入',null,true);
    const next={...note,text:window.NoteContent.canonicalize(inserted.text),images:note.images.concat(images),updatedAt:Date.now()};
    if(!persistSnapshot(state.notes.map(function replace(n){return n.id===id?next:n;}))){applyDraftDrop(payload,null,elements.sidebarDraft);toast('原记录未修改，拖入内容保留在新增草稿中',null,true);return;}
    if(editing){ui.editing.text=inserted.text;ui.editStorageError=false;const current=elements.noteList.querySelector('textarea[data-edit-id]');if(current&&current.liveMarkdown){if(current.liveMarkdown.getValue()!==inserted.text)current.liveMarkdown.remember(current.liveMarkdown.readSelection());current.liveMarkdown.setValue(inserted.text);current.focus();current.setSelectionRange(inserted.caret,inserted.caret);}}
    else renderNotes();toast('已插入到记录');
  }catch(error){toast(error.message||'无法读取拖入内容，请重试',null,true);}
  finally{if(pending)ui.pendingImages--;if(ui.tagRefreshPending)renderNotes();renderDraft();resumeEditBlur();}
}
/** 统一接收卡片和新增入口的拖入，先于可编辑区域默认处理。 */
function initializeContentDrop(){
  document.addEventListener('dragover',function allowContentDrop(event){const target=dropTarget(event);if(!target)return;event.preventDefault();if(event.dataTransfer)event.dataTransfer.dropEffect='copy';target.classList.add('is-drop-target');},true);
  document.addEventListener('dragleave',function leaveContentDrop(event){const target=dropTarget(event);if(target&&(!event.relatedTarget||!target.contains(event.relatedTarget)))target.classList.remove('is-drop-target');},true);
  document.addEventListener('dragend',function endContentDrop(){document.querySelectorAll('.is-drop-target').forEach(function clear(target){target.classList.remove('is-drop-target');});},true);
  document.addEventListener('drop',receiveContentDrop,true);
  document.addEventListener('paste',function pasteEditAttachments(event){const card=event.target.closest('.note-card.is-editing');if(!card||!ui.editing||!event.clipboardData)return;const files=Array.from(event.clipboardData.files||[]);if(!files.length)return;event.preventDefault();event.stopPropagation();addPickedAttachments(files,ui.editing.id);},true);
}

/* ==================== 编辑事务与附件 ==================== */
/** @brief 判断当前编辑是否有未提交内容。 @return {boolean} 是否存在修改。 */
function hasUnsavedEdit(){return Boolean(ui.editing&&(ui.editing.text!==ui.editing.originalText||ui.editing.images.length!==ui.editing.originalImages.length||ui.editing.images.some(function changed(image,index){return image.id!==ui.editing.originalImages[index].id;})));}

/** 丢弃当前编辑事务并退出，Esc 不触发失焦提交。 */
function cancelEdit(){
  if(!ui.editing)return;window.clearTimeout(ui.editTimer);window.clearTimeout(ui.editBlurTimer);
  ui.editing=null;ui.editAttachmentHold=null;ui.pendingEditBlur=null;ui.editStorageError=false;ui.skipCardClick=false;
  renderNotes();setStorageStatus(ui.storageWriteError);
}
/** @brief 渲染编辑事务中的图片，不移动正文光标。 @param {HTMLElement} card 编辑卡片。 */
function renderEditAttachments(card){
  if(!ui.editing)return;let list=card.querySelector('.note-edit-attachments');if(!list){list=el('div','attachment-list note-edit-attachments');card.insertBefore(list,card.querySelector('.note-edit-actions'));}list.replaceChildren();
  ui.editing.images.forEach(function item(image){const wrap=el('div','attachment-item'),preview=button('预览 '+image.name,'preview-markdown-image','','attachment-preview note-image-button');preview.dataset.src=image.data;preview.dataset.alt=image.name;const picture=el('img');picture.src=image.data;picture.alt=image.name;preview.append(picture);const remove=button('移除 '+image.name,'remove-edit-image','x');remove.classList.add('attachment-remove');remove.dataset.imageId=image.id;wrap.append(preview,remove);list.append(wrap);});
}
/** @brief 移除尚未提交的图片。 @param {string} id 图片标识。 */
function removeEditImage(id){if(!ui.editing)return;ui.editing.images=ui.editing.images.filter(function keep(image){return image.id!==id;});const card=elements.noteList.querySelector('.note-card.is-editing');if(card)renderEditAttachments(card);}
/** @brief 把文件和文本加入编辑事务，确认前不写入记录。 @param {object} payload 拖入内容。 @param {object|null} range 原文范围。 */
function applyEditPayload(payload,range=null){
  if(!ui.editing)return;const editing=ui.editing,input=elements.noteList.querySelector('textarea[data-edit-id]'),editor=input&&input.liveMarkdown;
  const inserted=insertDroppedText(editing.text,payload.text,range),available=Math.max(0,12-editing.images.length);if(payload.images.length>available)toast('一条记录最多12张图片，超出的图片未插入',null,true);
  if(editor&&inserted.text!==editing.text)editor.remember(editor.readSelection());editing.text=inserted.text;editing.images=editing.images.concat(payload.images.slice(0,available));
  if(editor){editor.setValue(inserted.text);editor.focus();editor.setSelectionRange(inserted.caret,inserted.caret);}const card=elements.noteList.querySelector('.note-card.is-editing');if(card)renderEditAttachments(card);
}

/** @brief 将附件插入当前编辑面或共享草稿，保持原来的输入窗口。 @param {FileList|Array} files 文件。 @param {string} target 目标。 */
async function addPickedAttachments(files,target='draft'){
  const editing=ui.editing&&ui.editing.id===target?ui.editing:null,input=target==='capture'?elements.draftInput:elements.sidebarDraft;
  ui.pendingImages++;renderDraft();
  try{
    const payload=await window.NoteDrop.prepare({files:Array.from(files),getData:function noText(){return '';}});
    payload.errors.forEach(function warn(message){toast(message,null,true);});
    if(editing){if(ui.editing!==editing){toast('编辑已退出，未插入附件');return;}applyEditPayload(payload);}
    else applyDraftDrop(payload,null,input);
  }catch(error){toast(error.message||'附件读取失败',null,true);}
  finally{ui.pendingImages--;ui.editAttachmentHold=null;renderDraft();resumeEditBlur();}
}

/** @brief 展开或收起搜索，收起时保留查询和筛选结果。 @param {boolean} open 是否展开。 @param {object} options 焦点选项。 */
function toggleSearch(open=true,options={}){
  ui.searchOpen=open;const wrap=document.getElementById('header-search'),row=document.getElementById('sidebar-navigation');wrap.classList.toggle('is-open',open);row.classList.toggle('is-searching',open);const tabs=row.querySelector('.sidebar-tabs');tabs.inert=open;tabs.setAttribute('aria-hidden',String(open));document.getElementById('search-toggle').setAttribute('aria-expanded',String(open));const panel=document.getElementById('search-panel');panel.inert=!open;panel.setAttribute('aria-hidden',String(!open));refreshSearchSummary();
  if(open){showSidebar({focus:false});elements.searchInput.value=ui.query;elements.searchInput.focus();elements.searchInput.select();}else if(options.focusButton)document.getElementById('search-toggle').focus();
}
/** 检查更新的原型入口，关于页与版本弹窗共用。 */
function checkForUpdates(){if(window.PrototypeFlags.demo){ui.availableVersion='0.5.1';refreshVersionBadge();showChangelog();toast('可用更新演示');}else{toast('更新服务待桌面端接入');}}

/* ==================== 手势优先级与长按排序 ==================== */
/** @brief 默认按创建时间倒序，手动排序后使用持久顺序。 @param {object} a 记录。 @param {object} b 记录。 @return {number} 比较结果。 */
function compareNoteOrder(a,b){const left=Number.isFinite(a.order)?a.order:-a.createdAt,right=Number.isFinite(b.order)?b.order:-b.createdAt;return left-right||b.createdAt-a.createdAt||a.id.localeCompare(b.id);}
/** 使所有待触发的正文编辑失效。 */
function invalidateCardClick(){window.clearTimeout(ui.clickTimer);window.clearTimeout(ui.tagClickTimer);ui.clickTimer=0;ui.clickEpoch=(ui.clickEpoch||0)+1;}
/** @brief 整理状态的外部操作先退出，并锁住本次完整点击手势。 @param {Event} event 当前事件。 @return {boolean} 是否消费。 */
function exitTagsFirst(event){if(!ui.expandedTags.size||event.target.closest('.note-tags.tags-expanded'))return false;event.preventDefault();event.stopImmediatePropagation();invalidateCardClick();ui.skipCardClick=true;ui.consumeClick=true;if(finishTagRename(false)){closeExpandedTags();if(ui.tagRefreshPending)renderNotes();}return true;}













/** @brief 仅迁移给定示例，其他草稿文字和图片保持原样，独立示例不重复添加。 @return {boolean} 是否变更。 */
function moveFileExampleFromDraft(){
  const pattern=/\[?思维导图\.xmind\]\(sidenotes-file:47f798dc-5356-4626-a5fe-218d5a9834f3\?name=[^)\r\n]*\)[ \t]*/g;
  const remaining=state.draft.text.replace(pattern,'');let changed=remaining!==state.draft.text;
  if(changed)state.draft={...state.draft,text:remaining.trim()?remaining:'',updatedAt:Date.now()};
  const exists=state.notes.some(function hasExample(note){return note.status==='active'&&note.text.includes('sidenotes-file:47f798dc-5356-4626-a5fe-218d5a9834f3');});
  if(!exists){const now=Date.now();state.notes=[{id:'file-example-'+createId(),text:'文件引用示例\n\n'+FILE_EXAMPLE_REFERENCE+'\n\n#文件 #示例',images:[],pinned:false,status:'active',createdAt:now-1800000,updatedAt:now},...state.notes];changed=true;}return changed;
}

/** @brief 聚焦真实 Markdown 输入面并准备新增。 @param {object} options 是否回到列表顶部。 */
function focusNewComposer(options={}){
  if(!elements.sidebarDraft||ui.modal||ui.editing||!elements.sidebar.classList.contains('open')||elements.sidebar.inert)return;
  if(options.resetScroll!==false)elements.noteList.scrollTop=0;
  ui.composer=true;
  const input=elements.sidebarDraft.liveMarkdown?elements.sidebarDraft.liveMarkdown.element:elements.sidebarDraft;
  input.focus({preventScroll:true});
}
/** 固定侧栏重新获得窗口焦点时回到新建输入，保留当前滚动位置。 */
function focusPinnedComposer(){
  if(!ui.locked||ui.modal||ui.editing||ui.searchOpen||ui.resizing||!elements.sidebar.classList.contains('open')||elements.sidebar.inert)return;
  if(window.NoteMenus&&window.NoteMenus.isOpen()||window.NoteInteractions&&window.NoteInteractions.isBusy())return;
  const input=elements.sidebarDraft.liveMarkdown?elements.sidebarDraft.liveMarkdown.element:elements.sidebarDraft;
  if(document.activeElement!==input)focusNewComposer({resetScroll:false});
}
/** 按需滚动至列表顶部，双击品牌不影响记录数据。 */
function scrollNotesToTop(){if(elements.noteList.scrollTo)elements.noteList.scrollTo({top:0,behavior:window.matchMedia&&window.matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'});else elements.noteList.scrollTop=0;}
/** 同步折叠搜索中的关键词胶囊与无障碍名称。 */
/** @brief 折叠搜索时按关键词实际宽度收缩，并限制最长显示宽度。 */
function refreshSearchSummary(){
  const wrap=document.getElementById('header-search'),row=document.getElementById('sidebar-navigation'),trigger=document.getElementById('search-toggle');
  if(!wrap||!trigger||!row)return;
  const query=ui.query.trim();
  let label=trigger.querySelector('.search-query-label');
  if(!label){label=el('span','search-query-label');label.setAttribute('aria-hidden','true');trigger.append(label);}
  label.textContent=query;label.hidden=!query;label.title=query;
  wrap.classList.toggle('has-query',Boolean(query));
  row.classList.toggle('has-search-query',Boolean(query));
  if(!query||ui.searchOpen){
    wrap.style.removeProperty('width');trigger.style.removeProperty('width');row.style.removeProperty('--search-collapsed-width');
  }else{
    let textWidth=0;
    try{
      const canvas=document.createElement('canvas'),context=canvas.getContext&&canvas.getContext('2d');
      if(context){context.font='500 10px "Microsoft YaHei UI","Microsoft YaHei",Segoe UI,sans-serif';textWidth=context.measureText(query).width;}
    }catch(error){/* 无 Canvas 环境使用字符宽度估算。 */}
    if(!textWidth)textWidth=Array.from(query).reduce(function width(total,character){return total+(/[\u0000-\u00ff]/.test(character)?6.2:10);},0);
    const rowWidth=row.clientWidth||320,maxWidth=Math.max(92,Math.min(176,rowWidth*.46));
    const width=Math.min(maxWidth,Math.max(64,Math.ceil(textWidth)+45));
    wrap.style.width=width+'px';trigger.style.width=width+'px';row.style.setProperty('--search-collapsed-width',width+'px');
  }
  trigger.title=query||'搜索 · Ctrl+F';
  trigger.setAttribute('aria-label',query?'搜索：'+query+'，点击修改':'搜索记录 · Ctrl+F');
}
/** 连接品牌双击回顶与搜索失焦收起，不抢走外部操作的焦点。 */
function initializeHeaderInteractions(){
  const brand=document.querySelector('.sidebar-brand');brand.title='双击回到列表顶部';brand.addEventListener('dblclick',function top(event){if(event.target.closest('button'))return;event.preventDefault();const selection=window.getSelection();if(selection&&selection.removeAllRanges)selection.removeAllRanges();scrollNotesToTop();});
  const wrap=document.getElementById('header-search');wrap.addEventListener('focusout',function closeOnBlur(event){if(event.relatedTarget&&wrap.contains(event.relatedTarget))return;window.clearTimeout(ui.searchBlurTimer);ui.searchBlurTimer=window.setTimeout(function afterFocus(){if(ui.searchOpen&&!wrap.contains(document.activeElement))toggleSearch(false);},0);});
  window.requestAnimationFrame(function initialFocus(){if(elements.sidebar.classList.contains('open')&&!ui.searchOpen&&!ui.modal&&!ui.editing)queueComposerFocus();});
}

/* ==================== 焦点交接与编辑失焦提交 ==================== */
/** 在下一帧与展开结束后复核聚焦，用户主动选择其它控件后停止重试。 */
function queueComposerFocus(){
  const token=ui.composerFocusToken=(ui.composerFocusToken||0)+1;
  const startFocus=document.activeElement;
  /** @brief 补足展开中的焦点交接。 @return {void} */
  function focusWhenVisible(){
    if(token!==ui.composerFocusToken||!elements.sidebar.classList.contains('open')||elements.sidebar.inert||ui.modal||ui.editing||ui.searchOpen)return;
    const input=elements.sidebarDraft.liveMarkdown?elements.sidebarDraft.liveMarkdown.element:elements.sidebarDraft,active=document.activeElement;
    if(active===input)return;
    if(active!==startFocus&&active!==document.body&&active!==elements.sidebarDraft&&active!==input&&active!==elements.edgeTrigger)return;
    focusNewComposer();
  }
  focusWhenVisible();window.requestAnimationFrame(function nextFrame(){window.requestAnimationFrame(focusWhenVisible);});
  window.setTimeout(focusWhenVisible,240);
}
/** @brief 失焦后提交同一个编辑事务，等待按钮点击完成以区分取消与保存。 @param {object} editing 编辑事务。 */
function scheduleEditBlur(editing){
  window.clearTimeout(ui.editBlurTimer);
  ui.editBlurTimer=window.setTimeout(function commitBlur(){
    if(!editing||ui.editing!==editing){ui.pendingEditBlur=null;return;}
    if(ui.composing||ui.pendingImages||ui.editAttachmentHold===editing){ui.pendingEditBlur=editing;return;}
    const card=elements.noteList.querySelector('.note-card.is-editing');
    if(card&&card.contains(document.activeElement)){ui.pendingEditBlur=null;return;}
    ui.pendingEditBlur=null;
    if(!finishEdit()){
      const input=elements.noteList.querySelector('textarea[data-edit-id]');if(input)input.focus({preventScroll:true});
    }
  },0);
}
/** 附件或输入法结束后继续尚未完成的失焦提交。 */
function resumeEditBlur(){if(ui.pendingEditBlur&&ui.pendingEditBlur===ui.editing)scheduleEditBlur(ui.pendingEditBlur);}
/** 注册焦点交接，编辑工具和文件选择暂时保留编辑事务。 */
function initializeEditFocus(){
  document.addEventListener('focusout',function editFocusLeft(event){const card=event.target.closest&&event.target.closest('.note-card.is-editing');if(card&&ui.editing)scheduleEditBlur(ui.editing);});
  [elements.imagePicker,elements.attachmentPicker].forEach(function pickerEvents(picker){
    picker.addEventListener('cancel',function canceledPick(){const editing=ui.editAttachmentHold;ui.editAttachmentHold=null;if(editing&&ui.editing===editing){const input=elements.noteList.querySelector('textarea[data-edit-id]');if(input)input.focus();}});
  });
  elements.sidebar.addEventListener('transitionend',function sidebarShown(event){
    if(event.target===elements.sidebar&&event.propertyName==='transform'&&elements.sidebar.classList.contains('open')&&!elements.sidebar.inert&&!ui.searchOpen&&!ui.modal&&!ui.editing){
      const active=document.activeElement;
      if(!active||active===document.body||active===elements.edgeTrigger||active===elements.sidebarDraft)focusNewComposer();
    }
  });
}

initialize();
