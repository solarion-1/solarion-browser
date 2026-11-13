
const {
  app,
  BrowserWindow,
  WebContentsView,
  ipcMain,
  session,
  shell,
  dialog
} = require("electron");

const { autoUpdater } = require("electron-updater");
const path = require("node:path");
const fs = require("node:fs/promises");
const { randomUUID } = require("node:crypto");

let mainWindow = null;
let sharedSession = null;

let tabs = [];
let activeTabId = 1;
let nextTabId = 1;

let bookmarks = [];
let history = [];
let downloads = [];
let closedTabs = [];
let extensions = [];

let bookmarksFile;
let historyFile;
let extensionsFile;

let updateCheckTimer = null;
let updateDialogOpen = false;

let browserBounds = {
  x: 0,
  y: 156,
  width: 1100,
  height: 700
};

const HOME_URL = "http://127.0.0.1:5173";
const MAX_CLOSED_TABS = 20;

// =========================================
// AUTOMATIC UPDATES
// =========================================

function setupAutoUpdates() {
  if (!app.isPackaged) {
    console.log("Solarion updates disabled in development.");
    return;
  }

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.allowPrerelease = false;

  autoUpdater.on("checking-for-update", () => {
    console.log("Checking for Solarion updates...");
  });

  autoUpdater.on("update-available", info => {
    console.log("Update available:", info.version);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.setProgressBar(0.05);
    }
  });

  autoUpdater.on("update-not-available", () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.setProgressBar(-1);
    }
  });

  autoUpdater.on("download-progress", progress => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.setProgressBar(progress.percent / 100);
    }
  });

  autoUpdater.on("update-downloaded", async info => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.setProgressBar(-1);
    }

    if (updateDialogOpen) return;
    updateDialogOpen = true;

    try {
      const result = await dialog.showMessageBox(
        mainWindow && !mainWindow.isDestroyed()
          ? mainWindow
          : undefined,
        {
          type: "info",
          title: "Solarion Update Ready",
          message: `Solarion ${info.version} is ready to install.`,
          detail: "Restart Solarion to install the update.",
          buttons: ["Restart and install", "Later"],
          defaultId: 0,
          cancelId: 1,
          noLink: true
        }
      );

      if (result.response === 0) {
        autoUpdater.quitAndInstall(false, true);
      }
    } catch (error) {
      console.error("Update dialog error:", error);
    } finally {
      updateDialogOpen = false;
    }
  });

  autoUpdater.on("error", error => {
    console.error("Solarion update error:", error);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.setProgressBar(-1);
    }
  });

  setTimeout(checkForSolarionUpdates, 15000);

  updateCheckTimer = setInterval(
    checkForSolarionUpdates,
    6 * 60 * 60 * 1000
  );
}

async function checkForSolarionUpdates() {
  if (!app.isPackaged) return;

  try {
    await autoUpdater.checkForUpdates();
  } catch (error) {
    console.error("Update check failed:", error);
  }
}

// =========================================
// GENERAL HELPERS
// =========================================

function allowedUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

function validSender(event) {
  return (
    mainWindow &&
    !mainWindow.isDestroyed() &&
    event.sender === mainWindow.webContents
  );
}

function getActiveTab() {
  return tabs.find(tab => tab.id === activeTabId);
}

function getPublicTabs() {
  return tabs.map(tab => ({
    id: tab.id,
    title: tab.title,
    url: tab.url,
    isLoading: tab.isLoading,
    canGoBack: !!tab.view?.webContents.canGoBack(),
    canGoForward: !!tab.view?.webContents.canGoForward(),
    isHome: !tab.view
  }));
}

function sendToUI(channel, data) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send(channel, data);
}

function sendUpdates() {
  sendToUI("tabs:updated", getPublicTabs());
  sendToUI("tabs:active-changed", activeTabId);
}

