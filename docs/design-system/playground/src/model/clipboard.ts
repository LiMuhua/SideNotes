/**
 * 写入剪贴板；浏览器拒绝时退回到隐藏文本框加 execCommand。
 * Playground 只写入文字（记录的 Markdown 原文），不复制附件文件。
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const field = document.createElement('textarea');
    field.value = text;
    field.setAttribute('readonly', '');
    field.style.position = 'fixed';
    field.style.opacity = '0';
    document.body.appendChild(field);
    field.select();
    // execCommand 已不推荐使用，这里只作为剪贴板接口不可用时的兜底。
    const done = document.execCommand('copy');
    field.remove();
    return done;
  }
}
