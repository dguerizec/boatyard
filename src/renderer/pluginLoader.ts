(function createPluginLoader(globalScope: PluginLoaderWindow) {
  function loadScript(src: string) {
    return new Promise<void>((resolve, reject) => {
      const script = document.createElement("script");
      script.src = src;
      script.async = false;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error(`Could not load plugin script: ${src}`));
      document.body.append(script);
    });
  }

  function loadStyle(href: string) {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = href;
    document.head.append(link);
  }

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
})(window);