function updateViews() {
  if (!mainWindow || mainWindow.isDestroyed()) return;

  for (const tab of tabs) {
    if (tab.view) {
      tab.view.setBounds({
        x: 0,
        y: 0,
        width: 0,
        height: 0
      });
    }
  }

  const active = getActiveTab();

  if (active?.view) {
    active.view.setBounds(browserBounds);
  }
}

// =========================================
// DATA STORAGE
// =========================================

async function readJson(file, fallback) {
  try {
    return JSON.parse(await fs.readFile(file, "utf8"));
  } catch {
    return fallback;
  }
}

async function writeJson(file, data) {
  if (!file) return;

  try {
    await fs.writeFile(
      file,
      JSON.stringify(data, null, 2),
      "utf8"
    );
  } catch (error) {
    console.error("Solarion could not save data:", error);
  }
}

async function saveBookmarks() {
  await writeJson(bookmarksFile, bookmarks);
  sendToUI("bookmarks:updated", bookmarks);
}

async function saveHistory() {
  await writeJson(historyFile, history);
  sendToUI("history:updated", history);
}

async function recordHistory(url, title) {
  if (!allowedUrl(url)) return;

  history.unshift({
    id: randomUUID(),
    title: title || url,
    url,
    visitedAt: Date.now()
  });

  history = history.slice(0, 2000);
  await saveHistory();
}

function sendDownloads() {
  sendToUI("downloads:updated", downloads);
}

// =========================================
// SOLARION EXTENSIONS
// =========================================

// Only unpacked extension folders are supported.
// Extensions are stored in Solarion's user data folder
// as references to their original folders.

function publicExtensions() {
  return extensions.map(extension => ({
    id: extension.id,
    name: extension.name,
    version: extension.version,
    manifestVersion: extension.manifestVersion,
    enabled: !!extension.enabled,
    path: extension.path,
    error: extension.error || null
  }));
}

async function saveExtensions() {
  await writeJson(extensionsFile, extensions);
  sendToUI("extensions:updated", publicExtensions());
}

async function inspectExtensionFolder(folder) {
  const manifestPath = path.join(folder, "manifest.json");

  const stats = await fs.stat(folder);
  if (!stats.isDirectory()) {
    throw new Error("Please select an extension folder.");
  }

  const manifestStats = await fs.stat(manifestPath);
  if (!manifestStats.isFile()) {
    throw new Error("This folder does not contain manifest.json.");
  }

  const manifest = JSON.parse(
    await fs.readFile(manifestPath, "utf8")
  );

  if (![2, 3].includes(manifest.manifest_version)) {
    throw new Error("Only Manifest V2 and V3 extensions can be tested.");
  }

  if (
    typeof manifest.name !== "string" ||
    typeof manifest.version !== "string"
  ) {
    throw new Error("The extension manifest is missing its name or version.");
  }

  return {
    name: manifest.name.slice(0, 200),
    version: manifest.version.slice(0, 50),
    manifestVersion: manifest.manifest_version
  };
}

async function loadSavedExtensions() {
  for (const item of extensions) {
    if (!item.enabled || !item.path) continue;

    try {
      const details = await inspectExtensionFolder(item.path);

      const loaded = await sharedSession.loadExtension(
        item.path,
        { allowFileAccess: false }
      );

      item.id = loaded.id;
      item.name = details.name;
      item.version = details.version;
      item.manifestVersion = details.manifestVersion;
      item.error = null;

      console.log("Loaded Solarion extension:", item.name);
    } catch (error) {
      item.error = error.message || "Could not load extension.";
      console.error(
        "Could not load extension:",
        item.name,
        error
      );
    }
  }

  await saveExtensions();
}

