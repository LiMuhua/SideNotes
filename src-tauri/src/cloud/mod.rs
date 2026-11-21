//! 云端同步（T159–T163，原名云端备份）：把本机的记录按快照的结构备份到群晖 NAS（WebDAV）、OneDrive 或 Google Drive，
//! 可以从任意一份恢复；之后的跨设备自动同步也放在这个模块里。
//!
//! - 配置（服务、地址、用户名、远程文件夹、自动备份的时间、通知邮箱）在设置里，由前端保存；
//!   凭据（密码、登录令牌、Resend 密钥）加密存在本机（secrets），不进设置。
//! - 运行状态（各服务登录的账户、上次备份的结果）存在本机应用数据目录的 `cloud-status.json`，
//!   有变化时向各窗口广播 `sidenotes://cloud-status`，设置页据此画服务卡片角上的状态点。
//! - 后台线程每 30 秒看一次：自动备份开着、按 crontab 的时间到了（或错过了上一次）就备份。
//! - 备份失败时按设置发系统通知与邮件（notify），同样的原因只通知一次。

mod certificate;
pub mod cron;
mod gdrive;
mod job;
mod notify;
mod oauth;
mod onedrive;
mod remote;
mod secrets;
mod webdav;

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use reqwest::blocking::Client;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, State};

use crate::commands::{AppState, snapshot_root};
use crate::error::{AppError, AppResult};
use crate::snapshots::{RestoreReport, now_millis};
use job::CloudBackup;
use remote::{Remote, RemoteError};
use secrets::Secrets;

/// 发给各服务的 User-Agent。
pub const USER_AGENT: &str = concat!("SideNotes/", env!("CARGO_PKG_VERSION"));
/// 状态变化时广播的事件。
pub const STATUS_EVENT: &str = "sidenotes://cloud-status";
const STATUS_FILE: &str = "cloud-status.json";
const PROVIDERS: [&str; 3] = ["synology", "onedrive", "google"];
/// 默认的自动备份时间：每天 3 点（电脑那时关着的话，下次打开应用时补上）。
pub const DEFAULT_SCHEDULE: &str = "0 3 * * *";

/// 设置里的云端同步配置（与前端 core/settings 的 normalizeCloud 对应）。
#[derive(Debug, Clone, Default)]
struct Config {
    enabled: bool,
    provider: String,
    endpoint: String,
    account: String,
    /// 按证书上的这个名字验证 NAS 的证书（地址是 IP、证书是给域名的时候），见 webdav::build_client。
    tls_name: String,
    folder: String,
    schedule: String,
    notifications: bool,
    email: String,
    email_from: String,
}

impl Config {
    fn from_settings(settings: &serde_json::Value) -> Self {
        let cloud = settings.get("cloud").cloned().unwrap_or_default();
        let text = |key: &str| cloud.get(key).and_then(|value| value.as_str()).unwrap_or_default().trim().to_string();
        let provider = text("provider");
        Config {
            enabled: cloud.get("enabled").and_then(|value| value.as_bool()).unwrap_or(false),
            provider: if PROVIDERS.contains(&provider.as_str()) { provider } else { "synology".into() },
            endpoint: text("endpoint"),
            account: text("account"),
            tls_name: text("tlsName"),
            folder: text("folder"),
            schedule: Some(text("schedule")).filter(|value| !value.is_empty()).unwrap_or_else(|| DEFAULT_SCHEDULE.into()),
            notifications: cloud.get("notifications").and_then(|value| value.as_bool()).unwrap_or(false),
            email: text("email"),
            email_from: text("emailFrom"),
        }
    }
}

/// 存在本机的运行状态。
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
struct Status {
    /// OneDrive、Google Drive 登录的账户（邮箱）。
    accounts: BTreeMap<String, String>,
    /// 各服务最近一次的错误；成功或重新连接后清掉。
    errors: BTreeMap<String, String>,
    /// 最近一次尝试与成功的时间（毫秒）。
    last_attempt: i64,
    last_success: i64,
    /// 最近一次成功备份到的服务。
    last_provider: String,
    /// 开始按时间表备份的时刻：从没备份过时，从这里算第一次。
    baseline: i64,
    /// 已经通知过的错误，同样的原因不再通知。
    notified: String,
}

