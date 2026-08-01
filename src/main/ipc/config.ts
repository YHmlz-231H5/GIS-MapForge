import type { IpcMain } from 'electron';
import type { IpcResult } from '../../shared/types';
import { Config } from '../db';
import { ok, err } from './result';

export function registerConfigHandlers(ipcMain: IpcMain) {
  ipcMain.handle('config:get', async (): Promise<any> => {
    try {
      const out: Record<string, unknown> = {};
      const items = [
        'downloads_dir',
        'output_dir',
        'default_java_heap',
        'java_heap',
        'maptiler_key',
        'locale',
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
