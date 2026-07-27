import type { BrowserWindow, IpcMain } from 'electron';
import type { Task, TaskKind, IpcResult } from '../../shared/types';
import { Tasks } from '../db';
import { taskScheduler } from '../tasks/scheduler';

function ok<T = unknown>(data?: T): IpcResult<T> {
  return { ok: true, data: data as T };
}
function err(message: string): IpcResult {
  return { ok: false, error: message };
}

export function registerTaskHandlers(ipcMain: IpcMain, getMainWindow: () => BrowserWindow | null) {
  // Initialize the scheduler with the window getter
  taskScheduler.init(getMainWindow);

  ipcMain.handle('task:submit', async (_e, input: {
    kind: TaskKind;
    region: Task['region'];
    options?: Task['options'];
  }): Promise<IpcResult<any>> => {
    try {
      const task = taskScheduler.enqueue(input);
      return ok(task);
    } catch (e) {
      return err((e as Error).message);
    }
  });

  ipcMain.handle('task:list', async (_e, filter?: { status?: Task['status'] | 'all' }): Promise<IpcResult<any>> => {
    try {
      return ok(Tasks.list(filter));
    } catch (e) {
      return err((e as Error).message);
    }
  });

  ipcMain.handle('task:cancel', async (_e, taskId: string): Promise<IpcResult<any>> => {
    try {
      taskScheduler.cancel(taskId);
      return ok();
    } catch (e) {
      return err((e as Error).message);
    }
  });

  ipcMain.handle('task:resume', async (_e, taskId: string): Promise<IpcResult<any>> => {
    try {
      const task = taskScheduler.resume(taskId);
      return ok(task);
    } catch (e) {
      return err((e as Error).message);
    }
  });

  ipcMain.handle(
    'task:delete',
    async (
      _e,
      taskId: string,
      opts?: { deleteFiles?: boolean }
    ): Promise<IpcResult<{ deletedPaths?: string[]; fileErrors?: string[] }>> => {
      try {
        const task = Tasks.get(taskId);
        if (!task) return err('Task not found');

        // Don't delete a running task's files while the worker may still write.
        if (task.status === 'running' || task.status === 'queued') {
          return err('请先停止任务再删除');
        }

        let deletedPaths: string[] | undefined;
        let fileErrors: string[] | undefined;
        if (opts?.deleteFiles) {
          const { deleteTaskDiskFiles } = await import('../tasks/delete-task-files');
          const r = deleteTaskDiskFiles(task);
          deletedPaths = r.deleted;
          fileErrors = r.errors;
        }

        Tasks.delete(taskId);
        return ok({ deletedPaths, fileErrors });
      } catch (e) {
        return err((e as Error).message);
      }
    }
  );

  ipcMain.handle('task:clear', async (): Promise<IpcResult<any>> => {
    try {
      Tasks.clearCompleted();
      return ok();
    } catch (e) {
      return err((e as Error).message);
    }
  });

  ipcMain.handle('task:clearAll', async (): Promise<IpcResult<any>> => {
    try {
      // Cancel all running tasks first
      for (const [id] of taskScheduler.getAllRunning()) {
        try { taskScheduler.cancel(id); } catch {}
      }
      // Small delay for cancellations to propagate
      await new Promise((r) => setTimeout(r, 100));
      Tasks.clearAll();
      return ok();
    } catch (e) {
      return err((e as Error).message);
    }
  });
}
