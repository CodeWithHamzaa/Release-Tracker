// Local development / self-hosted entry point.
//
// Vercel does NOT use this file: there the API runs as a serverless function
// (api/index.ts) and the built SPA in dist/ is served by Vercel's static layer.
// This server exists so `npm run dev` still serves API + SPA on a single port,
// and so the app can still be self-hosted with `npm run build:server && npm start`.

import express, { Request, Response } from 'express';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import app from './lib/app';

const PORT = Number(process.env.PORT) || 3000;

// Vite middleware & production static serving
async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req: Request, res: Response) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Enterprise Release Tracker server running on port ${PORT}`);
  });
}

startServer();
