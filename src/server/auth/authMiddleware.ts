import { Request, Response, NextFunction } from 'express';
import { AuthService, TokenPayload } from './authService';
import { DatabaseManager } from '../db/database';

declare global {
  namespace Express {
    interface Request {
      user?: TokenPayload;
    }
  }
}

export function createAuthMiddleware(authService: AuthService) {
  return {
    requireAuth: (req: Request, res: Response, next: NextFunction): void => {
      let token: string | undefined;

      const authHeader = req.headers.authorization;
      if (authHeader && authHeader.startsWith('Bearer ')) {
        token = authHeader.substring(7).trim();
      } else if (req.cookies && req.cookies.token) {
        token = req.cookies.token;
      }

      if (!token) {
        res.status(401).json({ success: false, error: 'Unauthorized: Authentication token missing' });
        return;
      }

      try {
        const payload = authService.verifyAccessToken(token);
        req.user = payload;
        next();
      } catch (err: any) {
        res.status(401).json({ success: false, error: err.message || 'Unauthorized token' });
      }
    },

    requireRole: (...allowedRoles: string[]) => {
      return (req: Request, res: Response, next: NextFunction): void => {
        if (!req.user) {
          res.status(401).json({ success: false, error: 'Unauthorized: Not logged in' });
          return;
        }

        if (!allowedRoles.includes(req.user.role)) {
          res.status(403).json({ success: false, error: 'Forbidden: Insufficient privileges' });
          return;
        }

        next();
      };
    },

    requireKyc: (minLevel: number) => {
      return (req: Request, res: Response, next: NextFunction): void => {
        if (!req.user) {
          res.status(401).json({ success: false, error: 'Unauthorized' });
          return;
        }

        if (req.user.kycLevel < minLevel) {
          res.status(403).json({
            success: false,
            error: `KYC verification Level ${minLevel} required to perform this action. Your current level is ${req.user.kycLevel}.`,
            currentLevel: req.user.kycLevel,
            requiredLevel: minLevel,
          });
          return;
        }

        next();
      };
    },
  };
}