async function chooseAndInstallExtension() {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: "Select an unpacked Chrome extension folder",
    properties: ["openDirectory"]
  });

  if (result.canceled || !result.filePaths.length) {
    return { ok: false, canceled: true };
  }

  const folder = path.resolve(result.filePaths[0]);

  try {
    const details = await inspectExtensionFolder(folder);

    const existing = extensions.find(
      item => path.resolve(item.path) === folder
    );

    if (existing) {
      if (existing.enabled) {
        return {
          ok: false,
          message: "This extension is already installed."
        };
      }

      const loaded = await sharedSession.loadExtension(folder, {
        allowFileAccess: false
      });

      existing.id = loaded.id;
      existing.enabled = true;
      existing.error = null;

      await saveExtensions();

      return { ok: true, extension: publicExtensions().find(
        item => item.id === existing.id
      ) };
    }

    const loaded = await sharedSession.loadExtension(folder, {
      allowFileAccess: false
    });

    const record = {
      id: loaded.id,
      name: details.name,
      version: details.version,
      manifestVersion: details.manifestVersion,
      path: folder,
      enabled: true,
      error: null
    };

    extensions.push(record);
    await saveExtensions();

    return {
      ok: true,
      extension: record
    };
  } catch (error) {
    console.error("Extension installation failed:", error);

    return {
      ok: false,
      message:
        error.message ||
        "Solarion could not load this extension. It may use unsupported Chrome APIs."
    };
  }
}

async function setExtensionEnabled(id, enabled) {
  const item = extensions.find(extension => extension.id === id);

  if (!item) {
    return { ok: false, message: "Extension not found." };
  }

  try {
    if (enabled) {
      const details = await inspectExtensionFolder(item.path);

      const loaded = await sharedSession.loadExtension(item.path, {
        allowFileAccess: false
      });

      item.id = loaded.id;
      item.name = details.name;
      item.version = details.version;
      item.manifestVersion = details.manifestVersion;
      item.enabled = true;
      item.error = null;
    } else {
      sharedSession.removeExtension(item.id);
      item.enabled = false;
      item.error = null;
    }

    await saveExtensions();
    return { ok: true, extensions: publicExtensions() };
  } catch (error) {
    item.enabled = false;
    item.error = error.message || "Could not change extension state.";

    await saveExtensions();

    return {
      ok: false,
      message: item.error
    };
  }
}

async function removeExtension(id) {
  const index = extensions.findIndex(item => item.id === id);

  if (index === -1) {
    return { ok: false, message: "Extension not found." };
  }

  const item = extensions[index];

  try {
    if (item.enabled) {
      sharedSession.removeExtension(item.id);
    }

    extensions.splice(index, 1);
    await saveExtensions();

    // The original extension folder is deliberately not deleted.
    return { ok: true, extensions: publicExtensions() };
  } catch (error) {
    return {
      ok: false,
      message: error.message || "Could not remove extension."
    };
  }
}

// =========================================
// KEYBOARD SHORTCUTS
// =========================================

function restoreLastClosedTab() {
  const lastClosed = closedTabs.pop();
  if (!lastClosed) return;

  createTab(lastClosed.url);
}

function handleBrowserShortcut(event, input) {
  if (input.type !== "keyDown") return;

  const key = String(input.key || "").toLowerCase();
  const control = input.control || input.meta;
  const shift = input.shift;

  if (!control) return;

  if (key === "t" && shift) {
    event.preventDefault();
    restoreLastClosedTab();
    return;
  }

  if (key === "t" && !shift) {
    event.preventDefault();
    createTab();
    return;
  }

  if (key === "w" && !shift) {
    event.preventDefault();
    if (getActiveTab()) closeTab(activeTabId);
  }
}

function attachKeyboardShortcuts(webContents) {
  webContents.on("before-input-event", handleBrowserShortcut);
}

// =========================================
// BROWSER VIEWS
// =========================================

