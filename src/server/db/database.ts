import initSqlJs, { Database as SqlJsDatabase } from 'sql.js';
import fs from 'node:fs';
import path from 'node:path';

export class DatabaseManager {
  private static instance: DatabaseManager | null = null;
  private db: SqlJsDatabase | null = null;
  private dbFilePath: string;
  private inTransaction: boolean = false;

  private constructor(dbFilePath?: string) {
    this.dbFilePath = dbFilePath || path.resolve(process.cwd(), 'data', 'silentsmile.db');
  }

  public static getInstance(dbFilePath?: string): DatabaseManager {
    if (!DatabaseManager.instance) {
      DatabaseManager.instance = new DatabaseManager(dbFilePath);
    }
    return DatabaseManager.instance;
  }

  public static createIsolated(dbFilePath?: string): DatabaseManager {
    return new DatabaseManager(dbFilePath || ':memory:');
  }

  public static resetInstance(): void {
    if (DatabaseManager.instance) {
      DatabaseManager.instance.close();
      DatabaseManager.instance = null;
    }
  }

  public async initialize(): Promise<SqlJsDatabase> {
    if (this.db) {
      return this.db;
    }

    const SQL = await initSqlJs();
    const dataDir = path.dirname(this.dbFilePath);
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }

    if (this.dbFilePath !== ':memory:' && fs.existsSync(this.dbFilePath)) {
      const fileBuffer = fs.readFileSync(this.dbFilePath);
      this.db = new SQL.Database(fileBuffer);
    } else {
      this.db = new SQL.Database();
      if (this.dbFilePath !== ':memory:') {
        this.saveToFile();
      }
    }

    return this.db;
  }

  public getDb(): SqlJsDatabase {
    if (!this.db) {
      throw new Error('Database not initialized. Call initialize() first.');
    }
    return this.db;
  }

  public saveToFile(): void {
    if (!this.db || this.dbFilePath === ':memory:') return;
    try {
      const data = this.db.export();
      const buffer = Buffer.from(data);
      const tempPath = `${this.dbFilePath}.tmp`;
      fs.writeFileSync(tempPath, buffer);
      fs.renameSync(tempPath, this.dbFilePath);
    } catch (err) {
      console.error('Failed to persist database to file:', err);
    }
  }

  /**
   * Executes parameterized SELECT query and returns array of objects
   */
  public query<T = any>(sql: string, params: any[] = []): T[] {
    const db = this.getDb();
    const stmt = db.prepare(sql);
    try {
      stmt.bind(params);
      const results: T[] = [];
      while (stmt.step()) {
        results.push(stmt.getAsObject() as T);
      }
      return results;
    } finally {
      stmt.free();
    }
  }

  /**
   * Executes parameterized SELECT returning a single row or null
   */
  public queryOne<T = any>(sql: string, params: any[] = []): T | null {
    const rows = this.query<T>(sql, params);
    return rows.length > 0 ? rows[0] : null;
  }

  /**
   * Executes parameterized INSERT/UPDATE/DELETE statement
   */
  public execute(sql: string, params: any[] = []): void {
    const db = this.getDb();
    db.run(sql, params);
    if (!this.inTransaction) {
      this.saveToFile();
    }
  }

  /**
   * Executes multiple statements in a single atomic transaction.
   * Automatically rolls back on exception.
   */
  public runInTransaction<T>(action: () => T): T {
    const db = this.getDb();
    if (this.inTransaction) {
      // Nested transaction: execute within current context
      return action();
    }

    this.inTransaction = true;
    db.run('BEGIN TRANSACTION');
    try {
      const result = action();
      db.run('COMMIT');
      this.saveToFile();
      return result;
    } catch (err) {
      try {
        db.run('ROLLBACK');
      } catch (rollbackErr) {
        console.error('Failed to rollback transaction:', rollbackErr);
      }
      throw err;
    } finally {
      this.inTransaction = false;
    }
  }

  public transaction<T>(action: () => T): T {
    return this.runInTransaction(action);
  }

  public close(): void {
    if (this.db) {
      this.saveToFile();
      this.db.close();
      this.db = null;
    }
    DatabaseManager.instance = null;
  }
}

export const dbManager = DatabaseManager.getInstance();