/// 云端同步的共享状态。
pub struct CloudState {
    secrets: Secrets,
    status_path: PathBuf,
    status: Mutex<Status>,
    running: AtomicBool,
    login_cancel: AtomicBool,
    /// 用户粘贴回来的授权码或回调网址，正在等的登录取走（oauth::login）。
    pasted: Mutex<Option<String>>,
    temp_dir: PathBuf,
}

impl CloudState {
    /// `app_dir` 是本机的应用数据目录（不随数据目录迁移），`cache_dir` 放临时的数据库副本。
    pub fn new(app_dir: &Path, cache_dir: &Path) -> Self {
        let status_path = app_dir.join(STATUS_FILE);
        let status = std::fs::read(&status_path).ok().and_then(|bytes| serde_json::from_slice(&bytes).ok()).unwrap_or_default();
        CloudState {
            secrets: Secrets::new(app_dir),
            status_path,
            status: Mutex::new(status),
            running: AtomicBool::new(false),
            login_cancel: AtomicBool::new(false),
            pasted: Mutex::new(None),
            temp_dir: cache_dir.join("cloud"),
        }
    }

    fn update(&self, change: impl FnOnce(&mut Status)) {
        if let Ok(mut status) = self.status.lock() {
            change(&mut status);
            if let Ok(bytes) = serde_json::to_vec_pretty(&*status) {
                let partial = self.status_path.with_extension("part");
                if std::fs::write(&partial, bytes).is_ok() {
                    let _ = std::fs::rename(&partial, &self.status_path);
                }
            }
        }
    }

    fn snapshot(&self) -> Status {
        self.status.lock().map(|status| status.clone()).unwrap_or_default()
    }
}

fn other(message: impl Into<String>) -> AppError {
    AppError::Other(message.into())
}

fn client() -> Result<Client, RemoteError> {
    Client::builder()
        .connect_timeout(Duration::from_secs(15))
        .timeout(Duration::from_secs(120))
        .user_agent(USER_AGENT)
        .build()
        .map_err(|error| RemoteError::Network(error.to_string()))
}

fn provider_name(provider: &str) -> &'static str {
    match provider {
        "onedrive" => "OneDrive",
        "google" => "Google Drive",
        _ => "群晖 NAS",
    }
}

fn local_time(millis: i64) -> String {
    use chrono::TimeZone;
    chrono::Local.timestamp_millis_opt(millis).single().map(|time| time.format("%Y-%m-%d %H:%M").to_string()).unwrap_or_default()
}

/// 当前服务的连接；OneDrive 刷新时换了刷新令牌要存下来，所以连同保存的回调一起返回。
enum Connection {
    WebDav(webdav::WebDav),
    OneDrive(onedrive::OneDrive),
    Google(gdrive::GoogleDrive),
}

impl Connection {
    fn remote(&self) -> &dyn Remote {
        match self {
            Connection::WebDav(remote) => remote,
            Connection::OneDrive(remote) => remote,
            Connection::Google(remote) => remote,
        }
    }

    /// 存下 OneDrive 换来的新刷新令牌。
    fn persist(&self, cloud: &CloudState) {
        if let Connection::OneDrive(drive) = self {
            if let Some(rotated) = drive.take_rotated() {
                let _ = cloud.secrets.set(secrets::ONEDRIVE_TOKEN, Some(&rotated));
            }
        }
    }
}

/// OneDrive 的客户端：构建时写进程序的优先，没有时用设置页里填的。
fn onedrive_provider(cloud: &CloudState) -> oauth::Provider {
    let id = Some(onedrive::BUILTIN_CLIENT.to_string()).filter(|id| !id.is_empty()).or_else(|| cloud.secrets.get(secrets::ONEDRIVE_CLIENT));
    onedrive::provider(&id.unwrap_or_default())
}

/// Google 的客户端与密钥：同上。
fn google_provider(cloud: &CloudState) -> oauth::Provider {
    if !gdrive::BUILTIN_CLIENT.is_empty() {
        return gdrive::provider(gdrive::BUILTIN_CLIENT, gdrive::BUILTIN_SECRET);
    }
    gdrive::provider(
        &cloud.secrets.get(secrets::GOOGLE_CLIENT).unwrap_or_default(),
        &cloud.secrets.get(secrets::GOOGLE_CLIENT_SECRET).unwrap_or_default(),
    )
}

