const payloadFiles = ["payload-1.txt", "payload-2.txt", "payload-3.txt", "payload-4.txt"];

try {
  if (!("DecompressionStream" in globalThis)) {
    throw new Error("This browser does not support the local compressed profiler runtime.");
  }

  const chunks = await Promise.all(payloadFiles.map(async (path) => {
    const response = await fetch(path, { cache: "force-cache" });
    if (!response.ok) throw new Error(`Unable to load ${path} (${response.status}).`);
    return response.text();
  }));

  const encoded = chunks.join("").trim();
  const bytes = Uint8Array.from(atob(encoded), (character) => character.charCodeAt(0));
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
  const source = await new Response(stream).text();
  new Function(source)();
} catch (error) {
  console.error("PAU Profiler failed to initialize", error);
  const results = document.querySelector("#results");
  if (results) {
    results.innerHTML = `<div class="results-empty"><h3>Profiler initialization failed</h3><p>${String(error)}</p></div>`;
  }
}