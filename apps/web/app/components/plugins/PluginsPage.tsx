"use client";

import {
  Archive,
  BarChart3,
  Box,
  CalendarDays,
  Check,
  CircleDot,
  Cloud,
  GitPullRequest,
  Handshake,
  Landmark,
  NotebookText,
  Plus,
  Search,
  Settings,
  TerminalSquare,
  TrendingUp,
  X,
  type LucideIcon,
} from "lucide-react";
import {
  normalizeMcpServerInput,
  removeMcpServerByName,
  upsertMcpServerByName,
} from "@taskforceai/client-core/mcp/settings";
import {
  pluginCatalog,
  type PluginCatalogCategory,
  type PluginCatalogEntry,
} from "@taskforceai/client-core/mcp/catalog";
import { useCallback, useEffect, useMemo, useState } from "react";

import type { WebMcpServerConfig } from "../../lib/mcp/manager";
import {
  persistWebMcpServers,
  readStoredWebMcpServers,
  WEB_MCP_SERVERS_CHANGED_EVENT,
} from "../../lib/mcp/store";
import { usePlatformRuntime } from "../../lib/platform/PlatformProvider";
import {
  listDesktopAppServerPlugins,
  setDesktopAppServerPluginEnabled,
} from "../../lib/platform/desktop/app-server";
import type { AppServerPluginListResult } from "../../lib/platform/desktop/app-server-types";

const catalogIcons: Record<string, LucideIcon> = {
  box: Box,
  calendar: CalendarDays,
  chart: BarChart3,
  "circle-dot": CircleDot,
  cloud: Cloud,
  github: GitPullRequest,
  handshake: Handshake,
  landmark: Landmark,
  notebook: NotebookText,
  "trending-up": TrendingUp,
};

type PluginEditorDraft = {
  name: string;
  endpoint: string;
};

const emptyDraft: PluginEditorDraft = { name: "", endpoint: "" };

const matchesQuery = (query: string, ...values: string[]): boolean =>
  values.some((value) => value.toLocaleLowerCase().includes(query));

