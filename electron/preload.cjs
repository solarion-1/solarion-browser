
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("solarion", {
  // Browser tabs
  getTabs: () => ipcRenderer.invoke("tabs:get"),
  createTab: (url) => ipcRenderer.invoke("tabs:create", url),
  selectTab: (id) => ipcRenderer.invoke("tabs:select", id),
  closeTab: (id) => ipcRenderer.invoke("tabs:close", id),
  navigate: (url) => ipcRenderer.invoke("tabs:navigate", url),
  goBack: () => ipcRenderer.invoke("tabs:back"),
  goForward: () => ipcRenderer.invoke("tabs:forward"),
  reload: () => ipcRenderer.invoke("tabs:reload"),

  // Bookmarks
  getBookmarks: () => ipcRenderer.invoke("bookmarks:get"),
  addBookmark: (title, url) =>
    ipcRenderer.invoke("bookmarks:add", title, url),
  removeBookmark: (id) =>
    ipcRenderer.invoke("bookmarks:remove", id),

  // History
  getHistory: () => ipcRenderer.invoke("history:get"),
  clearHistory: () => ipcRenderer.invoke("history:clear"),

  // Downloads
  getDownloads: () => ipcRenderer.invoke("downloads:get"),
  openDownload: (id) => ipcRenderer.invoke("downloads:open", id),
  showDownload: (id) => ipcRenderer.invoke("downloads:show", id),

  // Window controls
  minimizeWindow: () => ipcRenderer.send("window:minimize"),
  toggleMaximizeWindow: () =>
    ipcRenderer.send("window:toggle-maximize"),
  closeWindow: () => ipcRenderer.send("window:close"),
  isWindowMaximized: () =>
    ipcRenderer.invoke("window:is-maximized"),

  // Browser layout
  setBrowserBounds: (bounds) =>
    ipcRenderer.send("browser:set-bounds", bounds),

  // Event listeners
  onTabsUpdated: (callback) => {
    const listener = (_event, tabs) => callback(tabs);
    ipcRenderer.on("tabs:updated", listener);

    return () => {
      ipcRenderer.removeListener("tabs:updated", listener);
    };
  },

  onActiveTabChanged: (callback) => {
    const listener = (_event, id) => callback(id);
    ipcRenderer.on("tabs:active-changed", listener);

    return () => {
      ipcRenderer.removeListener("tabs:active-changed", listener);
    };
  },

  onBookmarksUpdated: (callback) => {
    const listener = (_event, bookmarks) => callback(bookmarks);
    ipcRenderer.on("bookmarks:updated", listener);

    return () => {
      ipcRenderer.removeListener("bookmarks:updated", listener);
    };
  },

  onHistoryUpdated: (callback) => {
    const listener = (_event, history) => callback(history);
    ipcRenderer.on("history:updated", listener);

    return () => {
      ipcRenderer.removeListener("history:updated", listener);
    };
  },

  onDownloadsUpdated: (callback) => {
    const listener = (_event, downloads) => callback(downloads);
    ipcRenderer.on("downloads:updated", listener);

    return () => {
      ipcRenderer.removeListener("downloads:updated", listener);
    };
  }
});
