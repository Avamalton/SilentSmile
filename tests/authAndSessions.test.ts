import { describe, it, expect, beforeEach } from 'vitest';
import { DatabaseManager } from '../src/server/db/database';
import { runMigrations } from '../src/server/db/migrations';
import { AuthService } from '../src/server/auth/authService';
import { TotpService } from '../src/server/auth/totpService';

describe('Auth & Session Management', () => {
  let dbMgr: DatabaseManager;
  let authService: AuthService;

  beforeEach(async () => {
    // In-memory sqlite instance for isolated test execution
    dbMgr = DatabaseManager.createIsolated(':memory:');
    await dbMgr.initialize();
    await runMigrations(dbMgr);
    authService = new AuthService(dbMgr);
  });

  it('registers a new user and provisions default ledger accounts', () => {
    const user = authService.register('trader@silentsmile.io', 'StrongPassword123!');
    expect(user.id).toBeDefined();
    expect(user.email).toBe('trader@silentsmile.io');
    expect(user.role).toBe('trader');
    expect(user.kyc_level).toBe(0);

    // Verify initial ledger accounts created
    const accounts = dbMgr.query(
      'SELECT asset, account_type, balance FROM ledger_accounts WHERE user_id = ?',
      [user.id]
    );
    expect(accounts.length).toBe(18); // 6 assets * 3 types (AVAILABLE, LOCKED_ORDER, LOCKED_WITHDRAW)
    for (const acc of accounts) {
      expect(acc.balance).toBe(0);
    }
  });

  it('rejects duplicate email registrations', () => {
    authService.register('dup@silentsmile.io', 'Secret1234!');
    expect(() => {
      authService.register('dup@silentsmile.io', 'AnotherSecret123!');
    }).toThrow(/already exists/i);
  });

  it('logs in successfully and returns JWT access and refresh tokens', () => {
    authService.register('alice@silentsmile.io', 'AlicePassword999!');
    const res = authService.login(
      'alice@silentsmile.io',
      'AlicePassword999!',
      '192.168.1.1',
      'Mozilla/5.0 (Macintosh)'
    );

    expect(res.requires2FA).toBe(false);
    expect(res.accessToken).toBeDefined();
    expect(res.refreshToken).toBeDefined();
    expect(res.user?.email).toBe('alice@silentsmile.io');

    // Verify access token decodes
    const payload = authService.verifyAccessToken(res.accessToken!);
    expect(payload.email).toBe('alice@silentsmile.io');
    expect(payload.userId).toBe(res.user?.id);
  });

  it('rejects invalid password and tracks failed attempts', () => {
    authService.register('bob@silentsmile.io', 'BobPassword123!');
    expect(() => {
      authService.login('bob@silentsmile.io', 'WrongPassword!', '127.0.0.1', 'Desktop');
    }).toThrow(/invalid email or password/i);
  });

  it('locks account after 5 failed password attempts (anti-brute-force)', () => {
    authService.register('brute@silentsmile.io', 'TargetPassword123!');
    const ip = '10.0.0.99';

    for (let i = 0; i < 4; i++) {
      expect(() => {
        authService.login('brute@silentsmile.io', 'Wrong!', ip, 'Agent');
      }).toThrow(/invalid email or password/i);
    }

    // 5th attempt fails and triggers lockout
    expect(() => {
      authService.login('brute@silentsmile.io', 'Wrong!', ip, 'Agent');
    }).toThrow(/invalid email or password/i);

    // 6th attempt should be blocked by anti-brute-force lockout
    expect(() => {
      authService.login('brute@silentsmile.io', 'TargetPassword123!', ip, 'Agent');
    }).toThrow(/too many failed attempts/i);
  });

  it('handles refresh token rotation and revokes on replay', () => {
    const user = authService.register('charlie@silentsmile.io', 'CharliePass123!');
    const loginRes = authService.login('charlie@silentsmile.io', 'CharliePass123!', '127.0.0.1', 'Desktop');

    const originalRefreshToken = loginRes.refreshToken!;
    const refreshed = authService.refreshTokens(originalRefreshToken, '127.0.0.1', 'Desktop');
    expect(refreshed.accessToken).toBeDefined();
    expect(refreshed.refreshToken).not.toBe(originalRefreshToken);

    // Replay attack: reusing the old refresh token must fail and revoke the session!
    expect(() => {
      authService.refreshTokens(originalRefreshToken, '127.0.0.1', 'Desktop');
    }).toThrow(/token reuse detected/i);
  });

  it('enables and verifies RFC 6238 2FA TOTP', () => {
    const user = authService.register('totp@silentsmile.io', 'TotpPass123!');
    const { secret, otpauthUri } = authService.setup2FA(user.id);
    expect(secret).toHaveLength(20);
    expect(otpauthUri).toContain('otpauth://totp/');

    const validCode = TotpService.generateCode(secret);
    const enabled = authService.enable2FA(user.id, validCode);
    expect(enabled).toBe(true);

    // Subsequent login now requires 2FA
    const loginAttempt = authService.login('totp@silentsmile.io', 'TotpPass123!', '127.0.0.1', 'Desktop');
    expect(loginAttempt.requires2FA).toBe(true);
    expect(loginAttempt.tempToken).toBeDefined();

    // Complete login with TOTP code
    const completed = authService.complete2FALogin(
      loginAttempt.tempToken!,
      validCode,
      '127.0.0.1',
      'Desktop'
    );
    expect(completed.accessToken).toBeDefined();
    expect(completed.user?.id).toBe(user.id);
  });

  it('allows listing and revoking device sessions', () => {
    const user = authService.register('multi@silentsmile.io', 'MultiSession123!');
    const s1 = authService.login('multi@silentsmile.io', 'MultiSession123!', '192.168.1.10', 'Mozilla/Mobile');
    const s2 = authService.login('multi@silentsmile.io', 'MultiSession123!', '192.168.1.20', 'Chrome/Desktop');

    let sessions = authService.listSessions(user.id);
    expect(sessions.length).toBe(2);

    // Revoke session 1
    authService.revokeSession(user.id, s1.session!.id);
    expect(() => {
      authService.verifyAccessToken(s1.accessToken!);
    }).toThrow(/revoked/i);

    // Session 2 remains valid
    const verifiedS2 = authService.verifyAccessToken(s2.accessToken!);
    expect(verifiedS2.sessionId).toBe(s2.session!.id);
  });
});
