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
//! 可见范围裁剪的容器里，滚出列表的部分不画。系统不支持（Windows 10）或建不起来时页面退回截图的做法（glass.rs）。
//!
//! 质感（T124，2026-11-19 用户要求，参考 Glance 的磨砂玻璃）：宿主背景本身只是系统亚克力那一档模糊，背后的画面
//! 还看得出形状，颜色也偏灰。照 Glance（github.com/lulu-loopp/glance，MIT）的做法，在它上面再叠合成器的效果：
//! 先按饱和度的令牌调饱和度（颜色矩阵），再按模糊的令牌 --sn-panel-blur 做一次高斯模糊（边缘按硬边处理，
//! 块的边上不会因为模糊到外面的透明而发暗）。效果用 Direct2D 效果的编号与参数描述，交给合成器在 GPU 上算。
//! 合成器不支持某个效果时依次退回只模糊、只用宿主背景。
//! 命令不是 async 的，Tauri 在主线程上执行，合成对象都在主线程上创建与修改。
//!
//! 磨砂玻璃的记录窗口（第八轮反馈 2）也用这里：窗口全透明，页面自己画主题的大圆角与边框，后端在窗口下面摆一块
//! 同样圆角的实时模糊。原来用系统的亚克力，系统只给窗口画 8 像素的小圆角，展开全文时副本是卡片的大圆角，换成真正的
//! 窗口时一下子变成小圆角。每个窗口各有一棵合成树，合成器与调度队列共用一份。

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;

use serde::Deserialize;
use tauri::{Manager, WebviewWindow};

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

/// 叠在宿主背景上的效果：再模糊多少（标准差，物理像素）与饱和度（1 为不变）。页面按令牌换算好交过来。
#[derive(Debug, Clone, Copy, PartialEq, Deserialize)]
pub struct Frost {
    pub blur: f32,
    pub saturate: f32,
}

/// 打开或关掉实时模糊（换到磨砂玻璃或换走时，页面调用），返回是否能用。侧栏打开失败时页面用截图，记录窗口用系统的亚克力。
#[tauri::command]
pub fn glass_live(window: WebviewWindow, enable: bool, frost: Option<Frost>) -> bool {
    let sidebar = window.label() == crate::windows::SIDEBAR_LABEL;
    if !sidebar && !crate::note_windows::is_note(window.label()) {
        return false;
    }
    let frost = frost.unwrap_or(Frost { blur: 0.0, saturate: 1.0 });
    let live = enable && imp::show(&window, frost);
    if !enable {
        imp::hide(window.label());
    }
    if sidebar {
        ACTIVE.store(live, Ordering::SeqCst);
        // 实时模糊打开期间定时量一次背后的明暗，页面按它调块的着色（T131，见 glass::watch_tone）；关掉时停下。
        crate::glass::watch_tone(window.app_handle(), live);
    }
    live
}

/// 页面报告各块的位置（变了才报告）。
#[tauri::command]
pub fn glass_blocks(window: WebviewWindow, layout: GlassLayout) {
    let sidebar = window.label() == crate::windows::SIDEBAR_LABEL;
    if sidebar && !active() {
        return;
    }
    imp::arrange(window.label(), &layout);
    if sidebar {
        if let Ok(mut slot) = LAYOUT.lock() {
            *slot = Some(layout);
        }
    }
}

/// 记录窗口销毁后拆掉它的合成树（主线程上调用）。
pub fn forget(label: &str) {
    imp::forget(label);
}

/// 记录窗口显示出来以后：合成树是在窗口藏着时建的（备用窗口），宿主背景画成一片黑，重建一次。交给主线程执行。
pub fn refresh_later(window: &WebviewWindow) {
    let handle = window.clone();
    let _ = window.run_on_main_thread(move || imp::refresh(&handle));
}

