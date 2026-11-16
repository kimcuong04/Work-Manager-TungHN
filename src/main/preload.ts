import { contextBridge, ipcRenderer, webUtils, type IpcRendererEvent } from 'electron';

contextBridge.exposeInMainWorld('ppm', {
  call: (method: string, args: unknown[]) => ipcRenderer.invoke('api', method, args),
  /** Đường dẫn thật của file kéo thả vào cửa sổ (Electron không còn File.path). */
  pathForFile: (file: File) => {
    try {
      return webUtils.getPathForFile(file) || null;
    } catch {
      return null;
    }
  },
  onEvent: (cb: (e: unknown) => void) => {
    const handler = (_e: IpcRendererEvent, data: unknown) => cb(data);
    ipcRenderer.on('ppm:event', handler);
    return () => ipcRenderer.removeListener('ppm:event', handler);
  },
});
