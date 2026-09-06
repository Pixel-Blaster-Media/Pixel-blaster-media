// Test-only transport routing. No React, Next, action or SDK substitutions.
const net = require("node:net");
const loopback = (host) => ["127.0.0.1", "localhost", "::1"].includes(host);
const connect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function (...args) {
  // net.connect passes an already-normalized argument array to Socket.connect.
  const options = Array.isArray(args[0])
    ? args[0][0]
    : net._normalizeArgs(args)[0];
  if (!options.path && !loopback(options.host || "localhost")) {
    throw new Error(`AUTH_BROWSER_FORBIDDEN_EGRESS: ${options.host}`);
  }
  return connect.apply(this, args);
};
const originalFetch = globalThis.fetch;
globalThis.fetch = function (input, init) {
  const url = new URL(
    typeof input === "string" || input instanceof URL ? input : input.url,
  );
  if (url.href === "https://api.resend.com/emails") {
    const target = new URL(process.env.AUTH_BROWSER_PROVIDER_URL);
    if (target.protocol !== "http:" || !loopback(target.hostname))
      throw new Error("Nonlocal fixture");
    return originalFetch(new URL("/emails", target), init);
  }
  if (!loopback(url.hostname))
    throw new Error(`AUTH_BROWSER_FORBIDDEN_FETCH: ${url.origin}`);
  return originalFetch(input, init);
};
