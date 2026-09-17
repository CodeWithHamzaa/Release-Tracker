// Vercel serverless function entry point.
//
// vercel.json rewrites /api/* to this function. An Express app is itself a
// (req, res) handler, so exporting it is all the Vercel Node runtime needs --
// there is no app.listen() in a serverless environment.
//
// Static assets are served by Vercel from dist/, never from this function.

import app from '../lib/app';

export default app;
