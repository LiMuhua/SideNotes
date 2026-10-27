/**
 * 设置面板。
 *
 * 分类结构与原型保持一致：外观、快捷键、数据目录与同步、回收站、关于。
 * 数据类操作调用存储桥接，而非直接写 localStorage；其余交互与原型相同。
 */

import { useCallback, useEffect, useState } from "react";
import { Modal } from "./Modal";
import { Icon } from "./Icon";
import { useStore } from "../hooks/useStore";
import * as store from "../core/store";
import * as bridge from "../core/bridge";
import { WIDTH_RANGE, FONT_SIZE_RANGE, TRASH_DAYS_RANGE, ANIM_DURATION_RANGE } from "../core/settings";
import type { Settings } from "../core/types";

type Section = "appearance" | "shortcuts" | "data" | "trash" | "about";

const SECTIONS: Array<{ id: Section; label: string; icon: string }> = [
  { id: "appearance", label: "外观", icon: "settings" },
  { id: "shortcuts", label: "快捷键", icon: "code" },
  { id: "data", label: "数据与同步", icon: "cloud" },
  { id: "trash", label: "回收站", icon: "trash" },
  { id: "about", label: "关于", icon: "info" },
];

/* ==================== 通用控件 ==================== */

function Row({
  label,
  description,
  children,
}: {
  label: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="settings-row setting-row">
      <div className="settings-row-info setting-copy">
        <span className="settings-row-label setting-label">{label}</span>
        {description ? (
          <span className="settings-row-description setting-description">{description}</span>
        ) : null}
      </div>
      <div className="settings-control">{children}</div>
    </div>
  );
}

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <input
      type="checkbox"
      className="toggle"
      aria-label={label}
      checked={checked}
      onChange={(event) => onChange(event.target.checked)}
    />
  );
}

function Select<T extends string | number>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: Array<[T, string]>;
  value: T;
  onChange: (next: T) => void;
}) {
  return (
    <select
      className="form-control"
      aria-label={label}
      value={String(value)}
      onChange={(event) => onChange(event.target.value as T)}
    >
      {options.map(([optValue, optLabel]) => (
        <option key={String(optValue)} value={String(optValue)}>
          {optLabel}
        </option>
      ))}
    </select>
  );
}

/* ==================== 外观 ==================== */

function AppearancePanel({ settings }: { settings: Settings }) {
  const save = useCallback(async (patch: Partial<Settings>) => {
    await store.updateSettings(patch);
  }, []);

  const themes: Array<[Settings["theme"], string]> = [
    ["light", "浅色"],
    ["dark", "深色"],
    ["system", "跟随系统"],
  ];
  const surfaces: Array<[Settings["surface"], string]> = [
    ["standard", "标准"],
    ["paper", "纸感"],
    ["glass", "磨砂"],
    ["win11", "Win 11"],
  ];
  const edges: Array<[Settings["edge"], string]> = [
    ["right", "屏幕右侧"],
    ["left", "屏幕左侧"],
  ];
  const delays: Array<[number, string]> = [
    [300, "300 毫秒"],
    [600, "600 毫秒"],
    [1000, "1 秒"],
  ];

  return (
    <div className="settings-dashboard appearance-dashboard">
      <div className="settings-group">
        <h3>显示</h3>
        <Row label="主题">
          <Select
            label="主题"
            options={themes}
            value={settings.theme}
            onChange={(value) => void save({ theme: value })}
          />
        </Row>
        <Row label="材质">
          <Select
            label="材质"
            options={surfaces}
            value={settings.surface}
            onChange={(value) => void save({ surface: value })}
          />
        </Row>
      </div>
      <div className="settings-group">
        <h3>文字</h3>
        <Row label="字号">
          <div className="settings-range">
            <input
              type="range"
              min={FONT_SIZE_RANGE.min}
              max={FONT_SIZE_RANGE.max}
              step={FONT_SIZE_RANGE.step}
              value={settings.fontSize}
              aria-label="字体大小"
              onChange={(event) => void save({ fontSize: Number(event.target.value) })}
            />
            <output>{settings.fontSize} px</output>
          </div>
        </Row>
      </div>
      <div className="settings-group">
        <h3>侧栏</h3>
        <Row label="显示位置">
          <Select
            label="触发边缘"
            options={edges}
            value={settings.edge}
            onChange={(value) => void save({ edge: value })}
          />
        </Row>
        <Row label="侧栏宽度" description="可拖动侧栏边缘直接调整。">
          <div className="settings-range">
            <input
              type="range"
              min={WIDTH_RANGE.min}
              max={WIDTH_RANGE.max}
              step={WIDTH_RANGE.step}
              value={settings.width}
              aria-label="侧栏宽度"
              onChange={(event) => void save({ width: Number(event.target.value) })}
            />
            <output>{settings.width} px</output>
          </div>
        </Row>
        <Row label="出入动画" description="侧栏滑入与滑出的时长，0 表示不使用动画。">
          <div className="settings-range">
            <input
              type="range"
              min={ANIM_DURATION_RANGE.min}
              max={ANIM_DURATION_RANGE.max}
              step={ANIM_DURATION_RANGE.step}
              value={settings.animDuration}
              aria-label="侧栏出入动画时长"
              onChange={(event) => void save({ animDuration: Number(event.target.value) })}
            />
            <output>{settings.animDuration === 0 ? '关闭' : `${settings.animDuration} ms`}</output>
          </div>
        </Row>
        <Row label="移出后收起">
          <Select
            label="移出后收起"
            options={delays}
            value={settings.hideDelay}
            onChange={(value) => void save({ hideDelay: Number(value) })}
          />
        </Row>
        <Row label="边缘唤出" description="鼠标移到屏幕边缘时自动显示侧栏。">
          <Toggle
            label="边缘唤出"
            checked={settings.edgeTrigger}
            onChange={(value) => void save({ edgeTrigger: value })}
          />
        </Row>
        <Row label="编辑时保持展开" description="正在书写时，鼠标移出也保持侧栏展开。">
          <Toggle
            label="编辑时保持展开"
            checked={settings.protectEditing}
            onChange={(value) => void save({ protectEditing: value })}
          />
        </Row>
      </div>
    </div>
  );
}

