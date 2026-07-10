(() => {
  const gsap = window.gsap;
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const supportsNativeViewTransition = "startViewTransition" in document && window.CSS && CSS.supports("view-transition-name: root");
  const warmedPages = new Set();

  const isSameSitePage = (link) => {
    const href = link.getAttribute("href");
    if (!href || href.startsWith("#") || href.startsWith("mailto:") || href.startsWith("tel:")) {
      return false;
    }

    if (link.target && link.target !== "_self") {
      return false;
    }

    if (link.hasAttribute("download")) {
      return false;
    }

    const url = new URL(href, window.location.href);
    const current = new URL(window.location.href);

    if (url.origin !== current.origin) {
      return false;
    }

    if (url.pathname === current.pathname && url.hash) {
      return false;
    }

    return url.pathname.endsWith(".html") || url.pathname.endsWith("/") || url.pathname === current.pathname;
  };

  const prefetchSameSitePage = (link) => {
    if (!link || !isSameSitePage(link)) {
      return;
    }

    const url = new URL(link.getAttribute("href"), window.location.href);
    url.hash = "";

    if (warmedPages.has(url.href)) {
      return;
    }

    warmedPages.add(url.href);
    const hint = document.createElement("link");
    hint.rel = "prefetch";
    hint.as = "document";
    hint.href = url.href;
    document.head.appendChild(hint);
  };

  const requestIdle = (callback, options) => (
    "requestIdleCallback" in window
      ? window.requestIdleCallback(callback, options)
      : window.setTimeout(callback, options?.timeout ?? 500)
  );

  document.addEventListener("pointerover", (event) => {
    prefetchSameSitePage(event.target.closest("a[href]"));
  }, {
    passive: true,
  });

  document.addEventListener("focusin", (event) => {
    prefetchSameSitePage(event.target.closest("a[href]"));
  });

  document.addEventListener("touchstart", (event) => {
    prefetchSameSitePage(event.target.closest("a[href]"));
  }, {
    passive: true,
  });

  requestIdle(() => {
    document.querySelectorAll("a[data-prefetch][href]").forEach(prefetchSameSitePage);
  }, { timeout: 1200 });

  if (supportsNativeViewTransition) {
    document.documentElement.classList.add("has-native-view-transition");
    return;
  }

  if (!gsap || reducedMotion) {
    return;
  }

  const overlay = document.createElement("div");
  overlay.className = "page-transition-overlay";
  overlay.setAttribute("aria-hidden", "true");
  document.body.appendChild(overlay);

  let isTransitioning = false;

  gsap.set(overlay, {
    autoAlpha: 0,
    scaleX: 0.985,
    transformOrigin: "50% 50%",
  });

  document.addEventListener("click", (event) => {
    if (isTransitioning || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
      return;
    }

    const link = event.target.closest("a[href]");
    if (!link || !isSameSitePage(link)) {
      return;
    }

    event.preventDefault();
    isTransitioning = true;
    const destination = new URL(link.getAttribute("href"), window.location.href).href;

    document.documentElement.classList.add("is-page-transitioning");
    gsap.killTweensOf(overlay);

    gsap.timeline({
      defaults: {
        ease: "power2.out",
        overwrite: "auto",
      },
      onComplete: () => {
        window.location.href = destination;
      },
    })
      .set(overlay, {
        scaleX: 0.985,
        autoAlpha: 0,
      }, 0)
      .to(overlay, {
        scaleX: 1,
        autoAlpha: 1,
        duration: 0.22,
      }, 0)
      .add(() => {}, "+=0.02");
  });

  window.addEventListener("pageshow", (event) => {
    if (!event.persisted) {
      return;
    }

    document.documentElement.classList.remove("is-page-transitioning");
    isTransitioning = false;
    gsap.set(overlay, {
      autoAlpha: 0,
      scaleX: 0.985,
    });
  });
})();
