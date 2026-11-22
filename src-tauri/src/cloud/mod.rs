//! 云端同步（T159–T163，原名云端备份）：把本机的记录按快照的结构备份到群晖 NAS（WebDAV）、OneDrive 或 Google Drive，
//! 可以从任意一份恢复；之后的跨设备自动同步也放在这个模块里。
//!
//! - 配置（服务、地址、用户名、远程文件夹、自动备份的时间、通知邮箱）在设置里，由前端保存；
//!   凭据（密码、登录令牌、Resend 密钥）加密存在本机（secrets），不进设置。
//! - 运行状态（各服务登录的账户、上次备份的结果）存在本机应用数据目录的 `cloud-status.json`，
//!   有变化时向各窗口广播 `sidenotes://cloud-status`，设置页据此画服务卡片角上的状态点。
//! - 同步一次就依次发往每个连上了、选了远程文件夹的服务（立即同步与自动同步都是），一家失败不影响别家。
//! - 后台线程每 30 秒看一次：自动同步开着、按 crontab 的时间到了（或错过了上一次）就同步。
//! - 哪个服务同步失败，就按设置为它发系统通知与邮件（notify），同一个服务同样的原因只通知一次。

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

/// 0.8.1 的设置只有一个远程文件夹 `folder`，没选过时存的是默认的 /SideNotes；读到旧设置时当作没选（同前端的 normalizeCloud）。
const LEGACY_DEFAULT_FOLDER: &str = "/SideNotes";

/// 设置里的云端同步配置（与前端 core/settings 的 normalizeCloud 对应）。
#[derive(Debug, Clone, Default)]
struct Config {
    enabled: bool,
    endpoint: String,
    account: String,
    /// 按证书上的这个名字验证 NAS 的证书（地址是 IP、证书是给域名的时候），见 webdav::build_client。
    tls_name: String,
    /// 各服务的远程文件夹，空的表示还没有选：同步时发往每个连上了、选了文件夹的服务（第十二轮反馈：连着几个服务时一键同步）。
    /// 设置里选中的服务只在迁移 0.8.1 的旧设置时用到；按服务的命令由前端指明服务（见 known_provider）。
    folders: BTreeMap<String, String>,
    schedule: String,
    notifications: bool,
    email: String,
    email_from: String,
}

