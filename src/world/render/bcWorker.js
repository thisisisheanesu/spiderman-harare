import { encodeLayer } from './bcEncode.js';

// Compresses one PBR layer off the main thread: {id, S, a (RGBA albedo+roughness), n (RGBA normal)}
// -> {id, a: [BC3 levels], n: [BC5 levels]}.
self.onmessage = (e) => {
  const { id, S, a, n } = e.data;
  try {
    const la = encodeLayer(a, S, 'bc3');
    const ln = n ? encodeLayer(n, S, 'bc5') : null;
    const transfer = la.map((x) => x.buffer);
    if (ln) for (const x of ln) transfer.push(x.buffer);
    self.postMessage({ id, a: la, n: ln }, transfer);
  } catch (err) {
    self.postMessage({ id, error: String(err) });
  }
};
