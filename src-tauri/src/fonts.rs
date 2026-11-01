//! 系统字体枚举，供设置页的字体下拉框列出候选。

/// 系统已安装的字体族名称，按名称排序并去重；读取失败时返回空列表。
///
/// Windows 上经 DirectWrite 读取系统字体集合（含当前用户安装的字体），
/// 取英文名称，没有英文名称时取第一个本地化名称。WebView2 按 font-family 匹配字体时
/// 认的就是这些名称，选中后可以直接用于 CSS。不需要网页的字体访问授权。
#[cfg(windows)]
pub fn system_families() -> Vec<String> {
    use ::windows::core::{w, BOOL};
    use ::windows::Win32::Graphics::DirectWrite::{
        DWriteCreateFactory, IDWriteFactory, IDWriteFontCollection, DWRITE_FACTORY_TYPE_SHARED,
    };

    let read = || -> ::windows::core::Result<Vec<String>> {
        // SAFETY：只调用 DirectWrite 的查询接口；输出参数指向本函数内的变量，
        // 名称缓冲区按接口返回的长度（另加结尾的空字符）分配。
        unsafe {
            let factory: IDWriteFactory = DWriteCreateFactory(DWRITE_FACTORY_TYPE_SHARED)?;
            let mut collection: Option<IDWriteFontCollection> = None;
            factory.GetSystemFontCollection(&mut collection, false)?;
            let Some(collection) = collection else {
                return Ok(Vec::new());
            };
            let mut names = Vec::new();
            for index in 0..collection.GetFontFamilyCount() {
                let Ok(family) = collection.GetFontFamily(index) else {
                    continue;
                };
                let Ok(localized) = family.GetFamilyNames() else {
                    continue;
                };
                let mut position = 0u32;
                let mut exists = BOOL::default();
                if localized.FindLocaleName(w!("en-us"), &mut position, &mut exists).is_err() || !exists.as_bool() {
                    position = 0;
                }
                let Ok(length) = localized.GetStringLength(position) else {
                    continue;
                };
                let mut buffer = vec![0u16; length as usize + 1];
                if localized.GetString(position, &mut buffer).is_err() {
                    continue;
                }
                let name = String::from_utf16_lossy(&buffer[..length as usize]);
                if !name.trim().is_empty() {
                    names.push(name);
                }
            }
            Ok(names)
        }
    };
    let mut names = read().unwrap_or_default();
    names.sort_by_key(|name| name.to_lowercase());
    names.dedup_by_key(|name| name.to_lowercase());
    names
}

/// 其它平台暂不读取系统字体，设置页只列出常用字体，仍可直接输入字体名。
#[cfg(not(windows))]
pub fn system_families() -> Vec<String> {
    Vec::new()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    #[cfg(windows)]
    fn lists_common_windows_fonts() {
        let names = system_families();
        // 任何 Windows 都带有 Segoe UI 与 Arial；结果已按名称排序且没有重复。
        assert!(names.iter().any(|name| name == "Segoe UI"), "{names:?}");
        assert!(names.iter().any(|name| name == "Arial"));
        let mut sorted = names.clone();
        sorted.sort_by_key(|name| name.to_lowercase());
        assert_eq!(names, sorted);
    }
}
