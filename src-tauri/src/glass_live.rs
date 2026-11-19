//! 磨砂玻璃的实时模糊（T118，技术决策第 49 条）。
//!
//! T101 的磨砂是截图：侧栏显示前截一次背后的屏幕，之后每两秒截一次，背后的画面在变（视频、色块跳动）时
//! 看不出磨砂跟着变。Windows 11 的合成器能直接取窗口背后的画面并模糊（宿主背景画刷 HostBackdropBrush，
//! 需要先给窗口打开 DWMWA_USE_HOSTBACKDROPBRUSH）：在侧栏窗口上挂一棵合成树（DesktopWindowTarget，
//! 放在 WebView 的下面），每一块（标题区与页签行、筛选行、整理提醒、新建卡片、记录卡片、底栏）各一个带圆角的
//! 视觉对象，用这种画刷画背后的画面；页面上各块的底色是半透明的，盖在上面就是磨砂玻璃。背后的画面怎么变，
//! 磨砂就怎么变，由系统合成，不截图、不占 CPU。块与块之间没有视觉对象，透出真实的桌面。
//!
//! 页面报告各块的位置（列表滚动、卡片增减、改宽度时，见 useLiveGlass），这里跟着摆：记录卡片放在一层按列表
//! 可见范围裁剪的容器里，滚出列表的部分不画。模糊的程度由系统决定（与令牌的 --sn-panel-blur 不完全一样）。
//! 系统不支持（Windows 10）或建不起来时页面退回截图的做法（glass.rs）。
//! 命令不是 async 的，Tauri 在主线程上执行，合成对象都在主线程上创建与修改。

use std::sync::atomic::{AtomicBool, Ordering};

use serde::Deserialize;
use tauri::WebviewWindow;

/// 实时模糊正在用：截图（glass.rs）这时不再截。
static ACTIVE: AtomicBool = AtomicBool::new(false);

/// 实时模糊是否正在用。
pub fn active() -> bool {
    ACTIVE.load(Ordering::SeqCst)
}

/// 一块：相对侧栏窗口内容区的物理像素与圆角半径。
#[derive(Debug, Clone, Copy, PartialEq, Deserialize)]
pub struct Block {
    pub x: f32,
    pub y: f32,
    pub width: f32,
    pub height: f32,
    #[serde(default)]
    pub radius: f32,
}

/// 页面报告的各块：列表之外的块、列表里的卡片与列表的可见范围（卡片按它裁剪）。
#[derive(Debug, Clone, PartialEq, Deserialize)]
pub struct GlassLayout {
    pub blocks: Vec<Block>,
    pub cards: Vec<Block>,
    pub viewport: Option<Block>,
}

/// 打开或关掉实时模糊（换到磨砂玻璃或换走时，页面调用），返回是否能用。打开失败时页面用截图。
#[tauri::command]
pub fn glass_live(window: WebviewWindow, enable: bool) -> bool {
    if window.label() != crate::windows::SIDEBAR_LABEL {
        return false;
    }
    let live = enable && imp::show(&window);
    if !enable {
        imp::hide();
    }
    ACTIVE.store(live, Ordering::SeqCst);
    live
}

/// 页面报告各块的位置（变了才报告）。
#[tauri::command]
pub fn glass_blocks(window: WebviewWindow, layout: GlassLayout) {
    if active() && window.label() == crate::windows::SIDEBAR_LABEL {
        imp::arrange(&layout);
    }
}

#[cfg(windows)]
mod imp {
    use std::cell::RefCell;