fn connect(cloud: &CloudState, config: &Config) -> Result<Connection, RemoteError> {
    match config.provider.as_str() {
        "onedrive" => {
            let token = cloud.secrets.get(secrets::ONEDRIVE_TOKEN).ok_or_else(|| RemoteError::Config("还没有登录 OneDrive".into()))?;
            Ok(Connection::OneDrive(onedrive::OneDrive::new(client()?, onedrive_provider(cloud), token)))
        }
        "google" => {
            let token = cloud.secrets.get(secrets::GOOGLE_TOKEN).ok_or_else(|| RemoteError::Config("还没有登录 Google Drive".into()))?;
            Ok(Connection::Google(gdrive::GoogleDrive::new(client()?, google_provider(cloud), token)))
        }
        _ => {
            if config.endpoint.is_empty() || config.account.is_empty() {
                return Err(RemoteError::Config("还没有连接群晖 NAS".into()));
            }
            let password = cloud.secrets.get(secrets::WEBDAV_PASSWORD).ok_or_else(|| RemoteError::Config("还没有连接群晖 NAS".into()))?;
            Ok(Connection::WebDav(webdav::WebDav::new(&config.endpoint, &config.account, &password, &config.tls_name)?))
        }
    }
}

fn read_config(app: &AppHandle) -> Config {
    let state = app.state::<AppState>();
    Config::from_settings(&state.store.settings().unwrap_or_default())
}

fn folder_of(config: &Config) -> Result<String, RemoteError> {
    let folder = remote::normalize_folder(if config.folder.is_empty() { "/SideNotes" } else { &config.folder }).map_err(RemoteError::Config)?;
    if folder == "/" {
        return Err(RemoteError::Config("远程文件夹不能是根目录，请选一个文件夹".into()));
    }
    Ok(folder)
}

/// 在后台线程里做会阻塞的网络操作（reqwest 的同步接口不能在异步线程里用）。
async fn blocking<T: Send + 'static>(work: impl FnOnce() -> T + Send + 'static) -> AppResult<T> {
    tauri::async_runtime::spawn_blocking(work).await.map_err(|error| other(format!("后台任务出错：{error}")))
}

fn broadcast(app: &AppHandle) {
    let _ = app.emit(STATUS_EVENT, ());
}

/// 备份失败时通知：系统通知与邮件（配置了的话）。同样的原因只通知一次。
fn notify_failure(app: &AppHandle, config: &Config, reason: &str, trigger: &str) {
    let cloud = app.state::<CloudState>();
    let status = cloud.snapshot();
    if !config.notifications || status.notified == reason {
        return;
    }
    cloud.update(|status| status.notified = reason.to_string());
    {
        use tauri_plugin_notification::NotificationExt;
        let body: String = notify::redact(reason).chars().take(200).collect();
        let _ = app.notification().builder().title(format!("SideNotes 没能备份到 {}", provider_name(&config.provider))).body(body).show();
    }
    if config.email.is_empty() {
        return;
    }
    let Some(key) = cloud.secrets.get(secrets::RESEND_KEY) else {
        return;
    };
    let account = match config.provider.as_str() {
        "synology" => format!("{}（{}）", config.account, config.endpoint),
        provider => status.accounts.get(provider).cloned().unwrap_or_default(),
    };
    let folder = folder_of(config).unwrap_or_else(|_| config.folder.clone());
    let last_success = if status.last_success > 0 { local_time(status.last_success) } else { "从未成功".into() };
    let (subject, html) = notify::failure_mail(&notify::FailureMail {
        provider: provider_name(&config.provider),
        account: &account,
        folder: &folder,
        reason,
        failure_time: &local_time(now_millis()),
        last_success: &last_success,
        trigger,
    });
    match client().map_err(|error| error.to_string()).and_then(|client| notify::send_mail(&client, &key, &config.email_from, &config.email, &subject, &html)) {
        Ok(_) => crate::diag::log("云端同步：已发出失败通知邮件"),
        Err(error) => crate::diag::log(format!("云端同步：失败通知邮件没有发出：{error}")),
    }
}

