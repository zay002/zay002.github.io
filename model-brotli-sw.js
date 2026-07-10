import brotliPromise from "/vendor/brotli-dec-wasm/index.js";

const MODEL_RE = /\.(dae|obj|stl|xml)$/i;
const CONTENT_TYPES = {
  dae: "model/vnd.collada+xml",
  obj: "text/plain; charset=utf-8",
  stl: "application/vnd.ms-pki.stl",
  xml: "text/xml; charset=utf-8",
};

self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  if (
    event.request.method !== "GET" ||
    url.origin !== self.location.origin ||
    !MODEL_RE.test(url.pathname) ||
    event.request.headers.has("range")
  ) {
    return;
  }

  event.respondWith(loadBrotliModel(url).catch(() => fetch(event.request)));
});

async function loadBrotliModel(url) {
  const response = await fetch(`${url.pathname}.br`, { cache: "force-cache" });

  if (!response.ok) {
    throw new Error(`Missing Brotli model: ${url.pathname}.br`);
  }

  const brotli = await brotliPromise;
  const compressed = new Uint8Array(await response.arrayBuffer());
  const restored = brotli.decompress(compressed);
  const extension = url.pathname.split(".").pop().toLowerCase();

  return new Response(restored, {
    headers: {
      "content-type": CONTENT_TYPES[extension] || "application/octet-stream",
      "content-length": String(restored.byteLength),
      "x-model-compression": "brotli-11",
    },
  });
}
