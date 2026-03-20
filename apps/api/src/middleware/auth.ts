/**
 * Athena V3.1 - Authentication & Authorization Middleware
 *
 * Two middleware functions:
 * 1. `authenticate` - verifies the JWT token and attaches user info to req
 * 2. `authorize`    - checks if the user's role is in the allowed roles list
 *
 * Usage:
 *   router.get('/admin-only', authenticate, authorize(['ADMIN']), handler)
 *   router.get('/manager-or-admin', authenticate, authorize(['ADMIN', 'MANAGER']), handler)
 *
 * OWNER role is a superuser — it passes through ALL authorization gates automatically.
 */

import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

// Extend Express Request to carry decoded user data after JWT verification
export interface AuthRequest extends Request {
  user?: {
    id:    string;
    email: string;
    role:  'OWNER' | 'ADMIN' | 'MANAGER' | 'EMPLOYEE';
  };
}

// Shape of the JWT payload we sign and verify
interface JwtPayload {
  id:    string;
  email: string;
  role:  'OWNER' | 'ADMIN' | 'MANAGER' | 'EMPLOYEE';
  iat?:  number;
  exp?:  number;
}

/**
 * authenticate - verifies JWT from Authorization header
 * Expects: "Authorization: Bearer <token>"
 */
export function authenticate(req: AuthRequest, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;

  // Token must be present and follow the "Bearer <token>" pattern
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Unauthorized: No token provided' });
    return;
  }

  const token = authHeader.split(' ')[1];
  const secret = process.env.JWT_SECRET;

  if (!secret) {
    res.status(500).json({ error: 'Server misconfiguration: JWT_SECRET missing' });
    return;
  }

  try {
    // Verify and decode the token
    const decoded = jwt.verify(token, secret) as JwtPayload;
    req.user = { id: decoded.id, email: decoded.email, role: decoded.role };
    next();
  } catch (err) {
    res.status(401).json({ error: 'Unauthorized: Invalid or expired token' });
  }
}

/**
 * authorize - checks if the authenticated user's role is allowed
 * Must be used AFTER `authenticate`
 * OWNER role always passes — it is a superuser that bypasses all role gates.
 */
export function authorize(allowedRoles: ('OWNER' | 'ADMIN' | 'MANAGER' | 'EMPLOYEE')[]) {
  return (req: AuthRequest, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized: Not authenticated' });
      return;
    }

    // OWNER is a superuser — always allowed through any gate
    if (req.user.role === 'OWNER') {
      return next();
    }

    if (!allowedRoles.includes(req.user.role)) {
      res.status(403).json({
        error: `Forbidden: Requires one of [${allowedRoles.join(', ')}], you are ${req.user.role}`,
      });
      return;
    }

    next();
  };
}