/// 备份一次（在后台线程里调用）。`trigger` 是「自动」或「手动」，写进说明与通知。
fn run_backup(app: &AppHandle, trigger: &str) -> Result<CloudBackup, String> {
    let cloud = app.state::<CloudState>();
    if cloud.running.swap(true, Ordering::SeqCst) {
        return Err("备份正在进行".into());
    }
    broadcast(app);
    let config = read_config(app);
    let now = now_millis();
    let result = (|| -> Result<CloudBackup, RemoteError> {
        let folder = folder_of(&config)?;
        let connection = connect(&cloud, &config)?;
        let state = app.state::<AppState>();
        job::clean_temp(&cloud.temp_dir);
        let reason = if trigger == "自动" { "auto" } else { "manual" };
        let result = job::backup(connection.remote(), &state.store, &folder, &cloud.temp_dir, reason, now);
        connection.persist(&cloud);
        result
    })();
    cloud.update(|status| {
        status.last_attempt = now;
        match &result {
            Ok(_) => {
                status.last_success = now;
                status.last_provider = config.provider.clone();
                status.errors.remove(&config.provider);
                status.notified.clear();
            }
            Err(error) => {
                status.errors.insert(config.provider.clone(), error.to_string());
            }
        }
    });
    cloud.running.store(false, Ordering::SeqCst);
    broadcast(app);
    match result {
        Ok(backup) => {
            crate::diag::log(format!("云端同步：备份（{trigger}）完成：{}，{} 条记录", provider_name(&config.provider), backup.info.note_count));
            Ok(backup)
        }
        Err(error) => {
            let reason = error.to_string();
            crate::diag::log(format!("云端同步：备份（{trigger}）失败：{}", notify::redact(&reason)));
            notify_failure(app, &config, &reason, trigger);
            Err(reason)
        }
    }
}

/// 启动后台的定时检查。
pub fn spawn_scheduler(app: AppHandle) {
    std::thread::spawn(move || {
        // 启动后先等一分钟：开机时网络可能还没好。
        std::thread::sleep(Duration::from_secs(60));
        loop {
            // 一次检查出错（panic）只跳过这一次。
            let app_for_tick = app.clone();
            let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(move || tick(&app_for_tick)));
            std::thread::sleep(Duration::from_secs(30));
        }
    });
}

/// 下一次自动备份的时间；没开或时间表写错时为 None。
fn next_run(config: &Config, status: &Status) -> Option<i64> {
    if !config.enabled {
        return None;
    }
    let schedule = cron::Schedule::parse(&config.schedule).ok()?;
    let base = status.last_attempt.max(status.baseline);
    schedule.next_after(if base > 0 { base } else { now_millis() })
}

fn tick(app: &AppHandle) {
    let cloud = app.state::<CloudState>();
    let config = read_config(app);
    if !config.enabled {
        // 关掉后重新打开时从打开那一刻算起，不补关着期间错过的。
        if cloud.snapshot().baseline != 0 {
            cloud.update(|status| status.baseline = 0);
        }
        return;
    }
    let now = now_millis();
    let status = cloud.snapshot();
    if status.baseline == 0 {
        cloud.update(|status| status.baseline = now);
        return;
    }
    if next_run(&config, &status).is_some_and(|due| due <= now) && !cloud.running.load(Ordering::SeqCst) {
        let _ = run_backup(app, "自动");
    }
}

/* ==================== 命令 ==================== */

/// 一个服务的状态，设置页画卡片角上的点。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderState {
    /// 有凭据（连接过或登录过）。
    pub connected: bool,
    /// 登录的账户；群晖 NAS 是用户名。
    pub account: String,
    /// 最近的错误，空的表示正常。
    pub error: String,
    /// 有没有客户端编号（构建时写进程序的，或设置页里填的）；群晖 NAS 总是 true。
    pub available: bool,
    /// 客户端编号是构建时写进程序的（设置页不用再填）。
    pub builtin: bool,
    /// 设置页里填过的客户端编号（构建时写进程序的不给出）。
    pub client: String,
}

/// 设置页要的全部状态。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Overview {
    pub providers: BTreeMap<String, ProviderState>,
    pub running: bool,
    pub last_success: i64,
    pub last_provider: String,
    pub next_run: Option<i64>,
    /// 保存了 Resend 的密钥。
    pub resend_key: bool,
}

