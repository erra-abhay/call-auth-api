/**
 * Role gate factory. Usage:
 *   router.post('/class/start', auth, requireRole('faculty'), handler)
 *   router.post('/class/approve', auth, requireRole('faculty'), handler)
 */
export function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'forbidden', required_roles: roles });
    }
    next();
  };
}