/// 磨砂玻璃的记录窗口改了大小（后端摆放、按内容伸缩的每一帧）：整个窗口那一块跟着变，不等页面量出来再报告
/// （页面藏着时不量，伸缩时晚一两帧，下边露出一条没有磨砂的）。交给主线程执行。
pub fn fit_window(window: &WebviewWindow, width: f64, height: f64) {
    let label = window.label().to_string();
    let apply = move || imp::fit_window(&label, width as f32, height as f32);
    if on_window_thread(window) {
        apply();
    } else {
        let _ = window.run_on_main_thread(apply);
    }
}

/// 窗口的实时模糊叠的效果（令牌的模糊与饱和度）；没有实时模糊时为空（主线程上调用）。打开记录窗口时按它把截图
/// 模糊成实时模糊的样子（glass::window_backdrop）。
pub fn frost(window: &WebviewWindow) -> Option<Frost> {
    imp::frost(window.label())
}

/// 记录窗口显示之前：藏着时建的合成树先藏起（不然显示的第一帧画出一片黑），显示之后由 refresh_later 重建。
/// 在主线程上时直接执行，否则交给主线程（排在之后的显示前面）。
pub fn hide_stale(window: &WebviewWindow) {
    if on_window_thread(window) {
        imp::hide_stale(window.label());
        return;
    }
    let label = window.label().to_string();
    let _ = window.run_on_main_thread(move || imp::hide_stale(&label));
}

/// 当前线程是不是窗口所在的线程（主线程）。
fn on_window_thread(window: &WebviewWindow) -> bool {
    #[cfg(windows)]
    if let Ok(hwnd) = window.hwnd() {
        use ::windows::Win32::System::Threading::GetCurrentThreadId;
        use ::windows::Win32::UI::WindowsAndMessaging::GetWindowThreadProcessId;
        // SAFETY：只读查询窗口所属的线程。
        return unsafe { GetWindowThreadProcessId(hwnd, None) } == unsafe { GetCurrentThreadId() };
    }
    let _ = window;
    false
}

/// 最近一次报告的各块（明暗测量只取块与块之间露出的桌面，见 glass::watch_tone）。
static LAYOUT: Mutex<Option<GlassLayout>> = Mutex::new(None);

/// 最近一次报告的各块位置。
pub fn last_layout() -> Option<GlassLayout> {
    LAYOUT.lock().ok().and_then(|slot| slot.clone())
}

/// 退出前拆掉实时模糊（第七轮反馈 P2：磨砂玻璃主题下从托盘退出时，系统弹出「Unknown Hard Error」）。
///
/// 合成树与本模块建的调度队列放在主线程的线程局部变量里，原来随进程退出才释放：那时窗口已经销毁、别的线程已被结束，
/// 释放发生在加载器锁之下，系统的合成组件随即报错（2026-11-20 验证版实测：磨砂玻璃下退出必现，没打开过实时模糊的
/// 终端主题退出正常）。所以退出前在主线程上、窗口还在时依次关掉：先藏起并关掉合成对象，再关掉调度队列。
/// 调度队列的关闭是异步的，要靠主线程的消息循环走完；返回 true 时调用方等一小会儿再退出。必须在主线程上调用。
pub fn shutdown() -> bool {
    ACTIVE.store(false, Ordering::SeqCst);
    crate::glass::watch_tone_stop();
    imp::shutdown()
}

/// 调饱和度的颜色矩阵（Direct2D 的 5 × 4 矩阵，行是输入的 R、G、B、A 与常数项，列是输出）：
/// 按亮度（Rec. 709 的权重）把颜色往灰拉（小于 1）或往外推（大于 1），`saturate` 为 1 时不变。
#[cfg_attr(not(windows), allow(dead_code))]
fn saturation_matrix(saturate: f32) -> [f32; 20] {
    let (r, g, b) = (0.2126, 0.7152, 0.0722);
    let keep = 1.0 - saturate;
    #[rustfmt::skip]
    let matrix = [
        r * keep + saturate, r * keep, r * keep, 0.0,
        g * keep, g * keep + saturate, g * keep, 0.0,
        b * keep, b * keep, b * keep + saturate, 0.0,
        0.0, 0.0, 0.0, 1.0,
        0.0, 0.0, 0.0, 0.0,
    ];
    matrix
}