/// 读取云端同步的状态。
#[tauri::command]
pub fn cloud_overview(app: AppHandle, cloud: State<'_, CloudState>) -> Overview {
    let config = read_config(&app);
    let status = cloud.snapshot();
    let mut providers = BTreeMap::new();
    for provider in PROVIDERS {
        let account = status.accounts.get(provider).cloned().unwrap_or_default();
        let state = match provider {
            "onedrive" => ProviderState {
                connected: cloud.secrets.get(secrets::ONEDRIVE_TOKEN).is_some(),
                account,
                error: String::new(),
                available: !onedrive_provider(&cloud).client_id.is_empty(),
                builtin: !onedrive::BUILTIN_CLIENT.is_empty(),
                client: if onedrive::BUILTIN_CLIENT.is_empty() { cloud.secrets.get(secrets::ONEDRIVE_CLIENT).unwrap_or_default() } else { String::new() },
            },
            "google" => ProviderState {
                connected: cloud.secrets.get(secrets::GOOGLE_TOKEN).is_some(),
                account,
                error: String::new(),
                available: !google_provider(&cloud).client_id.is_empty(),
                builtin: !gdrive::BUILTIN_CLIENT.is_empty(),
                client: if gdrive::BUILTIN_CLIENT.is_empty() { cloud.secrets.get(secrets::GOOGLE_CLIENT).unwrap_or_default() } else { String::new() },
            },
            _ => ProviderState {
                connected: cloud.secrets.get(secrets::WEBDAV_PASSWORD).is_some() && !config.endpoint.is_empty() && !config.account.is_empty(),
                account: config.account.clone(),
                error: String::new(),
                available: true,
                builtin: true,
                client: String::new(),
            },
        };
        let error = status.errors.get(provider).cloned().unwrap_or_default();
        providers.insert(provider.to_string(), ProviderState { error, ..state });
    }
    Overview {
        providers,
        running: cloud.running.load(Ordering::SeqCst),
        last_success: status.last_success,
        last_provider: status.last_provider.clone(),
        next_run: next_run(&config, &status),
        resend_key: cloud.secrets.get(secrets::RESEND_KEY).is_some(),
    }
}

/// 自动备份的时间表：返回下一次的时间，写错时返回原因。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScheduleCheck {
    pub next: Option<i64>,
    pub error: String,
}

/// 检查 crontab 写法并算下一次（不联网）。
#[tauri::command]
pub fn cloud_check_schedule(expression: String) -> ScheduleCheck {
    match cron::Schedule::parse(&expression) {
        Ok(schedule) => ScheduleCheck { next: schedule.next_after(now_millis()), error: String::new() },
        Err(error) => ScheduleCheck { next: None, error },
    }
}

/// 连接群晖 NAS 的结果：连上了，或者证书上的名字与地址对不上、要问用户是否按证书上的名字验证。
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "status", rename_all = "camelCase")]
pub enum ConnectOutcome {
    Connected { account: String },
    Certificate(certificate::NameMismatch),
}

/// 连接群晖 NAS：用地址、用户名与密码列一次根目录，成功后把密码加密存下。地址、用户名与 `tls_name` 由前端存进设置。
/// 连不上时看一眼证书：只是名字与地址对不上（NAS 用 IP 访问、证书是给域名的）时返回证书上的名字，由用户决定要不要按它验证。
#[tauri::command]
pub async fn cloud_connect_webdav(app: AppHandle, endpoint: String, username: String, password: String, tls_name: String) -> AppResult<ConnectOutcome> {
    let result = blocking(move || -> Result<ConnectOutcome, RemoteError> {
        let remote = webdav::WebDav::new(&endpoint, &username, &password, &tls_name)?;
        match remote.account() {
            Ok(_) => {}
            Err(RemoteError::Network(reason)) if tls_name.is_empty() => {
                let base = webdav::normalize_endpoint(&endpoint).map_err(RemoteError::Config)?;
                return match certificate::diagnose(&base) {
                    Ok(mismatch) => Ok(ConnectOutcome::Certificate(mismatch)),
                    // 握手本身没问题（证书看得到、名字也对），那原来的网络错误才是原因。
                    Err(RemoteError::Network(detail)) if detail == "连不上服务器，检查地址与网络" => Err(RemoteError::Network(reason)),
                    Err(error) => Err(error),
                };
            }
            Err(error) => return Err(error),
        }
        let cloud = app.state::<CloudState>();
        cloud.secrets.set(secrets::WEBDAV_PASSWORD, Some(&password)).map_err(|error| RemoteError::Config(error.to_string()))?;
        cloud.update(|status| {
            status.errors.remove("synology");
            status.notified.clear();
        });
        broadcast(&app);
        Ok(ConnectOutcome::Connected { account: username.trim().to_string() })
    })
    .await?;
    result.map_err(|error| other(error.to_string()))
}

