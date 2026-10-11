import { contextBridge, ipcRenderer } from "electron";
const channel = process.argv.find(arg => arg.startsWith("--remote-channel="))?.slice("--remote-channel=".length);
if (!channel) throw new Error("Missing remote IPC channel");
contextBridge.exposeInMainWorld("remoteHost", {
  invoke: (action: string, payload?: unknown, id = "") => ipcRenderer.invoke(channel, id, action, payload),
  onMessage: (callback: (message: unknown) => void) => { ipcRenderer.on(channel, (_event, message: unknown) => callback(message)); }
});
