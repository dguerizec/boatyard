import type { ChildProcess } from "node:child_process";

export type PluginActionHandler<TPayload = unknown, TResult = unknown> = (
  payload?: TPayload
) => TResult | Promise<TResult>;

export interface PluginActions {
  handle<TPayload = unknown, TResult = unknown>(
    name: string,
    handler: PluginActionHandler<TPayload, TResult>
  ): void;
}

export interface PluginEvents {
  emit(name: string, payload?: unknown): void;
}

export interface PluginProjectInspectors<TResult = unknown> {
  register(handler: (payload?: { sourcePath?: unknown }) => TResult | Promise<TResult>): void;
}

export interface PluginStateMigrations<TState = unknown, TResult = unknown> {
  register(handler: (payload: { state: TState }) => TResult): void;
}

export interface PromiseWithChild<T> extends Promise<T> {
  child: ChildProcess;
}

export interface ExecFileAsync {
  (file: string): PromiseWithChild<{ stdout?: string; stderr?: string }>;
  (file: string, args: readonly string[]): PromiseWithChild<{ stdout?: string; stderr?: string }>;
  (
    file: string,
    args: readonly string[],
    options: Record<string, unknown>
  ): PromiseWithChild<{ stdout?: string; stderr?: string }>;
  (file: string, options: Record<string, unknown>): PromiseWithChild<{ stdout?: string; stderr?: string }>;
}

export interface PluginMetadata {
  id: string;
}

export interface PluginPaths {
  pluginData: string;
  userData: string;
}

export interface PluginContext<TState = unknown> {
  actions: PluginActions;
  events: PluginEvents;
  execFileAsync: ExecFileAsync;
  getState(): TState;
  paths: PluginPaths;
  plugin: PluginMetadata;
  projectInspectors: PluginProjectInspectors;
  stateMigrations: PluginStateMigrations<TState>;
}
