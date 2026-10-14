import type { RequestHandler } from 'express';

/** Only explicitly configured hosted editors can reach this loopback service. */
export function editorCors(configuredOrigins = process.env.ALLOWED_EDITOR_ORIGINS ?? ''): RequestHandler {
  const hostedOrigins = new Set(configuredOrigins.split(',').map(origin => origin.trim()).filter(Boolean));
  for (const origin of hostedOrigins) {
    const url = new URL(origin);
    if (url.protocol !== 'https:' || url.origin !== origin) throw new Error('ALLOWED_EDITOR_ORIGINS must contain exact HTTPS origins, without paths or trailing slashes.');
  }
  return (req, res, next) => {
    const origin = req.get('origin');
    res.setHeader('Cache-Control', 'no-store');
    res.vary('Origin');
    if (origin) {
      if (!/^http:\/\/(localhost|127\.0\.0\.1):(5173|3001)$/.test(origin) && !hostedOrigins.has(origin)) {
        res.status(403).json({ error: 'This editor is not allowed to access the local service.' });
        return;
      }
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, POST, PUT, DELETE, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Range');
      res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition, Content-Range, Accept-Ranges');
      if (req.get('access-control-request-private-network') === 'true') res.setHeader('Access-Control-Allow-Private-Network', 'true');
    }
    if (req.method === 'OPTIONS') { res.sendStatus(204); return; }
    next();
  };
}