export function PluginsPage() {
  const platformRuntime = usePlatformRuntime();
  const [installed, setInstalled] = useState<WebMcpServerConfig[]>([]);
  const [desktopPlugins, setDesktopPlugins] = useState<
    AppServerPluginListResult["plugins"]
  >([]);
  const [query, setQuery] = useState("");
  const [draft, setDraft] = useState<PluginEditorDraft>(emptyDraft);
  const [editorOpen, setEditorOpen] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  const refreshInstalled = useCallback(() => {
    setInstalled(readStoredWebMcpServers());
  }, []);

  useEffect(() => {
    refreshInstalled();
    window.addEventListener(WEB_MCP_SERVERS_CHANGED_EVENT, refreshInstalled);
    return () =>
      window.removeEventListener(
        WEB_MCP_SERVERS_CHANGED_EVENT,
        refreshInstalled,
      );
  }, [refreshInstalled]);

  useEffect(() => {
    if (platformRuntime !== "desktop") {
      setDesktopPlugins([]);
      return;
    }
    void listDesktopAppServerPlugins()
      .then((result) => setDesktopPlugins(result.plugins))
      .catch(() => setDesktopPlugins([]));
  }, [platformRuntime]);

  const normalizedQuery = query.trim().toLocaleLowerCase();
  const visibleInstalled = useMemo(
    () =>
      installed.filter((plugin) =>
        matchesQuery(normalizedQuery, plugin.name, plugin.endpoint),
      ),
    [installed, normalizedQuery],
  );
  const visibleDesktopPlugins = useMemo(
    () =>
      desktopPlugins.filter((plugin) =>
        matchesQuery(
          normalizedQuery,
          plugin.name,
          plugin.description ?? "",
          plugin.source ?? "",
        ),
      ),
    [desktopPlugins, normalizedQuery],
  );
  const visibleCatalog = useMemo(
    () =>
      pluginCatalog.filter((plugin) =>
        matchesQuery(
          normalizedQuery,
          plugin.name,
          plugin.description,
          plugin.category,
        ),
      ),
    [normalizedQuery],
  );

  const openEditor = (plugin?: PluginCatalogEntry) => {
    setDraft({ name: plugin?.name ?? "", endpoint: "" });
    setFeedback(null);
    setEditorOpen(true);
  };

  const savePlugin = () => {
    const result = normalizeMcpServerInput(draft);
    if (!result.ok) {
      setFeedback(result.message);
      return;
    }
    const next = persistWebMcpServers(
      upsertMcpServerByName(installed, result.value),
    );
    setInstalled(next);
    setEditorOpen(false);
    setDraft(emptyDraft);
  };

  const togglePlugin = (plugin: WebMcpServerConfig) => {
    const next = persistWebMcpServers(
      installed.map((item) =>
        item.name === plugin.name ? { ...item, enabled: !item.enabled } : item,
      ),
    );
    setInstalled(next);
  };

  const removePlugin = (plugin: WebMcpServerConfig) => {
    const next = persistWebMcpServers(
      removeMcpServerByName(installed, plugin.name),
    );
    setInstalled(next);
  };

  const toggleDesktopPlugin = async (
    plugin: AppServerPluginListResult["plugins"][number],
  ) => {
    const result = await setDesktopAppServerPluginEnabled(
      plugin.id,
      !plugin.enabled,
    );
    setDesktopPlugins(result.plugins);
  };

  return (
    <section className="mx-auto min-h-screen w-full max-w-6xl px-4 pt-20 pb-16 sm:px-8 lg:pt-24">
      <div className="mx-auto w-full max-w-4xl">
        <div className="flex flex-col gap-6 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight text-white">
              Plugins
            </h1>
            <p className="mt-2 text-base text-slate-400">
              Connect TaskForceAI to tools through MCP.
            </p>
          </div>
          <button
            type="button"
            onClick={() => openEditor()}
            className="inline-flex h-10 items-center justify-center gap-2 self-start rounded-xl border border-white/15 bg-white/[0.07] px-4 text-sm font-medium text-slate-100 transition hover:bg-white/[0.12]"
          >
            <Plus aria-hidden="true" size={17} />
            Add plugin
          </button>
        </div>

        <label className="mt-8 flex h-11 items-center gap-3 rounded-xl border border-white/15 bg-white/[0.07] px-4 text-slate-300 focus-within:border-white/30">
          <Search aria-hidden="true" size={18} />
          <span className="sr-only">Search plugins</span>
          <input
            type="search"
            value={query}
            onInput={(event) => setQuery(event.currentTarget.value)}
            placeholder="Search plugins"
            className="min-w-0 flex-1 bg-transparent text-sm text-white placeholder:text-slate-500 focus:outline-none"
          />
        </label>

        <div className="mt-10 flex items-center justify-between border-b border-white/10 pb-3">
          <h2 className="text-base font-semibold text-slate-100">Installed</h2>
          <button
            type="button"
            onClick={() => openEditor()}
            aria-label="Configure plugins"
            className="rounded-lg p-2 text-slate-400 transition hover:bg-white/[0.07] hover:text-white"
          >
            <Settings aria-hidden="true" size={18} />
          </button>
        </div>

        {visibleInstalled.length || visibleDesktopPlugins.length ? (
          <div className="mt-4 flex flex-wrap gap-3">
            {visibleDesktopPlugins.map((plugin) => (
              <button
                key={plugin.id}
                type="button"
                role="switch"
                aria-checked={plugin.enabled}
                aria-label={`${plugin.name} plugin`}
                onClick={() => void toggleDesktopPlugin(plugin)}
                className="flex min-w-44 items-center gap-3 rounded-xl border border-white/10 bg-white/[0.04] p-2 pr-4 text-left"
              >
                <span className="relative grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-[#2a2a2a] text-slate-100">
                  <Archive aria-hidden="true" size={22} />
                  {plugin.enabled ? (
                    <span className="absolute -right-1 -bottom-1 grid h-4 w-4 place-items-center rounded-full bg-emerald-500 text-white">
                      <Check aria-hidden="true" size={11} strokeWidth={3} />
                    </span>
                  ) : null}
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium text-slate-100">
                    {plugin.name}
                  </span>
                  <span className="block truncate text-xs text-slate-500">
                    {plugin.enabled ? "Enabled" : "Disabled"} · local plugin
                  </span>
                </span>
              </button>
            ))}
            {visibleInstalled.map((plugin) => (
              <div
                key={plugin.name}
                className="group flex min-w-44 items-center gap-3 rounded-xl border border-white/10 bg-white/[0.04] p-2 pr-3"
              >
                <button
                  type="button"
                  role="switch"
                  aria-checked={plugin.enabled}
                  aria-label={`${plugin.name} plugin`}
                  onClick={() => togglePlugin(plugin)}
                  className="relative grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-[#2a2a2a] text-slate-100"
                >
                  <TerminalSquare aria-hidden="true" size={22} />
                  {plugin.enabled ? (
                    <span className="absolute -right-1 -bottom-1 grid h-4 w-4 place-items-center rounded-full bg-emerald-500 text-white">
                      <Check aria-hidden="true" size={11} strokeWidth={3} />
                    </span>
                  ) : null}
                </button>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium text-slate-100">
                    {plugin.name}
                  </div>
                  <div className="truncate text-xs text-slate-500">
                    {plugin.enabled ? "Enabled" : "Disabled"}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => removePlugin(plugin)}
                  aria-label={`Remove ${plugin.name}`}
                  className="rounded-md p-1 text-slate-600 opacity-0 transition group-hover:opacity-100 hover:bg-white/10 hover:text-red-300 focus:opacity-100"
                >
                  <X aria-hidden="true" size={15} />
                </button>
              </div>
            ))}
          </div>
        ) : (
          <div className="mt-4 rounded-xl border border-dashed border-white/10 px-4 py-8 text-center text-sm text-slate-500">
            {installed.length || desktopPlugins.length
              ? "No installed plugins match your search."
              : "No plugins installed yet."}
          </div>
        )}

        {(["Featured", "Productivity"] as const).map((category) => (
          <PluginCatalogSection
            key={category}
            category={category}
            plugins={visibleCatalog.filter(
              (plugin) => plugin.category === category,
            )}
            installed={installed}
            desktopPlugins={desktopPlugins}
            onAdd={openEditor}
          />
        ))}
      </div>

      {editorOpen ? (
        <PluginEditor
          draft={draft}
          feedback={feedback}
          onChange={setDraft}
          onClose={() => setEditorOpen(false)}
          onSave={savePlugin}
        />
      ) : null}
    </section>
  );
}

