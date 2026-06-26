import type { BoatyardBridge, RendererProject, RendererState } from "./rendererTypes.js";
import type { UnknownRecord } from "./rendererRecords.js";

export type CoreFieldSetOptions = {
  ifUnedited?: boolean;
  markEdited?: boolean;
  source?: string;
};

export type ProjectFormInitialValues = {
  id?: string;
  [key: string]: unknown;
};

export type CoreProjectFieldKey = "name" | "slug" | "group" | "sourcePath" | "gitUrl" | "repoUrl" | "devBranch";

export type CoreProjectInputs = Record<CoreProjectFieldKey, HTMLInputElement>;

export type PluginFieldSetOptions = {
  ifUnedited?: boolean;
  markEdited?: boolean;
};

export type ProjectPluginSectionOptions = {
  readCoreProjectFields?: () => Record<string, string>;
  setError?: (message: string) => void;
};

export type ProjectSettingsBoatyardBridge = BoatyardBridge & {
  inspectSourcePath?: (sourcePath: string) => Promise<UnknownRecord>;
  selectProjectsBasePath?(currentPath?: string): Promise<string>;
};

export type ProjectSettingsViewsOptions = {
  boatyard: ProjectSettingsBoatyardBridge;
  getState: () => RendererState;
  getSettings: () => UnknownRecord;
  getProjectGroups: () => string[];
  getProjectPaneLayout: (project: RendererProject) => unknown;
  getProjectWidgetPanes: (project: RendererProject) => UnknownRecord[];
  getSelectedWebAppForPane: (paneId: string) => string | undefined;
  getProjectPluginConfig: (projectId: string, pluginId: string) => UnknownRecord;
  getGlobalPluginConfig: (pluginId: string) => UnknownRecord;
  getPluginProjectSettingsSections: () => unknown[];
  applyFormControl: (control: HTMLElement) => void;
  applyFormControls: (container: HTMLElement) => void;
  showOverlayDialog: (dialog: HTMLDialogElement, options?: UnknownRecord) => Promise<boolean>;
  readPluginSettingsFieldValue: (field: ProjectPluginField, input: HTMLInputElement) => unknown;
  deriveRepoUrl: (gitUrl: unknown) => string;
  deriveProjectNameFromPath: (sourcePath: unknown) => string;
  formatProjectNameFromPath: (sourcePath: unknown) => string;
  slugify: (value: unknown) => string;
};

export type ProjectFormOptions = {
  title: string;
  submitLabel: string;
  initialValues?: ProjectFormInitialValues;
  onSubmit: (values: UnknownRecord & { pluginConfig: UnknownRecord }) => void | Promise<void>;
  onCancel: () => void;
};

export type ProjectPluginFieldAction = {
  hidden?: boolean;
  label?: string;
  message?: string;
  pendingLabel?: string;
  run?: (context: {
    coreFields: Record<string, string>;
    fields: PluginFieldApi;
    globalConfig: UnknownRecord;
    project: ProjectFormInitialValues;
  }) => unknown | Promise<unknown>;
};

export type ProjectPluginField = PluginSettingsFieldDefinition & {
  action?: ProjectPluginFieldAction;
  description?: string;
};

export type ProjectPluginSettingsSection = PluginSettingsSection & {
  fields: ProjectPluginField[];
};

export type ProjectPluginFieldState = {
  action: {
    button: HTMLButtonElement;
    element: HTMLDivElement;
    message: HTMLSpanElement;
  } | null;
  field: ProjectPluginField;
  input: HTMLInputElement;
};

export type ProjectPluginControlsSection = {
  inputs: Map<string, ProjectPluginFieldState>;
  pluginId: string;
};

export type PluginFieldApi = {
  getValue(key: string): string;
  isEdited(key: string): boolean;
  setActionMessage(key: string, message: unknown): boolean;
  setActionVisible(key: string, visible: boolean): boolean;
  setDefaultValue(key: string, value: unknown): boolean;
  setValue(key: string, value: unknown, options?: PluginFieldSetOptions): boolean;
};

export type ProjectScopedFormOptions = {
  project: RendererProject;
  onSubmit: (values: UnknownRecord[]) => void | Promise<void>;
};

export type GlobalUrlsFormOptions = {
  onSubmit: (values: UnknownRecord[]) => void | Promise<void>;
};

export function asProjectPluginSection(value: unknown): ProjectPluginSettingsSection {
  return value as ProjectPluginSettingsSection;
}

export function asErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
