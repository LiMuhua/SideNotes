//! 判断前台是否为全屏程序（T75）。
//!
//! 全屏的游戏、视频与演示在前台时，指针移到屏幕边缘不唤出侧栏：侧栏置顶并抢走焦点，独占全屏的游戏会因此退回桌面，
//! 无边框全屏的游戏与视频也会被盖住一条。快捷键与托盘照常唤出（不经过这里），退出全屏后贴边恢复——
//! 贴边轮询每次重新判断，不保存状态。
//!
//! 两种判断互补：
//! - 系统的用户通知状态（`SHQueryUserNotificationState`）：独占全屏的 Direct3D 程序与演示模式。
//!   这两种状态不区分显示器，出现时所有屏幕的边缘都不唤出（独占全屏时切走焦点就会让游戏退回桌面）。
//! - 前台窗口盖住所在显示器的整个矩形（无边框全屏的游戏、浏览器与播放器的全屏）：只挡住这块屏幕的边缘。
//!   桌面与任务栏等外壳窗口、本应用自己的窗口不算；最大化的窗口在任务栏自动隐藏时也会盖住整块屏幕，同样不算。

/// 窗口或显示器的矩形：左、上、右、下（物理像素）。
pub type Rect = (i32, i32, i32, i32);

/// 窗口是否盖住显示器的整个矩形。全屏窗口通常与显示器矩形完全重合，个别程序会超出一点，所以按「包含」判断。
pub fn covers_monitor(window: Rect, monitor: Rect) -> bool {
    window.0 <= monitor.0 && window.1 <= monitor.1 && window.2 >= monitor.2 && window.3 >= monitor.3
}

/// 外壳窗口的类名：桌面（Progman、WorkerW）与任务栏。它们本来就铺满屏幕，获得焦点时不算全屏程序。
pub fn is_shell_class(class: &str) -> bool {
    matches!(class, "Progman" | "WorkerW" | "Shell_TrayWnd" | "Shell_SecondaryTrayWnd")
}

/// 前台窗口是否按全屏程序对待：盖住整块屏幕、不是外壳窗口，也不是最大化的普通窗口。
pub fn is_fullscreen_window(covers: bool, shell: bool, zoomed: bool) -> bool {
    covers && !shell && !zoomed
}

/// 指针所在的屏幕是否被全屏程序占用，占用时贴边不唤出侧栏。
/// `x`、`y` 是指针的物理坐标（与 `GetCursorPos` 相同）。读取失败时按「没有全屏程序」处理，不挡住贴边唤出。
#[cfg(windows)]
pub fn blocks_edge(x: f64, y: f64) -> bool {
    use windows::Win32::Foundation::{POINT, RECT};
    use windows::Win32::Graphics::Gdi::{
        GetMonitorInfoW, MonitorFromPoint, MonitorFromWindow, MONITORINFO, MONITOR_DEFAULTTONEAREST, MONITOR_DEFAULTTONULL,
    };
    use windows::Win32::System::Threading::GetCurrentProcessId;
    use windows::Win32::UI::Shell::{SHQueryUserNotificationState, QUNS_PRESENTATION_MODE, QUNS_RUNNING_D3D_FULL_SCREEN};
    use windows::Win32::UI::WindowsAndMessaging::{
        GetClassNameW, GetForegroundWindow, GetWindowRect, GetWindowThreadProcessId, IsZoomed,
    };

    // SAFETY: 以下均为只读查询，传入的句柄来自系统调用，缓冲区与结构体都在栈上并给出了正确的大小。
    unsafe {
        if let Ok(state) = SHQueryUserNotificationState() {
            if state == QUNS_RUNNING_D3D_FULL_SCREEN || state == QUNS_PRESENTATION_MODE {
                return true;
            }
        }

        let foreground = GetForegroundWindow();
        if foreground.is_invalid() {
            return false;
        }
        let mut process = 0u32;
        GetWindowThreadProcessId(foreground, Some(&mut process));
        if process == GetCurrentProcessId() {
            return false;
        }
        let mut buffer = [0u16; 64];
        let length = GetClassNameW(foreground, &mut buffer).max(0) as usize;
        let class = String::from_utf16_lossy(&buffer[..length]);

        let mut window = RECT::default();
        if GetWindowRect(foreground, &mut window).is_err() {
            return false;
        }
        let monitor = MonitorFromWindow(foreground, MONITOR_DEFAULTTONULL);
        if monitor.is_invalid() {
            return false;
        }
        let mut info = MONITORINFO { cbSize: std::mem::size_of::<MONITORINFO>() as u32, ..Default::default() };
        if !GetMonitorInfoW(monitor, &mut info).as_bool() {
            return false;
        }
        let bounds = info.rcMonitor;
        let covers = covers_monitor(
            (window.left, window.top, window.right, window.bottom),
            (bounds.left, bounds.top, bounds.right, bounds.bottom),
        );
        if !is_fullscreen_window(covers, is_shell_class(&class), IsZoomed(foreground).as_bool()) {
            return false;
        }
        // 只挡住全屏程序所在的那块屏幕：另一块屏幕的外沿照常唤出。
        let cursor = MonitorFromPoint(POINT { x: x.round() as i32, y: y.round() as i32 }, MONITOR_DEFAULTTONEAREST);
        cursor == monitor
    }
}

/// 非 Windows 平台没有贴边唤出的全屏判断，一律不挡。
#[cfg(not(windows))]
pub fn blocks_edge(_x: f64, _y: f64) -> bool {
    false
}

#[cfg(test)]
mod tests {
    use super::*;

    const MONITOR: Rect = (0, 0, 3840, 2160);

    #[test]
    fn a_window_matching_or_exceeding_the_monitor_covers_it() {
        assert!(covers_monitor(MONITOR, MONITOR));
        assert!(covers_monitor((-8, -8, 3848, 2168), MONITOR));
        // 副屏在左侧、坐标为负时同样按包含判断。
        assert!(covers_monitor((-1600, 0, 0, 2560), (-1600, 0, 0, 2560)));
    }

    #[test]
    fn a_window_leaving_part_of_the_monitor_does_not_cover_it() {
        // 任务栏可见时最大化的窗口：底部留出任务栏。
        assert!(!covers_monitor((-8, -8, 3848, 2088), MONITOR));
        assert!(!covers_monitor((0, 0, 1920, 1080), MONITOR));
    }

    #[test]
    fn shell_windows_and_maximized_windows_are_not_fullscreen_programs() {
        assert!(is_shell_class("Progman"));
        assert!(is_shell_class("WorkerW"));
        assert!(is_shell_class("Shell_TrayWnd"));
        assert!(!is_shell_class("Chrome_WidgetWin_1"));
        assert!(is_fullscreen_window(true, false, false));
        // 桌面获得焦点时铺满屏幕，不算。
        assert!(!is_fullscreen_window(true, true, false));
        // 任务栏自动隐藏时最大化的窗口也盖住整块屏幕，不算。
        assert!(!is_fullscreen_window(true, false, true));
        assert!(!is_fullscreen_window(false, false, false));
    }
}
