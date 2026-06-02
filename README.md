# Dashtop

Dashtop is a prototype Electron application that acts as a desktop for dashboards and other important websites.

The goal is to display multiple apps/sites in a desktop-like interface, using `WebContentsView`-based views rather than mixing multiple embedding technologies.

For this first prototype, the minimum scope is:

- an Electron application that serves as a desktop shell;
- display dashboards and important websites in movable and resizable windows;
- a configuration interface for adding and editing the apps to display;
- for each configured app: a name and a URL.

Application development will be handled later through Hawser by a Codex agent.