#[cfg(windows)]
mod imp {
    use std::cell::RefCell;
    use std::mem::ManuallyDrop;

    use super::{Block, Frost, GlassLayout};
    use tauri::WebviewWindow;

    use ::windows::core::{implement, Interface, Result, BOOL, GUID, HSTRING, PCWSTR};
    use ::windows::Foundation::{IPropertyValue, PropertyValue};
    use ::windows::Graphics::Effects::{IGraphicsEffect, IGraphicsEffect_Impl, IGraphicsEffectSource, IGraphicsEffectSource_Impl};
    use ::windows::System::DispatcherQueueController;
    use ::windows::UI::Composition::Desktop::DesktopWindowTarget;
    use ::windows::UI::Composition::{
        CompositionBrush, CompositionEffectSourceParameter, CompositionRoundedRectangleGeometry, Compositor, ContainerVisual, SpriteVisual,
    };
    use ::windows::Win32::Foundation::{E_BOUNDS, E_INVALIDARG};
    use ::windows::Win32::Graphics::Direct2D::{CLSID_D2D1ColorMatrix, CLSID_D2D1GaussianBlur};
    use ::windows::Win32::Graphics::Dwm::{DwmSetWindowAttribute, DWMWA_USE_HOSTBACKDROPBRUSH};
    use ::windows::Win32::System::WinRT::Composition::ICompositorDesktopInterop;
    use ::windows::Win32::System::WinRT::Graphics::Direct2D::{
        IGraphicsEffectD2D1Interop, IGraphicsEffectD2D1Interop_Impl, GRAPHICS_EFFECT_PROPERTY_MAPPING,
    };
    use ::windows::Win32::System::WinRT::{CreateDispatcherQueueController, DispatcherQueueOptions, DQTAT_COM_NONE, DQTYPE_THREAD_CURRENT};
    use windows_numerics::{Vector2, Vector3};

    /// 交给合成器的一个效果：Direct2D 效果的编号、按编号顺序的参数与一个输入（写法同 Glance 的 ui/glass.rs）。
    #[implement(IGraphicsEffect, IGraphicsEffectSource, IGraphicsEffectD2D1Interop)]
    struct Effect {
        id: GUID,
        properties: Vec<IPropertyValue>,
        source: IGraphicsEffectSource,
    }

    impl IGraphicsEffect_Impl for Effect_Impl {
        fn Name(&self) -> Result<HSTRING> {
            Ok(HSTRING::new())
        }

        fn SetName(&self, _name: &HSTRING) -> Result<()> {
            Ok(())
        }
    }

    impl IGraphicsEffectSource_Impl for Effect_Impl {}

    impl IGraphicsEffectD2D1Interop_Impl for Effect_Impl {
        fn GetEffectId(&self) -> Result<GUID> {
            Ok(self.id)
        }

        fn GetNamedPropertyMapping(&self, _name: &PCWSTR, _index: *mut u32, _mapping: *mut GRAPHICS_EFFECT_PROPERTY_MAPPING) -> Result<()> {
            Err(E_INVALIDARG.into())
        }

        fn GetPropertyCount(&self) -> Result<u32> {
            Ok(self.properties.len() as u32)
        }

        fn GetProperty(&self, index: u32) -> Result<IPropertyValue> {
            self.properties.get(index as usize).cloned().ok_or_else(|| E_BOUNDS.into())
        }

        fn GetSource(&self, index: u32) -> Result<IGraphicsEffectSource> {
            if index == 0 {
                Ok(self.source.clone())
            } else {
                Err(E_BOUNDS.into())
            }
        }

        fn GetSourceCount(&self) -> Result<u32> {
            Ok(1)
        }
    }

    fn single(value: f32) -> Result<IPropertyValue> {
        PropertyValue::CreateSingle(value)?.cast()
    }

    fn whole(value: u32) -> Result<IPropertyValue> {
        PropertyValue::CreateUInt32(value)?.cast()
    }

