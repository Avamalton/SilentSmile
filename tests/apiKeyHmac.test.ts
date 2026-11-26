import crypto from 'node:crypto';
import { describe, it, expect, beforeEach } from 'vitest';
import { DatabaseManager } from '../src/server/db/database';
import { runMigrations } from '../src/server/db/migrations';
import { ApiKeyService } from '../src/server/api/apiKeyService';

describe('Public API & API Key HMAC Authentication', () => {
  let dbMgr: DatabaseManager;
  let apiService: ApiKeyService;

  beforeEach(async () => {
    dbMgr = DatabaseManager.createIsolated(':memory:');
    await dbMgr.initialize();
    await runMigrations(dbMgr);
    apiService = new ApiKeyService(dbMgr);
  });

  it('generates API key pair and strips prohibited withdrawal permission', () => {
    // Attempting to request withdraw permission must be stripped by security policy
    const key = apiService.createApiKey('usr_test', ['read', 'trade', 'withdraw']);
    expect(key.keyId).toMatch(/^smi_/);
    expect(key.secret).toHaveLength(64);
    expect(key.permissions).toContain('read');
    expect(key.permissions).toContain('trade');
    expect(key.permissions).not.toContain('withdraw');
  });

  it('validates authentic HMAC-SHA256 signature', () => {
    const key = apiService.createApiKey('usr_alice', ['read', 'trade']);
    const timestamp = Date.now();
    const method = 'GET';
    const path = '/api/v1/orders';
    const body = '';

    // Expected client side HMAC computation
    const secretHash = crypto.createHash('sha256').update(key.secret).digest('hex');
    const payload = `${timestamp}${method}${path}${body}`;
    const signature = crypto.createHmac('sha256', secretHash).update(payload).digest('hex');

    const result = apiService.verifySignature({
      keyId: key.keyId,
      timestamp,
      signature,
      method,
      path,
      body,
      clientIp: '127.0.0.1',
      requiredPermission: 'read',
    });

    expect(result.valid).toBe(true);
    expect(result.userId).toBe('usr_alice');
  });

  it('rejects expired timestamps due to clock drift (> 30 seconds)', () => {
    const key = apiService.createApiKey('usr_bob', ['read']);
    const staleTimestamp = Date.now() - 45000; // 45 seconds ago

    const result = apiService.verifySignature({
      keyId: key.keyId,
      timestamp: staleTimestamp,
      signature: 'dummy_sig',
      method: 'GET',
      path: '/api/v1/ticker',
      body: '',
      clientIp: '127.0.0.1',
      requiredPermission: 'read',
    });

    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/drift exceeds 30 seconds/i);
  });

  it('enforces IP whitelist and rate limits', () => {
    // Key locked to IP 192.168.1.50 with max 3 requests per minute
    const key = apiService.createApiKey('usr_ip', ['read'], '192.168.1.50', 3);
    const secretHash = crypto.createHash('sha256').update(key.secret).digest('hex');

    const sign = (ts: number, ip: string) => {
      const payload = `${ts}GET/api/v1/depth`;
      const sig = crypto.createHmac('sha256', secretHash).update(payload).digest('hex');
      return apiService.verifySignature({
        keyId: key.keyId,
        timestamp: ts,
        signature: sig,
        method: 'GET',
        path: '/api/v1/depth',
        body: '',
        clientIp: ip,
        requiredPermission: 'read',
      });
    };

    // Unauthorized IP rejected
    const unauthRes = sign(Date.now(), '203.0.113.10');
    expect(unauthRes.valid).toBe(false);
    expect(unauthRes.error).toMatch(/whitelist/i);

    // Whitelisted IP passes 3 times
    const now = Date.now();
    expect(sign(now, '192.168.1.50').valid).toBe(true);
    expect(sign(now, '192.168.1.50').valid).toBe(true);
    expect(sign(now, '192.168.1.50').valid).toBe(true);

    // 4th request exceeds rate limit
    const rateLimited = sign(now, '192.168.1.50');
    expect(rateLimited.valid).toBe(false);
    expect(rateLimited.error).toMatch(/rate limit exceeded/i);
  });
});
