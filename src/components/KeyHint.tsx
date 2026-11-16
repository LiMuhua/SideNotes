/**
 * 写在界面上的快捷键（终端主题显示，其余主题隐藏，见 theme.css 的 .key-hint 与 data-sn-shortcuts）。
 *
 * 按键随设置中的绑定变化；只是视觉提示，读屏用按钮自己的名称。
 */

/** 把按键组合（如 Ctrl+Enter）写成几个按键帽。 */
export function KeyHint({ combo }: { combo: string }) {
  if (!combo) return null;
  // 「Ctrl++」这类以加号为按键的组合：末尾的空段就是加号本身。
  const keys = combo.split('+').reduce<string[]>((list, key, index, all) => {
    if (key) list.push(key);
    else if (index === all.length - 1) list.push('+');
    return list;
  }, []);
  return (
    <span className="key-hint" aria-hidden="true">
      {keys.map((key, index) => (
        <kbd key={`${key}-${index}`}>{key}</kbd>
      ))}
    </span>
  );
}