    /// 宿主背景叠上效果的画刷：`saturate` 为真时先过颜色矩阵，`blur` 大于 0 时再高斯模糊。
    fn frosted(compositor: &Compositor, frost: Frost, saturate: bool) -> Result<CompositionBrush> {
        let mut effect: IGraphicsEffectSource = CompositionEffectSourceParameter::Create(&HSTRING::from("backdrop"))?.cast()?;
        if saturate {
            let matrix: IPropertyValue = PropertyValue::CreateSingleArray(&super::saturation_matrix(frost.saturate))?.cast()?;
            let clamp: IPropertyValue = PropertyValue::CreateBoolean(true)?.cast()?;
            // 参数按 Direct2D 颜色矩阵效果的编号：矩阵、透明度模式（1 预乘）、是否截断输出。
            let colored: IGraphicsEffect = Effect { id: CLSID_D2D1ColorMatrix, properties: vec![matrix, whole(1)?, clamp], source: effect }.into();
            effect = colored.cast()?;
        }
        if frost.blur > 0.0 {
            // 高斯模糊的参数：标准差、优化方式（1 平衡）、边缘处理（1 硬边）。
            let blurred: IGraphicsEffect =
                Effect { id: CLSID_D2D1GaussianBlur, properties: vec![single(frost.blur)?, whole(1)?, whole(1)?], source: effect }.into();
            effect = blurred.cast()?;
        }
        let description: IGraphicsEffect = effect.cast()?;
        let brush = compositor.CreateEffectFactory(&description)?.CreateBrush()?;
        brush.SetSourceParameter(&HSTRING::from("backdrop"), &compositor.CreateHostBackdropBrush()?)?;
        brush.cast()
    }

    /// 按 `frost` 建画刷：效果用不了时依次退回只模糊、只用宿主背景。
    fn brush_for(compositor: &Compositor, frost: Frost) -> Result<CompositionBrush> {
        let saturate = (frost.saturate - 1.0).abs() > 0.001;
        if saturate || frost.blur > 0.0 {
            match frosted(compositor, frost, saturate) {
                Ok(brush) => return Ok(brush),
                Err(error) => crate::diag::log(format!("磨砂玻璃的效果不可用：{error}")),
            }
            if saturate && frost.blur > 0.0 {
                match frosted(compositor, frost, false) {
                    Ok(brush) => return Ok(brush),
                    Err(error) => crate::diag::log(format!("磨砂玻璃的模糊效果不可用：{error}")),
                }
            }
        }
        compositor.CreateHostBackdropBrush()?.cast()
    }

    /// 一块的视觉对象：用宿主背景画刷填充，按圆角矩形裁剪。
    struct Tile {
        sprite: SpriteVisual,
        shape: CompositionRoundedRectangleGeometry,
    }

    /// 各窗口共用的合成器。
    struct Shared {
        /// 主线程原来没有调度队列时由这里建的，合成器要靠它（随进程退出）。
        _queue: Option<DispatcherQueueController>,
        compositor: Compositor,
    }

    /// 一个窗口上的合成树（侧栏或磨砂玻璃的记录窗口）。
    struct Live {
        _target: DesktopWindowTarget,
        root: ContainerVisual,
        /// 记录卡片的容器：摆在列表的可见范围上，裁掉滚出列表的部分（只有侧栏用）。
        list: ContainerVisual,
        brush: CompositionBrush,
        /// 画刷按它建的：页面换了令牌（换主题明暗、换屏幕缩放）时重建。
        frost: Frost,
        blocks: Vec<Tile>,
        cards: Vec<Tile>,
        /// 建的时候窗口是显示着的。藏着的窗口（备用的记录窗口）上建的合成树，宿主背景画出来是一片黑（2026-11-20 验证版
        /// 实测），显示出来以后要重建一次（refresh）。
        built_visible: bool,
        /// 最近一次摆放的各块，重建后照着再摆。
        layout: Option<GlassLayout>,
    }

    thread_local! {
        /// 合成器与各窗口（按标签）的合成树。用 ManuallyDrop 包着：线程局部变量的析构在进程退出时、加载器锁之下才跑，
        /// 那时释放合成对象会让系统报错（见 super::shutdown）；正常退出前已经由 shutdown 依次关掉，万一走了别的退出路径
        /// 就留给系统回收。
        static SHARED: RefCell<Option<ManuallyDrop<Shared>>> = const { RefCell::new(None) };
        static LIVES: RefCell<Vec<(String, ManuallyDrop<Live>)>> = const { RefCell::new(Vec::new()) };
    }

