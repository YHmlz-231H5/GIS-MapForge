import type { Task, TaskProgress } from '../../../shared/types';

export type LogPusher = (stream: 'out' | 'err', line: string) => void;
export type ProgressPusher = (progress: TaskProgress) => void;

export interface HandlerResult {
  output_path?: string;
  metadata?: Record<string, unknown>;
}

export type HandlerFn = (
  task: Task,
  abort: AbortSignal,
  pushLog: LogPusher,
  pushProgress?: ProgressPusher
) => Promise<HandlerResult>;
