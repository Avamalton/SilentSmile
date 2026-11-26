import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { DatabaseManager } from '../db/database';
import { TotpService } from './totpService';

const JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET || 'silentsmile-access-secret-production-key-9988';
const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'silentsmile-refresh-secret-production-key-7766';
const ACCESS_TOKEN_TTL = 15 * 60; // 15 minutes in seconds
const REFRESH_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export interface UserRecord {
  id: string;
  email: string;
  password_hash: string;
  role: 'trader' | 'admin' | 'compliance';
  status: 'active' | 'frozen' | 'suspended';
  kyc_level: number;
  totp_secret: string | null;
  totp_enabled: number;
  daily_withdraw_limit_idr: number;
  created_at: number;
  updated_at: number;
}

export interface SessionRecord {
  id: string;
  user_id: string;
  refresh_token_hash: string;
  ip_address: string;
  user_agent: string;
  device_name: string | null;
  is_revoked: number;
  expires_at: number;
  created_at: number;
}

export interface TokenPayload {
  userId: string;
  email: string;
  role: string;
  kycLevel: number;
  sessionId: string;
}

export interface LoginResult {
  requires2FA?: boolean;
  tempToken?: string;
  accessToken?: string;
  refreshToken?: string;
  user?: Omit<UserRecord, 'password_hash' | 'totp_secret'>;
  session?: SessionRecord;
}

// In-memory anti-brute force tracker: Map of email/IP -> { attempts: number, lockedUntil: number }
interface FailedAttemptInfo {
  attempts: number;
  lockedUntil: number;
}

export class AuthService {
  private dbMgr: DatabaseManager;
  private static failedAttempts = new Map<string, FailedAttemptInfo>();

  constructor(dbMgr: DatabaseManager) {
    this.dbMgr = dbMgr;
  }

  // --- Password Cryptography (PBKDF2) ---
  public static hashPassword(password: string): string {
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha512').toString('hex');
    return `${salt}:${hash}`;
  }

  public static verifyPassword(password: string, storedHash: string): boolean {
    const parts = storedHash.split(':');
    if (parts.length !== 2) return false;
    const [salt, originalHash] = parts;
    const testHash = crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha512').toString('hex');
    return crypto.timingSafeEqual(Buffer.from(testHash, 'hex'), Buffer.from(originalHash, 'hex'));
  }

  // --- Anti-Brute-Force Lockout Tracker ---
  private static checkLockout(identifier: string): void {
    const now = Date.now();
    const info = AuthService.failedAttempts.get(identifier);
    if (info && info.lockedUntil > now) {
      const waitMinutes = Math.ceil((info.lockedUntil - now) / 60000);
      throw new Error(`Too many failed attempts. Account temporarily locked. Try again in ${waitMinutes} minutes.`);
    }
  }

  private static recordFailedAttempt(identifier: string): void {
    const now = Date.now();
    const info = AuthService.failedAttempts.get(identifier) || { attempts: 0, lockedUntil: 0 };
    info.attempts += 1;

    // 5 failed attempts = 15 minutes lockout
    if (info.attempts >= 5) {
      info.lockedUntil = now + 15 * 60 * 1000;
    }
    AuthService.failedAttempts.set(identifier, info);
  }

  private static clearFailedAttempts(identifier: string): void {
    AuthService.failedAttempts.delete(identifier);
  }

  // --- Registration ---
  public register(email: string, password: string, role: 'trader' | 'admin' = 'trader'): Omit<UserRecord, 'password_hash' | 'totp_secret'> {
    const normalizedEmail = email.toLowerCase().trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
      throw new Error('Invalid email address format');
    }
    if (!password || password.length < 8) {
      throw new Error('Password must be at least 8 characters long');
    }

    const existing = this.dbMgr.queryOne<UserRecord>('SELECT id FROM users WHERE email = ?', [normalizedEmail]);
    if (existing) {
      throw new Error('An account with this email already exists');
    }

    const userId = `usr_${crypto.randomBytes(8).toString('hex')}`;
    const passwordHash = AuthService.hashPassword(password);
    const now = Date.now();

    // Default daily withdrawal limit: 50,000,000 IDR
    const dailyLimit = 50000000;