    /// 共用的合成器（第一次时建起来）。
    fn shared() -> Result<Compositor> {
        SHARED.with(|slot| {
            let mut slot = slot.borrow_mut();
            if let Some(shared) = slot.as_deref() {
                return Ok(shared.compositor.clone());
            }
            // 合成器要求所在线程有调度队列；主线程已经有了（别的组件建过）时建会失败，用原来的就行。
            let options = DispatcherQueueOptions {
                dwSize: std::mem::size_of::<DispatcherQueueOptions>() as u32,
                threadType: DQTYPE_THREAD_CURRENT,
                apartmentType: DQTAT_COM_NONE,
            };
            // SAFETY：在当前线程（主线程）上建调度队列，参数是本函数内的结构体。
            let queue = unsafe { CreateDispatcherQueueController(options) }.ok();
            let compositor = Compositor::new()?;
            *slot = Some(ManuallyDrop::new(Shared { _queue: queue, compositor: compositor.clone() }));
            Ok(compositor)
        })
    }

    fn build(window: &WebviewWindow, compositor: &Compositor, frost: Frost) -> Result<Live> {
        let hwnd = window.hwnd().map_err(|_| ::windows::core::Error::from(::windows::Win32::Foundation::E_HANDLE))?;
        // Windows 11（22000）起才有这一项；更早的系统在这里失败，页面退回截图或亚克力。
        let enable = BOOL::from(true);
        // SAFETY：指针指向本函数内的 BOOL，大小与之匹配。
        unsafe { DwmSetWindowAttribute(hwnd, DWMWA_USE_HOSTBACKDROPBRUSH, (&enable as *const BOOL).cast(), std::mem::size_of::<BOOL>() as u32)? };
        let interop: ICompositorDesktopInterop = compositor.cast()?;
        // 第二个参数为 false：合成树画在窗口的子窗口（WebView）下面，页面盖在上面。
        // SAFETY：hwnd 来自仍然存在的窗口。
        let target = unsafe { interop.CreateDesktopWindowTarget(hwnd, false)? };
        let root = compositor.CreateContainerVisual()?;
        root.SetRelativeSizeAdjustment(Vector2 { X: 1.0, Y: 1.0 })?;
        target.SetRoot(&root)?;
        let list = compositor.CreateContainerVisual()?;
        list.SetClip(&compositor.CreateInsetClip()?)?;
        root.Children()?.InsertAtTop(&list)?;
        let brush = brush_for(compositor, frost)?;
        let built_visible = window.is_visible().unwrap_or(false);
        Ok(Live { _target: target, root, list, brush, frost, blocks: Vec::new(), cards: Vec::new(), built_visible, layout: None })
    }

    /// 显示窗口的合成树（第一次时建起来），返回是否能用。效果的参数变了时换画刷。
    pub fn show(window: &WebviewWindow, frost: Frost) -> bool {
        let label = window.label().to_string();
        let compositor = match shared() {
            Ok(compositor) => compositor,
            Err(error) => {
                crate::diag::log(format!("磨砂玻璃的实时模糊不可用：{error}"));
                return false;
            }
        };
        LIVES.with(|lives| {
            let mut lives = lives.borrow_mut();
            if !lives.iter().any(|(item, _)| *item == label) {
                match build(window, &compositor, frost) {
                    Ok(live) => lives.push((label.clone(), ManuallyDrop::new(live))),
                    Err(error) => {
                        crate::diag::log(format!("窗口 {label} 的实时模糊不可用：{error}"));
                        return false;
                    }
                }
            }
            let Some((_, live)) = lives.iter_mut().find(|(item, _)| *item == label) else { return false };
            if live.frost != frost {
                if let Ok(brush) = brush_for(&compositor, frost) {
                    for tile in live.blocks.iter().chain(live.cards.iter()) {
                        let _ = tile.sprite.SetBrush(&brush);
                    }
                    live.brush = brush;
                    live.frost = frost;
                }
            }
            live.root.SetIsVisible(true).is_ok()
        })
    }

