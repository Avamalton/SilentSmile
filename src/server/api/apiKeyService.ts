import crypto from 'node:crypto';
import { DatabaseManager } from '../db/database';

export interface ApiKeyRecord {
  id: string;
  user_id: string;
  key_id: string;
  secret_hash: string;
  permissions: string;
  ip_whitelist: string | null;
  rate_limit_rpm: number;
  is_active: number;
  created_at: number;
}

export interface CreatedApiKeyResult {
  keyId: string;
  secret: string; // Plaintext secret returned ONCE upon generation
  permissions: string[];
  ipWhitelist: string | null;
  rateLimitRpm: number;
}

export class ApiKeyService {
  private dbMgr: DatabaseManager;
  // In-memory rate limit tracker: keyId -> Array of timestamps (ms)
  private static rateLimitMap = new Map<string, number[]>();

  constructor(dbMgr: DatabaseManager) {
    this.dbMgr = dbMgr;
  }

  /**
   * Generates a new API key pair.
   * Enforces security policy: 'withdraw' permission is never permitted on API keys.
   */
  public createApiKey(
    userId: string,
    permissions: string[] = ['read', 'trade'],
    ipWhitelist?: string,
    rateLimitRpm: number = 120
  ): CreatedApiKeyResult {
    // Sanitize permissions: strictly strip 'withdraw'
    const allowedPerms = permissions.filter((p) => p === 'read' || p === 'trade');
    if (allowedPerms.length === 0) {
      allowedPerms.push('read');
    }

    const keyId = `smi_${crypto.randomBytes(16).toString('hex')}`;
    const rawSecret = crypto.randomBytes(32).toString('hex');
    const secretHash = crypto.createHash('sha256').update(rawSecret).digest('hex');

    const id = `apk_${crypto.randomBytes(8).toString('hex')}`;
    const now = Date.now();

    this.dbMgr.execute(
      `INSERT INTO api_keys (id, user_id, key_id, secret_hash, permissions, ip_whitelist, rate_limit_rpm, is_active, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)`,
      [
        id,
        userId,
        keyId,
        secretHash,
        JSON.stringify(allowedPerms),
        ipWhitelist || null,
        rateLimitRpm,
        now,
      ]
    );

    return {
      keyId,
      secret: rawSecret,
      permissions: allowedPerms,
      ipWhitelist: ipWhitelist || null,
      rateLimitRpm,
    };
  }

  public listApiKeys(userId: string): Omit<ApiKeyRecord, 'secret_hash'>[] {
    return this.dbMgr.query<Omit<ApiKeyRecord, 'secret_hash'>>(
      `SELECT id, user_id, key_id, permissions, ip_whitelist, rate_limit_rpm, is_active, created_at
       FROM api_keys WHERE user_id = ? ORDER BY created_at DESC`,
      [userId]
    );
  }

  public revokeApiKey(userId: string, keyId: string): void {
    this.dbMgr.execute('UPDATE api_keys SET is_active = 0 WHERE key_id = ? AND user_id = ?', [keyId, userId]);
  }

  /**
   * Verify HMAC-SHA256 signature and validate rate limits + IP whitelist
   */
  public verifySignature(params: {
    keyId: string;
    timestamp: number;
    signature: string;
    method: string;
    path: string;
    body: string;
    clientIp: string;
    requiredPermission: 'read' | 'trade';
  }): { valid: boolean; userId?: string; error?: string } {
    const { keyId, timestamp, signature, method, path, body, clientIp, requiredPermission } = params;

    const now = Date.now();
    // 30 seconds drift tolerance
    if (Math.abs(now - timestamp) > 30000) {
      return { valid: false, error: 'Timestamp drift exceeds 30 seconds' };
    }

    const key = this.dbMgr.queryOne<ApiKeyRecord>('SELECT * FROM api_keys WHERE key_id = ?', [keyId]);
    if (!key || key.is_active !== 1) {
      return { valid: false, error: 'Invalid or deactivated API key' };
    }

    // IP Whitelist Check
    if (key.ip_whitelist) {
      const allowedIps = key.ip_whitelist.split(',').map((s) => s.trim());
      if (!allowedIps.includes(clientIp) && !allowedIps.includes('127.0.0.1') && !allowedIps.includes('::1')) {
        return { valid: false, error: 'IP address not in API key whitelist' };
      }
    }

    // Permission Check
    const perms: string[] = JSON.parse(key.permissions || '[]');
    if (!perms.includes(requiredPermission)) {
      return { valid: false, error: `API key lacks required permission: ${requiredPermission}` };
    }

    // Rate Limiting Check (Sliding 60-second window)
    const windowStart = now - 60000;
    const timestamps = ApiKeyService.rateLimitMap.get(keyId) || [];
    const validTimestamps = timestamps.filter((t) => t > windowStart);

    if (validTimestamps.length >= key.rate_limit_rpm) {
      return { valid: false, error: `Rate limit exceeded: max ${key.rate_limit_rpm} requests/min` };
    }

    validTimestamps.push(now);
    ApiKeyService.rateLimitMap.set(keyId, validTimestamps);

    // Compute expected HMAC SHA-256
    // Payload: timestamp + method + path + body
    const payload = `${timestamp}${method.toUpperCase()}${path}${body || ''}`;
    // Since secret is hashed with sha256 in DB, the HMAC key is derived from hash
    const expectedSig = crypto.createHmac('sha256', key.secret_hash).update(payload).digest('hex');

    if (expectedSig !== signature.toLowerCase()) {
      return { valid: false, error: 'Invalid HMAC signature' };
    }

    return { valid: true, userId: key.user_id };
  }
}
