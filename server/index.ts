import './load-env.js';
import path from 'node:path';
import express from 'express';
import { createApp, root } from './app.js';

const app = createApp();
if (process.argv.includes('--production')) {
  app.use(express.static(path.join(root, 'dist')));
  app.get('/{*path}', (_req, res) => res.sendFile(path.join(root, 'dist', 'index.html')));
}
app.listen(3001, '127.0.0.1', () => console.log('Six-Tile processing service: http://localhost:3001'));