/* ==================== 快捷键 ==================== */

function ShortcutsPanel({ conflicts }: { conflicts: string[] }) {
  const shortcuts: Array<[string, string]> = [
    ["新建记录", "Ctrl + N"],
    ["呼出速记浮窗", "Ctrl + Shift + Space"],
    ["保存并收起", "Ctrl + Enter"],
    ["搜索记录与标签", "Ctrl + F"],
    ["呼出侧栏", "Alt + Shift + S"],
  ];
  return (
    <div>
      {conflicts.length ? (
        <div className="desktop-notice is-error">
          <Icon name="alert" />
          以下快捷键注册失败（可能被其他软件占用）：{conflicts.join("、")}
        </div>
      ) : null}
      <div className="settings-group">
        {shortcuts.map(([label, keys]) => (
          <div key={label} className="shortcut-row">
            <span>{label}</span>
            <kbd>{keys}</kbd>
          </div>
        ))}
      </div>
      <p className="settings-notice">所列快捷键固定生效，无需额外配置；中文选词期间不触发。</p>
    </div>
  );
}

/* ==================== 数据与同步 ==================== */

function DataPanel(_props: { settings: Settings }) {
  const [info, setInfo] = useState<{ directory: string; size: number; noteCount: number } | null>(
    null,
  );

  useEffect(() => {
    void bridge.storageInfo().then((data) => setInfo(data));
  }, []);

  return (
    <div className="settings-dashboard data-dashboard">
      <p className="settings-notice">记录存储在本地 SQLite 数据库中，不会上传任何数据。</p>
      {info ? (
        <div className="settings-group">
          <h3>存储位置</h3>
          <div className="current-directory settings-inline">
            <code className="settings-path directory-field" aria-label="当前数据目录">
              {info.directory}
            </code>
          </div>
          <p className="setting-description">
            {info.noteCount} 条记录 ·{" "}
            {info.size < 1024 * 1024
              ? `${Math.round(info.size / 1024)} KB`
              : `${(info.size / 1024 / 1024).toFixed(1)} MB`}
          </p>
        </div>
      ) : null}
      <div className="settings-group">
        <h3>备份</h3>
        <div className="data-actions">
          <button
            type="button"
            className="button secondary compact"
            onClick={() => {
              const state = store.getState();
              const blob = new Blob(
                [
                  JSON.stringify(
                    {
                      version: 2,
                      exportedAt: Date.now(),
                      notes: state.notes,
                      draft: state.draft,
                      settings: state.settings,
                    },
                    null,
                    2,
                  ),
                ],
                { type: "application/json" },
              );
              const url = URL.createObjectURL(blob);
              const link = document.createElement("a");
              link.href = url;
              link.download = `sidenotes-backup-${new Date().toISOString().slice(0, 10)}.json`;
              link.click();
              link.remove();
              window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
            }}
          >
            <Icon name="download" />
            导出备份
          </button>
          <button
            type="button"
            className="button secondary compact"
            onClick={async () => {
              // 触发文件选择器，由外部实现读取导入逻辑。
              window.dispatchEvent(new CustomEvent("sidenotes:import-backup"));
            }}
          >
            <Icon name="upload" />
            导入备份
          </button>
          <button
            type="button"
            className="button secondary compact"
            onClick={async () => {
              await bridge.compactDatabase();
              void bridge.storageInfo().then((data) => setInfo(data));
            }}
          >
            <Icon name="restore" />
            整理数据库
          </button>
        </div>
      </div>
      <div className="settings-group">
        <h3>同步</h3>
        <p className="setting-description">
          云端同步功能正在开发中，敬请期待。当前版本支持手动导出备份到 OneDrive、坚果云等同步盘。
        </p>
      </div>
    </div>
  );
}

