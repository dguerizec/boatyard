type ManualEntry = {
  title: string;
  body: string;
};

type ManualSection = {
  id: string;
  title: string;
  summary: string;
  entries: ManualEntry[];
};

type ManualOnboardingStep = {
  title: string;
  body: string;
  target: string;
};

type BoatyardManual = {
  version: number;
  title: string;
  description: string;
  publicUrlStatus: string;
  sections: ManualSection[];
  onboarding: ManualOnboardingStep[];
};

type BoatyardManualGlobal = typeof globalThis & {
  BoatyardManual?: BoatyardManual;
};

(function exposeManual(root: BoatyardManualGlobal) {
  const manual: BoatyardManual = {
    version: 1,
    title: "Boatyard Manual",
    description: "A practical guide to projects, workbench panes, widgets, terminals, integrations, profiles, and settings.",
    publicUrlStatus: "pending",
    sections: [
      {
        id: "overview",
        title: "Overview",
        summary: "Boatyard keeps project operations in one workspace.",
        entries: [
          {
            title: "Global workspace",
            body: "Use Global for shared dashboards and system-level webapp panes that are not tied to a single project."
          },
          {
            title: "Project workbenches",
            body: "Each project opens as a split-pane workbench with webapps, terminals, repository links, integration panes, and widgets."
          },
          {
            title: "Project navigation",
            body: "Search projects by name, slug, source path, or group. Pin frequent projects, collapse the sidebar when space is tight, and use integration status indicators to spot activity that needs attention."
          },
          {
            title: "Manual and tour",
            body: "Open this manual from Help at any time, or restart the guided tour when you need a quick walkthrough."
          }
        ]
      },
      {
        id: "projects",
        title: "Projects",
        summary: "Projects define the code checkout and its linked tools.",
        entries: [
          {
            title: "Add a project",
            body: "Use Add project to register a checkout. Boatyard can infer the name, slug, Git URL, and repository URL from the source path."
          },
          {
            title: "Project settings",
            body: "Use the gear next to a project to edit identity, source path, repository links, project URLs, widget panes, terminal environment, integration settings, and unregister actions. Most fields save when you leave them."
          },
          {
            title: "Project URLs",
            body: "Project URLs appear as webapp tabs, which makes deployment dashboards, cloud consoles, preview URLs, and issue trackers available beside the terminal."
          },
          {
            title: "Groups and pins",
            body: "Assign optional groups to organize related projects, drag projects to reorder them, and pin the projects you want to keep at the top of the sidebar."
          }
        ]
      },
      {
        id: "panes",
        title: "Webapp Panes",
        summary: "Panes let you keep several project surfaces visible at once.",
        entries: [
          {
            title: "Split panes",
            body: "Use vertical or horizontal split actions in a pane header to build a workbench layout for the current project."
          },
          {
            title: "Tabs and home tabs",
            body: "Pane tabs include widgets, preview URLs, saved project URLs, terminals, plugin panes, and repository links. The Home menu can save useful sub-tabs."
          },
          {
            title: "Navigation and focus",
            body: "Use Back, Forward, Refresh, Hard reload, and the editable address field for embedded webapps. Expand a pane group when you need to focus it, then shrink it to restore the saved split layout."
          },
          {
            title: "Mobile previews",
            body: "Preview development webapps at preset or bookmarked mobile viewport sizes without leaving the workbench."
          },
          {
            title: "Open rules",
            body: "When a webapp requests a new URL, keep it in the same pane, open it in a new split, route it to an existing pane, or open it externally. Save reusable exact, host, path-prefix, or wildcard rules in global settings."
          }
        ]
      },
      {
        id: "widgets",
        title: "Widgets",
        summary: "Widgets provide compact operational views.",
        entries: [
          {
            title: "Widget panes",
            body: "Every project has at least one widget pane. Add named widget panes from project settings when a project needs separate operational views."
          },
          {
            title: "Layout controls",
            body: "Drag widgets to reorder them, resize them from their controls, and hide widgets that are not relevant to the current workflow. Project widget layouts are restored with the current profile."
          },
          {
            title: "Integration widgets",
            body: "Integrations can contribute widgets, panes, settings sections, and project status indicators. GitHub provides Actions and Pull Requests widgets; Pier and TwiCC add project-specific operational views."
          },
          {
            title: "Top bar widgets",
            body: "Compact widgets can live in the top bar for information that should stay visible while you move between projects."
          }
        ]
      },
      {
        id: "terminal",
        title: "Terminal",
        summary: "Terminals are attached to projects and can be used as panes or widgets.",
        entries: [
          {
            title: "Shell tabs",
            body: "Create, rename, switch, and close shell tabs from terminal panes and widgets. Boatyard remembers the selected shell per surface."
          },
          {
            title: "Environment",
            body: "Global terminal environment applies everywhere. Project terminal environment augments the shell for one project."
          },
          {
            title: "Clipboard support",
            body: "Terminal selection can be copied and pasted through the app bridge, including middle-click paste support where available."
          }
        ]
      },
      {
        id: "settings",
        title: "Settings",
        summary: "Global settings control shared behavior.",
        entries: [
          {
            title: "Projects base path",
            body: "Set a default base path so project registration starts from the directory where your checkouts usually live."
          },
          {
            title: "Search and automatic saves",
            body: "Use the settings search to find global or project options. Most editable fields save when they lose focus, while explicit actions remain available for operations that need confirmation."
          },
          {
            title: "Presentation",
            body: "Tune webapp overlay behavior, sidebar behavior, and widget rail width to match your display and workflow."
          },
          {
            title: "Password autofill",
            body: "Optional local autofill stores encrypted credentials through Electron safeStorage when the desktop session supports it. The shared secrets vault is kept at the Boatyard configuration root."
          }
        ]
      },
      {
        id: "plugins",
        title: "Integrations",
        summary: "Integrations connect project tools without changing the core app.",
        entries: [
          {
            title: "Built-in integrations",
            body: "Boatyard includes GitHub, Pier, TwiCC, Hawser, Telegram, and Color Palette integrations when their plugin files are present."
          },
          {
            title: "Integration settings",
            body: "The Extensions section shows status, contributed surfaces, settings, reload controls, filters, and enable switches. Global settings affect shared integration state; project settings point integrations at project-specific resources."
          },
          {
            title: "Plugin API",
            body: "Use the plugin API to contribute panes, widgets, status indicators, settings sections, and background services."
          }
        ]
      },
      {
        id: "profiles",
        title: "Profiles and Windows",
        summary: "Windows expand one workspace; profiles isolate configuration.",
        entries: [
          {
            title: "Split-screen windows",
            body: "Use Split screen to open another workbench window. It can follow project changes from the current window or navigate independently."
          },
          {
            title: "Configuration profiles",
            body: "Start Boatyard with --profile NAME when you need separate projects, layouts, terminal sessions, and integration settings. Launching the same profile again focuses an existing window."
          },
          {
            title: "Shared and isolated data",
            body: "Each profile has its own state under the profiles directory. Encrypted credentials, installed tools, and update files remain shared at the configuration root; Chromium web storage is separate from configuration profiles."
          }
        ]
      }
    ],
    onboarding: [
      {
        title: "Start with Global",
        body: "Global is the default workspace for shared dashboards and system-level URLs.",
        target: "#global-nav"
      },
      {
        title: "Register projects",
        body: "Add project records for each checkout you want to manage from Boatyard.",
        target: "#add-project"
      },
      {
        title: "Open demo project settings",
        body: "A temporary demo project appears during the tour so you can see where repository links, project URLs, terminal environment, widget panes, and integration configuration live.",
        target: ".onboarding-demo-project .project-settings-button"
      },
      {
        title: "Use split workbenches",
        body: "Use pane split controls to keep several project surfaces visible side by side.",
        target: ".webapp-pane .split-vertical"
      },
      {
        title: "Choose a pane tab",
        body: "After splitting a workbench, use the pane dropdown to choose what that pane should display.",
        target: ".webapp-tab-menu-item[data-web-app-id=\"manual\"]"
      },
      {
        title: "Select the Manual tab",
        body: "The Manual is a webapp pane tab, so it can stay open next to widgets, terminals, previews, dashboards, and repository pages.",
        target: ".webapp-pane[data-web-app-id=\"manual\"] .webapp-tab-picker"
      }
    ]
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = manual;
  }

  root.BoatyardManual = manual;
})(typeof globalThis !== "undefined" ? globalThis : window);
