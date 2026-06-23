export type PluginActionHandler<TPayload = any, TResult = unknown> = (
  payload?: TPayload
) => TResult | Promise<TResult>;

export interface PluginActions {
  handle(name: string, handler: PluginActionHandler<any, unknown>): void;
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

export type ExecFileAsync = (
  file: string,
  args: string[],
  options?: Record<string, unknown>
) => Promise<{ stdout?: string, stderr?: string }>;

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