function PluginCatalogSection({
  category,
  plugins,
  installed,
  desktopPlugins,
  onAdd,
}: {
  category: PluginCatalogCategory;
  plugins: readonly PluginCatalogEntry[];
  installed: readonly WebMcpServerConfig[];
  desktopPlugins: readonly AppServerPluginListResult["plugins"][number][];
  onAdd: (_plugin: PluginCatalogEntry) => void;
}) {
  if (!plugins.length) return null;
  return (
    <section
      className="mt-12"
      aria-labelledby={`plugins-${category.toLocaleLowerCase()}`}
    >
      <h2
        id={`plugins-${category.toLocaleLowerCase()}`}
        className="border-b border-white/10 pb-3 text-base font-semibold text-slate-100"
      >
        {category}
      </h2>
      <div className="mt-3 grid gap-x-10 md:grid-cols-2">
        {plugins.map((plugin) => {
          const Icon = catalogIcons[plugin.icon] ?? Archive;
          const isInstalled = installed.some(
            (item) =>
              item.name.toLocaleLowerCase() === plugin.name.toLocaleLowerCase(),
          );
          const isDesktopInstalled = desktopPlugins.some(
            (item) =>
              item.name.toLocaleLowerCase() === plugin.name.toLocaleLowerCase(),
          );
          return (
            <article
              key={plugin.id}
              className="flex min-w-0 items-center gap-4 py-3.5"
            >
              <span
                className="grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-white/10 text-white shadow-sm"
                style={{ backgroundColor: plugin.tint }}
              >
                <Icon aria-hidden="true" size={22} />
              </span>
              <div className="min-w-0 flex-1">
                <h3 className="truncate text-sm font-medium text-slate-100">
                  {plugin.name}
                </h3>
                <p className="truncate text-sm text-slate-500">
                  {plugin.description}
                </p>
              </div>
              {isInstalled || isDesktopInstalled ? (
                <span className="text-xs font-medium text-emerald-400">
                  Installed
                </span>
              ) : (
                <button
                  type="button"
                  onClick={() => onAdd(plugin)}
                  aria-label={`Add ${plugin.name}`}
                  className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-slate-300 transition hover:bg-white/[0.08] hover:text-white"
                >
                  <Plus aria-hidden="true" size={20} />
                </button>
              )}
            </article>
          );
        })}
      </div>
    </section>
  );
}