/// 登录 OneDrive 或 Google Drive：在浏览器里打开登录页，等回调（或用户粘贴的授权码），存下刷新令牌，返回登录的账户。
/// 构建时没有写进客户端编号时，用这次填的 `client_id`（Google 还有 `client_secret`），存在本机供以后刷新令牌。
#[tauri::command]
pub async fn cloud_login(app: AppHandle, provider: String, client_id: String, client_secret: String) -> AppResult<String> {
    let result = blocking(move || -> Result<String, RemoteError> {
        let cloud = app.state::<CloudState>();
        cloud.login_cancel.store(false, Ordering::SeqCst);
        if let Ok(mut slot) = cloud.pasted.lock() {
            *slot = None;
        }
        let save = |key: &str, value: &str| cloud.secrets.set(key, Some(value.trim())).map_err(|error| RemoteError::Config(error.to_string()));
        match provider.as_str() {
            "onedrive" if onedrive::BUILTIN_CLIENT.is_empty() && !client_id.trim().is_empty() => save(secrets::ONEDRIVE_CLIENT, &client_id)?,
            "google" if gdrive::BUILTIN_CLIENT.is_empty() && !client_id.trim().is_empty() => {
                save(secrets::GOOGLE_CLIENT, &client_id)?;
                if !client_secret.trim().is_empty() {
                    save(secrets::GOOGLE_CLIENT_SECRET, &client_secret)?;
                }
            }
            _ => {}
        }
        let http = client()?;
        let open = |url: &str| {
            use tauri_plugin_opener::OpenerExt;
            app.opener().open_url(url, None::<&str>).map_err(|error| error.to_string())
        };
        let (account, token, key) = match provider.as_str() {
            "onedrive" => {
                let provider = onedrive_provider(&cloud);
                let tokens = oauth::login(&http, &provider, &cloud.login_cancel, &cloud.pasted, open)?;
                let drive = onedrive::OneDrive::with_tokens(http.clone(), provider, &tokens);
                (drive.account()?, tokens.refresh.unwrap_or_default(), secrets::ONEDRIVE_TOKEN)
            }
            "google" => {
                let provider = google_provider(&cloud);
                if provider.client_secret.is_none() {
                    return Err(RemoteError::Config("请填写 Google 客户端的密钥".into()));
                }
                let tokens = oauth::login(&http, &provider, &cloud.login_cancel, &cloud.pasted, open)?;
                let drive = gdrive::GoogleDrive::with_tokens(http.clone(), provider, &tokens);
                (drive.account()?, tokens.refresh.unwrap_or_default(), secrets::GOOGLE_TOKEN)
            }
            _ => return Err(RemoteError::Config("这个服务不用登录".into())),
        };
        cloud.secrets.set(key, Some(&token)).map_err(|error| RemoteError::Config(error.to_string()))?;
        cloud.update(|status| {
            status.accounts.insert(provider.clone(), account.clone());
            status.errors.remove(&provider);
            status.notified.clear();
        });
        broadcast(&app);
        Ok(account)
    })
    .await?;
    result.map_err(|error| other(error.to_string()))
}

/// 取消正在等的登录。
#[tauri::command]
pub fn cloud_cancel_login(cloud: State<'_, CloudState>) {
    cloud.login_cancel.store(true, Ordering::SeqCst);
}