impl Config {
    fn from_settings(settings: &serde_json::Value) -> Self {
        let cloud = settings.get("cloud").cloned().unwrap_or_default();
        let text = |key: &str| cloud.get(key).and_then(|value| value.as_str()).unwrap_or_default().trim().to_string();
        let provider = Some(text("provider")).filter(|provider| PROVIDERS.contains(&provider.as_str())).unwrap_or_else(|| "synology".into());
        // 远程文件夹按服务分别存（第十二轮反馈 3）；旧设置只有一个，归当时选中的服务。
        let folders: BTreeMap<String, String> = match cloud.get("folders").filter(|folders| folders.is_object()) {
            Some(folders) => PROVIDERS
                .iter()
                .map(|name| (name.to_string(), folders.get(*name).and_then(|value| value.as_str()).unwrap_or_default().trim().to_string()))
                .collect(),
            None => {
                let legacy = Some(text("folder")).filter(|folder| folder != LEGACY_DEFAULT_FOLDER).unwrap_or_default();
                PROVIDERS.iter().map(|name| (name.to_string(), if *name == provider { legacy.clone() } else { String::new() })).collect()
            }
        };
        Config {
            enabled: cloud.get("enabled").and_then(|value| value.as_bool()).unwrap_or(false),
            endpoint: text("endpoint"),
            account: text("account"),
            tls_name: text("tlsName"),
            folders,
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
    /// 最近一次同步的时间，与其中至少一个服务成功的时间（毫秒）。
    last_attempt: i64,
    last_success: i64,
    /// 各服务最近一次同步成功的时间，写进失败通知邮件。
    successes: BTreeMap<String, i64>,
    /// 开始按时间表同步的时刻：从没同步过时，从这里算第一次。
    baseline: i64,
    /// 各服务已经通知过的错误，同样的原因不再通知。0.8.2 之前的 `notified`（一个字符串）与 `lastProvider` 读到时忽略。
    notified_by: BTreeMap<String, String>,
}

/// 云端同步的共享状态。
pub struct CloudState {
    secrets: Secrets,
    status_path: PathBuf,
    status: Mutex<Status>,
    running: AtomicBool,
    /// 正在同步的服务（设置页让它卡片角上的点闪烁）；没在同步时为空。
    syncing: Mutex<String>,
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
            syncing: Mutex::new(String::new()),
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

/// OneDrive、Google Drive 与 Resend 用的客户端：同浏览器一样走系统代理（见 Cargo.toml 里 reqwest 的 system-proxy）。
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

/// OneDrive 与 Google Drive 的客户端：只用构建时写进程序的（build.rs），同 VS Code 等桌面应用，用户只管登录，
/// 不用自己注册（第十二轮反馈 5）。没有写进时编号为空，这个版本登录不了（`provider_ready`）。
fn oauth_provider(provider: &str) -> oauth::Provider {
    match provider {
        "google" => gdrive::provider(gdrive::BUILTIN_CLIENT, gdrive::BUILTIN_SECRET),
        _ => onedrive::provider(onedrive::BUILTIN_CLIENT),
    }
}

/// 这个版本能不能连接这个服务：群晖 NAS 总能；OneDrive 要客户端编号，Google 还要客户端密钥。
fn provider_ready(provider: &str) -> bool {
    match provider {
        "onedrive" => !onedrive::BUILTIN_CLIENT.trim().is_empty(),
        "google" => !gdrive::BUILTIN_CLIENT.trim().is_empty() && !gdrive::BUILTIN_SECRET.trim().is_empty(),
        _ => true,
    }
}

/// 这个服务有没有凭据（连接过或登录过）。
fn has_credentials(cloud: &CloudState, config: &Config, provider: &str) -> bool {
    match provider {
        "onedrive" => cloud.secrets.get(secrets::ONEDRIVE_TOKEN).is_some(),
        "google" => cloud.secrets.get(secrets::GOOGLE_TOKEN).is_some(),
        _ => cloud.secrets.get(secrets::WEBDAV_PASSWORD).is_some() && !config.endpoint.is_empty() && !config.account.is_empty(),
    }
}

/// 同步要发往的服务与远程文件夹：连上了（`connected`）、选了远程文件夹（不是根目录）的服务，按卡片的顺序。
fn targets(config: &Config, connected: impl Fn(&str) -> bool) -> Vec<(String, String)> {
    let mut found = Vec::new();
    for provider in PROVIDERS {
        let folder = config.folders.get(provider).and_then(|folder| remote::normalize_folder(folder).ok()).unwrap_or_default();
        if connected(provider) && !folder.is_empty() && folder != "/" {
            found.push((provider.to_string(), folder));
        }
    }
    found
}

fn connect_to(cloud: &CloudState, config: &Config, provider: &str) -> Result<Connection, RemoteError> {
    match provider {
        "onedrive" => {
            let token = cloud.secrets.get(secrets::ONEDRIVE_TOKEN).ok_or_else(|| RemoteError::Config("还没有登录 OneDrive".into()))?;
            Ok(Connection::OneDrive(onedrive::OneDrive::new(client()?, oauth_provider("onedrive"), token)))
        }
        "google" => {
            let token = cloud.secrets.get(secrets::GOOGLE_TOKEN).ok_or_else(|| RemoteError::Config("还没有登录 Google Drive".into()))?;
            Ok(Connection::Google(gdrive::GoogleDrive::new(client()?, oauth_provider("google"), token)))
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

/// 这个服务的远程文件夹。没有选（或选的是根目录）时报错，不往根目录里写。
fn folder_for(config: &Config, provider: &str) -> Result<String, RemoteError> {
    let folder = config.folders.get(provider).map(String::as_str).unwrap_or_default();
    let folder = remote::normalize_folder(folder).map_err(RemoteError::Config)?;
    if folder == "/" {
        return Err(RemoteError::Config("还没有选远程文件夹".into()));
    }
    Ok(folder)
}

/// 前端指明的服务：只认这三个。列快照、恢复与选文件夹都由前端指明服务，不读设置里选中的那个：
/// 设置页刚换了卡片时，新的设置可能还没存进后端，读到的会是上一个服务。
fn known_provider(provider: &str) -> Result<(), RemoteError> {
    if PROVIDERS.contains(&provider) {
        Ok(())
    } else {
        Err(RemoteError::Config(format!("不认识的服务：{provider}")))
    }
}

/// 在后台线程里做会阻塞的网络操作（reqwest 的同步接口不能在异步线程里用）。
async fn blocking<T: Send + 'static>(work: impl FnOnce() -> T + Send + 'static) -> AppResult<T> {
    tauri::async_runtime::spawn_blocking(work).await.map_err(|error| other(format!("后台任务出错：{error}")))
}

fn broadcast(app: &AppHandle) {
    let _ = app.emit(STATUS_EVENT, ());
}

/// 一个服务同步失败时通知：系统通知与邮件（配置了的话）。同一个服务同样的原因只通知一次。
fn notify_failure(app: &AppHandle, config: &Config, provider: &str, folder: &str, reason: &str, trigger: &str) {
    let cloud = app.state::<CloudState>();
    let status = cloud.snapshot();
    if !config.notifications || status.notified_by.get(provider).is_some_and(|notified| notified == reason) {
        return;
    }
    cloud.update(|status| {
        status.notified_by.insert(provider.to_string(), reason.to_string());
    });
    {
        use tauri_plugin_notification::NotificationExt;
        let body: String = notify::redact(reason).chars().take(200).collect();
        let _ = app.notification().builder().title(format!("SideNotes 没能同步到 {}", provider_name(provider))).body(body).show();
    }
    if config.email.is_empty() {
        return;
    }
    let Some(key) = cloud.secrets.get(secrets::RESEND_KEY) else {
        return;
    };
    let account = match provider {
        "synology" => format!("{}（{}）", config.account, config.endpoint),
        provider => status.accounts.get(provider).cloned().unwrap_or_default(),
    };
    let last = status.successes.get(provider).copied().unwrap_or(0);
    let last_success = if last > 0 { local_time(last) } else { "从未成功".into() };
    let (subject, html) = notify::failure_mail(&notify::FailureMail {
        provider: provider_name(provider),
        account: &account,
        folder,
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

/// 一次同步里一个服务的结果。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncResult {
    pub provider: String,
    /// 同步的记录条数（成功时）。
    pub note_count: i64,
    /// 失败的原因；空的表示成功。
    pub error: String,
}

fn set_syncing(cloud: &CloudState, provider: &str) {
    if let Ok(mut syncing) = cloud.syncing.lock() {
        *syncing = provider.to_string();
    }
}

/// 同步一次（在后台线程里调用）：依次发往每个连上了、选了远程文件夹的服务，一家失败不影响别家，失败的那家单独通知。
/// 几家的快照用同一个时间，编号相同。`trigger` 是「自动」或「手动」，写进说明与通知。
fn run_backup(app: &AppHandle, trigger: &str) -> Result<Vec<SyncResult>, String> {
    let cloud = app.state::<CloudState>();
    if cloud.running.swap(true, Ordering::SeqCst) {
        return Err("正在同步".into());
    }
    let config = read_config(app);
    let targets = targets(&config, |provider| has_credentials(&cloud, &config, provider));
    if targets.is_empty() {
        cloud.running.store(false, Ordering::SeqCst);
        return Err("还没有连上服务并选好远程文件夹".into());
    }
    let now = now_millis();
    let state = app.state::<AppState>();
    let reason = if trigger == "自动" { "auto" } else { "manual" };
    let mut results = Vec::new();
    for (provider, folder) in &targets {
        set_syncing(&cloud, provider);
        broadcast(app);
        let result = (|| -> Result<CloudBackup, RemoteError> {
            let connection = connect_to(&cloud, &config, provider)?;
            job::clean_temp(&cloud.temp_dir);
            let result = job::backup(connection.remote(), &state.store, folder, &cloud.temp_dir, reason, now);
            connection.persist(&cloud);
            result
        })();
        cloud.update(|status| match &result {
            Ok(_) => {
                status.successes.insert(provider.clone(), now);
                status.errors.remove(provider);
                status.notified_by.remove(provider);
            }
            Err(error) => {
                status.errors.insert(provider.clone(), error.to_string());
            }
        });
        match result {
            Ok(backup) => {
                crate::diag::log(format!("云端同步（{trigger}）完成：{}，{} 条记录", provider_name(provider), backup.info.note_count));
                results.push(SyncResult { provider: provider.clone(), note_count: backup.info.note_count, error: String::new() });
            }
            Err(error) => {
                let reason = error.to_string();
                crate::diag::log(format!("云端同步（{trigger}）失败：{}：{}", provider_name(provider), notify::redact(&reason)));
                notify_failure(app, &config, provider, folder, &reason, trigger);
                results.push(SyncResult { provider: provider.clone(), note_count: 0, error: reason });
            }
        }
    }
    let succeeded = results.iter().any(|result| result.error.is_empty());
    cloud.update(|status| {
        status.last_attempt = now;
        if succeeded {
            status.last_success = now;
        }
    });
    set_syncing(&cloud, "");
    cloud.running.store(false, Ordering::SeqCst);
    broadcast(app);
    Ok(results)
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
    /// 这个版本能不能连接（`provider_ready`）：OneDrive 与 Google Drive 要构建时写进客户端编号。
    pub available: bool,
}

/// 设置页要的全部状态。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Overview {
    pub providers: BTreeMap<String, ProviderState>,
    pub running: bool,
    /// 正在同步的服务；没在同步时为空。
    pub syncing: String,
    /// 最近一次同步里至少一个服务成功的时间（毫秒），0 表示没有。
    pub last_success: i64,
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
        let connected = has_credentials(&cloud, &config, provider);
        let account = if provider == "synology" { config.account.clone() } else { status.accounts.get(provider).cloned().unwrap_or_default() };
        let error = status.errors.get(provider).cloned().unwrap_or_default();
        providers.insert(provider.to_string(), ProviderState { connected, account, error, available: provider_ready(provider) });
    }
    Overview {
        providers,
        running: cloud.running.load(Ordering::SeqCst),
        syncing: cloud.syncing.lock().map(|syncing| syncing.clone()).unwrap_or_default(),
        last_success: status.last_success,
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
            status.notified_by.remove("synology");
        });
        broadcast(&app);
        Ok(ConnectOutcome::Connected { account: username.trim().to_string() })
    })
    .await?;
    result.map_err(|error| other(error.to_string()))
}

/// 登录 OneDrive 或 Google Drive：本机临时开一个端口等回调，在默认浏览器里打开登录页；用户登录、同意之后浏览器跳回本机，
/// 自动换取令牌（没跳回来时也可以把授权码粘贴回来），存下刷新令牌，返回登录的账户。用的是构建时写进程序的客户端。
#[tauri::command]
pub async fn cloud_login(app: AppHandle, provider: String) -> AppResult<String> {
    let result = blocking(move || -> Result<String, RemoteError> {
        let cloud = app.state::<CloudState>();
        if !matches!(provider.as_str(), "onedrive" | "google") {
            return Err(RemoteError::Config("这个服务不用登录".into()));
        }
        if !provider_ready(&provider) {
            return Err(RemoteError::Config(format!("这个版本还不能登录 {}：构建时没有带上客户端编号", provider_name(&provider))));
        }
        cloud.login_cancel.store(false, Ordering::SeqCst);
        if let Ok(mut slot) = cloud.pasted.lock() {
            *slot = None;
        }
        let http = client()?;
        let open = |url: &str| {
            use tauri_plugin_opener::OpenerExt;
            app.opener().open_url(url, None::<&str>).map_err(|error| error.to_string())
        };
        let endpoints = oauth_provider(&provider);
        let tokens = oauth::login(&http, &endpoints, &cloud.login_cancel, &cloud.pasted, open)?;
        let (account, key) = if provider == "google" {
            (gdrive::GoogleDrive::with_tokens(http.clone(), endpoints, &tokens).account()?, secrets::GOOGLE_TOKEN)
        } else {
            (onedrive::OneDrive::with_tokens(http.clone(), endpoints, &tokens).account()?, secrets::ONEDRIVE_TOKEN)
        };
        let token = tokens.refresh.unwrap_or_default();
        cloud.secrets.set(key, Some(&token)).map_err(|error| RemoteError::Config(error.to_string()))?;
        cloud.update(|status| {
            status.accounts.insert(provider.clone(), account.clone());
            status.errors.remove(&provider);
            status.notified_by.remove(&provider);
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
            status.notified_by.remove(&provider);
        });
        broadcast(&app);
        Ok(())
    })
    .await?
}

/// 远程文件夹选择框里的一层：子文件夹的名字。
#[tauri::command]
pub async fn cloud_list_folders(app: AppHandle, provider: String, path: String) -> AppResult<Vec<String>> {
    let result = blocking(move || -> Result<Vec<String>, RemoteError> {
        let cloud = app.state::<CloudState>();
        let config = read_config(&app);
        known_provider(&provider)?;
        let path = remote::normalize_folder(&path).map_err(RemoteError::Config)?;
        let connection = connect_to(&cloud, &config, &provider)?;
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
pub async fn cloud_create_folder(app: AppHandle, provider: String, parent: String, name: String) -> AppResult<String> {
    let result = blocking(move || -> Result<String, RemoteError> {
        let cloud = app.state::<CloudState>();
        let config = read_config(&app);
        let name = name.trim();
        if name.is_empty() || name.contains(['/', '\\']) {
            return Err(RemoteError::Config("文件夹名不能为空，也不能有斜杠".into()));
        }
        known_provider(&provider)?;
        let path = remote::normalize_folder(&remote::join(&parent, name)).map_err(RemoteError::Config)?;
        let connection = connect_to(&cloud, &config, &provider)?;
        connection.remote().ensure_dir(&path)?;
        connection.persist(&cloud);
        Ok(path)
    })
    .await?;
    result.map_err(|error| other(error.to_string()))
}

/// 立即同步一次：发往每个连上了、选了远程文件夹的服务，返回各服务的结果。
#[tauri::command]
pub async fn cloud_backup_now(app: AppHandle) -> AppResult<Vec<SyncResult>> {
    blocking(move || run_backup(&app, "手动")).await?.map_err(other)
}

/// 列出一个服务的远程文件夹里的快照（最新的在前）。
#[tauri::command]
pub async fn cloud_list_backups(app: AppHandle, provider: String) -> AppResult<Vec<CloudBackup>> {
    let result = blocking(move || -> Result<Vec<CloudBackup>, RemoteError> {
        let cloud = app.state::<CloudState>();
        let config = read_config(&app);
        known_provider(&provider)?;
        let folder = folder_for(&config, &provider)?;
        let connection = connect_to(&cloud, &config, &provider)?;
        let backups = job::read_index(connection.remote(), &folder);
        connection.persist(&cloud);
        if let Err(RemoteError::Auth(reason)) = &backups {
            cloud.update(|status| {
                status.errors.insert(provider.clone(), reason.clone());
            });
            broadcast(&app);
        }
        backups
    })
    .await?;
    result.map_err(|error| other(error.to_string()))
}

/// 从一个服务的一份云端快照恢复记录：恢复前在本机快照目录（`snapshot_directory`，空的是默认位置）建一份快照，各窗口需要重新读库。
#[tauri::command]
pub async fn cloud_restore(app: AppHandle, provider: String, id: String, snapshot_directory: String) -> AppResult<RestoreReport> {
    let result = blocking(move || -> Result<RestoreReport, RemoteError> {
        let cloud = app.state::<CloudState>();
        if cloud.running.swap(true, Ordering::SeqCst) {
            return Err(RemoteError::Config("正在同步，稍后再恢复".into()));
        }
        let outcome = (|| {
            let config = read_config(&app);
            known_provider(&provider)?;
            let folder = folder_for(&config, &provider)?;
            let connection = connect_to(&cloud, &config, &provider)?;
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
            "cloud": {
                "enabled": true, "provider": "google", "folders": { "google": " /Test ", "synology": "/backup/Test" },
                "schedule": "", "email": "a@b.com", "emailFrom": "n@b.com", "notifications": true
            }
        });
        let config = Config::from_settings(&settings);
        assert!(config.enabled && config.notifications);
        assert_eq!(config.folders.get("google").map(String::as_str), Some("/Test"));
        assert_eq!(config.folders.get("synology").map(String::as_str), Some("/backup/Test"));
        assert_eq!(config.schedule, DEFAULT_SCHEDULE);
        assert_eq!((config.email.as_str(), config.email_from.as_str()), ("a@b.com", "n@b.com"));
        // 不认识的服务当作群晖 NAS：0.8.1 的旧文件夹归它。
        let unknown = Config::from_settings(&serde_json::json!({ "cloud": { "provider": "dropbox", "folder": "/X" } }));
        assert_eq!(unknown.folders.get("synology").map(String::as_str), Some("/X"));
        assert!(!Config::from_settings(&serde_json::json!({})).enabled);
    }

    #[test]
    fn each_provider_has_its_own_folder_and_old_settings_migrate() {
        let read = |cloud: serde_json::Value, provider: &str| {
            Config::from_settings(&serde_json::json!({ "cloud": cloud })).folders.get(provider).cloned().unwrap_or_default()
        };
        // 换到没选过文件夹的服务：空的，不沿用别的服务的。
        assert_eq!(read(serde_json::json!({ "provider": "onedrive", "folders": { "synology": "/backup/Test" } }), "onedrive"), "");
        // 0.8.1 的设置：一个 folder，归当时选中的服务；没选过时的默认 /SideNotes 当作没选。
        assert_eq!(read(serde_json::json!({ "provider": "synology", "folder": "/backup/Test" }), "synology"), "/backup/Test");
        assert_eq!(read(serde_json::json!({ "provider": "synology", "folder": "/backup/Test" }), "onedrive"), "");
        assert_eq!(read(serde_json::json!({ "provider": "synology", "folder": "/SideNotes" }), "synology"), "");
        assert_eq!(read(serde_json::json!({ "provider": "synology" }), "synology"), "");
    }

    #[test]
    fn the_remote_folder_must_be_chosen_and_not_the_root() {
        let config = |folder: &str| Config { folders: BTreeMap::from([("onedrive".to_string(), folder.to_string())]), ..Config::default() };
        assert_eq!(folder_for(&config("/"), "onedrive"), Err(RemoteError::Config("还没有选远程文件夹".into())));
        assert!(folder_for(&config(""), "onedrive").is_err());
        // 按指明的服务取：别的服务的文件夹不算。
        assert!(folder_for(&config("/Test"), "google").is_err());
        assert_eq!(folder_for(&config("Test"), "onedrive").unwrap(), "/Test");
        assert!(known_provider("google").is_ok() && known_provider("dropbox").is_err());
    }

    #[test]
    fn syncs_to_every_connected_provider_with_a_folder() {
        let config = Config::from_settings(&serde_json::json!({
            "cloud": { "provider": "synology", "folders": { "synology": "", "onedrive": "/Test", "google": "Test" } }
        }));
        let pair = |provider: &str, folder: &str| (provider.to_string(), folder.to_string());
        // 都连着：没选文件夹的群晖 NAS 不算，选中的是哪个服务都一样。
        assert_eq!(targets(&config, |_| true), vec![pair("onedrive", "/Test"), pair("google", "/Test")]);
        // Google Drive 没连接：只剩 OneDrive。
        assert_eq!(targets(&config, |provider| provider == "onedrive"), vec![pair("onedrive", "/Test")]);
        // 选的是根目录也不算。
        let root = Config::from_settings(&serde_json::json!({ "cloud": { "folders": { "onedrive": "/" } } }));
        assert!(targets(&root, |_| true).is_empty());
        // 0.8.1 的设置：一个 folder，归当时选中的服务。
        let old = Config::from_settings(&serde_json::json!({ "cloud": { "provider": "google", "folder": "/Notes" } }));
        assert_eq!(targets(&old, |_| true), vec![pair("google", "/Notes")]);
    }

    #[test]
    fn old_status_files_still_load() {
        // 0.8.2 之前的 cloud-status.json：notified 是一个字符串，还有 lastProvider；读进来不丢登录的账户。
        let old = r#"{ "accounts": { "google": "a@b.com" }, "errors": {}, "lastAttempt": 1, "lastSuccess": 2, "lastProvider": "google", "baseline": 0, "notified": "网络不通" }"#;
        let status: Status = serde_json::from_str(old).unwrap();
        assert_eq!(status.accounts.get("google").map(String::as_str), Some("a@b.com"));
        assert_eq!((status.last_attempt, status.last_success), (1, 2));
        assert!(status.notified_by.is_empty() && status.successes.is_empty());
    }

    #[test]
    fn webdav_is_always_ready_and_the_drives_need_a_builtin_client() {
        assert!(provider_ready("synology"));
        assert_eq!(provider_ready("onedrive"), !onedrive::BUILTIN_CLIENT.trim().is_empty());
        assert_eq!(provider_ready("google"), !gdrive::BUILTIN_CLIENT.trim().is_empty() && !gdrive::BUILTIN_SECRET.trim().is_empty());
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
