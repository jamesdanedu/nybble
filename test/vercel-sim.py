#!/usr/bin/env python3
"""
Local stand-in for Vercel's static hosting, used by test/deploy.test.mjs.

  python3 test/vercel-sim.py                # plain — matches the current vercel.json
  python3 test/vercel-sim.py --clean        # as if cleanUrls:true were re-enabled
  python3 test/vercel-sim.py --port 8102

--clean exists because switching cleanUrls on once broke every runner, silently.
`/runners/mcq/index.html` 308s to `/runners/mcq`, and with trailingSlash:false the
document then sits at a URL with no trailing slash — so a relative `../lib/x.js`
resolves to `/lib/x.js` and 404s. The iframe stays blank with no visible error.
The runners now use absolute paths, so both modes work. This keeps it that way.

Serves ./public relative to the repo root.
"""
import argparse
import http.server
import os
import sys

CLEAN = False


class Handler(http.server.SimpleHTTPRequestHandler):
    def do_GET(self):
        path, _, qs = self.path.partition('?')
        qs = ('?' + qs) if qs else ''

        if CLEAN:
            # cleanUrls: true — strip .html and /index.html, preserving the query
            if path.endswith('/index.html'):
                return self._redirect((path[:-len('/index.html')] or '/') + qs)
            if path.endswith('.html'):
                return self._redirect(path[:-len('.html')] + qs)
            # trailingSlash: false — Vercel strips it rather than adding one
            if path.endswith('/') and path != '/':
                return self._redirect(path.rstrip('/') + qs)

        fs = self.translate_path(path)
        target = None
        if os.path.isfile(fs):
            target = fs
        elif CLEAN and os.path.isfile(fs + '.html'):
            target = fs + '.html'
        elif os.path.isdir(fs) and os.path.isfile(os.path.join(fs, 'index.html')):
            # served AT /a/b with no trailing-slash redirect — this is the case
            # that used to break relative subresource paths
            target = os.path.join(fs, 'index.html')

        if target is None:
            self.send_error(404)
            return

        body = open(target, 'rb').read()
        self.send_response(200)
        self.send_header('Content-Type', self.guess_type(target))
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _redirect(self, to):
        self.send_response(308)
        self.send_header('Location', to)
        self.end_headers()

    def log_message(self, *args):
        pass


if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('--clean', action='store_true', help='simulate cleanUrls: true')
    ap.add_argument('--port', type=int, default=8102)
    ap.add_argument('--root', default='public')
    args = ap.parse_args()

    CLEAN = args.clean
    if not os.path.isdir(args.root):
        sys.exit(f'{args.root}/ not found — run this from the repo root')
    os.chdir(args.root)

    mode = 'cleanUrls ON' if CLEAN else 'plain (production config)'
    print(f'serving {args.root}/ on http://127.0.0.1:{args.port}  [{mode}]')
    http.server.HTTPServer(('127.0.0.1', args.port), Handler).serve_forever()
