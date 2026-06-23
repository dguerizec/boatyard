// @ts-check
"use strict";

/**
 * @typedef {{ rendererPath?: string, stylePaths?: string[] }} RendererPluginDescriptor
 * @typedef {{ listPlugins?: () => Promise<RendererPluginDescriptor[]> }} BoatyardRendererApi
 * @typedef {Window & { boatyard?: BoatyardRendererApi, BoatyardPluginLoader?: { ready: Promise<RendererPluginDescriptor[]> } }} PluginLoaderWindow
 */

/**
 * @param {PluginLoaderWindow} globalScope
 */
(function createPluginLoader(globalScope) {
  /**
   * @param {string} src
   * @returns {Promise<void>}
   */
  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = src;
      script.async = false;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error(`Could not load plugin script: ${src}`));
      document.body.append(script);
    });
  }

  /**
   * @param {string} href
   */
  function loadStyle(href) {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = href;
    document.head.append(link);
  }

  /**
   * @returns {Promise<RendererPluginDescriptor[]>}
   */
  async function loadPlugins() {
    if (typeof globalScope.boatyard?.listPlugins !== "function") {
      return [];
    }

    const plugins = await globalScope.boatyard.listPlugins();

    for (const plugin of plugins) {
      for (const stylePath of plugin.stylePaths || []) {
        loadStyle(stylePath);
      }

      if (plugin.rendererPath) {
        await loadScript(plugin.rendererPath);
      }
    }

    return plugins;
  }

  globalScope.BoatyardPluginLoader = Object.freeze({
    ready: loadPlugins()
  });
})(/** @type {PluginLoaderWindow} */ (window));
