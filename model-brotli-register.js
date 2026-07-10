(() => {
  window.modelBrotliReady = Promise.resolve();

  if (!("serviceWorker" in navigator) || window.location.protocol === "file:") {
    return;
  }

  const reloadKey = `model-brotli-reloaded:${window.location.pathname}`;

  const waitForController = () => {
    if (navigator.serviceWorker.controller) {
      sessionStorage.removeItem(reloadKey);
      return Promise.resolve();
    }

    return new Promise((resolve) => {
      let shouldResolve = true;
      const finish = () => {
        window.clearTimeout(timer);
        sessionStorage.removeItem(reloadKey);
        resolve();
      };
      const timer = window.setTimeout(() => {
        navigator.serviceWorker.removeEventListener("controllerchange", finish);

        if (sessionStorage.getItem(reloadKey) !== "true") {
          shouldResolve = false;
          sessionStorage.setItem(reloadKey, "true");
          window.location.reload();
        }

        if (shouldResolve) {
          resolve();
        }
      }, 3000);

      navigator.serviceWorker.addEventListener("controllerchange", finish, { once: true });
    });
  };

  window.modelBrotliReady = navigator.serviceWorker
    .register("/model-brotli-sw.js", { scope: "/", type: "module" })
    .then(() => navigator.serviceWorker.ready)
    .then(waitForController)
    .catch(() => {});
})();
