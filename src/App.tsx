
import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import "./App.css";

type BrowserTab = {
  id: number;
  title: string;
  url: string;
  isLoading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  isHome: boolean;
};

type Bookmark = { id: string; title: string; url: string };
type HistoryEntry = { id: string; title: string; url: string; visitedAt: number };
type Download = {
  id: string;
  name: string;
  url: string;
  receivedBytes: number;
  totalBytes: number;
  state: string;
  savePath: string;
};
type TabMeta = { workspace: string; group: string };
type ClosedTab = { title: string; url: string };
type ReadingItem = { id: string; title: string; url: string; savedAt: number };
type SolarionExtension = {
  id: string;
  name: string;
  version: string;
  manifestVersion: number;
  enabled: boolean;
  path: string;
  error: string | null;
};
type Panel =
  | "bookmarks"
  | "history"
  | "downloads"
  | "notes"
  | "reading"
  | "extensions"
  | null;
type SearchEngine = "Google" | "Bing" | "DuckDuckGo";

declare global {
  interface Window {
    solarion: {
      getTabs: () => Promise<BrowserTab[]>;
      createTab: (url?: string) => Promise<number>;
      selectTab: (id: number) => Promise<void>;
      closeTab: (id: number) => Promise<void>;
      navigate: (url: string) => Promise<void>;
      goBack: () => Promise<void>;
      goForward: () => Promise<void>;
      reload: () => Promise<void>;

      getBookmarks: () => Promise<Bookmark[]>;
      addBookmark: (title: string, url: string) => Promise<Bookmark[]>;
      removeBookmark: (id: string) => Promise<Bookmark[]>;

      getHistory: () => Promise<HistoryEntry[]>;
      clearHistory: () => Promise<HistoryEntry[]>;

      getDownloads: () => Promise<Download[]>;
      openDownload: (id: string) => Promise<void>;
      showDownload: (id: string) => Promise<void>;

      getExtensions: () => Promise<SolarionExtension[]>;
      installExtension: () => Promise<{
        ok: boolean;
        canceled?: boolean;
        message?: string;
        extension?: SolarionExtension;
      }>;
      setExtensionEnabled: (
        id: string,
        enabled: boolean
      ) => Promise<{
        ok: boolean;
        message?: string;
        extensions?: SolarionExtension[];
      }>;
      removeExtension: (id: string) => Promise<{
        ok: boolean;
        message?: string;
        extensions?: SolarionExtension[];
      }>;

      checkForUpdates: () => Promise<{
        ok: boolean;
        message?: string;
      }>;
      getAppVersion: () => Promise<{
        version: string;
        packaged: boolean;
      } | null>;

      minimizeWindow: () => void;
      toggleMaximizeWindow: () => void;
      closeWindow: () => void;
      isWindowMaximized: () => Promise<boolean>;

      setBrowserBounds: (bounds: {
        x: number;
        y: number;
        width: number;
        height: number;
      }) => void;

      onTabsUpdated: (callback: (tabs: BrowserTab[]) => void) => () => void;
      onActiveTabChanged: (callback: (id: number) => void) => () => void;
      onBookmarksUpdated: (callback: (items: Bookmark[]) => void) => () => void;
      onHistoryUpdated: (callback: (items: HistoryEntry[]) => void) => () => void;
      onDownloadsUpdated: (callback: (items: Download[]) => void) => () => void;
      onExtensionsUpdated: (
        callback: (items: SolarionExtension[]) => void
      ) => () => void;
    };
  }
}

const DEFAULT_WORKSPACES = ["School", "Work", "Personal", "Research"];
const DEFAULT_GROUPS = ["Ungrouped"];

function readSaved<T>(key: string, fallback: T): T {
  try {
    const value = localStorage.getItem(key);
    return value ? JSON.parse(value) as T : fallback;
  } catch {
    return fallback;
  }
}

function formatTime(timestamp: number) {
  return new Date(timestamp).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit"
  });
}

function formatDate(timestamp: number) {
  return new Date(timestamp).toLocaleDateString([], {
    month: "short",
    day: "numeric"
  });
}