    this.dbMgr.runInTransaction(() => {
      this.dbMgr.execute(
        `INSERT INTO users (id, email, password_hash, role, status, kyc_level, totp_secret, totp_enabled, daily_withdraw_limit_idr, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'active', 0, NULL, 0, ?, ?, ?)`,
        [userId, normalizedEmail, passwordHash, role, dailyLimit, now, now]
      );

      // Initialize default ledger accounts for all standard assets
      const assets = ['IDR', 'BTC', 'ETH', 'SOL', 'DNA', 'USDT'];
      for (const asset of assets) {
        this.dbMgr.execute(
          `INSERT OR IGNORE INTO ledger_accounts (id, user_id, asset, account_type, balance, created_at)
           VALUES (?, ?, ?, 'AVAILABLE', 0, ?)`,
          [`acc_${userId}_${asset}_AVAILABLE`, userId, asset, now]
        );
        this.dbMgr.execute(
          `INSERT OR IGNORE INTO ledger_accounts (id, user_id, asset, account_type, balance, created_at)
           VALUES (?, ?, ?, 'LOCKED_ORDER', 0, ?)`,
          [`acc_${userId}_${asset}_LOCKED_ORDER`, userId, asset, now]
        );
        this.dbMgr.execute(
          `INSERT OR IGNORE INTO ledger_accounts (id, user_id, asset, account_type, balance, created_at)
           VALUES (?, ?, ?, 'LOCKED_WITHDRAW', 0, ?)`,
          [`acc_${userId}_${asset}_LOCKED_WITHDRAW`, userId, asset, now]
        );
      }
    });

