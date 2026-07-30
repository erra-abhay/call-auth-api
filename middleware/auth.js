import { jwtVerify } from 'jose';

function getSecret() {
  return new TextEncoder().encode(process.env.JWT_SECRET);
}

/**
 * Reads the optimus_session cookie, verifies the JWT with jose (HS256),
 * and sets req.user = { userId, role }.
 * Returns 401 if missing or invalid.
 */
export async function auth(req, res, next) {
  try {
    const cookieName = process.env.COOKIE_NAME ?? 'optimus_session';
    const raw = req.cookies?.[cookieName];

    if (!raw) {
      return res.status(401).json({ error: 'unauthenticated' });
    }

    const { payload } = await jwtVerify(raw, getSecret(), { algorithms: ['HS256'] });

    req.user = { userId: payload.userId, role: payload.role };
    next();
  } catch {
    return res.status(401).json({ error: 'invalid or expired session' });
  }
}