/// 把用户粘贴的授权码或回调网址交给正在等的登录。
#[tauri::command]
pub fn cloud_submit_code(cloud: State<'_, CloudState>, text: String) {
    if let Ok(mut slot) = cloud.pasted.lock() {
        *slot = Some(text);
    }
}

/// 断开群晖 NAS 或退出 OneDrive、Google Drive：删掉本机存的凭据（Google 的刷新令牌顺带撤销）。云端的备份不动。
#[tauri::command]
pub async fn cloud_disconnect(app: AppHandle, provider: String) -> AppResult<()> {
    blocking(move || -> AppResult<()> {
        let cloud = app.state::<CloudState>();
        let key = match provider.as_str() {
            "onedrive" => secrets::ONEDRIVE_TOKEN,
            "google" => secrets::GOOGLE_TOKEN,
            _ => secrets::WEBDAV_PASSWORD,
        };
        if provider == "google" {
            if let (Some(token), Ok(http)) = (cloud.secrets.get(key), client()) {
                gdrive::revoke(&http, &token);
            }
        }
        cloud.secrets.set(key, None)?;
        cloud.update(|status| {
            status.accounts.remove(&provider);
            status.errors.remove(&provider);
        });
        broadcast(&app);
        Ok(())
    })
    .await?
}

/// 远程文件夹选择框里的一层：子文件夹的名字。
#[tauri::command]
pub async fn cloud_list_folders(app: AppHandle, path: String) -> AppResult<Vec<String>> {
    let result = blocking(move || -> Result<Vec<String>, RemoteError> {
        let cloud = app.state::<CloudState>();
        let config = read_config(&app);
        let path = remote::normalize_folder(&path).map_err(RemoteError::Config)?;
        let connection = connect(&cloud, &config)?;
        let mut names: Vec<String> = connection.remote().list(&path)?.into_iter().filter(|entry| entry.is_dir).map(|entry| entry.name).collect();
        connection.persist(&cloud);
        names.sort_by_key(|name| name.to_lowercase());
        Ok(names)
    })
    .await?;
    result.map_err(|error| other(error.to_string()))
}

/// 在远程文件夹选择框里新建一个文件夹，返回它的路径。
#[tauri::command]
pub async fn cloud_create_folder(app: AppHandle, parent: String, name: String) -> AppResult<String> {
    let result = blocking(move || -> Result<String, RemoteError> {
        let cloud = app.state::<CloudState>();
        let config = read_config(&app);
        let name = name.trim();
        if name.is_empty() || name.contains(['/', '\\']) {
            return Err(RemoteError::Config("文件夹名不能为空，也不能有斜杠".into()));
        }
        let path = remote::normalize_folder(&remote::join(&parent, name)).map_err(RemoteError::Config)?;
        let connection = connect(&cloud, &config)?;
        connection.remote().ensure_dir(&path)?;
        connection.persist(&cloud);
        Ok(path)
    })
    .await?;
    result.map_err(|error| other(error.to_string()))
}

/// 立即备份一次。
#[tauri::command]
pub async fn cloud_backup_now(app: AppHandle) -> AppResult<CloudBackup> {
    blocking(move || run_backup(&app, "手动")).await?.map_err(other)
}

/// 列出远程文件夹里的备份（最新的在前）。
#[tauri::command]
pub async fn cloud_list_backups(app: AppHandle) -> AppResult<Vec<CloudBackup>> {
    let result = blocking(move || -> Result<Vec<CloudBackup>, RemoteError> {
        let cloud = app.state::<CloudState>();
        let config = read_config(&app);
        let folder = folder_of(&config)?;
        let connection = connect(&cloud, &config)?;
        let backups = job::read_index(connection.remote(), &folder);
        connection.persist(&cloud);
        if let Err(RemoteError::Auth(reason)) = &backups {
            cloud.update(|status| {
                status.errors.insert(config.provider.clone(), reason.clone());
            });
            broadcast(&app);
        }
        backups
    })
    .await?;
    result.map_err(|error| other(error.to_string()))
}

