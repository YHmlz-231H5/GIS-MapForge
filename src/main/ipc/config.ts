import type { IpcMain } from 'electron';
import type { IpcResult } from '../../shared/types';
import { Config } from '../db';

function ok<T = unknown>(data?: T): IpcResult<T> {
  return { ok: true, data: data as T };
}
function err(message: string): IpcResult {
  return { ok: false, error: message };
}

export function registerConfigHandlers(ipcMain: IpcMain) {
  ipcMain.handle('config:get', async (): Promise<any> => {
    try {
      const out: Record<string, unknown> = {};
      const items = [
        'downloads_dir',
        'output_dir',
        'user_agent',
        'geofabrik_base',
        'osm_api_base',
        'java_path',
        'planetiler_jar',
        'max_concurrent_heavy',
        'default_zoom_max',
        'default_java_heap',
      ];
      for (const k of items) {
        const v = Config.get(k);
        if (v !== null) out[k] = v;
      }
      return ok(out);
    } catch (e) {
      return err((e as Error).message);
    }
  });

  ipcMain.handle('config:set', async (_e, key: string, value: unknown): Promise<IpcResult<any>> => {
    try {
      Config.set(key, value);
      return ok();
    } catch (e) {
      return err((e as Error).message);
    }
  });
}
