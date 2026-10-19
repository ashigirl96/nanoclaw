import fs from 'fs';
import type http from 'http';
import path from 'path';

import { mimeTypeFor } from './mime.js';

const BUILD_INSTRUCTIONS = `<!doctype html>
<meta charset="utf-8">
<title>Console</title>
<body style="font-family: system-ui, sans-serif; max-width: 40rem; margin: 4rem auto; padding: 0 1rem">
<h1>Console の画面がまだ build されていません</h1>
<p>NanoClaw の checkout で次を実行してから、このページを開き直してください。</p>
<pre>pnpm --dir web install --frozen-lockfile
pnpm --dir web run build</pre>
</body>
`;

/** Serves the built frontend; unknown paths get index.html so client-side routes survive a reload. */
export function serveStatic(distDir: string, pathname: string, res: http.ServerResponse): void {
  const index = path.join(distDir, 'index.html');
  if (!fs.existsSync(index)) {
    res.writeHead(503, { 'content-type': 'text/html; charset=utf-8' });
    res.end(BUILD_INSTRUCTIONS);
    return;
  }
  const root = path.resolve(distDir);
  const requested = path.resolve(root, '.' + safeDecode(pathname));
  const inside = requested.startsWith(root + path.sep);
  const file = inside && fs.statSync(requested, { throwIfNoEntry: false })?.isFile() ? requested : index;
  res.writeHead(200, { 'content-type': mimeTypeFor(file) });
  fs.createReadStream(file).pipe(res);
}

function safeDecode(pathname: string): string {
  try {
    return decodeURIComponent(pathname);
  } catch (err) {
    if (!(err instanceof URIError)) throw err;
    return '/';
  }
}
