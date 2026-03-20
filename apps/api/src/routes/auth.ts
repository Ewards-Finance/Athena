/**
 * Athena V2 - Auth Routes
 * POST /api/auth/login  - returns JWT on valid credentials
 * GET  /api/auth/me     - returns current user data (requires auth)
 */

import { Router, Request, Response } from 'express';
import { prisma } from '../lib/prisma';
import bcrypt                        from 'bcryptjs';
import jwt                           from 'jsonwebtoken';
import { z }                         from 'zod';
import { authenticate, AuthRequest } from '../middleware/auth';

const router = Router();

// Zod schema: validates login input before touching the database
const loginSchema = z.object({
  email:    z.string().email('Invalid email address'),
  password: z.string().min(6, 'Password must be at least 6 characters'),
});

// POST /api/auth/login
router.post('/login', async (req: Request, res: Response) => {
  try {
    // Validate request body
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Validation failed', details: parsed.error.flatten() });
      return;
    }

    const { email: rawEmail, password } = parsed.data;
    const email = rawEmail.toLowerCase().trim();

    // Fetch user from DB (include profile for display name)
    const user = await prisma.user.findUnique({
      where: { email },
      include: { profile: { select: { firstName: true, lastName: true, employeeId: true, department: true } } },
    });

    // Use a generic error message to avoid leaking which emails exist (security best practice)
    if (!user || !user.isActive) {
      res.status(401).json({ error: 'Invalid email or password' });
      return;
    }

    // Constant-time password comparison via bcrypt
    const passwordMatch = await bcrypt.compare(password, user.password);
    if (!passwordMatch) {
      res.status(401).json({ error: 'Invalid email or password' });
      return;
    }

    const secret = process.env.JWT_SECRET!;
    const expiresIn = (process.env.JWT_EXPIRES_IN || '7d') as jwt.SignOptions['expiresIn'];

    // Sign JWT with user id, email, and role as payload
    const token = jwt.sign(
      { id: user.id, email: user.email, role: user.role },
      secret,
      { expiresIn }
    );

    res.json({
      token,
      user: {
        id:         user.id,
        email:      user.email,
        role:       user.role,
        firstName:  user.profile?.firstName,
        lastName:   user.profile?.lastName,
        employeeId: user.profile?.employeeId,
        department: user.profile?.department,
      },
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/auth/me - returns the current authenticated user's info
router.get('/me', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user!.id },
      select: {
        id:      true,
        email:   true,
        role:    true,
        profile: {
          select: {
            firstName:     true,
            lastName:      true,
            employeeId:    true,
            designation:   true,
            department:    true,
            officeLocation: true,
          },
        },
      },
    });

    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    res.json(user);
  } catch (err) {
    console.error('Get me error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/auth/reset-password/:userId - admin resets any employee's password to a temp value
router.post('/reset-password/:userId', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    if (req.user!.role !== 'ADMIN') {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }

    const target = await prisma.user.findUnique({ where: { id: req.params.userId } });
    if (!target) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    // Generate a temp password that satisfies strength requirements
    const digits = Math.floor(1000 + Math.random() * 9000);
    const tempPassword = `Temp@${digits}`;

    const hashed = await bcrypt.hash(tempPassword, 12);
    await prisma.user.update({ where: { id: target.id }, data: { password: hashed } });

    res.json({ tempPassword });
  } catch (err) {
    console.error('Reset password error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/auth/change-password - any logged-in user can change their own password
const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Current password is required'),
  newPassword: z.string().min(6, 'Password must be at least 6 characters'),
});

router.post('/change-password', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const parsed = changePasswordSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.errors[0].message });
      return;
    }

    const { currentPassword, newPassword } = parsed.data;

    const user = await prisma.user.findUnique({ where: { id: req.user!.id } });
    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    const match = await bcrypt.compare(currentPassword, user.password);
    if (!match) {
      res.status(400).json({ error: 'Current password is incorrect' });
      return;
    }

    const hashed = await bcrypt.hash(newPassword, 12);
    await prisma.user.update({ where: { id: user.id }, data: { password: hashed } });

    res.json({ message: 'Password changed successfully' });
  } catch (err) {
    console.error('Change password error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
