import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { connectMongo } from './db/mongo.js';

import authRoutes from './routes/authRoutes.js';
import studentRoutes from './routes/studentRoutes.js';
import classRoutes from './routes/classRoutes.js';
import callRoutes from './routes/callRoutes.js';
import micRoutes from './routes/micRoutes.js';

const app = express();

// ── Middleware ────────────────────────────────────────────────
app.use(cors({
  origin: true,
  credentials: true,
}));
app.use(express.json());

// Manual cookie parsing (no extra dep needed for simple httpOnly cookies)
app.use((req, _res, next) => {
  req.cookies = {};
  const cookieHeader = req.headers.cookie;
  if (cookieHeader) {
    cookieHeader.split(';').forEach((part) => {
      const [key, ...rest] = part.trim().split('=');
      req.cookies[key.trim()] = decodeURIComponent(rest.join('=').trim());
    });
  }
  next();
});

// ── Routes ────────────────────────────────────────────────────
app.use('/auth', authRoutes);
app.use('/student', studentRoutes);
app.use('/class', classRoutes);
app.use('/call', callRoutes);
app.use('/class', micRoutes);  // mic-request/approve/revoke share /class prefix

// ── Health check ──────────────────────────────────────────────
app.get('/health', (_req, res) => res.json({ ok: true, ts: new Date().toISOString() }));

// ── Global error handler (Express 5: async errors auto-propagate) ─
app.use((err, _req, res, _next) => {
  console.error('[error]', err);
  res.status(500).json({ error: 'internal_server_error', message: err.message });
});

// ── Boot ─────────────────────────────────────────────────────
const PORT = parseInt(process.env.PORT ?? '8080', 10);

connectMongo()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`[optimus-auth-api] listening on :${PORT}`);
    });
  })
  .catch((err) => {
    console.error('[boot] MongoDB connection failed:', err.message);
    console.warn('[boot] Starting without MongoDB — auth routes requiring DB will fail');
    app.listen(PORT, () => {
      console.log(`[optimus-auth-api] listening on :${PORT} (no MongoDB)`);
    });
  });

export default app;
