import '../server/load-env.js';
import { createServer } from 'vite';
import { createApp } from '../server/app.js';

const api = createApp().listen(3001, '127.0.0.1');
api.on('error', error => { console.error('Cannot start processing service:', error.message); process.exit(1); });
const vite = await createServer();
await vite.listen();
console.log('\nSix-Tile Lesson Video Builder: http://localhost:5173\nLocal processing service: http://localhost:3001\n');
async function stop() { await vite.close(); api.close(() => process.exit(0)); }
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
