import type http from 'http';

export type ByteRange = { start: number; end: number };

/** Reads a single-range `Range: bytes=…` header; a missing or multi-range header serves the whole body. */
export function parseByteRange(header: string | undefined, size: number): ByteRange | 'unsatisfiable' | null {
  const match = header && /^bytes=(\d*)-(\d*)$/i.exec(header.trim());
  if (!match) return null;
  const [, from, to] = match;
  if (!from && !to) return null;
  if (!from) {
    const suffix = Number(to);
    if (suffix === 0 || size === 0) return 'unsatisfiable';
    return { start: Math.max(0, size - suffix), end: size - 1 };
  }
  const start = Number(from);
  if (start >= size) return 'unsatisfiable';
  const end = to ? Math.min(Number(to), size - 1) : size - 1;
  if (end < start) return null;
  return { start, end };
}

/** Sends `data` whole or as the requested byte range, so a video player can seek. */
export function sendBytes(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  data: Buffer,
  headers: http.OutgoingHttpHeaders,
): void {
  const size = data.length;
  const range = parseByteRange(req.headers.range, size);
  const common = { ...headers, 'accept-ranges': 'bytes' };
  if (range === 'unsatisfiable') {
    res.writeHead(416, { ...common, 'content-range': `bytes */${size}` });
    res.end();
  } else if (range) {
    res.writeHead(206, { ...common, 'content-range': `bytes ${range.start}-${range.end}/${size}` });
    res.end(data.subarray(range.start, range.end + 1));
  } else {
    res.writeHead(200, common);
    res.end(data);
  }
}
