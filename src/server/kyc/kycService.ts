import crypto from 'node:crypto';
import { DatabaseManager } from '../db/database';

export interface KycApplicationRecord {
  id: string;
  user_id: string;
  full_name: string;
  id_number: string;
  id_card_url: string;
  selfie_url: string;
  status: 'pending' | 'approved' | 'rejected';
  reject_reason: string | null;
  reviewer_id: string | null;
  reviewed_at: number | null;
  vendor_reference: string | null;
  created_at: number;
}

export class KycService {
  private dbMgr: DatabaseManager;

  constructor(dbMgr: DatabaseManager) {
    this.dbMgr = dbMgr;
  }

  /**
   * Submit new KYC verification application
   */
  public submitApplication(params: {
    userId: string;
    fullName: string;
    idNumber: string;
    idCardUrl: string;
    selfieUrl: string;
  }): KycApplicationRecord {
    const { userId, fullName, idNumber, idCardUrl, selfieUrl } = params;

    if (!fullName || fullName.trim().length < 3) {
      throw new Error('Full name matching government ID is required');
    }
    if (!idNumber || idNumber.trim().length < 8) {
      throw new Error('Valid NIK / National ID number is required');
    }

    const existingPending = this.dbMgr.queryOne<KycApplicationRecord>(
      `SELECT * FROM kyc_applications WHERE user_id = ? AND status = 'pending'`,
      [userId]
    );
    if (existingPending) {
      throw new Error('You already have a pending KYC application under review');
    }

    const appId = `kyc_${crypto.randomBytes(8).toString('hex')}`;
    const vendorRef = `sumsub_applicant_${crypto.randomBytes(6).toString('hex')}`;
    const now = Date.now();

    this.dbMgr.execute(
      `INSERT INTO kyc_applications (id, user_id, full_name, id_number, id_card_url, selfie_url, status, reject_reason, reviewer_id, reviewed_at, vendor_reference, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 'pending', NULL, NULL, NULL, ?, ?)`,
      [appId, userId, fullName.trim(), idNumber.trim(), idCardUrl, selfieUrl, vendorRef, now]
    );

    const created = this.dbMgr.queryOne<KycApplicationRecord>('SELECT * FROM kyc_applications WHERE id = ?', [appId]);
    if (!created) throw new Error('Failed to record KYC application');
    return created;
  }

  /**
   * Get latest KYC application for a user
   */
  public getApplicationByUserId(userId: string): KycApplicationRecord | null {
    return this.dbMgr.queryOne<KycApplicationRecord>(
      'SELECT * FROM kyc_applications WHERE user_id = ? ORDER BY created_at DESC LIMIT 1',
      [userId]
    );
  }

  /**
   * List all pending KYC applications for Admin review
   */
  public getPendingApplications(): KycApplicationRecord[] {
    return this.dbMgr.query<KycApplicationRecord>(
      `SELECT * FROM kyc_applications WHERE status = 'pending' ORDER BY created_at ASC`
    );
  }

  /**
   * Admin or automated review action
   */
  public reviewApplication(params: {
    applicationId: string;
    reviewerId: string;
    decision: 'approved' | 'rejected';
    rejectReason?: string;
  }): KycApplicationRecord {
    const { applicationId, reviewerId, decision, rejectReason } = params;

    const app = this.dbMgr.queryOne<KycApplicationRecord>('SELECT * FROM kyc_applications WHERE id = ?', [applicationId]);
    if (!app) throw new Error('KYC Application not found');
    if (app.status !== 'pending') {
      throw new Error(`Application already decided with status: ${app.status}`);
    }

    const now = Date.now();

    this.dbMgr.runInTransaction(() => {
      this.dbMgr.execute(
        `UPDATE kyc_applications
         SET status = ?, reject_reason = ?, reviewer_id = ?, reviewed_at = ?
         WHERE id = ?`,
        [decision, rejectReason || null, reviewerId, now, applicationId]
      );

      if (decision === 'approved') {
        // Upgrade user to KYC Level 1 and increase daily withdrawal limit to 100,000,000 IDR
        this.dbMgr.execute(
          `UPDATE users SET kyc_level = 1, daily_withdraw_limit_idr = 100000000, updated_at = ? WHERE id = ?`,
          [now, app.user_id]
        );
      }
    });

    const updated = this.dbMgr.queryOne<KycApplicationRecord>('SELECT * FROM kyc_applications WHERE id = ?', [applicationId]);
    return updated!;
  }

  /**
   * Sumsub Sandbox Webhook Simulator
   * Simulates an inbound automated KYC webhook payload from Sumsub / Onfido.
   */
  public simulateSumsubWebhook(params: {
    vendorReference: string;
    reviewResult: 'GREEN' | 'RED';
    moderationComment?: string;
  }): { success: boolean; message: string; applicationId?: string } {
    const app = this.dbMgr.queryOne<KycApplicationRecord>(
      'SELECT * FROM kyc_applications WHERE vendor_reference = ?',
      [params.vendorReference]
    );

    if (!app) {
      return { success: false, message: `No applicant found with reference: ${params.vendorReference}` };
    }

    const decision = params.reviewResult === 'GREEN' ? 'approved' : 'rejected';
    const reason = params.reviewResult === 'GREEN' ? undefined : (params.moderationComment || 'Failed facial biometric verification');

    this.reviewApplication({
      applicationId: app.id,
      reviewerId: 'sys_sumsub_webhook',
      decision,
      rejectReason: reason,
    });

    return {
      success: true,
      message: `Applicant ${params.vendorReference} processed with status: ${decision}`,
      applicationId: app.id,
    };
  }
}
