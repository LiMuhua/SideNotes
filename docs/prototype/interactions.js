/* 卡片长按排序与多选：状态独立于正文编辑，点击事件在捕获阶段按优先级处理。 */
(function exposeNoteInteractions(){
  'use strict';
  const selected = new Set(); // 当前选择的记录标识。
  const tools = { initialized:false, mode:false, anchor:'', gesture:null, blockClick:false, lastDragAt:-Infinity, lastPointerAt:-Infinity, frame:0, scrollFrame:0, observer:null, viewKey:'' }; // 手势与临时状态。
  let dragTrash; // 拖动时显示的回收站投放区。

  /** @brief 取得单调时间。 @return {number} 毫秒数。 */
  function now(){return window.performance&&window.performance.now?window.performance.now():Date.now();}
  /** @brief 取得事件对应的元素。 @param {Event} event 事件。 @return {Element|null} 元素。 */
  function targetOf(event){return event.target&&event.target.closest?event.target:event.target&&event.target.parentElement;}
  /** @brief 列出当前筛选结果的有效标识。 @return {string[]} 记录标识。 */
  function visibleIds(){return (ui.listItems||[]).map(function id(note){return note.id;});}
  /** @brief 取得仍存在且未回收的选择。 @return {string[]} 记录标识。 */
  function selectedIds(){return state.notes.filter(function chosen(note){return selected.has(note.id)&&note.status!=='trash';}).map(function id(note){return note.id;});}
  /** @brief 阻止本次事件继续触发卡片编辑。 @param {Event} event 事件。 */
  function consume(event){event.preventDefault();event.stopImmediatePropagation();invalidateCardClick();}
  /** 选择变化后同步卡片状态。 */
  function refresh(){
    if(!tools.initialized)return;
    if(tools.viewKey!==ui.listKey){
      if(!(tools.gesture&&tools.gesture.active)){selected.clear();tools.mode=false;tools.anchor='';}
      tools.viewKey=ui.listKey;
    }
    const valid=new Set(state.notes.filter(function active(note){return note.status!=='trash';}).map(function id(note){return note.id;}));
    selected.forEach(function prune(id){if(!valid.has(id))selected.delete(id);});
    ui.selection=selected;
    elements.noteList.querySelectorAll('.note-card').forEach(function mark(card){
      const chosen=selected.has(card.dataset.noteId);card.classList.toggle('is-selected',chosen);card.setAttribute('aria-selected',String(chosen));
    });
  }
  /** 清空选择与多选模式，不更改记录内容。 */
  function clearSelection(){selected.clear();tools.mode=false;tools.anchor='';refresh();}
  /** @brief 指示是否存在选择或正在多选。 @return {boolean} 选择状态。 */
  function hasSelection(){return tools.mode||selected.size>0;}
  /** @brief 指示是否正在按压、拖动或框选。 @return {boolean} 手势状态。 */
  function isBusy(){return Boolean(tools.gesture);}
  /** @brief 同步连续区间选择。 @param {string} id 终点。 @param {boolean} range 是否区间选择。 @param {boolean} additive 是否追加。 */
  function choose(id,range,additive){
    const ids=visibleIds();
    if(range&&tools.anchor&&ids.includes(tools.anchor)){const start=ids.indexOf(tools.anchor),end=ids.indexOf(id);if(!additive)selected.clear();ids.slice(Math.min(start,end),Math.max(start,end)+1).forEach(function select(item){selected.add(item);});}
    else{if(selected.has(id))selected.delete(id);else selected.add(id);tools.anchor=id;}
    tools.mode=true;refresh();
  }
  /** @brief 捕获多选点击及拖动产生的合成点击。 @param {MouseEvent} event 点击。 */
  function captureClick(event){
    const target=targetOf(event);if(!target)return;
    if(tools.blockClick){tools.blockClick=false;if(event.detail!==0&&now()-tools.lastDragAt<650){consume(event);return;}}
    const interactive=target.closest('button,a,input,textarea,select,[contenteditable="true"],.modal,.capture,.tag-dropdown');
    const card=target.closest('.note-card');
    if((!card||!elements.noteList.contains(card)||card.classList.contains('is-editing'))&&hasSelection()&&!interactive){consume(event);clearSelection();return;}
    if(!card||!elements.noteList.contains(card)||card.classList.contains('is-editing'))return;
    if((hasSelection()||event.ctrlKey||event.metaKey||event.shiftKey)&&!interactive){consume(event);choose(card.dataset.noteId,event.shiftKey,event.ctrlKey||event.metaKey);}
  }
  /** @brief 多选和排序之后不再触发双击复制。 @param {MouseEvent} event 双击。 */
  function captureDoubleClick(event){const target=targetOf(event);if(target&&target.closest('.note-card')&&(hasSelection()||now()-tools.lastDragAt<650))consume(event);}
  /** @brief 按照批次目的地更新状态，先持久化再刷新。 @param {string} destination 目的地。 @return {boolean} 是否成功。 */
  function moveRecords(source,destination){
    const ids=new Set(source||[]),previous=new Map();if(!ids.size)return false;const changedAt=Date.now();
    const notes=state.notes.map(function change(note){if(!ids.has(note.id)||note.status==='trash')return note;previous.set(note.id,{status:note.status,pinned:note.pinned,deletedAt:note.deletedAt,previousStatus:note.previousStatus,order:note.order});
      if(destination==='trash')return {...note,status:'trash',previousStatus:note.status,deletedAt:changedAt,updatedAt:changedAt};
      return {...note,status:destination==='archive'?'archived':'active',pinned:destination==='archive'?note.pinned:destination==='pinned',order:null,updatedAt:changedAt};});
    if(!persistSnapshot(notes)){toast('移动未保存，请重试',null,true);return false;}
    const message=destination==='trash'?'已移入回收站':destination==='archive'?'已移到归档':destination==='pinned'?'已移到置顶':'已移到工作区';
    clearSelection();renderNotes();toast(message+' '+ids.size+' 条记录',{label:'撤销',run:function undoBatch(){const restored=state.notes.map(function restore(note){return previous.has(note.id)?{...note,...previous.get(note.id)}:note;});if(persistSnapshot(restored))renderNotes();}});return true;
  }
  /** @brief 取得记录标题用于落点提示。 @param {object} note 记录。 @return {string} 短标题。 */
  function noteTitle(note){const first=String(note&&note.text||'').split(/\r?\n/).find(function content(text){return text.trim();})||'图片记录';return first.trim().slice(0,18);}
  /** @brief 清除当前插入线。 @param {object} gesture 手势。 */
  function clearDropGuide(gesture){elements.noteList.querySelectorAll('.drop-before,.drop-after').forEach(function clear(card){card.classList.remove('drop-before','drop-after');});if(gesture.guide){gesture.guide.hidden=true;gesture.guide.classList.remove('is-invalid');}}
  /** 创建卡片容器右下角的回收站投放区。 */
  function mountDragTargets(){
    dragTrash=el('div','drag-trash-zone');dragTrash.id='drag-trash-zone';dragTrash.setAttribute('role','status');dragTrash.setAttribute('aria-label','拖放到这里移入回收站');dragTrash.setAttribute('aria-hidden','true');
    dragTrash.append(icon('trash'),el('span','drag-trash-label','移入回收站'));elements.sidebar.append(dragTrash);
  }
  /** @brief 清除 Tab 悬停计时与提示。 @param {object} gesture 手势。 */
  function clearTabTarget(gesture){window.clearTimeout(gesture.tabTimer);gesture.tabTimer=0;gesture.tabCandidate='';document.querySelectorAll('.sidebar-tabs .tab.is-drag-target').forEach(function clear(tab){tab.classList.remove('is-drag-target');});}
  /** @brief 在悬停 Tab 后切换列表，保留当前拖动手势。 @param {object} gesture 手势。 @param {string} destination 目标 Tab。 */
  function activateDragTab(gesture,destination){
    if(tools.gesture!==gesture||!gesture.active||gesture.tabCandidate!==destination||destination===ui.tab)return;
    ui.tab=destination;ui.selectedTag='';ui.query='';elements.searchInput.value='';if(typeof closeTagMenu==='function')closeTagMenu();renderNotes({reset:true});
    gesture.targetMode='tab';gesture.targetDestination=destination;gesture.targetId='';
    const tab=document.querySelector('.sidebar-tabs [data-tab="'+destination+'"]');if(tab)tab.classList.add('is-drag-target');
    gesture.label.textContent=gesture.ids.size+' 条 · 已进入'+tab.textContent.replace(/\d+/g,'').trim()+'，松开移动或继续拖到卡片间排序';
  }
  /** @brief 记录指针当前悬停的 Tab，并在短暂停留后切换页面。 @param {object} gesture 手势。 @param {HTMLElement|null} tab Tab 按钮。 */
  function setTabTarget(gesture,tab){
    const destination=tab&&tab.dataset.tab||'';
    if(gesture.tabCandidate!==destination){window.clearTimeout(gesture.tabTimer);gesture.tabTimer=0;document.querySelectorAll('.sidebar-tabs .tab.is-drag-target').forEach(function clear(node){node.classList.remove('is-drag-target');});}
    gesture.tabCandidate=destination;if(!tab)return;
    tab.classList.add('is-drag-target');
    if(destination!==ui.tab&&!gesture.tabTimer)gesture.tabTimer=window.setTimeout(function switchTab(){gesture.tabTimer=0;activateDragTab(gesture,destination);},240);
  }
  /** @brief 在列表边缘或卡片间隙选择最近的有效插入点。 @param {object} gesture 手势。 */
  function updateDropTarget(gesture){
    clearDropGuide(gesture);gesture.targetId='';gesture.after=false;gesture.targetMode='';gesture.targetDestination='';
    if(dragTrash){
      const trashBounds=dragTrash.getBoundingClientRect(),overTrash=gesture.x>=trashBounds.left-9&&gesture.x<=trashBounds.right+9&&gesture.y>=trashBounds.top-9&&gesture.y<=trashBounds.bottom+9;
      if(overTrash){clearTabTarget(gesture);dragTrash.classList.add('is-target');gesture.targetMode='trash';gesture.targetDestination='trash';gesture.label.textContent=gesture.ids.size+' 条 · 松开后移入回收站';return;}
      dragTrash.classList.remove('is-target');
    }
    // 拖出侧栏（指针离开侧栏朝屏幕内侧的边）：松开后在那里打开记录窗口（本次提出）。
    const sidebarBounds=elements.sidebar.getBoundingClientRect(),outside=state.settings.edge==='left'?gesture.x>sidebarBounds.right+4:gesture.x<sidebarBounds.left-4;
    gesture.ghost.classList.toggle('is-window',outside);
    if(outside&&window.NoteWindows){clearTabTarget(gesture);gesture.targetMode='window';gesture.label.textContent=gesture.ids.size+' 条 · 松开后在窗口中打开';return;}
    const tab=document.elementFromPoint?document.elementFromPoint(gesture.x,gesture.y):null;
    const tabTarget=tab&&tab.closest?tab.closest('.sidebar-tabs [data-tab]'):null;
    if(tabTarget){
      setTabTarget(gesture,tabTarget);gesture.targetMode='tab';gesture.targetDestination=tabTarget.dataset.tab;
      gesture.label.textContent=gesture.targetDestination===ui.tab?gesture.ids.size+' 条 · 当前为'+tabTarget.textContent.replace(/\d+/g,'').trim()+'，继续拖入列表排序':gesture.ids.size+' 条 · 停留后可切换到'+tabTarget.textContent.replace(/\d+/g,'').trim();
      return;
    }
    clearTabTarget(gesture);gesture.targetMode='list';
    const listBounds=elements.noteList.getBoundingClientRect();
    if(gesture.x<listBounds.left-14||gesture.x>listBounds.right+14){gesture.label.textContent=gesture.ids.size+' 条 · 移入记录列表后松开';return;}
    const candidates=Array.from(elements.noteList.querySelectorAll('.note-card[data-note-id]')).filter(function eligible(card){return !gesture.ids.has(card.dataset.noteId);});
    if(!candidates.length){gesture.label.textContent=gesture.ids.size+' 条 · 当前没有可用落点';return;}
    let best=null;const measured=candidates.map(function measure(card){const bounds=card.getBoundingClientRect();return {card:card,bounds:bounds};});
    const visible=measured.filter(function onScreen(item){return item.bounds.bottom>listBounds.top&&item.bounds.top<listBounds.bottom;});
    if(gesture.y>listBounds.bottom&&visible.length){const last=visible[visible.length-1];best={card:last.card,bounds:last.bounds,after:true,distance:0};}
    else if(gesture.y<listBounds.top&&visible.length){const first=visible[0];best={card:first.card,bounds:first.bounds,after:false,distance:0};}
    else measured.forEach(function nearest(item){
      const bounds=item.bounds,after=gesture.y>bounds.top+bounds.height/2;
      const distance=gesture.y<bounds.top?bounds.top-gesture.y:gesture.y>bounds.bottom?gesture.y-bounds.bottom:0;
      if(!best||distance<best.distance||distance===best.distance&&bounds.top<best.bounds.top)best={card:item.card,bounds:bounds,after:after,distance:distance};
    });
    const target=best.card,note=state.notes.find(function find(item){return item.id===target.dataset.noteId;});if(!note)return;
    gesture.targetId=note.id;gesture.after=best.after;target.classList.add(best.after?'drop-after':'drop-before');
    const position=best.after?'之后':'之前';
    gesture.label.textContent=gesture.ids.size+' 条 · 松开后放到「'+noteTitle(note)+'」'+position;
    if(gesture.guide){
      const insertionY=best.after?Math.min(best.bounds.bottom,listBounds.bottom-2):Math.max(best.bounds.top,listBounds.top+2);
      // 插入线横跨卡片的宽度，位于两张卡片的间隙中间（Playground 的 sn-drop-line）。
      const cardBounds=best.bounds,gap=parseFloat(window.getComputedStyle(elements.noteList).rowGap)||0,middle=best.after?insertionY+gap*gesture.zoom/2:insertionY-gap*gesture.zoom/2;
      gesture.guide.hidden=false;
      gesture.guide.style.left=cardBounds.left+'px';
      gesture.guide.style.width=Math.max(0,cardBounds.width)+'px';
      gesture.guide.style.top=middle+'px';
    }
  }
  /** @brief 更新框选区域及与其相交的卡片。 @param {object} gesture 框选手势。 */
  function updateFrame(gesture){
    const anchorY=gesture.startY-(elements.noteList.scrollTop-gesture.startScrollTop),left=Math.min(gesture.startX,gesture.x),top=Math.min(anchorY,gesture.y),right=Math.max(gesture.startX,gesture.x),bottom=Math.max(anchorY,gesture.y),bounds=elements.noteList.getBoundingClientRect();
    gesture.overlay.style.left=Math.max(left,bounds.left)+'px';gesture.overlay.style.top=Math.max(top,bounds.top)+'px';gesture.overlay.style.width=Math.max(0,Math.min(right,bounds.right)-Math.max(left,bounds.left))+'px';gesture.overlay.style.height=Math.max(0,Math.min(bottom,bounds.bottom)-Math.max(top,bounds.top))+'px';
    selected.clear();gesture.base.forEach(function keep(id){selected.add(id);});
    elements.noteList.querySelectorAll('.note-card').forEach(function hit(card){const rect=card.getBoundingClientRect();if(rect.right>=left&&rect.left<=right&&rect.bottom>=top&&rect.top<=bottom)selected.add(card.dataset.noteId);});tools.mode=true;refresh();
  }
  /** @brief 跟随指针更新反馈及落点。 @param {object} gesture 手势。 */
  function paintGesture(gesture){if(tools.gesture!==gesture||!gesture.active)return;if(gesture.kind==='sort'){gesture.ghost.style.left=(gesture.x-gesture.grabX)/gesture.zoom+'px';gesture.ghost.style.top=(gesture.y-gesture.grabY)/gesture.zoom+'px';updateDropTarget(gesture);}else updateFrame(gesture);}
  /** 在靠近滚动边缘时持续滚动，无需再次移动指针。 */
  function scrollDuringGesture(){const gesture=tools.gesture;if(!gesture||!gesture.active){tools.scrollFrame=0;return;}if(gesture.targetMode==='tab'||gesture.targetMode==='trash'){tools.scrollFrame=window.requestAnimationFrame(scrollDuringGesture);return;}const bounds=elements.noteList.getBoundingClientRect(),margin=38;let speed=0;if(gesture.y<bounds.top+margin)speed=-Math.ceil((bounds.top+margin-gesture.y)/4);else if(gesture.y>bounds.bottom-margin)speed=Math.ceil((gesture.y-bounds.bottom+margin)/4);speed=Math.max(-22,Math.min(22,speed));if(speed){elements.noteList.scrollTop+=speed;paintGesture(gesture);}tools.scrollFrame=window.requestAnimationFrame(scrollDuringGesture);}
  /** @brief 长按到阈值后启动拖动，不把手部轻微漂移判定为取消。 @param {object} gesture 按压。 */
  function activateSort(gesture){
    if(tools.gesture!==gesture||ui.editing||ui.modal||ui.expandedTags.size)return;gesture.active=true;gesture.originTab=ui.tab;gesture.targetMode='list';gesture.card.classList.remove('is-sort-pending');gesture.card.classList.add('is-sorting');invalidateCardClick();
    gesture.ids=selected.has(gesture.id)&&selected.size?new Set(selectedIds()):new Set([gesture.id]);
    document.body.classList.add('is-sorting-cards');elements.noteList.querySelectorAll('.note-card').forEach(function mark(card){card.classList.toggle('is-sorting-member',gesture.ids.has(card.dataset.noteId));});
    const selection=window.getSelection();if(selection&&selection.removeAllRanges)selection.removeAllRanges();
    // 拖影是卡片本身的副本：向右错开、倾斜、浮起（Playground 的 sn-drag-ghost）；拖出侧栏时保持倾斜并放大一点，表示松开后成为窗口。
    // 副本放进带 note-list 类的外壳，卡片的样式照常生效；多选时右上角写出条数。说明文字只留给读屏（gesture.label 不放进页面）。
    const source=gesture.card.getBoundingClientRect(),zoom=parseFloat(window.getComputedStyle(elements.sidebar).zoom)||1;
    gesture.grabX=gesture.startX-source.left;gesture.grabY=gesture.startY-source.top;gesture.zoom=zoom;
    gesture.ghost=el('div','card-drag-ghost note-list');gesture.ghost.setAttribute('aria-hidden','true');gesture.ghost.style.width=source.width/zoom+'px';
    // 多选时副本后面叠一两张卡片的边，错开并转开一点，像拿起一叠卡片（本次提出）。
    for(let layer=Math.min(2,gesture.ids.size-1);layer>0;layer-=1){const stack=el('div','card-drag-stack');stack.style.setProperty('--local-layer',String(layer));gesture.ghost.append(stack);}
    const copy=gesture.card.cloneNode(true);copy.classList.remove('is-sort-pending','is-sorting','is-sorting-member','drop-before','drop-after','is-selected');copy.classList.add('is-current');copy.removeAttribute('id');copy.querySelectorAll('[id]').forEach(function strip(node){node.removeAttribute('id');});gesture.ghost.append(copy);
    if(gesture.ids.size>1)gesture.ghost.append(el('span','card-drag-count',String(gesture.ids.size)));
    gesture.label=el('span','');
    gesture.guide=el('div','card-drop-guide');gesture.guide.hidden=true;gesture.guide.append(el('span','card-drop-guide-line'));
    document.body.append(gesture.ghost,gesture.guide);if(dragTrash)dragTrash.setAttribute('aria-hidden','false');
    try{if(gesture.card.setPointerCapture&&gesture.pointerId!==undefined)gesture.card.setPointerCapture(gesture.pointerId);}catch(error){/* 指针失效时由 pointercancel 清理。 */}
    paintGesture(gesture);tools.scrollFrame=window.requestAnimationFrame(scrollDuringGesture);
  }
  /** @brief 在空白处启动框选，拖动 4px 后才进入多选状态。 @param {object} gesture 框选。 */
  function activateFrame(gesture){gesture.active=true;gesture.overlay=el('div','card-selection-rectangle');gesture.overlay.setAttribute('aria-hidden','true');document.body.append(gesture.overlay);document.body.classList.add('is-framing-cards');paintGesture(gesture);tools.scrollFrame=window.requestAnimationFrame(scrollDuringGesture);}
  /** @brief 创建按压状态，鼠标兼容事件不会重复启动手势。 @param {Event} event 按压。 */
  function press(event){
    if(event.type==='pointerdown')tools.lastPointerAt=now();else if(now()-tools.lastPointerAt<700)return;
    if(!tools.gesture)tools.blockClick=false;
    if(event.button!==0||tools.gesture||ui.modal||ui.editing||ui.expandedTags.size||ui.consumeClick)return;
    const target=targetOf(event);if(!target||!elements.noteList.contains(target)||target.closest('button,a,input,textarea,select,[contenteditable="true"],.sidebar-composer'))return;
    const card=target.closest('.note-card');invalidateCardClick();
    const gesture={kind:card?'sort':'frame',eventKind:event.type==='pointerdown'?'pointer':'mouse',pointerId:event.pointerId,startX:event.clientX,startY:event.clientY,startScrollTop:elements.noteList.scrollTop,x:event.clientX,y:event.clientY,active:false,card:card,id:card&&card.dataset.noteId,base:new Set(event.ctrlKey||event.metaKey||event.shiftKey?selected:[]),pointerType:event.pointerType||'mouse'};
    tools.gesture=gesture;if(card){ui.sortPress=gesture;card.classList.add('is-sort-pending');gesture.timer=window.setTimeout(function hold(){activateSort(gesture);},300);if(gesture.pointerType==='mouse')event.preventDefault();}else event.preventDefault();
  }
  /** @brief 仅处理与起点同一输入通道的事件。 @param {Event} event 事件。 @return {boolean} 是否匹配。 */
  function samePointer(event){const gesture=tools.gesture;return Boolean(gesture&&((gesture.eventKind==='pointer'&&event.type.startsWith('pointer')&&event.pointerId===gesture.pointerId)||(gesture.eventKind==='mouse'&&event.type.startsWith('mouse'))));}
  /** @brief 更新指针位置，长按前鼠标移动不会中断计时。 @param {Event} event 移动。 */
  function move(event){
    if(!samePointer(event))return;const gesture=tools.gesture;gesture.x=event.clientX;gesture.y=event.clientY;
    const distance=Math.hypot(gesture.x-gesture.startX,gesture.y-gesture.startY);
    if(!gesture.active){if(gesture.kind==='frame'&&distance>=4)activateFrame(gesture);else if(gesture.pointerType==='touch'&&distance>30){cancelGesture();return;}else return;}
    event.preventDefault();event.stopImmediatePropagation();if(!tools.frame)tools.frame=window.requestAnimationFrame(function draw(){tools.frame=0;paintGesture(gesture);});
  }
  /** @brief 将整批卡片插入目标记录之前或之后并保存顺序。 @param {Set<string>} ids 来源标识。 @param {string} targetId 目标。 @param {boolean} after 是否放在目标之后。 @return {boolean} 是否保存。 */
  function reorder(ids,targetId,after){
    const target=state.notes.find(function find(note){return note.id===targetId;}),moving=state.notes.filter(function chosen(note){return ids.has(note.id)&&note.status!=='trash';}).sort(function order(a,b){return (a.pinned===b.pinned?0:a.pinned?-1:1)||compareNoteOrder(a,b);});if(!target||!moving.length||ids.has(targetId))return false;
    const group=state.notes.filter(function same(note){return note.status===target.status&&note.pinned===target.pinned&&!ids.has(note.id);}).sort(compareNoteOrder),index=group.findIndex(function same(note){return note.id===targetId;});if(index<0)return false;group.splice(index+(after?1:0),0,...moving);
    const ranks=new Map(group.map(function rank(note,index){return [note.id,index];})),before=new Map(state.notes.filter(function affected(note){return ranks.has(note.id);}).map(function previous(note){return [note.id,{order:note.order,status:note.status,pinned:note.pinned}];}));
    const notes=state.notes.map(function rank(note){return ranks.has(note.id)?{...note,order:ranks.get(note.id),status:ids.has(note.id)?target.status:note.status,pinned:ids.has(note.id)?target.pinned:note.pinned}:note;});
    if(!persistSnapshot(notes)){toast('排序未保存，原顺序保持不变',null,true);return false;}renderNotes();refresh();toast('已移动 '+moving.length+' 条记录',{label:'撤销',run:function undo(){const restored=state.notes.map(function restore(note){return before.has(note.id)?{...note,...before.get(note.id)}:note;});if(persistSnapshot(restored))renderNotes();}});return true;
  }
  /** 清理按压计时、指针捕获和所有拖动反馈。 */
  function cancelGesture(){
    const gesture=tools.gesture;if(!gesture)return false;window.clearTimeout(gesture.timer);clearTabTarget(gesture);if(tools.frame)window.cancelAnimationFrame(tools.frame);if(tools.scrollFrame)window.cancelAnimationFrame(tools.scrollFrame);tools.frame=0;tools.scrollFrame=0;
    if(gesture.active){tools.blockClick=true;tools.lastDragAt=now();invalidateCardClick();}
    try{if(gesture.card&&gesture.card.hasPointerCapture&&gesture.card.hasPointerCapture(gesture.pointerId))gesture.card.releasePointerCapture(gesture.pointerId);}catch(error){/* 系统可能已经释放指针捕获。 */}
    if(gesture.ghost)gesture.ghost.remove();if(gesture.guide)gesture.guide.remove();if(gesture.overlay)gesture.overlay.remove();if(dragTrash){dragTrash.classList.remove('is-target');dragTrash.setAttribute('aria-hidden','true');}document.body.classList.remove('is-sorting-cards','is-framing-cards');elements.noteList.querySelectorAll('.note-card').forEach(function clean(card){card.classList.remove('is-sort-pending','is-sorting','is-sorting-member','drop-before','drop-after');});tools.gesture=null;ui.sortPress=null;return true;
  }
  /** @brief 松开后一次性保存排序或完成框选，不触发编辑。 @param {Event} event 松开。 */
  function release(event){if(!samePointer(event))return;const gesture=tools.gesture;if(gesture.active){gesture.x=event.clientX;gesture.y=event.clientY;paintGesture(gesture);consume(event);}const active=gesture.active,kind=gesture.kind,target=gesture.targetId,after=gesture.after,ids=gesture.ids,mode=gesture.targetMode,destination=gesture.targetDestination,originTab=gesture.originTab,point={x:gesture.x,y:gesture.y},ghost=gesture.ghost&&gesture.ghost.firstElementChild?gesture.ghost.firstElementChild.getBoundingClientRect():null;cancelGesture();if(!active||kind!=='sort')return;if(mode==='window'){window.NoteWindows.openFromDrag(ids,point,ghost);return;}if(mode==='trash')moveRecords(ids,'trash');else if(mode==='tab'&&destination&&destination!==originTab)moveRecords(ids,destination);else if(mode==='list'&&target)reorder(ids,target,after);}
  /** @brief 选择模式下 Ctrl+A 全选筛选结果。 @param {KeyboardEvent} event 按键。 */
  function keyboard(event){const target=targetOf(event);if(hasSelection()&&(event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='a'&&!(target&&target.closest('input,textarea,[contenteditable="true"]'))){consume(event);visibleIds().forEach(function select(id){selected.add(id);});refresh();}}
  /** 连接捕获阶段手势与普通按钮，不接管正文编辑事务。 */
  function initialize(){
    if(tools.initialized)return;tools.initialized=true;tools.viewKey=ui.listKey;ui.selection=selected;mountDragTargets();
    document.addEventListener('pointerdown',press,true);document.addEventListener('mousedown',press,true);document.addEventListener('pointermove',move,{capture:true,passive:false});document.addEventListener('mousemove',move,{capture:true,passive:false});document.addEventListener('pointerup',release,true);document.addEventListener('mouseup',release,true);document.addEventListener('pointercancel',cancelGesture,true);window.addEventListener('blur',cancelGesture);
    document.addEventListener('click',captureClick,true);document.addEventListener('dblclick',captureDoubleClick,true);document.addEventListener('contextmenu',function keepDragPriority(event){if(tools.gesture&&tools.gesture.active)consume(event);},true);document.addEventListener('keydown',keyboard,true);document.addEventListener('selectstart',function noSelection(event){if(tools.gesture&&tools.gesture.kind==='sort')event.preventDefault();},true);
    if(window.MutationObserver){tools.observer=new window.MutationObserver(function listChanged(){refresh();});tools.observer.observe(elements.noteList,{childList:true,subtree:true});}
    refresh();
  }
  window.NoteInteractions=Object.freeze({initialize:initialize,refresh:refresh,clearSelection:clearSelection,hasSelection:hasSelection,isBusy:isBusy,cancelGesture:cancelGesture,selectedIds:selectedIds});
})();
