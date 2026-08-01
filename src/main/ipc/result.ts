import type { IpcResult } from '../../shared/types';

export function ok<T = unknown>(data?: T): IpcResult<T> {
  return { ok: true, data: data as T };
}

export function err<T = never>(message: string): IpcResult<T> {
  return { ok: false, error: message };
}
