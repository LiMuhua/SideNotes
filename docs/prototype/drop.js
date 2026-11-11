'use strict';

/** 拖入文本、图片与可重新定位的本地文件引用。 */
(function exposeNoteDrop() {
  const MAX_IMAGE_BYTES = 2 * 1024 * 1024; // 与文件选择和截图粘贴保持一致。
  const IMAGE_TYPES = /^image\/(png|jpeg|gif|webp|svg\+xml)$/i; // 原型支持的内嵌图片格式。

  /* ==================== 拖入内容快照 ==================== */

  /** @brief 判断拖入数据是否包含可接收的文件或文本。 @param {DataTransfer} transfer 拖放数据。 @return {boolean} 是否可接收。 */
  function accepts(transfer) {
    if (!transfer) return false;
    return Boolean(transfer.files && transfer.files.length) || Array.from(transfer.types || []).some(function acceptedType(type) { return type === 'Files' || type === 'text/plain' || type === 'text/uri-list'; });
  }

  /** @brief 在拖放事件结束前读取文本和文件访问入口。 @param {DataTransfer} transfer 拖放数据。 @return {object} 快照。 */
  function snapshot(transfer) {
    if (!transfer) return { files: [], handles: [], text: '', rejectedDirectories: 0 };
    const items = Array.from(transfer.items || []).filter(function fileItem(item) { return item.kind === 'file'; });
    const files = [], handles = [];
    let rejectedDirectories = 0;
    items.forEach(function captureFile(item) {
      let file = null, entry = null, handle = Promise.resolve(null);
      try { file = item.getAsFile && item.getAsFile(); entry = typeof item.webkitGetAsEntry === 'function' ? item.webkitGetAsEntry() : null; }
      catch (error) { file = null; }
      // 文件夹没有稳定的单文件引用入口，不递归读取。
      if (entry && entry.isDirectory) { rejectedDirectories += 1; return; }
      try { if (typeof item.getAsFileSystemHandle === 'function') handle = Promise.resolve(item.getAsFileSystemHandle()).catch(function unavailableHandle() { return null; }); }
      catch (error) { handle = Promise.resolve(null); }
      if (file) { files.push(file); handles.push(handle); }
    });
    if (!files.length && !rejectedDirectories) Array.from(transfer.files || []).forEach(function fallbackFile(file) { files.push(file); handles.push(Promise.resolve(null)); });
    let text = '';
    if (typeof transfer.getData === 'function') {
      text = transfer.getData('text/plain') || String(transfer.getData('text/uri-list') || '').split(/\r?\n/).filter(function keepLink(line) { return line && !line.startsWith('#'); }).join('\n');
    }
    return { files: files, handles: handles, text: text, rejectedDirectories: rejectedDirectories };
  }

  /** @brief 获取本次附件的唯一标识。 @return {string} 标识。 */
  function createId() {
    return window.crypto && typeof window.crypto.randomUUID === 'function' ? window.crypto.randomUUID() : Date.now().toString(36) + '-' + Math.random().toString(36).slice(2);
  }

  /** @brief 将图片读为可随记录持久保存的内容。 @param {File} file 图片文件。 @return {Promise<object>} 图片附件。 */
  function readImage(file) {
    return new Promise(function readImagePromise(resolve, reject) {
      if (!IMAGE_TYPES.test(file.type)) { reject(new Error('支持 PNG、JPG、GIF、WebP 和 SVG 图片')); return; }
      if (file.size > MAX_IMAGE_BYTES) { reject(new Error('单张图片需小于 2 MB，请压缩后再添加')); return; }
      const reader = new FileReader();
      reader.onload = function imageLoaded() { resolve(window.SideNotesImages.register({ id: createId(), name: file.name || '拖入的图片.png', type: file.type, data: String(reader.result), inline: true })); };
      reader.onerror = function imageFailed() { reject(new Error('图片读取失败，请重新拖入')); };
      reader.onabort = function imageAborted() { reject(new Error('图片读取已取消')); };
      reader.readAsDataURL(file);
    });
  }

  /** @brief 转义 Markdown 链接文字，文件名不能注入其他内容。 @param {string} value 名称。 @return {string} 安全链接文字。 */
  function escapeLabel(value) {
    return String(value || '未命名文件').replace(/[\r\n]+/g, ' ').replace(/([\\\[\]])/g, '\\$1');
  }

  /** @brief 获取可读的文件错误，不让单个失败丢失其余内容。 @param {File} file 文件。 @param {Error} error 错误。 @return {string} 可显示提示。 */
  function fileError(file, error) {
    return (file && file.name ? file.name + '：' : '') + (error && error.message ? error.message : '文件读取失败，请重新拖入');
  }

  /* ==================== 对外入口 ==================== */

  /** @brief 准备拖入内容；同步抓取访问入口后再异步读取图片。 @param {DataTransfer} transfer 拖放数据。 @return {Promise<{text:string,images:object[],errors:string[]}>} 可插入的正文（图片与文件的引用各占一行）、图片内容及可显示的局部失败提示。 */
  async function prepare(transfer) {
    const captured = snapshot(transfer);
    const result = { text: '', images: [], errors: [] };
    if (captured.rejectedDirectories) result.errors.push('不支持拖入文件夹，请选择文件');
    if (!captured.files.length) { result.text = captured.rejectedDirectories ? '' : captured.text; return result; }
    const references = [];
    const handles = await Promise.all(captured.handles);
    const prepared = await Promise.allSettled(captured.files.map(async function prepareFile(file, index) {
      if (!file || typeof file.slice !== 'function') throw new Error('不支持拖入文件夹，请选择文件');
      const handle = handles[index] && handles[index].kind === 'file' ? handles[index] : null;
      if (handles[index] && handles[index].kind === 'directory') throw new Error('不支持拖入文件夹，请选择文件');
      // 图片与文件一样写进正文，插在光标处（与现有应用一致）；图片内容随记录保存，正文中是 sidenotes-image: 引用（见 app.js 的 SideNotesImages）。
      if (/^image\//i.test(file.type)) { const image = await readImage(file); return { image: image, reference: window.SideNotesImages.markdown(image) }; }
      const target = window.NoteContent.createFileReference(file, handle);
      return { reference: '[' + escapeLabel(file.name) + '](' + target + ')' };
    }));
    prepared.forEach(function collectFile(item, index) {
      if (item.status === 'rejected') { result.errors.push(fileError(captured.files[index], item.reason)); return; }
      if (item.value.image) result.images.push(item.value.image);
      references.push(item.value.reference);
    });
    result.text = references.join('\n');
    return result;
  }

  window.NoteDrop = Object.freeze({ accepts: accepts, prepare: prepare });
})();
