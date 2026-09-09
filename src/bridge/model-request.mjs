// Bounded, authenticated-route body reader. Empty bodies keep old presets.
export function readModelSettings(request, { timeoutMs = 2000, maxBytes = 2048 } = {}) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    const timer = setTimeout(() => fail("Model settings request timed out"), timeoutMs);
    const cleanup = () => {
      clearTimeout(timer);
      request.off("data", onData);
      request.off("end", onEnd);
      request.off("error", onError);
      request.off("aborted", onError);
    };
    const fail = (message) => {
      cleanup();
      request.resume();
      reject(Object.assign(new Error(message), { statusCode: 400 }));
    };
    const onError = () => fail("Incomplete model settings request");
    const onData = (chunk) => {
      size += Buffer.byteLength(chunk);
      if (size > maxBytes) return fail("Model settings request too large");
      chunks.push(Buffer.from(chunk));
    };
    const onEnd = () => {
      cleanup();
      if (size === 0) return resolve(undefined);
      try {
        const value = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        if (!value || typeof value !== "object" || Array.isArray(value)
          || Object.keys(value).some(key => key !== "model" && key !== "effort")) {
          throw new Error();
        }
        resolve(value);
      } catch {
        reject(Object.assign(new Error("Invalid model settings request"), { statusCode: 400 }));
      }
    };
    request.on("data", onData);
    request.on("end", onEnd);
    request.on("error", onError);
    request.on("aborted", onError);
  });
}
