export type WidgetGridSize = {
  columns: number;
  rows: number;
};

export type WidgetGridPosition = {
  x: number;
  y: number;
};

export type WidgetDefinition = {
  id: string;
  name: string;
  title?: string;
  category?: string;
  defaultVisible?: boolean;
  pluginId?: string;
  layout?: {
    default?: Partial<WidgetGridSize>;
    min?: Partial<WidgetGridSize>;
    max?: Partial<WidgetGridSize>;
  };
  create?: unknown;
  createElement?: unknown;
};

export type WidgetLayout = {
  order: string[];
  hidden: string[];
  sizes: Record<string, WidgetGridSize>;
  positions: Record<string, WidgetGridPosition>;
  locked: boolean;
};

export type PersistedWidgetLayout = Partial<WidgetLayout> & {
  panes?: Record<string, PersistedWidgetLayout>;
};

export type WidgetPane = {
  id: string;
  label?: string;
};

export type WidgetProject = {
  id: string;
  widgetPanes?: WidgetPane[];
};

export type WidgetMenuElement = HTMLDivElement & {
  cleanup?: () => void;
};

export type WidgetRailAction = {
  label: string;
  icon: string;
  menu?: boolean;
  disabled?: boolean;
  onClick?: (event: MouseEvent) => void;
};