function createView(tab, url) {
  const view = new WebContentsView({
    webPreferences: {
      session: sharedSession,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  tab.view = view;
  mainWindow.contentView.addChildView(view);

  attachKeyboardShortcuts(view.webContents);

  view.webContents.setWindowOpenHandler(({ url: newUrl }) => {
    if (allowedUrl(newUrl)) createTab(newUrl);
    return { action: "deny" };
  });

  view.webContents.on("will-navigate", (event, nextUrl) => {
    if (!allowedUrl(nextUrl)) event.preventDefault();
  });

  view.webContents.on("page-title-updated", (_event, title) => {
    tab.title = title || "New Tab";
    sendUpdates();
  });

  view.webContents.on("did-navigate", (_event, nextUrl) => {
    tab.url = nextUrl;
    recordHistory(nextUrl, tab.title);
    sendUpdates();
  });

  view.webContents.on("did-navigate-in-page", (_event, nextUrl) => {
    tab.url = nextUrl;
    sendUpdates();
  });

  view.webContents.on("did-start-loading", () => {
    tab.isLoading = true;
    sendUpdates();
  });

  view.webContents.on("did-stop-loading", () => {
    tab.isLoading = false;
    sendUpdates();
  });

  view.webContents.on("did-fail-load", (_event, code) => {
    if (code !== -3) {
      tab.isLoading = false;
      sendUpdates();
    }
  });

  view.webContents.loadURL(url);
  updateViews();

  return view;
}

function createTab(url = null) {
  const tab = {
    id: nextTabId++,
    title: "New Tab",
    url: "solarion://home",
    isLoading: false,
    view: null
  };

  tabs.push(tab);
  activeTabId = tab.id;

  if (url && allowedUrl(url)) {
    tab.url = url;
    createView(tab, url);
  }

  updateViews();
  sendUpdates();

  return tab.id;
}

function closeTab(id) {
  const index = tabs.findIndex(tab => tab.id === id);
  if (index === -1) return;

  const [tab] = tabs.splice(index, 1);

  const closedUrl = tab.view
    ? tab.view.webContents.getURL()
    : null;

  closedTabs.push({
    url: allowedUrl(closedUrl) ? closedUrl : null
  });

  if (closedTabs.length > MAX_CLOSED_TABS) {
    closedTabs.shift();
  }

  if (tab.view) {
    mainWindow.contentView.removeChildView(tab.view);
    tab.view.webContents.close();
  }

  if (tabs.length === 0) {
    createTab();
    return;
  }

  if (activeTabId === id) {
    activeTabId = tabs[Math.max(0, index - 1)].id;
  }

  updateViews();
  sendUpdates();
}

// =========================================
// APPLICATION WINDOW
// =========================================

async function loadApplicationInterface() {
  if (!mainWindow) return;

  if (app.isPackaged) {
    const appPage = path.join(__dirname, "..", "dist", "index.html");
    await mainWindow.loadFile(appPage);
  } else {
    await mainWindow.loadURL(HOME_URL);
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 950,
    minHeight: 650,
    frame: false,
    title: "Solarion Browser",
    backgroundColor: "#080b16",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  attachKeyboardShortcuts(mainWindow.webContents);

  mainWindow.webContents.setWindowOpenHandler(() => ({
    action: "deny"
  }));

  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (app.isPackaged && !url.startsWith("file://")) {
      event.preventDefault();
    }
  });

  loadApplicationInterface().catch(error => {
    console.error("Could not load Solarion interface:", error);
  });

  mainWindow.webContents.once("did-finish-load", () => {
    sendUpdates();
    sendToUI("bookmarks:updated", bookmarks);
    sendToUI("history:updated", history);
    sendDownloads();
    sendToUI("extensions:updated", publicExtensions());
    updateViews();
  });

  mainWindow.on("resize", updateViews);
  mainWindow.on("maximize", updateViews);
  mainWindow.on("unmaximize", updateViews);

  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  createTab();
}

// =========================================
// UPDATE IPC
// =========================================

ipcMain.handle("updates:check", async event => {
  if (!validSender(event)) return { ok: false };

  if (!app.isPackaged) {
    return {
      ok: false,
      message: "Updates are available in the installed version."
    };
  }

  try {
    await autoUpdater.checkForUpdates();
    return { ok: true };
  } catch (error) {
    console.error("Manual update check failed:", error);
    return {
      ok: false,
      message: "Solarion could not check for updates."
    };
  }
});

ipcMain.handle("updates:version", event => {
  if (!validSender(event)) return null;

  return {
    version: app.getVersion(),
    packaged: app.isPackaged
  };
});

// =========================================
// EXTENSION IPC
// =========================================

ipcMain.handle("extensions:get", event => {
  if (!validSender(event)) return [];
  return publicExtensions();
});

ipcMain.handle("extensions:install", async event => {
  if (!validSender(event)) {
    return { ok: false, message: "Unauthorized request." };
  }

  return chooseAndInstallExtension();
});

ipcMain.handle("extensions:set-enabled", async (event, id, enabled) => {
  if (!validSender(event)) {
    return { ok: false, message: "Unauthorized request." };
  }

  if (typeof id !== "string" || typeof enabled !== "boolean") {
    return { ok: false, message: "Invalid extension settings." };
  }

  return setExtensionEnabled(id, enabled);
});

ipcMain.handle("extensions:remove", async (event, id) => {
  if (!validSender(event)) {
    return { ok: false, message: "Unauthorized request." };
  }

  if (typeof id !== "string") {
    return { ok: false, message: "Invalid extension ID." };
  }

  return removeExtension(id);
});

// =========================================
// TAB IPC
// =========================================

ipcMain.handle("tabs:get", event => {
  if (!validSender(event)) return [];
  return getPublicTabs();
});

ipcMain.handle("tabs:create", (event, url) => {
  if (!validSender(event)) return null;
  return createTab(typeof url === "string" ? url : null);
});

ipcMain.handle("tabs:select", (event, id) => {
  if (!validSender(event)) return;

  if (tabs.some(tab => tab.id === id)) {
    activeTabId = id;
    updateViews();
    sendUpdates();
  }
});

ipcMain.handle("tabs:close", (event, id) => {
  if (!validSender(event)) return;
  closeTab(id);
});

ipcMain.handle("tabs:navigate", (event, url) => {
  if (!validSender(event) || !allowedUrl(url)) return;

  const tab = getActiveTab();
  if (!tab) return;

  if (!tab.view) {
    createView(tab, url);
  } else {
    tab.url = url;
    tab.view.webContents.loadURL(url);
  }

  sendUpdates();
});

ipcMain.handle("tabs:back", event => {
  if (!validSender(event)) return;

  const tab = getActiveTab();
  if (tab?.view?.webContents.canGoBack()) {
    tab.view.webContents.goBack();
  }
});

ipcMain.handle("tabs:forward", event => {
  if (!validSender(event)) return;

  const tab = getActiveTab();
  if (tab?.view?.webContents.canGoForward()) {
    tab.view.webContents.goForward();
  }
});

ipcMain.handle("tabs:reload", event => {
  if (!validSender(event)) return;

  const tab = getActiveTab();
  if (tab?.view) tab.view.webContents.reload();
});

// =========================================
// BOOKMARK IPC
// =========================================

ipcMain.handle("bookmarks:get", event => {
  if (!validSender(event)) return [];
  return bookmarks;
});

ipcMain.handle("bookmarks:add", async (event, title, url) => {
  if (!validSender(event) || !allowedUrl(url)) return bookmarks;

  if (bookmarks.some(item => item.url === url)) return bookmarks;

  bookmarks.unshift({
    id: randomUUID(),
    title: String(title || url).slice(0, 300),
    url
  });

  await saveBookmarks();
  return bookmarks;
});

ipcMain.handle("bookmarks:remove", async (event, id) => {
  if (!validSender(event)) return bookmarks;

  bookmarks = bookmarks.filter(item => item.id !== id);
  await saveBookmarks();

  return bookmarks;
});

// =========================================
// HISTORY IPC
// =========================================

ipcMain.handle("history:get", event => {
  if (!validSender(event)) return [];
  return history;
});

ipcMain.handle("history:clear", async event => {
  if (!validSender(event)) return;

  history = [];
  await saveHistory();

  return history;
});

// =========================================
// DOWNLOAD IPC
// =========================================

ipcMain.handle("downloads:get", event => {
  if (!validSender(event)) return [];
  return downloads;
});

ipcMain.handle("downloads:open", async (event, id) => {
  if (!validSender(event)) return;

  const download = downloads.find(item => item.id === id);
  if (!download?.savePath) return;

  await shell.openPath(download.savePath);
});

ipcMain.handle("downloads:show", (event, id) => {
  if (!validSender(event)) return;

  const download = downloads.find(item => item.id === id);
  if (download?.savePath) {
    shell.showItemInFolder(download.savePath);
  }
});

// =========================================
// WINDOW CONTROLS
// =========================================

ipcMain.on("window:minimize", event => {
  if (validSender(event)) mainWindow.minimize();
});

ipcMain.on("window:toggle-maximize", event => {
  if (!validSender(event)) return;

  if (mainWindow.isMaximized()) {
    mainWindow.unmaximize();
  } else {
    mainWindow.maximize();
  }
});

ipcMain.on("window:close", event => {
  if (validSender(event)) mainWindow.close();
});

ipcMain.handle("window:is-maximized", event => {
  if (!validSender(event)) return false;
  return mainWindow.isMaximized();
});

// =========================================
// WEBSITE VIEW SIZE
// =========================================

ipcMain.on("browser:set-bounds", (event, bounds) => {
  if (!validSender(event)) return;

  const { x, y, width, height } = bounds || {};

  if (![x, y, width, height].every(Number.isFinite)) return;
  if (width < 0 || height < 0) return;

  browserBounds = {
    x: Math.round(x),
    y: Math.round(y),
    width: Math.round(width),
    height: Math.round(height)
  };

  updateViews();
});

// =========================================
// DOWNLOAD MANAGEMENT
// =========================================

function setupDownloads() {
  sharedSession.on("will-download", (_event, item) => {
    const download = {
      id: randomUUID(),
      name: item.getFilename(),
      url: item.getURL(),
      receivedBytes: 0,
      totalBytes: item.getTotalBytes(),
      state: "progressing",
      savePath: ""
    };

    downloads.unshift(download);
    sendDownloads();

    item.on("updated", (_event, state) => {
      download.receivedBytes = item.getReceivedBytes();
      download.totalBytes = item.getTotalBytes();
      download.savePath = item.getSavePath();

      if (state === "interrupted") {
        download.state = "interrupted";
      }

      sendDownloads();
    });

    item.once("done", (_event, state) => {
      download.receivedBytes = item.getReceivedBytes();
      download.totalBytes = item.getTotalBytes();
      download.savePath = item.getSavePath();
      download.state = state;

      sendDownloads();
    });
  });
}

// =========================================
// STARTUP
// =========================================

app.whenReady().then(async () => {
  sharedSession = session.defaultSession;

  const dataFolder = app.getPath("userData");

  bookmarksFile = path.join(dataFolder, "bookmarks.json");
  historyFile = path.join(dataFolder, "history.json");
  extensionsFile = path.join(dataFolder, "extensions.json");

  bookmarks = await readJson(bookmarksFile, []);
  history = await readJson(historyFile, []);
  extensions = await readJson(extensionsFile, []);

  setupDownloads();

  // Load saved extensions before creating the first browser tab.
  await loadSavedExtensions();

  createWindow();
  setupAutoUpdates();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

// =========================================
// SHUTDOWN
// =========================================

app.on("before-quit", () => {
  if (updateCheckTimer) {
    clearInterval(updateCheckTimer);
    updateCheckTimer = null;
  }
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