/* ==================== 回收站 ==================== */

function TrashPanel({ settings }: { settings: Settings }) {
  const [trashQuery, setTrashQuery] = useState("");
  const state = useStore();
  const trashed = state.notes
    .filter((note) => note.status === "trash")
    .sort((a, b) => (b.deletedAt ?? 0) - (a.deletedAt ?? 0));
  // useState 懒初始化是调用 Date.now() 的合规方式（不在渲染函数体中直接调用）。
  const [now] = useState<number>(() => Date.now());
  const retainMs = settings.trashDays * 86_400_000;

  const visible = trashed.filter((note) => {
    const lower = trashQuery.toLowerCase();
    return (
      !lower ||
      (note.text + note.images.map((image) => image.name).join(" ")).toLowerCase().includes(lower)
    );
  });

  return (
    <div>
      <div className="settings-trash-toolbar settings-search-row">
        <input
          type="search"
          className="form-control"
          placeholder="搜索回收站"
          aria-label="搜索回收站"
          value={trashQuery}
          onChange={(event) => setTrashQuery(event.target.value)}
        />
        <Row label="保留天数">
          <div className="trash-retention-control">
            <input
              type="number"
              className="trash-retention-days"
              min={TRASH_DAYS_RANGE.min}
              max={TRASH_DAYS_RANGE.max}
              aria-label="回收站保留天数"
              value={settings.trashDays}
              onChange={async (event) => {
                const days = Math.round(Number(event.target.value));
                if (Number.isFinite(days) && days >= 1 && days <= 365) {
                  await store.updateSettings({ trashDays: days });
                }
              }}
            />
            <span className="trash-retention-unit">天</span>
          </div>
        </Row>
      </div>
      <div className="trash-toolbar settings-inline">
        <span className="settings-trash-summary setting-description">
          {visible.length} / {trashed.length} 条
        </span>
        <button
          type="button"
          className="button secondary compact"
          disabled={!visible.length}
          onClick={async () => {
            await store.restoreFromTrash(visible.map((note) => note.id));
          }}
        >
          <Icon name="restore" />
          恢复筛选结果
        </button>
        <button
          type="button"
          className="button secondary compact"
          disabled={!trashed.some((note) => now - (note.deletedAt ?? 0) > retainMs)}
          onClick={async () => {
            const expired = trashed.filter((note) => now - (note.deletedAt ?? 0) > retainMs);
            await store.deleteForever(expired.map((note) => note.id));
          }}
        >
          <Icon name="trash" />
          清理到期项
        </button>
      </div>
      <div className="settings-trash-list">
        {visible.length === 0 ? (
          <div className="empty-state">{trashed.length ? "没有匹配的记录" : "回收站为空"}</div>
        ) : (
          visible.map((note) => {
            const expired = now - (note.deletedAt ?? 0) > retainMs;
            const lines = note.text.split("\n");
            const title =
              lines.find((line) => line.trim()) || (note.images.length ? "图片记录" : "");
            return (
              <div key={note.id} className="settings-trash-item trash-card">
                <div className="trash-item-main">
                  <h4 className="trash-title">{title}</h4>
                  <p className="trash-item-meta">
                    {note.deletedAt
                      ? new Date(note.deletedAt).toLocaleString("zh-CN", { hour12: false })
                      : "—"}
                    {expired ? " · 已到期" : ""}
                  </p>
                </div>
                <div className="trash-item-actions">
                  <button
                    type="button"
                    className="icon-button"
                    aria-label="恢复此记录"
                    title="恢复记录"
                    onClick={() => void store.restoreFromTrash([note.id])}
                  >
                    <Icon name="restore" />
                  </button>
                  <button
                    type="button"
                    className="icon-button"
                    aria-label="永久删除此记录"
                    title="永久删除"
                    onClick={() => void store.deleteForever([note.id])}
                  >
                    <Icon name="trash" />
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

/* ==================== 关于 ==================== */

function AboutPanel() {
  const links: Array<[string, string, string, string]> = [
    ["Tauri", "https://tauri.app/", "◈", "桌面与跨平台运行时"],
    ["React", "https://react.dev/", "⚛", "界面方案参考"],
    ["Vite", "https://vite.dev/", "ϟ", "开发与构建工具"],
    ["SQLite", "https://sqlite.org/", "▱", "本地数据存储"],
  ];
  return (
    <div>
      <div className="about-hero settings-about-logo">
        <img src="/src/assets/favicon.svg" alt="" width={40} height={40} />
        <h3>SideNotes</h3>
        <span className="settings-version">0.6.1</span>
        <p className="setting-description">本地速记 · 置顶取用 · 用后归档</p>
      </div>
      <div className="settings-group">
        <h3>开源致谢</h3>
        <div className="resource-links settings-about-links">
          {links.map(([name, url, icon, desc]) => (
            <a
              key={name}
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className="resource-link"
            >
              <span className="resource-icon">{icon}</span>
              <span>{name}</span>
              <span className="resource-desc">{desc}</span>
            </a>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ==================== 主组件 ==================== */

export interface SettingsModalProps {
  onClose: () => void;
  initialSection?: Section;
  /** 独立窗口模式：不套用 Modal 遮罩，渲染为完整页面。 */
  standalone?: boolean;
}

/** 设置对话框；支持独立窗口模式。 */
export function SettingsModal({
  onClose,
  initialSection = "appearance",
  standalone = false,
}: SettingsModalProps) {
  const [section, setSection] = useState<Section>(initialSection);
  const [conflicts, setConflicts] = useState<string[]>([]);
  const state = useStore();

  useEffect(() => {
    void bridge.shortcutConflicts().then(setConflicts);
  }, []);

  // 独立窗口下 Esc 直接关闭；模态下沿用 Modal 自身的 Esc 行为。
  useEffect(() => {
    if (!standalone) return;
    const handler = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        onClose();
      }
    };
    document.addEventListener("keydown", handler, true);
    return () => document.removeEventListener("keydown", handler, true);
  }, [standalone, onClose]);

  const body = (
    <div className="settings-layout">
      <nav
        className="settings-nav"
        aria-label="设置分类"
        role="tablist"
        aria-orientation="vertical"
      >
        {SECTIONS.map(({ id, label }) => (
          <button
            key={id}
            type="button"
            role="tab"
            className={`settings-nav-button settings-nav-item${section === id ? " active" : ""}`}
            aria-selected={section === id}
            data-section={id}
            tabIndex={section === id ? 0 : -1}
            onClick={() => setSection(id)}
            onKeyDown={(event) => {
              const index = SECTIONS.findIndex((s) => s.id === section);
              if (event.key === "ArrowDown") {
                event.preventDefault();
                setSection(SECTIONS[(index + 1) % SECTIONS.length].id);
              } else if (event.key === "ArrowUp") {
                event.preventDefault();
                setSection(SECTIONS[(index - 1 + SECTIONS.length) % SECTIONS.length].id);
              }
            }}
          >
            {label}
          </button>
        ))}
      </nav>

      <div
        id="settings-panel"
        className="settings-panel settings-content"
        role="tabpanel"
        aria-labelledby={`settings-tab-${section}`}
      >
        <div className="settings-panel-heading settings-content-header">
          <h3>{SECTIONS.find((s) => s.id === section)?.label}</h3>
        </div>

        {section === "appearance" ? <AppearancePanel settings={state.settings} /> : null}
        {section === "shortcuts" ? <ShortcutsPanel conflicts={conflicts} /> : null}
        {section === "data" ? <DataPanel settings={state.settings} /> : null}
        {section === "trash" ? <TrashPanel settings={state.settings} /> : null}
        {section === "about" ? <AboutPanel /> : null}
      </div>
    </div>
  );

  if (standalone) {
    // 独立窗口使用系统原生标题栏（含最小化与关闭按钮），
    // 因此这里不再重复绘制标题栏与关闭按钮。
    return <div className="settings-window">{body}</div>;
  }

  return (
    <Modal title="设置" className="settings-modal" onClose={onClose} footer={null}>
      {body}
    </Modal>
  );
}
