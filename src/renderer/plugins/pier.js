"use strict";

(function registerPierPlugin(globalScope) {
  const registry = globalScope.DashtopPluginRegistry;

  if (!registry) {
    throw new Error("Plugin registry is unavailable.");
  }

  registry.register(
    {
      id: "dashtop.pier",
      name: "Pier",
      version: "0.1.0",
      apiVersion: "0.1",
      contributes: {
        widgets: ["project-preview"],
        panes: ["dashtop.pier.preview"],
        projectSettings: ["dashtop.pier.project"]
      },
      permissions: [
        "projectConfig:read",
        "projectConfig:write",
        "pane:wcv",
        "widget:provide"
      ]
    },
    {
      activate(ctx) {
        ctx.status.set({
          state: "ready",
          summary: "Pier preview integration is available"
        });

        ctx.settings.registerProjectSection({
          id: "dashtop.pier.project",
          title: "Pier",
          fields: [
            {
              key: "pierPreviewUrl",
              label: "Preview URL",
              type: "text",
              placeholder: "http://localhost:5173",
              legacyProjectKey: "previewUrl"
            }
          ]
        });

        ctx.panes.register({
          id: "dashtop.pier.preview",
          webAppId: "preview",
          key: "preview",
          title: "Preview",
          kind: "wcv",
          scope: "project",
          resolveUrl({ project, projectConfig }) {
            return projectConfig.pierPreviewUrl || project.previewUrl || "";
          }
        });

        ctx.widgets.register({
          id: "project-preview",
          name: "Project preview",
          title: "Project preview",
          scope: "project",
          category: "Project",
          status: "stable",
          defaultVisible: false,
          description: "Links to the project's main preview URL when one is configured.",
          layout: {
            default: { columns: 2, rows: 2 },
            min: { columns: 1, rows: 2 },
            max: { columns: 3, rows: 3 }
          },
          create: (project) => ({
            eyebrow: "Preview",
            title: "Project preview",
            body: project.previewUrl
              ? "Project preview is available as a webapp tab in the project pane."
              : "No preview URL configured for this project.",
            meta: project.previewUrl || "Optional",
            action: project.previewUrl
              ? {
                  label: "Open URL",
                  onClick: () => globalScope.dashtop.openExternal(project.previewUrl)
                }
              : null
          })
        });
      }
    }
  );
})(window);
