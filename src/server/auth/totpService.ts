import crypto from 'node:crypto';

/**
 * Base32 character set per RFC 4648
 */
const BASE32_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export class TotpService {
  /**
   * Generates a secure random Base32 secret for 2FA TOTP setup.
   */
  public static generateSecret(length: number = 20): string {
    const randomBytes = crypto.randomBytes(length);
    let secret = '';
    for (let i = 0; i < randomBytes.length; i++) {
      secret += BASE32_CHARS[randomBytes[i] % 32];
    }
    return secret;
  }

  /**
   * Decodes a Base32 string into a Buffer.
   */
  private static base32Decode(base32Str: string): Buffer {
    const cleanStr = base32Str.toUpperCase().replace(/[^A-Z2-7]/g, '');
    let bits = 0;
    let value = 0;
    const output: number[] = [];

    for (let i = 0; i < cleanStr.length; i++) {
      const idx = BASE32_CHARS.indexOf(cleanStr[i]);
      if (idx === -1) continue;
      value = (value << 5) | idx;
      bits += 5;
      if (bits >= 8) {
        output.push((value >>> (bits - 8)) & 255);
        bits -= 8;
      }
    }

    return Buffer.from(output);
  }

  /**
   * Generates standard 6-digit TOTP code for a given timestamp and secret.
   * Time step: 30 seconds (RFC 6238)
   */
  public static generateCode(secret: string, timestampMs: number = Date.now()): string {
    const timeStep = Math.floor(timestampMs / 1000 / 30);
    const timeBuffer = Buffer.alloc(8);
    timeBuffer.writeBigInt64BE(BigInt(timeStep));

    const key = this.base32Decode(secret);
    const hmac = crypto.createHmac('sha1', key);
    hmac.update(timeBuffer);
    const hash = hmac.digest();

    const offset = hash[hash.length - 1] & 0x0f;
    const binary =
      ((hash[offset] & 0x7f) << 24) |
      ((hash[offset + 1] & 0xff) << 16) |
      ((hash[offset + 2] & 0xff) << 8) |
      (hash[offset + 3] & 0xff);

    const otp = binary % 1000000;
    return otp.toString().padStart(6, '0');
  }

  /**
   * Verifies a 6-digit TOTP code against a secret.
   * Supports window tolerance of +- 1 step (prev step, current step, next step)
   * to accommodate slight device clock drift.
   */
  public static verifyCode(token: string, secret: string, windowTolerance: number = 1): boolean {
    if (!token || token.length !== 6 || !secret) {
      return false;
    }

    const now = Date.now();
    for (let i = -windowTolerance; i <= windowTolerance; i++) {
      const checkTime = now + i * 30 * 1000;
      const expected = this.generateCode(secret, checkTime);
      if (crypto.timingSafeEqual(Buffer.from(token), Buffer.from(expected))) {
        return true;
      }
    }

    return false;
  }

  /**
   * Generates otpauth:// URI for QR codes and authenticator apps (Google Authenticator, Authy).
   */
  public static getOtpauthUri(secret: string, email: string, issuer: string = 'SilentSmile Exchange'): string {
    const encodedIssuer = encodeURIComponent(issuer);
    const encodedAccount = encodeURIComponent(email);
    return `otpauth://totp/${encodedIssuer}:${encodedAccount}?secret=${secret}&issuer=${encodedIssuer}&algorithm=SHA1&digits=6&period=30`;
  }
}