    /// 藏起窗口的合成树（换到别的主题）。
    pub fn hide(label: &str) {
        LIVES.with(|lives| {
            if let Some((_, live)) = lives.borrow().iter().find(|(item, _)| item == label) {
                let _ = live.root.SetIsVisible(false);
            }
        });
    }

    /// 拆掉一棵合成树：先藏起，释放各块，再关掉窗口目标。
    fn close(live: Live) {
        let Live { _target: target, root, list, brush, blocks, cards, .. } = live;
        let _ = root.SetIsVisible(false);
        drop((blocks, cards, list, brush, root));
        let _ = target.Close();
    }

    /// 窗口销毁后拆掉它的合成树。
    pub fn forget(label: &str) {
        let taken = LIVES.with(|lives| {
            let mut lives = lives.borrow_mut();
            let index = lives.iter().position(|(item, _)| item == label)?;
            Some(lives.remove(index).1)
        });
        if let Some(live) = taken {
            close(ManuallyDrop::into_inner(live));
        }
    }

    /// 记录窗口只有铺满窗口的一块：改成新的大小再摆（见 super::fit_window）。
    pub fn fit_window(label: &str, width: f32, height: f32) {
        let layout = LIVES.with(|lives| {
            let lives = lives.borrow();
            let (_, live) = lives.iter().find(|(item, _)| item == label)?;
            let mut layout = live.layout.clone()?;
            let [block] = layout.blocks.as_mut_slice() else { return None };
            if block.x != 0.0 || block.y != 0.0 || (block.width == width && block.height == height) {
                return None;
            }
            block.width = width;
            block.height = height;
            Some(layout)
        });
        if let Some(layout) = layout {
            arrange(label, &layout);
        }
    }

    /// 窗口的合成树叠的效果。
    pub fn frost(label: &str) -> Option<Frost> {
        LIVES.with(|lives| lives.borrow().iter().find(|(item, _)| item == label).map(|(_, live)| live.frost))
    }

    /// 藏着时建的合成树先藏起（见 super::hide_stale）。
    pub fn hide_stale(label: &str) {
        LIVES.with(|lives| {
            if let Some((_, live)) = lives.borrow().iter().find(|(item, live)| item == label && !live.built_visible) {
                let _ = live.root.SetIsVisible(false);
            }
        });
    }

    /// 窗口显示出来以后：合成树是在它藏着时建的，就重建一次并照原来的位置摆好（见 Live::built_visible）。
    pub fn refresh(window: &WebviewWindow) {
        let label = window.label();
        if !window.is_visible().unwrap_or(false) {
            return;
        }
        let stale = LIVES.with(|lives| {
            let mut lives = lives.borrow_mut();
            let index = lives.iter().position(|(item, live)| item == label && !live.built_visible)?;
            Some(lives.remove(index).1)
        });
        let Some(stale) = stale else { return };
        let stale = ManuallyDrop::into_inner(stale);
        let (frost, layout) = (stale.frost, stale.layout.clone());
        close(stale);
        if show(window, frost) {
            if let Some(layout) = layout {
                arrange(label, &layout);
            }
        }
    }

    /// 退出前依次关掉各窗口的合成树、合成器与调度队列（见 super::shutdown），返回是否开始了调度队列的关闭。
    pub fn shutdown() -> bool {
        let lives = LIVES.with(|lives| std::mem::take(&mut *lives.borrow_mut()));
        for (_, live) in lives {
            close(ManuallyDrop::into_inner(live));
        }
        let Some(shared) = SHARED.with(|slot| slot.borrow_mut().take()) else { return false };
        let Shared { _queue: queue, compositor } = ManuallyDrop::into_inner(shared);
        let _ = compositor.Close();
        drop(compositor);
        let Some(queue) = queue else { return false };
        // 关闭要靠主线程的消息循环走完；关闭的操作与队列本身都不在这里释放，进程马上退出，由系统回收。
        let started = match queue.ShutdownQueueAsync() {
            Ok(action) => {
                std::mem::forget(action);
                true
            }
            Err(error) => {
                crate::diag::log(format!("磨砂玻璃的调度队列关闭失败：{error}"));
                false
            }
        };
        std::mem::forget(queue);
        started
    }