    use ::windows::core::{Interface, BOOL};
    use ::windows::System::DispatcherQueueController;
    use ::windows::UI::Composition::Desktop::DesktopWindowTarget;
    use ::windows::UI::Composition::{CompositionBackdropBrush, CompositionRoundedRectangleGeometry, Compositor, ContainerVisual, SpriteVisual};
    use ::windows::Win32::Graphics::Dwm::{DwmSetWindowAttribute, DWMWA_USE_HOSTBACKDROPBRUSH};
    use ::windows::Win32::System::WinRT::Composition::ICompositorDesktopInterop;
    use ::windows::Win32::System::WinRT::{CreateDispatcherQueueController, DispatcherQueueOptions, DQTAT_COM_NONE, DQTYPE_THREAD_CURRENT};
    use tauri::WebviewWindow;
    use windows_numerics::{Vector2, Vector3};

    use super::{Block, GlassLayout};

    /// 一块的视觉对象：用宿主背景画刷填充，按圆角矩形裁剪。
    struct Tile {
        sprite: SpriteVisual,
        shape: CompositionRoundedRectangleGeometry,
    }

    /// 侧栏窗口上的合成树。
    struct Live {
        /// 主线程原来没有调度队列时由这里建的，合成器要靠它（随进程退出）。
        _queue: Option<DispatcherQueueController>,
        compositor: Compositor,
        _target: DesktopWindowTarget,
        root: ContainerVisual,
        /// 记录卡片的容器：摆在列表的可见范围上，裁掉滚出列表的部分。
        list: ContainerVisual,
        brush: CompositionBackdropBrush,
        blocks: Vec<Tile>,
        cards: Vec<Tile>,
    }

    thread_local! {
        static LIVE: RefCell<Option<Live>> = const { RefCell::new(None) };
    }

    fn build(window: &WebviewWindow) -> ::windows::core::Result<Live> {
        let hwnd = window.hwnd().map_err(|_| ::windows::core::Error::from(::windows::Win32::Foundation::E_HANDLE))?;
        // Windows 11（22000）起才有这一项；更早的系统在这里失败，页面退回截图。
        let enable = BOOL::from(true);
        // SAFETY：指针指向本函数内的 BOOL，大小与之匹配。
        unsafe { DwmSetWindowAttribute(hwnd, DWMWA_USE_HOSTBACKDROPBRUSH, (&enable as *const BOOL).cast(), std::mem::size_of::<BOOL>() as u32)? };
        // 合成器要求所在线程有调度队列；主线程已经有了（别的组件建过）时建会失败，用原来的就行。
        let options = DispatcherQueueOptions {
            dwSize: std::mem::size_of::<DispatcherQueueOptions>() as u32,
            threadType: DQTYPE_THREAD_CURRENT,
            apartmentType: DQTAT_COM_NONE,
        };
        // SAFETY：在当前线程（主线程）上建调度队列，参数是本函数内的结构体。
        let queue = unsafe { CreateDispatcherQueueController(options) }.ok();
        let compositor = Compositor::new()?;
        let interop: ICompositorDesktopInterop = compositor.cast()?;
        // 第二个参数为 false：合成树画在窗口的子窗口（WebView）下面，页面盖在上面。
        // SAFETY：hwnd 来自仍然存在的侧栏窗口。
        let target = unsafe { interop.CreateDesktopWindowTarget(hwnd, false)? };
        let root = compositor.CreateContainerVisual()?;
        root.SetRelativeSizeAdjustment(Vector2 { X: 1.0, Y: 1.0 })?;
        target.SetRoot(&root)?;
        let list = compositor.CreateContainerVisual()?;
        list.SetClip(&compositor.CreateInsetClip()?)?;
        root.Children()?.InsertAtTop(&list)?;
        let brush = compositor.CreateHostBackdropBrush()?;
        Ok(Live { _queue: queue, compositor, _target: target, root, list, brush, blocks: Vec::new(), cards: Vec::new() })
    }

    /// 显示合成树（第一次时建起来），返回是否能用。
    pub fn show(window: &WebviewWindow) -> bool {
        LIVE.with(|slot| {
            let mut slot = slot.borrow_mut();
            if slot.is_none() {
                match build(window) {
                    Ok(live) => *slot = Some(live),
                    Err(error) => {
                        crate::diag::log(format!("磨砂玻璃的实时模糊不可用，改用截图：{error}"));
                        return false;
                    }
                }
            }
            slot.as_ref().is_some_and(|live| live.root.SetIsVisible(true).is_ok())
        })
    }

