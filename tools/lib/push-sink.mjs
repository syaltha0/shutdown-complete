// Loaded into a test server with `NODE_OPTIONS=--import <this file>`: pushes the server sends to a browser push
// service (fcm.googleapis.com) go to the test's own listener (PUSH_SINK_URL) instead, with the real endpoint in the
// `x-endpoint` header. Nothing about the server changes; only where its outgoing push requests land.
const real = globalThis.fetch;
globalThis.fetch = (input, init) => {
  const url = String(input?.url ?? input);
  if (process.env.PUSH_SINK_URL && url.startsWith('https://fcm.googleapis.com/')) {
    return real(process.env.PUSH_SINK_URL, { ...init, redirect: 'manual', headers: { ...init?.headers, 'x-endpoint': url } });
  }
  return real(input, init);
};
