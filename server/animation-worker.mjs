// A separate process keeps camera sampling and encoding off the API event loop.
import { register } from 'tsx/esm/api';
register();
const { renderAnimations } = await import('./animation-render.ts');
const controller = new AbortController();
const send = message => new Promise((resolve, reject) => {
  if (!process.connected) { resolve(); return; }
  process.send(message, error => error ? reject(error) : resolve());
});
process.on('SIGTERM', () => controller.abort());
process.on('disconnect', () => controller.abort());
process.on('message', async message => {
  if (message.type === 'cancel') { controller.abort(); return; }
  if (message.type !== 'render') return;
  try {
    const manifest = await renderAnimations(message.task, controller.signal, (framesDone, framesTotal, text) => {
      if (process.connected) process.send({ type: 'progress', framesDone, framesTotal, message: text });
    });
    await send({ type: 'complete', manifest });
  } catch (error) { await send({ type: 'error', cancelled: controller.signal.aborted, error: error instanceof Error ? error.message : String(error) }); }
  finally { process.disconnect(); }
});
await send({ type: 'ready' });
