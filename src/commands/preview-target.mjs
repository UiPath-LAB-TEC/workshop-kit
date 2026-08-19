#!/usr/bin/env node
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import {getTarget} from '../config/workshop-target.mjs';

// The consumer repo, not the kit: this file runs from inside node_modules.
const root = process.cwd();
const [, , targetArg, portArg = '3000'] = process.argv;
const {targetName, target} = getTarget(targetArg);
const port = Number(portArg);
const buildDir = path.join(root, 'build');
const baseUrl = target.baseUrl;

const contentTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.zip': 'application/zip',
};

function resolvePath(requestPath) {
  let pathname = decodeURIComponent(requestPath.split('?')[0] || '/');

  if (baseUrl !== '/') {
    const prefix = baseUrl.replace(/\/$/, '');
    if (pathname === prefix) {
      pathname = '/';
    } else if (pathname.startsWith(`${prefix}/`)) {
      pathname = pathname.slice(prefix.length);
    } else {
      return null;
    }
  }

  const cleanPath = pathname.replace(/^\/+/, '');
  const candidates = [
    path.join(buildDir, cleanPath),
    path.join(buildDir, cleanPath, 'index.html'),
    path.join(buildDir, 'index.html'),
  ];

  return candidates.find((candidate) => {
    const relative = path.relative(buildDir, candidate);
    return !relative.startsWith('..') && !path.isAbsolute(relative) && fs.existsSync(candidate) && fs.statSync(candidate).isFile();
  });
}

const server = http.createServer((req, res) => {
  const filePath = resolvePath(req.url || '/');
  if (!filePath) {
    res.writeHead(404, {'content-type': 'text/plain; charset=utf-8'});
    res.end(`Not found for target ${targetName}`);
    return;
  }

  res.writeHead(200, {
    'content-type': contentTypes[path.extname(filePath)] || 'application/octet-stream',
    'cache-control': 'no-cache',
  });
  fs.createReadStream(filePath).pipe(res);
});

server.listen(port, '127.0.0.1', () => {
  console.log(`Previewing ${targetName} at http://127.0.0.1:${port}${baseUrl}`);
});