    /// 藏起合成树（换到别的主题）。
    pub fn hide() {
        LIVE.with(|slot| {
            if let Some(live) = slot.borrow().as_ref() {
                let _ = live.root.SetIsVisible(false);
            }
        });
    }

    fn tile(compositor: &Compositor, brush: &CompositionBackdropBrush, parent: &ContainerVisual) -> ::windows::core::Result<Tile> {
        let sprite = compositor.CreateSpriteVisual()?;
        sprite.SetBrush(brush)?;
        let shape = compositor.CreateRoundedRectangleGeometry()?;
        sprite.SetClip(&compositor.CreateGeometricClipWithGeometry(&shape)?)?;
        parent.Children()?.InsertAtTop(&sprite)?;
        Ok(Tile { sprite, shape })
    }

    fn place(tile: &Tile, block: &Block, origin: (f32, f32)) -> ::windows::core::Result<()> {
        let size = Vector2 { X: block.width.max(0.0), Y: block.height.max(0.0) };
        tile.sprite.SetOffset(Vector3 { X: block.x - origin.0, Y: block.y - origin.1, Z: 0.0 })?;
        tile.sprite.SetSize(size)?;
        tile.shape.SetSize(size)?;
        let radius = block.radius.clamp(0.0, size.X.min(size.Y) / 2.0);
        tile.shape.SetCornerRadius(Vector2 { X: radius, Y: radius })?;
        tile.sprite.SetIsVisible(true)
    }

    /// 让 `tiles` 与 `blocks` 一一对应：不够的补上，多出来的藏起来（留着下次用）。
    fn sync(
        compositor: &Compositor,
        brush: &CompositionBackdropBrush,
        parent: &ContainerVisual,
        tiles: &mut Vec<Tile>,
        blocks: &[Block],
        origin: (f32, f32),
    ) -> ::windows::core::Result<()> {
        while tiles.len() < blocks.len() {
            tiles.push(tile(compositor, brush, parent)?);
        }
        for (index, current) in tiles.iter().enumerate() {
            match blocks.get(index) {
                Some(block) => place(current, block, origin)?,
                None => current.sprite.SetIsVisible(false)?,
            }
        }
        Ok(())
    }

    /// 按页面报告的位置摆好各块。
    pub fn arrange(layout: &GlassLayout) {
        LIVE.with(|slot| {
            let mut slot = slot.borrow_mut();
            let Some(live) = slot.as_mut() else { return };
            let result = (|| -> ::windows::core::Result<()> {
                sync(&live.compositor, &live.brush, &live.root, &mut live.blocks, &layout.blocks, (0.0, 0.0))?;
                let viewport = layout.viewport.unwrap_or(Block { x: 0.0, y: 0.0, width: 0.0, height: 0.0, radius: 0.0 });
                live.list.SetOffset(Vector3 { X: viewport.x, Y: viewport.y, Z: 0.0 })?;
                live.list.SetSize(Vector2 { X: viewport.width.max(0.0), Y: viewport.height.max(0.0) })?;
                sync(&live.compositor, &live.brush, &live.list, &mut live.cards, &layout.cards, (viewport.x, viewport.y))
            })();
            if let Err(error) = result {
                crate::diag::log(format!("磨砂玻璃的实时模糊摆放失败：{error}"));
            }
        });
    }
}

#[cfg(not(windows))]
mod imp {
    use super::GlassLayout;
    use tauri::WebviewWindow;

    pub fn show(_window: &WebviewWindow) -> bool {
        false
    }

    pub fn hide() {}

    pub fn arrange(_layout: &GlassLayout) {}
}