function PluginEditor({
  draft,
  feedback,
  onChange,
  onClose,
  onSave,
}: {
  draft: PluginEditorDraft;
  feedback: string | null;
  onChange: (_draft: PluginEditorDraft) => void;
  onClose: () => void;
  onSave: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-[600] grid place-items-center bg-black/65 p-4 backdrop-blur-sm"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="plugin-editor-title"
        className="w-full max-w-md rounded-2xl border border-white/15 bg-[#191919] p-6 shadow-2xl"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2
              id="plugin-editor-title"
              className="text-xl font-semibold text-white"
            >
              Add plugin
            </h2>
            <p className="mt-1 text-sm text-slate-400">
              Connect a remote MCP endpoint. Desktop also supports configured
              local endpoints.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close plugin editor"
            className="rounded-lg p-1.5 text-slate-400 hover:bg-white/10 hover:text-white"
          >
            <X aria-hidden="true" size={18} />
          </button>
        </div>

        <label className="mt-6 block text-sm font-medium text-slate-200">
          Name
          <input
            autoFocus
            value={draft.name}
            onInput={(event) =>
              onChange({ ...draft, name: event.currentTarget.value })
            }
            aria-label="Plugin name"
            placeholder="GitHub"
            className="mt-2 h-11 w-full rounded-xl border border-white/15 bg-white/[0.06] px-3 text-sm text-white placeholder:text-slate-600 focus:border-white/30 focus:outline-none"
          />
        </label>
        <label className="mt-4 block text-sm font-medium text-slate-200">
          MCP endpoint
          <input
            value={draft.endpoint}
            onInput={(event) =>
              onChange({ ...draft, endpoint: event.currentTarget.value })
            }
            aria-label="Plugin MCP endpoint"
            placeholder="https://example.com/mcp"
            className="mt-2 h-11 w-full rounded-xl border border-white/15 bg-white/[0.06] px-3 font-mono text-sm text-white placeholder:text-slate-600 focus:border-white/30 focus:outline-none"
          />
        </label>
        {feedback ? (
          <p role="alert" className="mt-3 text-sm text-red-300">
            {feedback}
          </p>
        ) : null}
        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl px-4 py-2 text-sm font-medium text-slate-300 hover:bg-white/[0.07]"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onSave}
            className="rounded-xl bg-white px-4 py-2 text-sm font-semibold text-slate-950 transition hover:bg-slate-200"
          >
            Save plugin
          </button>
        </div>
      </div>
    </div>
  );
}