function formatBytes(bytes: number) {
  if (!bytes) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function App() {
  const [tabs, setTabs] = useState<BrowserTab[]>([]);
  const [activeTabId, setActiveTabId] = useState(1);
  const [address, setAddress] = useState("");

  const [workspaces, setWorkspaces] = useState<string[]>(
    () => readSaved("solarion-workspaces", DEFAULT_WORKSPACES)
  );
  const [groups, setGroups] = useState<string[]>(
    () => readSaved("solarion-groups", DEFAULT_GROUPS)
  );
  const [activeWorkspace, setActiveWorkspace] = useState(
    () => localStorage.getItem("solarion-active-workspace") || "School"
  );
  const [selectedGroup, setSelectedGroup] = useState("All tabs");
  const [tabMeta, setTabMeta] = useState<Record<number, TabMeta>>(
    () => readSaved("solarion-tab-metadata", {})
  );

  const [bookmarks, setBookmarks] = useState<Bookmark[]>([]);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [downloads, setDownloads] = useState<Download[]>([]);
  const [extensions, setExtensions] = useState<SolarionExtension[]>([]);
  const [extensionBusy, setExtensionBusy] = useState(false);

  const [readingList, setReadingList] = useState<ReadingItem[]>(
    () => readSaved("solarion-reading-list", [])
  );
  const [notes, setNotes] = useState(
    () => localStorage.getItem("solarion-notes") || ""
  );
  const [recentlyClosed, setRecentlyClosed] = useState<ClosedTab[]>([]);
  const [librarySearch, setLibrarySearch] = useState("");

  const [activePanel, setActivePanel] = useState<Panel>(null);
  const [searchEngine, setSearchEngine] = useState<SearchEngine>(
    () => localStorage.getItem("solarion-search-engine") as SearchEngine || "Google"
  );
  const [clock, setClock] = useState(new Date());
  const [isMaximized, setIsMaximized] = useState(false);

  const contentRef = useRef<HTMLDivElement>(null);
  const addressRef = useRef<HTMLInputElement>(null);

  const activeTab = tabs.find(tab => tab.id === activeTabId);

  const visibleTabs = tabs.filter(tab => {
    const meta = tabMeta[tab.id];
    const workspaceMatches = meta?.workspace === activeWorkspace;
    const groupMatches =
      selectedGroup === "All tabs" || meta?.group === selectedGroup;

    return workspaceMatches && groupMatches;
  });

  const currentPageBookmarked = !!activeTab &&
    bookmarks.some(bookmark => bookmark.url === activeTab.url);

  const currentPageInReadingList = !!activeTab &&
    readingList.some(item => item.url === activeTab.url);

  useEffect(() => {
    localStorage.setItem("solarion-workspaces", JSON.stringify(workspaces));
  }, [workspaces]);

  useEffect(() => {
    localStorage.setItem("solarion-groups", JSON.stringify(groups));
  }, [groups]);

  useEffect(() => {
    localStorage.setItem("solarion-tab-metadata", JSON.stringify(tabMeta));
  }, [tabMeta]);

  useEffect(() => {
    localStorage.setItem("solarion-active-workspace", activeWorkspace);
  }, [activeWorkspace]);

  useEffect(() => {
    localStorage.setItem("solarion-search-engine", searchEngine);
  }, [searchEngine]);

  useEffect(() => {
    localStorage.setItem("solarion-reading-list", JSON.stringify(readingList));
  }, [readingList]);

  useEffect(() => {
    localStorage.setItem("solarion-notes", notes);
  }, [notes]);

  useEffect(() => {
    const timer = window.setInterval(() => setClock(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    window.solarion.isWindowMaximized().then(setIsMaximized);
  }, []);

  useEffect(() => {
    const updateTabs = (newTabs: BrowserTab[]) => {
      setTabs(newTabs);

      setTabMeta(previous => {
        const next = { ...previous };

        for (const tab of newTabs) {
          if (!next[tab.id]) {
            next[tab.id] = {
              workspace: activeWorkspace,
              group: "Ungrouped"
            };
          }
        }

        for (const key of Object.keys(next)) {
          if (!newTabs.some(tab => tab.id === Number(key))) {
            delete next[Number(key)];
          }
        }

        return next;
      });
    };

    window.solarion.getTabs().then(updateTabs);
    const removeTabs = window.solarion.onTabsUpdated(updateTabs);
    const removeActive = window.solarion.onActiveTabChanged(setActiveTabId);

    return () => {
      removeTabs();
      removeActive();
    };
  }, [activeWorkspace]);

  useEffect(() => {
    window.solarion.getBookmarks().then(setBookmarks);
    window.solarion.getHistory().then(setHistory);
    window.solarion.getDownloads().then(setDownloads);
    window.solarion.getExtensions().then(setExtensions);

    const removeBookmarks = window.solarion.onBookmarksUpdated(setBookmarks);
    const removeHistory = window.solarion.onHistoryUpdated(setHistory);
    const removeDownloads = window.solarion.onDownloadsUpdated(setDownloads);
    const removeExtensions = window.solarion.onExtensionsUpdated(setExtensions);

    return () => {
      removeBookmarks();
      removeHistory();
      removeDownloads();
      removeExtensions();
    };
  }, []);

  useEffect(() => {
    if (!activeTab) return;
    setAddress(activeTab.url === "solarion://home" ? "" : activeTab.url);
  }, [activeTab]);

  useEffect(() => {
    const updateBounds = () => {
      const element = contentRef.current;
      if (!element) return;

      const rect = element.getBoundingClientRect();

      window.solarion.setBrowserBounds({
        x: Math.round(rect.left),
        y: Math.round(rect.top),
        width: Math.max(0, Math.round(rect.width)),
        height: Math.max(0, Math.round(rect.height))
      });
    };

    updateBounds();
    window.addEventListener("resize", updateBounds);

    const observer = new ResizeObserver(updateBounds);
    if (contentRef.current) observer.observe(contentRef.current);

    return () => {
      window.removeEventListener("resize", updateBounds);
      observer.disconnect();
    };
  }, [activePanel]);

  function navigate(value: string) {
    const text = value.trim();
    if (!text) return;

    const looksLikeAddress =
      /^https?:\/\//i.test(text) ||
      (/^[\w-]+(\.[\w-]+)+(:\d+)?(\/.*)?$/i.test(text) &&
        !text.includes(" "));

    let url: string;

    if (looksLikeAddress) {
      url = /^https?:\/\//i.test(text) ? text : `https://${text}`;
    } else {
      const encoded = encodeURIComponent(text);
      const searchUrls: Record<SearchEngine, string> = {
        Google: `https://www.google.com/search?q=${encoded}`,
        Bing: `https://www.bing.com/search?q=${encoded}`,
        DuckDuckGo: `https://duckduckgo.com/?q=${encoded}`
      };

      url = searchUrls[searchEngine];
    }

    setActivePanel(null);
    window.solarion.navigate(url);
  }

  function submitAddress(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    navigate(address);
  }

  async function newTab(url?: string) {
    const id = await window.solarion.createTab(url);

    setTabMeta(previous => ({
      ...previous,
      [id]: {
        workspace: activeWorkspace,
        group: "Ungrouped"
      }
    }));

    setSelectedGroup("All tabs");
    setActivePanel(null);
  }

  async function closeTab(tab: BrowserTab) {
    setRecentlyClosed(previous => [
      ...previous,
      {
        title: tab.title || "New Tab",
        url: tab.isHome ? "" : tab.url
      }
    ].slice(-30));

    await window.solarion.closeTab(tab.id);
  }

  async function restoreClosedTab() {
    if (recentlyClosed.length === 0) return;

    const last = recentlyClosed[recentlyClosed.length - 1];
    setRecentlyClosed(previous => previous.slice(0, -1));

    await newTab(last.url || undefined);
  }

  async function duplicateTab(tab: BrowserTab) {
    await newTab(tab.isHome ? undefined : tab.url);
  }

  async function switchWorkspace(name: string) {
    setActiveWorkspace(name);
    setSelectedGroup("All tabs");
    setActivePanel(null);

    const existing = tabs.find(
      tab => tabMeta[tab.id]?.workspace === name
    );

    if (existing) {
      await window.solarion.selectTab(existing.id);
    } else {
      const id = await window.solarion.createTab();

      setTabMeta(previous => ({
        ...previous,
        [id]: { workspace: name, group: "Ungrouped" }
      }));
    }
  }

  function addWorkspace() {
    const name = window.prompt("Name your new workspace:");
    if (!name?.trim()) return;

    const clean = name.trim();

    if (workspaces.includes(clean)) {
      window.alert("That workspace already exists.");
      return;
    }

    setWorkspaces(previous => [...previous, clean]);
    void switchWorkspace(clean);
  }

  function addGroup() {
    const name = window.prompt("Name your new tab group:");
    if (!name?.trim()) return;

    const clean = name.trim();

    if (groups.includes(clean)) {
      window.alert("That tab group already exists.");
      return;
    }

    setGroups(previous => [...previous, clean]);
    setSelectedGroup(clean);

    if (activeTab) {
      setTabMeta(previous => ({
        ...previous,
        [activeTab.id]: { workspace: activeWorkspace, group: clean }
      }));
    }
  }

  function moveActiveTab(group: string) {
    if (!activeTab) return;

    setTabMeta(previous => ({
      ...previous,
      [activeTab.id]: { workspace: activeWorkspace, group }
    }));
  }

  async function addBookmark() {
    if (!activeTab || activeTab.isHome || !activeTab.url.startsWith("http")) {
      return;
    }

    if (currentPageBookmarked) {
      setActivePanel("bookmarks");
      return;
    }

    const updated = await window.solarion.addBookmark(
      activeTab.title,
      activeTab.url
    );

    setBookmarks(updated);
  }

  async function removeBookmark(id: string) {
    const updated = await window.solarion.removeBookmark(id);
    setBookmarks(updated);
  }

  function addToReadingList() {
    if (!activeTab || activeTab.isHome || !activeTab.url.startsWith("http")) {
      return;
    }

    if (currentPageInReadingList) return;

    setReadingList(previous => [
      {
        id: `${Date.now()}-${Math.random()}`,
        title: activeTab.title || activeTab.url,
        url: activeTab.url,
        savedAt: Date.now()
      },
      ...previous
    ]);
  }

  function removeFromReadingList(id: string) {
    setReadingList(previous => previous.filter(item => item.id !== id));
  }

  async function clearHistory() {
    const confirmed = window.confirm(
      "Are you sure you want to clear your browsing history?"
    );

    if (!confirmed) return;

    const updated = await window.solarion.clearHistory();
    setHistory(updated);
  }

  function openPanel(panel: Panel) {
    setLibrarySearch("");
    setActivePanel(current => current === panel ? null : panel);
  }

  // =========================================
  // EXTENSION MANAGER
  // =========================================

  async function installExtension() {
    if (extensionBusy) return;

    setExtensionBusy(true);

    try {
      const result = await window.solarion.installExtension();

      if (result.canceled) return;

      if (!result.ok) {
        window.alert(
          result.message || "Solarion could not install this extension."
        );
        return;
      }

      const updated = await window.solarion.getExtensions();
      setExtensions(updated);

      window.alert(
        `Successfully loaded ${result.extension?.name || "extension"}.`
      );
    } catch (error) {
      console.error(error);
      window.alert("An error occurred while installing the extension.");
    } finally {
      setExtensionBusy(false);
    }
  }

  async function toggleExtension(extension: SolarionExtension) {
    if (extensionBusy) return;

    setExtensionBusy(true);

    try {
      const result = await window.solarion.setExtensionEnabled(
        extension.id,
        !extension.enabled
      );

      if (!result.ok) {
        window.alert(
          result.message || "Could not change extension settings."
        );
      }

      const updated = await window.solarion.getExtensions();
      setExtensions(updated);
    } catch (error) {
      console.error(error);
      window.alert("Could not update this extension.");
    } finally {
      setExtensionBusy(false);
    }
  }

  async function uninstallExtension(extension: SolarionExtension) {
    if (extensionBusy) return;

    const confirmed = window.confirm(
      `Remove ${extension.name} from Solarion? Its original folder will not be deleted.`
    );

    if (!confirmed) return;

    setExtensionBusy(true);

    try {
      const result = await window.solarion.removeExtension(extension.id);

      if (!result.ok) {
        window.alert(result.message || "Could not remove extension.");
      }

      const updated = await window.solarion.getExtensions();
      setExtensions(updated);
    } catch (error) {
      console.error(error);
      window.alert("Could not remove this extension.");
    } finally {
      setExtensionBusy(false);
    }
  }

  function openChromeWebStore() {
    void newTab("https://chromewebstore.google.com/category/extensions");
  }

  // =========================================
  // KEYBOARD SHORTCUTS
  // =========================================

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (!event.ctrlKey && !event.altKey) return;

      const key = event.key.toLowerCase();

      if (event.ctrlKey && event.shiftKey && key === "t") {
        event.preventDefault();
        void restoreClosedTab();
        return;
      }

      if (event.ctrlKey && event.shiftKey && key === "b") {
        event.preventDefault();
        openPanel("bookmarks");
        return;
      }

      if (event.ctrlKey && event.shiftKey && key === "n") {
        event.preventDefault();
        openPanel("notes");
        return;
      }

      if (event.ctrlKey && event.shiftKey && key === "e") {
        event.preventDefault();
        openPanel("extensions");
        return;
      }

      if (event.ctrlKey && key === "t") {
        event.preventDefault();
        void newTab();
        return;
      }

      if (event.ctrlKey && key === "w") {
        event.preventDefault();
        if (activeTab) void closeTab(activeTab);
        return;
      }

      if (event.ctrlKey && key === "l") {
        event.preventDefault();
        addressRef.current?.focus();
        addressRef.current?.select();
        return;
      }

      if (event.ctrlKey && key === "r") {
        event.preventDefault();
        void window.solarion.reload();
        return;
      }

      if (event.ctrlKey && key === "d") {
        event.preventDefault();
        void addBookmark();
        return;
      }

      if (event.ctrlKey && key === "h") {
        event.preventDefault();
        openPanel("history");
        return;
      }

      if (event.ctrlKey && key === "j") {
        event.preventDefault();
        openPanel("downloads");
        return;
      }

      if (event.ctrlKey && event.key === "Tab") {
        event.preventDefault();

        if (visibleTabs.length < 2) return;

        const currentIndex = visibleTabs.findIndex(
          tab => tab.id === activeTabId
        );

        const nextIndex = event.shiftKey
          ? (currentIndex - 1 + visibleTabs.length) % visibleTabs.length
          : (currentIndex + 1) % visibleTabs.length;

        void window.solarion.selectTab(visibleTabs[nextIndex].id);
        return;
      }

      if (event.ctrlKey && !event.shiftKey && /^[1-9]$/.test(event.key)) {
        event.preventDefault();

        const index = Number(event.key) - 1;

        if (visibleTabs[index]) {
          void window.solarion.selectTab(visibleTabs[index].id);
        }
      }
    }

    window.addEventListener("keydown", handleKeyDown);

    return () => window.removeEventListener("keydown", handleKeyDown);
  });

  // =========================================
  // FILTERED LIBRARY DATA
  // =========================================

  const shortcuts = [
    { name: "YouTube", url: "https://www.youtube.com/", symbol: "▶" },
    { name: "Google", url: "https://www.google.com/", symbol: "G" },
    { name: "Wikipedia", url: "https://www.wikipedia.org/", symbol: "W" },
    { name: "GitHub", url: "https://github.com/", symbol: "⌘" },
    { name: "Gmail", url: "https://mail.google.com/", symbol: "✉" },
    { name: "Reddit", url: "https://www.reddit.com/", symbol: "◉" }
  ];

  const filteredBookmarks = bookmarks.filter(item =>
    `${item.title} ${item.url}`.toLowerCase().includes(librarySearch.toLowerCase())
  );

  const filteredHistory = history.filter(item =>
    `${item.title} ${item.url}`.toLowerCase().includes(librarySearch.toLowerCase())
  );

  const filteredDownloads = downloads.filter(item =>
    `${item.name} ${item.url}`.toLowerCase().includes(librarySearch.toLowerCase())
  );

  const filteredReading = readingList.filter(item =>
    `${item.title} ${item.url}`.toLowerCase().includes(librarySearch.toLowerCase())
  );

  const filteredExtensions = extensions.filter(item =>
    `${item.name} ${item.version} ${item.manifestVersion}`
      .toLowerCase()
      .includes(librarySearch.toLowerCase())
  );

  // =========================================
  // INTERFACE
  // =========================================

  return (
    <main className="browser-shell">
      <header className="titlebar">
        <div className="titlebar-brand">
          <span className="brand-symbol">✦</span>
          <span className="brand-name">SOLARION</span>
          <span className="brand-edition">BROWSER</span>
        </div>

        <div className="titlebar-center">
          {activeTab?.title || "Your universe. Your rules."}
        </div>

        <div className="window-controls">
          <button onClick={() => window.solarion.minimizeWindow()} title="Minimize">−</button>
          <button
            onClick={() => {
              window.solarion.toggleMaximizeWindow();
              setIsMaximized(previous => !previous);
            }}
            title={isMaximized ? "Restore" : "Maximize"}
          >
            {isMaximized ? "❐" : "□"}
          </button>
          <button
            className="window-close"
            onClick={() => window.solarion.closeWindow()}
            title="Close Solarion"
          >×</button>
        </div>
      </header>

      <div className="tabs-bar">
        <div className="tab-list">
          {visibleTabs.map(tab => (
            <div
              key={tab.id}
              className={`browser-tab ${activeTabId === tab.id ? "active" : ""}`}
              onClick={() => {
                void window.solarion.selectTab(tab.id);
                setActivePanel(null);
              }}
              onContextMenu={event => {
                event.preventDefault();
                void duplicateTab(tab);
              }}
              title={`${tab.url}\nRight-click to duplicate`}
            >
              <span className="tab-loading">{tab.isLoading ? "◌" : "●"}</span>
              <span className="tab-title">{tab.title || "New Tab"}</span>
              <button
                className="tab-close"
                onClick={event => {
                  event.stopPropagation();
                  void closeTab(tab);
                }}
                aria-label="Close tab"
              >×</button>
            </div>
          ))}
        </div>

        <button
          className="new-tab-button"
          onClick={() => void newTab()}
          title="New tab (Ctrl+T)"
        >+</button>
      </div>

      <div className="browser-toolbar">
        <button
          className="nav-button"
          onClick={() => void window.solarion.goBack()}
          disabled={!activeTab?.canGoBack}
          title="Back"
        >←</button>

        <button
          className="nav-button"
          onClick={() => void window.solarion.goForward()}
          disabled={!activeTab?.canGoForward}
          title="Forward"
        >→</button>

        <button
          className="nav-button"
          onClick={() => void window.solarion.reload()}
          title="Reload (Ctrl+R)"
        >↻</button>

        <button
          className="nav-button home-button"
          onClick={() => void newTab()}
          title="New tab"
        >⌂</button>

        <form className="address-form" onSubmit={submitAddress}>
          <span className="address-lock">⌕</span>
          <input
            ref={addressRef}
            value={address}
            onChange={event => setAddress(event.target.value)}
            placeholder="Search or enter a website address..."
            aria-label="Website address"
          />
          <button className="go-button" type="submit">Go</button>
        </form>

        <button
          className={`nav-button bookmark-star ${currentPageBookmarked ? "bookmarked" : ""}`}
          onClick={() => void addBookmark()}
          title="Save bookmark (Ctrl+D)"
        >{currentPageBookmarked ? "★" : "☆"}</button>

        <button
          className="nav-button"
          onClick={addToReadingList}
          title="Save to reading list"
          style={{ fontSize: 15 }}
        >▤</button>

        <button
          className={`nav-button ${activePanel === "extensions" ? "bookmarked" : ""}`}
          onClick={() => openPanel("extensions")}
          title="Extensions (Ctrl+Shift+E)"
        >🧩</button>

        <select
          className="search-engine-select"
          value={searchEngine}
          onChange={event => setSearchEngine(event.target.value as SearchEngine)}
          title="Search engine"
          aria-label="Search engine"
        >
          <option value="Google">Google</option>
          <option value="Bing">Bing</option>
          <option value="DuckDuckGo">DuckDuckGo</option>
        </select>
      </div>

      <div className="workspace-bar">
        <span className="workspace-label">SPACES</span>

        {workspaces.map(name => (
          <button
            key={name}
            className={`workspace-button ${activeWorkspace === name ? "selected" : ""}`}
            onClick={() => void switchWorkspace(name)}
            onContextMenu={event => {
              event.preventDefault();

              const newName = window.prompt("Rename workspace:", name);
              if (!newName?.trim() || newName.trim() === name) return;

              const clean = newName.trim();

              if (workspaces.includes(clean)) {
                window.alert("That workspace already exists.");
                return;
              }

              setWorkspaces(previous =>
                previous.map(item => item === name ? clean : item)
              );

              setTabMeta(previous => {
                const next = { ...previous };

                for (const key of Object.keys(next)) {
                  if (next[Number(key)].workspace === name) {
                    next[Number(key)] = {
                      ...next[Number(key)],
                      workspace: clean
                    };
                  }
                }

                return next;
              });

              if (activeWorkspace === name) setActiveWorkspace(clean);
            }}
            title="Right-click to rename"
          >{name}</button>
        ))}

        <button
          className="workspace-add"
          onClick={addWorkspace}
          title="Create workspace"
        >+</button>

        <span className="workspace-spacer" />

        <select
          className="group-select"
          value={selectedGroup}
          onChange={event => setSelectedGroup(event.target.value)}
          aria-label="Filter tab group"
        >
          <option value="All tabs">All groups</option>
          {groups.map(group => (
            <option key={group} value={group}>{group}</option>
          ))}
        </select>

        <button className="group-add" onClick={addGroup}>+ Group</button>

        <select
          className="group-select"
          value={activeTab ? tabMeta[activeTab.id]?.group || "Ungrouped" : "Ungrouped"}
          onChange={event => moveActiveTab(event.target.value)}
          aria-label="Move active tab to group"
        >
          {groups.map(group => (
            <option key={group} value={group}>{group}</option>
          ))}
        </select>
      </div>

      <div className="browser-main">
        <div className="browser-content" ref={contentRef}>
          {activeTab?.isHome && (
            <section className="home-dashboard">
              <div className="dashboard-topline">
                <span className="dashboard-tag">SOLARION COMMAND CENTER</span>
                <span className="dashboard-status">
                  <span className="status-dot" />
                  READY TO EXPLORE
                </span>
              </div>

              <div className="dashboard-center">
                <div className="home-orb">✦</div>
                <p className="home-eyebrow">YOUR UNIVERSE. YOUR RULES.</p>
                <h1>Explore beyond<br /><span>the ordinary.</span></h1>

                <div className="dashboard-clock">
                  {clock.toLocaleTimeString([], {
                    hour: "2-digit",
                    minute: "2-digit"
                  })}
                </div>

                <p className="dashboard-date">
                  {clock.toLocaleDateString([], {
                    weekday: "long",
                    month: "long",
                    day: "numeric",
                    year: "numeric"
                  })}
                </p>

                <form className="dashboard-search" onSubmit={submitAddress}>
                  <span>⌕</span>
                  <input
                    value={address}
                    onChange={event => setAddress(event.target.value)}
                    placeholder={`Search with ${searchEngine} or enter an address...`}
                  />
                  <button type="submit">Search</button>
                </form>

                <div className="shortcut-grid">
                  {shortcuts.map(shortcut => (
                    <button
                      className="shortcut-card"
                      key={shortcut.name}
                      onClick={() => navigate(shortcut.url)}
                    >
                      <span className="shortcut-symbol">{shortcut.symbol}</span>
                      <strong>{shortcut.name}</strong>
                      <span className="shortcut-arrow">↗</span>
                    </button>
                  ))}
                </div>

                <div style={{
                  display: "flex",
                  flexWrap: "wrap",
                  justifyContent: "center",
                  gap: 8,
                  marginTop: 20
                }}>
                  <button className="group-add" onClick={() => openPanel("notes")}>✎ Notes</button>
                  <button className="group-add" onClick={() => openPanel("reading")}>▤ Reading list</button>
                  <button
                    className="group-add"
                    onClick={restoreClosedTab}
                    disabled={recentlyClosed.length === 0}
                  >
                    ↶ Reopen closed tab ({recentlyClosed.length})
                  </button>
                  <button
                    className="group-add"
                    onClick={() => openPanel("extensions")}
                  >🧩 Extensions</button>
                </div>
              </div>

              <div className="dashboard-footer">
                <span>{activeWorkspace} workspace</span>
                <span>Built for discovery.</span>
              </div>
            </section>
          )}
        </div>

        {activePanel && (
          <aside className="right-sidebar">
            <div className="sidebar-heading">
              <div>
                <span className="sidebar-eyebrow">SOLARION LIBRARY</span>
                <h2>
                  {activePanel === "bookmarks" && "Bookmarks"}
                  {activePanel === "history" && "History"}
                  {activePanel === "downloads" && "Downloads"}
                  {activePanel === "notes" && "Notes"}
                  {activePanel === "reading" && "Read later"}
                  {activePanel === "extensions" && "Extensions"}
                </h2>
              </div>

              <button
                className="sidebar-close"
                onClick={() => setActivePanel(null)}
                title="Close sidebar"
              >×</button>
            </div>

            {activePanel !== "notes" && (
              <div style={{ padding: "10px 10px 0" }}>
                <input
                  value={librarySearch}
                  onChange={event => setLibrarySearch(event.target.value)}
                  placeholder={`Search ${activePanel}...`}
                  style={{
                    width: "100%",
                    padding: "9px 10px",
                    border: "1px solid #34415b",
                    borderRadius: 6,
                    outline: "none",
                    background: "#090f1d",
                    color: "#edf0fa",
                    fontSize: 11
                  }}
                />
              </div>
            )}

            {activePanel === "extensions" && (
              <div className="sidebar-list">
                <div style={{
                  padding: 12,
                  borderBottom: "1px solid #26334b"
                }}>
                  <div style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    gap: 8,
                    marginBottom: 10
                  }}>
                    <strong style={{ fontSize: 12 }}>Extension manager</strong>
                    <span style={{ fontSize: 10, color: "#93a5c1" }}>
                      {extensions.length} installed
                    </span>
                  </div>

                  <button
                    className="group-add"
                    style={{ width: "100%", padding: "10px 12px" }}
                    onClick={() => void installExtension()}
                    disabled={extensionBusy}
                  >
                    {extensionBusy ? "Working..." : "+ Install unpacked extension"}
                  </button>

                  <button
                    className="group-add"
                    style={{ width: "100%", marginTop: 8, padding: "10px 12px" }}
                    onClick={openChromeWebStore}
                  >
                    Open Chrome Web Store ↗
                  </button>
                </div>

                <div style={{
                  padding: "11px 12px",
                  color: "#9eabc1",
                  fontSize: 10,
                  lineHeight: 1.6,
                  borderBottom: "1px solid #26334b"
                }}>
                  Solarion loads unpacked extension folders. The Chrome Web Store
                  link is for browsing only; extensions cannot be installed
                  directly from its Install button.
                </div>

                {filteredExtensions.length === 0 ? (
                  <div className="sidebar-empty">
                    <span>🧩</span>
                    <strong>No matching extensions</strong>
                    <p>
                      Install an unpacked extension folder to get started.
                    </p>
                  </div>
                ) : (
                  filteredExtensions.map(extension => (
                    <div
                      className="download-item"
                      key={extension.id}
                      style={{
                        padding: 12,
                        borderBottom: "1px solid #26334b"
                      }}
                    >
                      <div style={{
                        display: "flex",
                        alignItems: "flex-start",
                        justifyContent: "space-between",
                        gap: 8
                      }}>
                        <div style={{ minWidth: 0 }}>
                          <strong style={{
                            display: "block",
                            color: "#edf0fa",
                            fontSize: 12,
                            overflowWrap: "anywhere"
                          }}>
                            {extension.name}
                          </strong>

                          <span style={{
                            display: "block",
                            color: "#91a1bb",
                            fontSize: 10,
                            marginTop: 5
                          }}>
                            Version {extension.version}
                          </span>
                        </div>

                        <span style={{
                          fontSize: 9,
                          color: extension.enabled ? "#71d6a2" : "#9ca9bd",
                          whiteSpace: "nowrap"
                        }}>
                          {extension.enabled ? "● Enabled" : "○ Disabled"}
                        </span>
                      </div>

                      <div style={{
                        display: "flex",
                        flexWrap: "wrap",
                        gap: 6,
                        marginTop: 9
                      }}>
                        <span style={{
                          border: "1px solid #35425b",
                          borderRadius: 5,
                          padding: "3px 6px",
                          color: "#b9c7dc",
                          fontSize: 9
                        }}>
                          Manifest V{extension.manifestVersion}
                        </span>

                        <span style={{
                          border: "1px solid #35425b",
                          borderRadius: 5,
                          padding: "3px 6px",
                          color: "#b9c7dc",
                          fontSize: 9
                        }}>
                          Chrome extension
                        </span>
                      </div>

                      {extension.error && (
                        <p style={{
                          color: "#ff9d9d",
                          fontSize: 10,
                          lineHeight: 1.5,
                          marginTop: 9,
                          overflowWrap: "anywhere"
                        }}>
                          {extension.error}
                        </p>
                      )}

                      <div style={{
                        display: "flex",
                        gap: 7,
                        marginTop: 11
                      }}>
                        <button
                          className="group-add"
                          style={{ flex: 1 }}
                          disabled={extensionBusy}
                          onClick={() => void toggleExtension(extension)}
                        >
                          {extension.enabled ? "Disable" : "Enable"}
                        </button>

                        <button
                          className="group-add"
                          style={{ flex: 1 }}
                          disabled={extensionBusy}
                          onClick={() => void uninstallExtension(extension)}
                        >
                          Remove
                        </button>
                      </div>
                    </div>
                  ))
                )}

                <div style={{
                  padding: 12,
                  color: "#8290a8",
                  fontSize: 10,
                  lineHeight: 1.6
                }}>
                  Compatibility depends on Electron's Chromium engine and
                  extension API support. Manifest V2 extensions, including
                  classic uBlock Origin, are not guaranteed to work.
                  Only install extensions from sources you trust.
                </div>
              </div>
            )}

            {activePanel === "notes" && (
              <div className="sidebar-list">
                <div className="sidebar-list-actions">
                  <span>Saved automatically on this device</span>
                  <button onClick={() => {
                    if (window.confirm("Clear all your notes?")) setNotes("");
                  }}>Clear</button>
                </div>

                <textarea
                  value={notes}
                  onChange={event => setNotes(event.target.value)}
                  placeholder="Write your notes here..."
                  style={{
                    width: "100%",
                    minHeight: 300,
                    resize: "vertical",
                    padding: 12,
                    border: "1px solid #34415b",
                    borderRadius: 7,
                    outline: "none",
                    background: "#090f1d",
                    color: "#edf0fa",
                    fontFamily: "inherit",
                    fontSize: 12,
                    lineHeight: 1.7,
                    userSelect: "text"
                  }}
                />

                <p style={{ color: "#8290a8", fontSize: 10 }}>
                  Your notes are stored locally in Solarion.
                </p>
              </div>
            )}

            {activePanel === "bookmarks" && (
              <div className="sidebar-list">
                {filteredBookmarks.length === 0 ? (
                  <div className="sidebar-empty">
                    <span>☆</span>
                    <strong>No matching bookmarks</strong>
                    <p>Save a website using the star in the toolbar.</p>
                  </div>
                ) : filteredBookmarks.map(bookmark => (
                  <div className="sidebar-item" key={bookmark.id}>
                    <button
                      className="sidebar-item-main"
                      onClick={() => navigate(bookmark.url)}
                    >
                      <strong>{bookmark.title}</strong>
                      <span>{bookmark.url}</span>
                    </button>

                    <button
                      className="sidebar-item-delete"
                      onClick={() => void removeBookmark(bookmark.id)}
                      title="Remove bookmark"
                    >×</button>
                  </div>
                ))}
              </div>
            )}

            {activePanel === "history" && (
              <div className="sidebar-list">
                <div className="sidebar-list-actions">
                  <span>{filteredHistory.length} visits</span>
                  <button onClick={() => void clearHistory()}>Clear history</button>
                </div>

                {filteredHistory.length === 0 ? (
                  <div className="sidebar-empty">
                    <span>◷</span>
                    <strong>No matching history</strong>
                    <p>Your visited websites appear here.</p>
                  </div>
                ) : filteredHistory.map(entry => (
                  <button
                    className="history-item"
                    key={entry.id}
                    onClick={() => navigate(entry.url)}
                  >
                    <strong>{entry.title}</strong>
                    <span>{entry.url}</span>
                    <small>
                      {formatDate(entry.visitedAt)} · {formatTime(entry.visitedAt)}
                    </small>
                  </button>
                ))}
              </div>
            )}

            {activePanel === "downloads" && (
              <div className="sidebar-list">
                {filteredDownloads.length === 0 ? (
                  <div className="sidebar-empty">
                    <span>↓</span>
                    <strong>No matching downloads</strong>
                    <p>Files you download will appear here.</p>
                  </div>
                ) : filteredDownloads.map(download => (
                  <div className="download-item" key={download.id}>
                    <strong>{download.name}</strong>

                    <span>
                      {download.state === "completed"
                        ? "Completed"
                        : download.state === "interrupted"
                          ? "Interrupted"
                          : `${formatBytes(download.receivedBytes)} / ${formatBytes(download.totalBytes)}`}
                    </span>

                    {download.totalBytes > 0 && download.state === "progressing" && (
                      <div className="download-progress">
                        <div style={{
                          width: `${Math.min(100, download.receivedBytes / download.totalBytes * 100)}%`
                        }} />
                      </div>
                    )}

                    <div className="download-actions">
                      <button
                        disabled={!download.savePath}
                        onClick={() => void window.solarion.openDownload(download.id)}
                      >Open</button>

                      <button
                        disabled={!download.savePath}
                        onClick={() => void window.solarion.showDownload(download.id)}
                      >Show in folder</button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {activePanel === "reading" && (
              <div className="sidebar-list">
                <div className="sidebar-list-actions">
                  <span>{readingList.length} saved pages</span>

                  <button onClick={() => {
                    if (window.confirm("Clear your entire reading list?")) {
                      setReadingList([]);
                    }
                  }}>Clear list</button>
                </div>

                {filteredReading.length === 0 ? (
                  <div className="sidebar-empty">
                    <span>▤</span>
                    <strong>Nothing saved to read</strong>
                    <p>Use the book icon in the toolbar to save a page for later.</p>
                  </div>
                ) : filteredReading.map(item => (
                  <div className="sidebar-item" key={item.id}>
                    <button
                      className="sidebar-item-main"
                      onClick={() => navigate(item.url)}
                    >
                      <strong>{item.title}</strong>
                      <span>{item.url}</span>
                      <span>Saved {formatDate(item.savedAt)}</span>
                    </button>

                    <button
                      className="sidebar-item-delete"
                      onClick={() => removeFromReadingList(item.id)}
                      title="Remove from reading list"
                    >×</button>
                  </div>
                ))}
              </div>
            )}
          </aside>
        )}
      </div>

      <div className="side-dock">
        <button
          className={activePanel === "bookmarks" ? "dock-active" : ""}
          onClick={() => openPanel("bookmarks")}
          title="Bookmarks (Ctrl+Shift+B)"
        >☆</button>

        <button
          className={activePanel === "history" ? "dock-active" : ""}
          onClick={() => openPanel("history")}
          title="History (Ctrl+H)"
        >◷</button>

        <button
          className={activePanel === "downloads" ? "dock-active" : ""}
          onClick={() => openPanel("downloads")}
          title="Downloads (Ctrl+J)"
        >↓</button>

        <button
          className={activePanel === "reading" ? "dock-active" : ""}
          onClick={() => openPanel("reading")}
          title="Reading list"
        >▤</button>

        <button
          className={activePanel === "notes" ? "dock-active" : ""}
          onClick={() => openPanel("notes")}
          title="Notes (Ctrl+Shift+N)"
        >✎</button>

        <button
          className={activePanel === "extensions" ? "dock-active" : ""}
          onClick={() => openPanel("extensions")}
          title="Extensions (Ctrl+Shift+E)"
        >🧩</button>
      </div>
    </main>
  );
}

export default App;
