import { type IpcMain, app, shell, dialog, BrowserWindow } from 'electron';
import type { IpcResult } from '../../shared/types';
import * as fs from 'fs';
const { execFile } = require('child_process');
const { promisify } = require('util');
import { join, dirname, resolve, normalize, extname, sep } from 'path';
import { resolveOutputDir } from '../paths';
import { ok, err } from './result';

const execFileP = promisify(execFile);
const {
  existsSync,
  statSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} = fs;

export function registerSystemHandlers(ipcMain: IpcMain) {
  ipcMain.handle('app:version', async (): Promise<IpcResult<any>> => {
    return ok(app.getVersion());
  });

  ipcMain.handle('system:detectJava', async (): Promise<IpcResult<{ path: string; version: string } | null>> => {
    const candidates = [
      'java',
      'C:\\Program Files (x86)\\jdk\\bin\\java.exe',
      'C:\\Program Files\\Eclipse Adoptium\\jdk-21\\bin\\java.exe',
      'C:\\Program Files\\Java\\jdk-21\\bin\\java.exe',
    ];
    for (const cmd of candidates) {
      try {
        const { stdout, stderr } = await execFileP(cmd, ['-version'], {
          timeout: 5000,
          windowsHide: true,
        });
        return ok({ path: cmd, version: (stderr || stdout || '').split('\n')[0].trim() });
      } catch {
        // try next candidate
      }
    }
    return ok(null);
  });

  ipcMain.handle('system:planetilerJar', async (): Promise<IpcResult<{ path: string; size: number } | null>> => {
    const candidates = [
      join(process.cwd(), 'tools', 'planetiler.jar'),
      join(app.getAppPath(), 'tools', 'planetiler.jar'),
    ];
    for (const p of candidates) {
      if (existsSync(p)) {
        const size = statSync(p).size;
        return ok({ path: p, size });
      }
    }
    return ok(null);
  });

  ipcMain.handle('system:resolveOutputDir', async (): Promise<IpcResult<string>> => {
    try {
      const dir = resolveOutputDir();
      mkdirSync(dir, { recursive: true });
      return ok(dir);
    } catch (e) {
      return err((e as Error).message);
    }
  });

  ipcMain.handle('system:pickDirectory', async (): Promise<IpcResult<string | null>> => {
    try {
      const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
      const options: Electron.OpenDialogOptions = {
        title: '选择输出目录',
        properties: ['openDirectory', 'createDirectory'],
        defaultPath: resolveOutputDir(),
      };
      const result = win
        ? await dialog.showOpenDialog(win, options)
        : await dialog.showOpenDialog(options);
      if (result.canceled || !result.filePaths[0]) return ok(null);
      return ok(result.filePaths[0]);
    } catch (e) {
      return err((e as Error).message);
    }
  });

  ipcMain.handle(
    'system:pickOpenFile',
    async (
      _e,
      opts?: {
        title?: string;
        filters?: Array<{ name: string; extensions: string[] }>;
        defaultPath?: string;
      }
    ): Promise<IpcResult<string | null>> => {
      try {
        const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
        const options: Electron.OpenDialogOptions = {
          title: opts?.title ?? '选择文件',
          properties: ['openFile'],
          filters: opts?.filters,
          defaultPath: opts?.defaultPath ?? resolveOutputDir(),
        };
        const result = win
          ? await dialog.showOpenDialog(win, options)
          : await dialog.showOpenDialog(options);
        if (result.canceled || !result.filePaths[0]) return ok(null);
        return ok(result.filePaths[0]);
      } catch (e) {
        return err((e as Error).message);
      }
    }
  );

  ipcMain.handle(
    'fs:listPmtiles',
    async (
      _e,
      dir: string
    ): Promise<IpcResult<Array<{ name: string; path: string; size: number; mtimeMs: number }>>> => {
      try {
        if (!dir || typeof dir !== 'string') return err('Invalid directory');
        const abs = resolve(normalize(dir));
        if (!existsSync(abs)) return err(`Directory not found: ${abs}`);
        if (!statSync(abs).isDirectory()) return err(`Not a directory: ${abs}`);
        const out: Array<{ name: string; path: string; size: number; mtimeMs: number }> = [];
        for (const name of readdirSync(abs)) {
          if (!name.toLowerCase().endsWith('.pmtiles')) continue;
          const p = join(abs, name);
          try {
            const st = statSync(p);
            if (!st.isFile()) continue;
            out.push({ name, path: p, size: st.size, mtimeMs: st.mtimeMs });
          } catch {
            /* skip */
          }
        }
        out.sort((a, b) => b.mtimeMs - a.mtimeMs);
        return ok(out);
      } catch (e) {
        return err((e as Error).message);
      }
    }
  );

  ipcMain.handle('fs:readTextFile', async (_e, filePath: string): Promise<IpcResult<string>> => {
    try {
      if (!filePath || typeof filePath !== 'string') return err('Invalid path');
      const abs = resolve(normalize(filePath));
      if (!existsSync(abs)) return err(`File not found: ${abs}`);
      const st = statSync(abs);
      if (!st.isFile()) return err(`Not a file: ${abs}`);
      if (st.size > 32 * 1024 * 1024) return err('File too large (>32MB)');
      const ext = extname(abs).toLowerCase();
      if (!['.json', '.geojson', '.md', '.txt', '.css', '.html', '.js', '.ts'].includes(ext)) {
        return err(`Unsupported text extension: ${ext || '(none)'}`);
      }
      return ok(readFileSync(abs, 'utf8'));
    } catch (e) {
      return err((e as Error).message);
    }
  });

  ipcMain.handle(
    'fs:writeTextFiles',
    async (
      _e,
      dir: string,
      files: Array<{ relativePath: string; contents: string }>
    ): Promise<IpcResult<{ dir: string; written: string[] }>> => {
      try {
        if (!dir || typeof dir !== 'string') return err('Invalid directory');
        if (!Array.isArray(files) || files.length === 0) return err('No files');
        const absDir = resolve(normalize(dir));
        mkdirSync(absDir, { recursive: true });
        const written: string[] = [];
        for (const f of files) {
          if (!f?.relativePath || typeof f.contents !== 'string') {
            return err('Invalid file entry');
          }
          const rel = f.relativePath.replace(/\\/g, '/').replace(/^\/+/, '');
          if (!rel || rel.includes('..')) return err(`Unsafe relative path: ${f.relativePath}`);
          const abs = join(absDir, rel);
          if (!abs.startsWith(absDir + sep) && abs !== absDir) {
            return err(`Path escapes directory: ${f.relativePath}`);
          }
          if (f.contents.length > 32 * 1024 * 1024) return err(`File too large: ${rel}`);
          mkdirSync(dirname(abs), { recursive: true });
          writeFileSync(abs, f.contents, 'utf8');
          written.push(abs);
        }
        return ok({ dir: absDir, written });
      } catch (e) {
        return err((e as Error).message);
      }
    }
  );

  ipcMain.handle(
    'fs:readRasterTileFile',
    async (
      _e,
      tileDir: string,
      z: number,
      x: number,
      fileName: string
    ): Promise<IpcResult<ArrayBuffer>> => {
      try {
        if (!tileDir || typeof tileDir !== 'string') return err('Invalid tileDir');
        if (!Number.isFinite(z) || !Number.isFinite(x)) return err('Invalid z/x');
        if (!fileName || typeof fileName !== 'string' || fileName.includes('..') || fileName.includes('/') || fileName.includes('\\')) {
          return err('Invalid tile file name');
        }
        const absDir = resolve(normalize(tileDir));
        if (!existsSync(absDir) || !statSync(absDir).isDirectory()) {
          return err(`Not a directory: ${absDir}`);
        }
        const abs = join(absDir, String(Math.floor(z)), String(Math.floor(x)), fileName);
        if (!abs.startsWith(absDir + sep) && abs !== absDir) {
          return err('Path escapes tile directory');
        }
        if (!existsSync(abs)) return err(`Tile not found: ${abs}`);
        const buf = readFileSync(abs);
        return ok(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
      } catch (e) {
        return err((e as Error).message);
      }
    }
  );

  ipcMain.handle(
    'mbtiles:getTile',
    async (
      _e,
      mbtilesPath: string,
      z: number,
      x: number,
      y: number
    ): Promise<IpcResult<ArrayBuffer>> => {
      try {
        if (!mbtilesPath || typeof mbtilesPath !== 'string') return err('Invalid path');
        const abs = resolve(normalize(mbtilesPath));
        if (!existsSync(abs) || !abs.toLowerCase().endsWith('.mbtiles')) {
          return err('Not an MBTiles file');
        }
        if (![z, x, y].every(Number.isFinite)) return err('Invalid z/x/y');
        const Database = require('better-sqlite3') as typeof import('better-sqlite3');
        const db = new Database(abs, { readonly: true, fileMustExist: true });
        try {
          const tmsY = (1 << Math.floor(z)) - 1 - Math.floor(y);
          const row = db
            .prepare(
              'SELECT tile_data AS data FROM tiles WHERE zoom_level = ? AND tile_column = ? AND tile_row = ?'
            )
            .get(Math.floor(z), Math.floor(x), tmsY) as { data?: Buffer } | undefined;
          if (!row?.data) return err('Tile not found');
          const buf = Buffer.isBuffer(row.data) ? row.data : Buffer.from(row.data);
          return ok(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
        } finally {
          db.close();
        }
      } catch (e) {
        return err((e as Error).message);
      }
    }
  );

  ipcMain.handle('system:openFolder', async (_e, p: string): Promise<IpcResult<any>> => {
    try {
      if (!p) return err('Empty path');
      let folder = p;
      if (!existsSync(p)) {
        folder = dirname(p);
        mkdirSync(folder, { recursive: true });
      } else {
        const st = statSync(p);
        folder = st.isDirectory() ? p : dirname(p);
      }
      if (!existsSync(folder)) {
        mkdirSync(folder, { recursive: true });
      }
      const fail = await shell.openPath(folder);
      if (fail) return err(fail);
      return ok();
    } catch (e) {
      return err((e as Error).message);
    }
  });

}
