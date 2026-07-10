(() => {
  const sceneHosts = [
    document.querySelector("#aubo-demo"),
  ].filter(Boolean);

  if (!sceneHosts.length) {
    return;
  }

  const modules = ["./robot-demo.js"];
  const warmedModules = new Set();
  let loadPromise = null;

  const warmModule = (source) => {
    const href = new URL(source, window.location.href).href;
    if (warmedModules.has(href)) {
      return;
    }

    warmedModules.add(href);
    const hint = document.createElement("link");
    hint.rel = "modulepreload";
    hint.href = href;
    document.head.appendChild(hint);
  };

  const warmScenes = () => {
    modules.forEach(warmModule);
  };

  const loadScenes = () => {
    if (!loadPromise) {
      warmScenes();
      loadPromise = (window.modelBrotliReady || Promise.resolve())
        .then(() => Promise.all(modules.map((source) => import(source))))
        .catch((error) => {
          console.warn("Failed to load robotics showcase modules", error);
          loadPromise = null;
        });
    }

    return loadPromise;
  };

  loadScenes();
})();
