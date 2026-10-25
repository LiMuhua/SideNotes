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

/** 把绝对路径包装成 Markdown 链接。 */
export function toMarkdownReference(path: string, name?: string): string {
  const label = escapeLabel(name || fileLabel(path));
  return `[${label}](${path})`;
}
