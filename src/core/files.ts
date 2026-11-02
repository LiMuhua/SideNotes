/**
 * 本地文件引用。
 *
 * 与原型的差异：浏览器拿不到文件完整路径，只能用 `sidenotes-file:` 标识并在
 * 刷新后失效；桌面端通过系统文件对话框取得真实绝对路径，引用可跨会话保留，
 * 并可用系统默认应用打开。旧备份中的 `sidenotes-file:` 标识仍可识别，
 * 但会标记为需要重新定位。
 */

/** 判断是否为原型遗留的浏览器文件标识。 */
export function isLegacyToken(value: string): boolean {
  return /^sidenotes-file:[a-z0-9-]+\?name=(?:[a-z0-9_.~-]|%[\da-f]{2})+$/i.test(String(value ?? '').trim());
}

/**
 * 取得绝对文件路径，兼容 Windows 盘符、UNC 与 file URL。
 *
 * 返回 null 表示该字符串不是本地文件引用（例如 http 链接）。
 */
export function filePath(value: string): string | null {
  const source = String(value ?? '').trim();
  if (!source) return null;
  if (isLegacyToken(source)) return source;
  // Windows 盘符路径与 UNC 共享路径。
  if (/^[a-z]:[\\/]/i.test(source) || /^\\\\[^\\]+\\/.test(source)) return source;
  // POSIX 绝对路径，供 Linux 构建使用。
  if (/^\/(?:[^/]|$)/.test(source) && !/^\/\//.test(source)) return source;
  if (!/^file:\/\//i.test(source)) return null;
  try {
    const url = new URL(source);
    const pathname = decodeURIComponent(url.pathname);
    if (url.hostname) return `\\\\${url.hostname}${pathname.replace(/\//g, '\\')}`;
    // file:///C:/… 去掉前导斜杠还原盘符。
    return /^\/[a-z]:/i.test(pathname)
      ? pathname.slice(1).replace(/\//g, '\\')
      : pathname;
  } catch {
    return null;
  }
}

/** 取得引用的显示名称。 */
export function fileLabel(value: string): string {
  const source = String(value ?? '').trim();
  if (isLegacyToken(source)) {
    try {
      return decodeURIComponent(source.slice(source.indexOf('?name=') + 6));
    } catch {
      return '所选文件';
    }
  }
  const path = filePath(source) ?? source;
  return path.split(/[\\/]/).pop() || source;
}

/** 转义 Markdown 链接文字，文件名不能注入其他语法。 */
export function escapeLabel(value: string): string {
  return String(value || '未命名文件')
    .replace(/[\r\n]+/g, ' ')
    .replace(/([\\[\]])/g, '\\$1');
}

/** 可以内嵌显示的图片扩展名。 */
const IMAGE_EXTENSION = /\.(?:png|jpe?g|gif|webp|bmp|avif|svg)$/i;

/** 文件名或路径是否为图片。 */
export function isImageName(value: string): boolean {
  return IMAGE_EXTENSION.test(String(value ?? '').trim());
}

/** 链接地址：路径含空白或括号时用尖括号包住，避免括号提前结束链接。 */
function linkAddress(path: string): string {
  return /[\s()]/.test(path) ? `<${path}>` : path;
}

/** 把绝对路径包装成 Markdown 链接。 */
export function toMarkdownReference(path: string, name?: string): string {
  const label = escapeLabel(name || fileLabel(path));
  return `[${label}](${linkAddress(path)})`;
}

/** 把字节数写成便于阅读的大小，如 812 B、3.4 KB、12.5 MB。 */
export function formatBytes(bytes: number): string {
  const value = Math.max(0, Number(bytes) || 0);
  if (value < 1024) return `${value} B`;
  const units = ['KB', 'MB', 'GB'];
  let size = value / 1024;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }
  return `${size >= 100 ? Math.round(size) : Number(size.toFixed(1))} ${units[unit]}`;
}

/** 把图片路径包装成 Markdown 内嵌图片。 */
export function toMarkdownImage(path: string, name?: string): string {
  const label = escapeLabel(name || fileLabel(path)).replace(/\.[^.]+$/, '');
  return `![${label}](${linkAddress(path)})`;
}
