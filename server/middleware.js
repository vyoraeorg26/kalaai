const jwt = require('jsonwebtoken');

function requireAdmin(req, res, next) {
  const token = req.cookies?.dc_admin;
  if (!token) return res.status(401).json({ message: 'Admin login required' });
  try {
    const claims = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ['HS256'], issuer: 'kalaai', audience: 'kalaai-admin' });
    if (claims.role !== 'admin' || typeof claims.username !== 'string') throw new Error('Invalid role');
    req.admin = claims;
    next();
  } catch (_) {
    res.clearCookie('dc_admin', cookieOptions());
    return res.status(401).json({ message: 'Session expired. Please log in again.' });
  }
}

function cookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    path: '/',
  };
}

// Browser state-changing requests must originate from this site. JSON-only APIs
// also make cross-site HTML form submissions unusable as a CSRF vector.
function sameOriginMutation(req, res, next) {
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) return next();
  const origin = req.get('origin');
  if (!origin) {
    if (process.env.NODE_ENV === 'production') return res.status(403).json({ message: 'Request origin could not be verified.' });
    return next();
  }
  try {
    const parsed = new URL(origin);
    if (parsed.origin !== `${req.protocol}://${req.get('host')}`) {
      return res.status(403).json({ message: 'Cross-origin request blocked.' });
    }
  } catch (_) {
    return res.status(403).json({ message: 'Invalid request origin.' });
  }
  next();
}

const cleanText = (value, max = 500) => typeof value === 'string'
  ? value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').replace(/<[^>]*>/g, '').trim().slice(0, max)
  : '';
const validEmail = value => typeof value === 'string' && value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value);
const validPhone = value => !value || (typeof value === 'string' && /^[+()\d .-]{7,20}$/.test(value));

module.exports = { requireAdmin, cookieOptions, sameOriginMutation, cleanText, validEmail, validPhone };
