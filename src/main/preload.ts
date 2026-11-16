import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';

contextBridge.exposeInMainWorld('ppm', {
  call: (method: string, args: unknown[]) => ipcRenderer.invoke('api', method, args),
  onEvent: (cb: (e: unknown) => void) => {
    const handler = (_e: IpcRendererEvent, data: unknown) => cb(data);
    ipcRenderer.on('ppm:event', handler);
    return () => ipcRenderer.removeListener('ppm:event', handler);
  },
});
