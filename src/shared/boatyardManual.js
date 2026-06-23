// @ts-check
"use strict";

/**
 * @typedef {{ title: string, body: string }} ManualEntry
 * @typedef {{ id: string, title: string, summary: string, entries: ManualEntry[] }} ManualSection
 * @typedef {{ title: string, body: string, target: string }} ManualOnboardingStep
 * @typedef {{
 *   version: number,
 *   title: string,
 *   description: string,
 *   publicUrlStatus: string,
 *   sections: ManualSection[],
 *   onboarding: ManualOnboardingStep[]
 * }} BoatyardManual
 */

/**
 * @param {typeof globalThis & { BoatyardManual?: BoatyardManual }} root
 */
(function exposeManual(root) {
  /** @type {BoatyardManual} */
  const manual = {
    version: 1,
    title: "Boatyard Manual",
    description: "A practical guide to project dashboards, webapp panes, widgets, terminals, plugins, and settings.",
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
            body: "Each project opens as a split-pane workbench with webapps, terminals, repository links, plugin panes, and widgets."
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
            body: "Use the gear next to a project to edit identity, source path, repository links, project URLs, widget panes, terminal environment, plugin settings, and unregister actions."
          },
          {
            title: "Project URLs",
            body: "Project URLs appear as webapp tabs, which makes deployment dashboards, cloud consoles, preview URLs, and issue trackers available beside the terminal."
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
            title: "Open rules",
            body: "When a webapp requests a new URL, choose whether it should stay in the same pane, open in a split pane, or open externally. Reusable rules live in global settings."
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
            body: "Drag widgets to reorder them, resize them from their controls, and hide widgets that are not relevant to the current workflow."
          },
          {
            title: "Plugin widgets",
            body: "Plugins can contribute widgets, panes, settings sections, and navigation badges. Enable or disable plugins from global settings."
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
            body: "Create, rename, switch, and close shell tabs from terminal surfaces. Boatyard remembers the selected shell per surface."
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
            title: "Presentation",
            body: "Tune webapp overlay behavior and widget rail width to match your display and workflow."
          },
          {
            title: "Password autofill",
            body: "Optional local autofill stores encrypted credentials through Electron safeStorage when the desktop session supports it."
          }
        ]
      },
      {
        id: "plugins",
        title: "Plugins",
        summary: "Plugins extend Boatyard without changing the core app.",
        entries: [
          {
            title: "Built-in plugins",
            body: "The app ships with built-in integrations such as TwiCC, Hawser, Pier, Telegram, and color palette tooling when their plugin files are present."
          },
          {
            title: "Plugin settings",
            body: "Global plugin settings affect shared integration state. Project plugin settings let each project point a plugin at project-specific resources."
          },
          {
            title: "Plugin API",
            body: "Use the plugin API to contribute panes, widgets, badges, settings sections, and background services."
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
        body: "A temporary demo project appears during the tour so you can see where repository links, project URLs, terminal environment, widget panes, and plugin configuration live.",
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
