import { Router } from 'express';
import * as argon2 from 'argon2';
import { SignJWT } from 'jose';
import { z } from 'zod';
import { User } from '../models/User.js';

function getSecret() {
  return new TextEncoder().encode(process.env.JWT_SECRET);
}

const router = Router();

const loginSchema = z.object({
  userId: z.string().min(1),
  password: z.string().min(1).max(128),
});

const COOKIE_NAME = () => process.env.COOKIE_NAME ?? 'optimus_session';
const COOKIE_OPTS = [
  'HttpOnly',
  'Path=/',
  'SameSite=Lax',
].join('; ');

/**
 * POST /auth/login
 * Body: { userId, password }
 * Returns: { userId, role, name }  +  sets httpOnly session cookie
 */
router.post('/login', async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'invalid_input', details: parsed.error.flatten() });
  }

  const { userId, password } = parsed.data;

  const user = await User.findById(userId).lean();
  if (!user) {
    // Constant-time: still verify against a dummy hash to prevent user enumeration
    await argon2.verify(
      '$argon2id$v=19$m=65536,t=3,p=4$dummysalt1234567$dummyhash123456789012345678901234',
      password,
    ).catch(() => {});
    return res.status(401).json({ error: 'invalid_credentials' });
  }

  const valid = await argon2.verify(user.passwordHash, password);
  if (!valid) {
    return res.status(401).json({ error: 'invalid_credentials' });
  }

  // Sign JWT with jose (HS256)
  const ttl = process.env.JWT_TTL ?? '8h';
  const token = await new SignJWT({ userId: user._id, role: user.role })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(ttl)
    .sign(getSecret());

  // Set httpOnly cookie
  const maxAge = ttl === '8h' ? 8 * 60 * 60 : 3600;
  res.setHeader(
    'Set-Cookie',
    `${COOKIE_NAME()}=${token}; ${COOKIE_OPTS}; Max-Age=${maxAge}`,
  );

  return res.json({
    userId: user._id,
    role: user.role,
    name: user.profile?.name ?? userId,
  });
});

/**
 * POST /auth/logout
 * Clears the session cookie.
 */
router.post('/logout', (_req, res) => {
  res.setHeader(
    'Set-Cookie',
    `${COOKIE_NAME()}=; HttpOnly; Path=/; SameSite=Strict; Max-Age=0`,
  );
  return res.json({ ok: true });
});

export default router;
