/**
 * ICO 文件（T85）：把几张 PNG 打包成一个 Windows 图标文件。
 *
 * Windows Vista 起 ICO 中的每一项都可以直接是 PNG。文件结构：
 * - 文件头 6 字节：保留字 0、类型 1（图标）、项数；
 * - 每项 16 字节的目录：宽、高（256 记为 0）、色数 0、保留 0、色彩平面 1、每像素 32 位、数据长度、数据偏移；
 * - 之后依次是各项的 PNG 数据。
 *
 * 上传的自定义图标按清单的 icoSizes 生成 `custom.ico`，开始菜单与桌面快捷方式指向它（adaptation.md 第十节）。
 */

/** ICO 中的一项。 */
export interface IcoEntry {
  /** 边长（像素），1–256。 */
  size: number;
  /** 这一尺寸的 PNG 文件内容。 */
  png: Uint8Array;
}

const HEADER_SIZE = 6;
const ENTRY_SIZE = 16;

/** 打包成 ICO；没有项、项数过多或尺寸超出 1–256 时抛出错误。 */
export function buildIco(entries: readonly IcoEntry[]): Uint8Array {
  if (entries.length === 0 || entries.length > 0xffff) throw new Error('ICO 的项数应为 1–65535');
  const dataStart = HEADER_SIZE + entries.length * ENTRY_SIZE;
  const total = entries.reduce((sum, entry) => sum + entry.png.length, dataStart);
  const bytes = new Uint8Array(total);
  const view = new DataView(bytes.buffer);
  view.setUint16(0, 0, true);
  view.setUint16(2, 1, true);
  view.setUint16(4, entries.length, true);
  let offset = dataStart;
  entries.forEach((entry, index) => {
    if (!Number.isInteger(entry.size) || entry.size < 1 || entry.size > 256) throw new Error(`ICO 不支持 ${entry.size} 像素的图标`);
    const at = HEADER_SIZE + index * ENTRY_SIZE;
    // 一个字节放不下 256，按格式记为 0。
    const side = entry.size === 256 ? 0 : entry.size;
    view.setUint8(at, side);
    view.setUint8(at + 1, side);
    view.setUint8(at + 2, 0);
    view.setUint8(at + 3, 0);
    view.setUint16(at + 4, 1, true);
    view.setUint16(at + 6, 32, true);
    view.setUint32(at + 8, entry.png.length, true);
    view.setUint32(at + 12, offset, true);
    bytes.set(entry.png, offset);
    offset += entry.png.length;
  });
  return bytes;
}