    fn tile(compositor: &Compositor, brush: &CompositionBrush, parent: &ContainerVisual) -> Result<Tile> {
        let sprite = compositor.CreateSpriteVisual()?;
        sprite.SetBrush(brush)?;
        let shape = compositor.CreateRoundedRectangleGeometry()?;
        sprite.SetClip(&compositor.CreateGeometricClipWithGeometry(&shape)?)?;
        parent.Children()?.InsertAtTop(&sprite)?;
        Ok(Tile { sprite, shape })
    }

    fn place(tile: &Tile, block: &Block, origin: (f32, f32)) -> Result<()> {
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
        brush: &CompositionBrush,
        parent: &ContainerVisual,
        tiles: &mut Vec<Tile>,
        blocks: &[Block],
        origin: (f32, f32),
    ) -> Result<()> {
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

    /// 按页面报告的位置摆好窗口里的各块。
    pub fn arrange(label: &str, layout: &GlassLayout) {
        let Ok(compositor) = shared() else { return };
        LIVES.with(|lives| {
            let mut lives = lives.borrow_mut();
            let Some((_, live)) = lives.iter_mut().find(|(item, _)| item == label) else { return };
            // 先解开 ManuallyDrop，下面才能同时借用各字段。
            let live: &mut Live = live;
            live.layout = Some(layout.clone());
            let result = (|| -> Result<()> {
                sync(&compositor, &live.brush, &live.root, &mut live.blocks, &layout.blocks, (0.0, 0.0))?;
                let viewport = layout.viewport.unwrap_or(Block { x: 0.0, y: 0.0, width: 0.0, height: 0.0, radius: 0.0 });
                live.list.SetOffset(Vector3 { X: viewport.x, Y: viewport.y, Z: 0.0 })?;
                live.list.SetSize(Vector2 { X: viewport.width.max(0.0), Y: viewport.height.max(0.0) })?;
                sync(&compositor, &live.brush, &live.list, &mut live.cards, &layout.cards, (viewport.x, viewport.y))
            })();
            if let Err(error) = result {
                crate::diag::log(format!("磨砂玻璃的实时模糊摆放失败：{error}"));
            }
        });
    }
}

#[cfg(not(windows))]
mod imp {
    use super::{Frost, GlassLayout};
    use tauri::WebviewWindow;

    pub fn show(_window: &WebviewWindow, _frost: Frost) -> bool {
        false
    }

    pub fn hide(_label: &str) {}

    pub fn forget(_label: &str) {}

    pub fn refresh(_window: &WebviewWindow) {}

    pub fn hide_stale(_label: &str) {}

    pub fn frost(_label: &str) -> Option<Frost> {
        None
    }

    pub fn fit_window(_label: &str, _width: f32, _height: f32) {}

    pub fn shutdown() -> bool {
        false
    }

    pub fn arrange(_label: &str, _layout: &GlassLayout) {}
}

#[cfg(test)]
mod tests {
    use super::saturation_matrix;

    #[test]
    fn saturation_one_keeps_colours_and_zero_turns_them_grey() {
        let same = saturation_matrix(1.0);
        let identity = [1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0];
        assert!(same.iter().zip(identity).all(|(a, b)| (a - b).abs() < 1e-6));
        // 饱和度 0：三个输出通道都是同一个亮度，纯红变成亮度 0.2126 的灰。
        let grey = saturation_matrix(0.0);
        let red = (grey[0], grey[1], grey[2]);
        assert!((red.0 - 0.2126).abs() < 1e-6 && (red.1 - 0.2126).abs() < 1e-6 && (red.2 - 0.2126).abs() < 1e-6);
        // 透明度不变。
        assert_eq!(grey[15], 1.0);
    }
}