/// 从云端的一份备份恢复记录：恢复前在本机快照目录（`snapshot_directory`，空的是默认位置）建一份快照，各窗口需要重新读库。
#[tauri::command]
pub async fn cloud_restore(app: AppHandle, id: String, snapshot_directory: String) -> AppResult<RestoreReport> {
    let result = blocking(move || -> Result<RestoreReport, RemoteError> {
        let cloud = app.state::<CloudState>();
        if cloud.running.swap(true, Ordering::SeqCst) {
            return Err(RemoteError::Config("备份正在进行，稍后再恢复".into()));
        }
        let outcome = (|| {
            let config = read_config(&app);
            let folder = folder_of(&config)?;
            let connection = connect(&cloud, &config)?;
            let state = app.state::<AppState>();
            let root = snapshot_root(&state, &snapshot_directory);
            job::clean_temp(&cloud.temp_dir);
            let report = job::restore(connection.remote(), &state.store, &folder, &id, &root, &cloud.temp_dir, now_millis());
            connection.persist(&cloud);
            report
        })();
        cloud.running.store(false, Ordering::SeqCst);
        outcome
    })
    .await?;
    result.map_err(|error| other(error.to_string()))
}

/// 保存或删除 Resend 的密钥（`key` 为空时删除）。
#[tauri::command]
pub fn cloud_set_resend_key(cloud: State<'_, CloudState>, key: String) -> AppResult<()> {
    cloud.secrets.set(secrets::RESEND_KEY, Some(key.trim()))
}

/// 发一封测试邮件：`key` 为空时用保存的密钥。
#[tauri::command]
pub async fn cloud_test_email(app: AppHandle, to: String, from: String, key: String) -> AppResult<()> {
    blocking(move || -> AppResult<()> {
        let cloud = app.state::<CloudState>();
        let key = Some(key.trim().to_string()).filter(|key| !key.is_empty()).or_else(|| cloud.secrets.get(secrets::RESEND_KEY)).ok_or_else(|| other("没有填写 Resend 的 API 密钥"))?;
        let from_shown = if from.trim().is_empty() { notify::DEFAULT_FROM.to_string() } else { from.trim().to_string() };
        let (subject, html) = notify::test_mail(&from_shown, &local_time(now_millis()));
        let http = client().map_err(|error| other(error.to_string()))?;
        notify::send_mail(&http, &key, &from, to.trim(), &subject, &html).map(|_| ()).map_err(other)
    })
    .await?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_the_cloud_config_from_settings() {
        let settings = serde_json::json!({
            "cloud": { "enabled": true, "provider": "google", "folder": " /Test ", "schedule": "", "email": "a@b.com", "emailFrom": "n@b.com", "notifications": true }
        });
        let config = Config::from_settings(&settings);
        assert!(config.enabled && config.notifications);
        assert_eq!(config.provider, "google");
        assert_eq!(config.folder, "/Test");
        assert_eq!(config.schedule, DEFAULT_SCHEDULE);
        assert_eq!((config.email.as_str(), config.email_from.as_str()), ("a@b.com", "n@b.com"));
        assert_eq!(Config::from_settings(&serde_json::json!({ "cloud": { "provider": "dropbox" } })).provider, "synology");
        assert!(!Config::from_settings(&serde_json::json!({})).enabled);
    }

    #[test]
    fn the_remote_folder_must_not_be_the_root() {
        let mut config = Config { folder: "/".into(), ..Config::default() };
        assert!(folder_of(&config).is_err());
        config.folder = String::new();
        assert_eq!(folder_of(&config).unwrap(), "/SideNotes");
        config.folder = "Test".into();
        assert_eq!(folder_of(&config).unwrap(), "/Test");
    }

    #[test]
    fn next_run_counts_from_the_last_attempt_or_the_baseline() {
        // 每分钟一次：整分钟在任何时区都一样。
        let config = Config { enabled: true, schedule: "* * * * *".into(), ..Config::default() };
        let minute = 60_000;
        let base = 1_800_000_000_000 - 1_800_000_000_000 % minute;
        let status = Status { last_attempt: base + 1_000, ..Status::default() };
        assert_eq!(next_run(&config, &status), Some(base + minute));
        let status = Status { baseline: base + 2 * minute + 1, ..Status::default() };
        assert_eq!(next_run(&config, &status), Some(base + 3 * minute));
        assert_eq!(next_run(&Config { enabled: false, ..config.clone() }, &status), None);
        assert_eq!(next_run(&Config { schedule: "bad".into(), ..config }, &status), None);
    }
}