    const user = this.getUserById(userId);
    if (!user) throw new Error('User creation failed');
    return user;
  }

  // --- Login with Brute-Force Protection & 2FA ---
  public login(
    email: string,
    password: string,
    ipAddress: string,
    userAgent: string,
    totpCode?: string
  ): LoginResult {
    const normalizedEmail = email.toLowerCase().trim();
    const lockoutKey = `${normalizedEmail}_${ipAddress}`;

    AuthService.checkLockout(lockoutKey);

    const user = this.dbMgr.queryOne<UserRecord>('SELECT * FROM users WHERE email = ?', [normalizedEmail]);
    if (!user) {
      AuthService.recordFailedAttempt(lockoutKey);
      throw new Error('Invalid email or password');
    }

    if (user.status === 'frozen') {
      throw new Error('Account is frozen due to compliance or security hold. Contact support.');
    }
    if (user.status === 'suspended') {
      throw new Error('Account has been suspended.');
    }

    const isValidPassword = AuthService.verifyPassword(password, user.password_hash);
    if (!isValidPassword) {
      AuthService.recordFailedAttempt(lockoutKey);
      throw new Error('Invalid email or password');
    }

    // 2FA Verification if enabled
    if (user.totp_enabled === 1) {
      if (!totpCode) {
        // Return intermediate token for 2FA verification step
        const tempToken = jwt.sign(
          { userId: user.id, email: user.email, stage: '2FA_PENDING' },
          JWT_ACCESS_SECRET,
          { expiresIn: '5m' }
        );
        return { requires2FA: true, tempToken };
      }

      if (!user.totp_secret || !TotpService.verifyCode(totpCode, user.totp_secret)) {
        AuthService.recordFailedAttempt(lockoutKey);
        throw new Error('Invalid 2FA authentication code');
      }
    }

    // Login successful: reset failed attempt counter
    AuthService.clearFailedAttempts(lockoutKey);

    // Create session and issue tokens
    return this.createSessionAndTokens(user, ipAddress, userAgent);
  }

  // --- Complete 2FA Login with Temporary Token ---
  public complete2FALogin(
    tempToken: string,
    totpCode: string,
    ipAddress: string,
    userAgent: string
  ): LoginResult {
    let payload: any;
    try {
      payload = jwt.verify(tempToken, JWT_ACCESS_SECRET);
    } catch {
      throw new Error('2FA session expired. Please log in again.');
    }

    if (payload.stage !== '2FA_PENDING' || !payload.userId) {
      throw new Error('Invalid 2FA authentication token.');
    }

    const user = this.dbMgr.queryOne<UserRecord>('SELECT * FROM users WHERE id = ?', [payload.userId]);
    if (!user || !user.totp_secret || user.totp_enabled !== 1) {
      throw new Error('2FA is not properly configured for this user.');
    }

    if (!TotpService.verifyCode(totpCode, user.totp_secret)) {
      throw new Error('Invalid 2FA authentication code');
    }

    return this.createSessionAndTokens(user, ipAddress, userAgent);
  }

  // --- Session & Token Generator ---
  private createSessionAndTokens(user: UserRecord, ipAddress: string, userAgent: string): LoginResult {
    const sessionId = `ses_${crypto.randomBytes(12).toString('hex')}`;
    const rawRefreshToken = crypto.randomBytes(32).toString('hex');
    const refreshTokenHash = crypto.createHash('sha256').update(rawRefreshToken).digest('hex');

    const now = Date.now();
    const expiresAt = now + REFRESH_TOKEN_TTL_MS;

    // Detect device name from user-agent
    let deviceName = 'Desktop Browser';
    if (/mobile/i.test(userAgent)) deviceName = 'Mobile Device';
    if (/iphone|ipad/i.test(userAgent)) deviceName = 'iOS Device';
    if (/android/i.test(userAgent)) deviceName = 'Android Device';

    this.dbMgr.execute(
      `INSERT INTO user_sessions (id, user_id, refresh_token_hash, ip_address, user_agent, device_name, is_revoked, expires_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)`,
      [sessionId, user.id, refreshTokenHash, ipAddress, userAgent, deviceName, expiresAt, now]
    );

    const tokenPayload: TokenPayload = {
      userId: user.id,
      email: user.email,
      role: user.role,
      kycLevel: user.kyc_level,
      sessionId,
    };

    const accessToken = jwt.sign(tokenPayload, JWT_ACCESS_SECRET, { expiresIn: ACCESS_TOKEN_TTL });
    // Encode sessionId alongside refresh token
    const refreshToken = `${sessionId}:${rawRefreshToken}`;

    const { password_hash, totp_secret, ...safeUser } = user;
    const session = this.dbMgr.queryOne<SessionRecord>('SELECT * FROM user_sessions WHERE id = ?', [sessionId]);

    return {
      requires2FA: false,
      accessToken,
      refreshToken,
      user: safeUser,
      session: session || undefined,
    };
  }

  // --- Refresh Token Rotation ---
  public refreshTokens(refreshTokenStr: string, ipAddress: string, userAgent: string): { accessToken: string; refreshToken: string } {
    const parts = refreshTokenStr.split(':');
    if (parts.length !== 2) {
      throw new Error('Invalid refresh token format');
    }
    const [sessionId, rawRefreshToken] = parts;
    const hash = crypto.createHash('sha256').update(rawRefreshToken).digest('hex');

    const session = this.dbMgr.queryOne<SessionRecord>('SELECT * FROM user_sessions WHERE id = ?', [sessionId]);
    if (!session) {
      throw new Error('Session not found');
    }
    if (session.is_revoked === 1) {
      throw new Error('Session has been revoked');
    }
    if (session.expires_at < Date.now()) {
      throw new Error('Session expired. Please log in again.');
    }
    if (session.refresh_token_hash !== hash) {
      // Possible token theft or replay attack: revoke session immediately!
      this.dbMgr.execute('UPDATE user_sessions SET is_revoked = 1 WHERE id = ?', [sessionId]);
      throw new Error('Token reuse detected. Session revoked for security.');
    }

    const user = this.dbMgr.queryOne<UserRecord>('SELECT * FROM users WHERE id = ?', [session.user_id]);
    if (!user || user.status !== 'active') {
      throw new Error('User account is not active');
    }

    // Rotate refresh token
    const newRawRefreshToken = crypto.randomBytes(32).toString('hex');
    const newHash = crypto.createHash('sha256').update(newRawRefreshToken).digest('hex');
    const now = Date.now();
    const newExpiresAt = now + REFRESH_TOKEN_TTL_MS;

    this.dbMgr.execute(
      `UPDATE user_sessions
       SET refresh_token_hash = ?, ip_address = ?, user_agent = ?, expires_at = ?
       WHERE id = ?`,
      [newHash, ipAddress, userAgent, newExpiresAt, sessionId]
    );

    const tokenPayload: TokenPayload = {
      userId: user.id,
      email: user.email,
      role: user.role,
      kycLevel: user.kyc_level,
      sessionId,
    };

    const newAccessToken = jwt.sign(tokenPayload, JWT_ACCESS_SECRET, { expiresIn: ACCESS_TOKEN_TTL });
    const newRefreshToken = `${sessionId}:${newRawRefreshToken}`;

    return {
      accessToken: newAccessToken,
      refreshToken: newRefreshToken,
    };
  }

  // --- Session Management ---
  public listSessions(userId: string): SessionRecord[] {
    return this.dbMgr.query<SessionRecord>(
      'SELECT id, user_id, ip_address, user_agent, device_name, is_revoked, expires_at, created_at FROM user_sessions WHERE user_id = ? ORDER BY created_at DESC',
      [userId]
    );
  }

  public revokeSession(userId: string, sessionId: string): void {
    this.dbMgr.execute(
      'UPDATE user_sessions SET is_revoked = 1 WHERE id = ? AND user_id = ?',
      [sessionId, userId]
    );
  }

  public revokeAllOtherSessions(userId: string, currentSessionId: string): void {
    this.dbMgr.execute(
      'UPDATE user_sessions SET is_revoked = 1 WHERE user_id = ? AND id != ?',
      [userId, currentSessionId]
    );
  }

  // --- 2FA Management ---
  public setup2FA(userId: string): { secret: string; otpauthUri: string } {
    const user = this.dbMgr.queryOne<UserRecord>('SELECT * FROM users WHERE id = ?', [userId]);
    if (!user) throw new Error('User not found');

    const secret = TotpService.generateSecret();
    this.dbMgr.execute('UPDATE users SET totp_secret = ? WHERE id = ?', [secret, userId]);

    const otpauthUri = TotpService.getOtpauthUri(secret, user.email);
    return { secret, otpauthUri };
  }

  public enable2FA(userId: string, code: string): boolean {
    const user = this.dbMgr.queryOne<UserRecord>('SELECT * FROM users WHERE id = ?', [userId]);
    if (!user || !user.totp_secret) {
      throw new Error('Please initiate 2FA setup first');
    }

    const isValid = TotpService.verifyCode(code, user.totp_secret);
    if (!isValid) {
      throw new Error('Invalid verification code');
    }

    this.dbMgr.execute('UPDATE users SET totp_enabled = 1, updated_at = ? WHERE id = ?', [Date.now(), userId]);
    return true;
  }

  public disable2FA(userId: string, code: string): boolean {
    const user = this.dbMgr.queryOne<UserRecord>('SELECT * FROM users WHERE id = ?', [userId]);
    if (!user || !user.totp_secret || user.totp_enabled === 0) {
      throw new Error('2FA is not enabled');
    }

    const isValid = TotpService.verifyCode(code, user.totp_secret);
    if (!isValid) {
      throw new Error('Invalid 2FA authentication code');
    }

    this.dbMgr.execute('UPDATE users SET totp_enabled = 0, totp_secret = NULL, updated_at = ? WHERE id = ?', [Date.now(), userId]);
    return true;
  }

  // --- User Queries ---
  public getUserById(userId: string): Omit<UserRecord, 'password_hash' | 'totp_secret'> | null {
    const user = this.dbMgr.queryOne<UserRecord>('SELECT * FROM users WHERE id = ?', [userId]);
    if (!user) return null;
    const { password_hash, totp_secret, ...safeUser } = user;
    return safeUser;
  }

  public verifyAccessToken(token: string): TokenPayload {
    try {
      const decoded = jwt.verify(token, JWT_ACCESS_SECRET) as TokenPayload;
      // Verify session revocation
      const session = this.dbMgr.queryOne<SessionRecord>('SELECT is_revoked, expires_at FROM user_sessions WHERE id = ?', [decoded.sessionId]);
      if (!session || session.is_revoked === 1 || session.expires_at < Date.now()) {
        throw new Error('Session is invalid or has been revoked');
      }
      return decoded;
    } catch (err: any) {
      throw new Error(`Authentication token invalid: ${err.message}`);
    }
  }
}
