import fs from 'node:fs';
import path from 'node:path';
import initSqlJs, { type Database, type SqlJsStatic, type SqlValue } from 'sql.js';
import { MIGRATIONS, migrate, type Migration } from './migrations';

export type Param = SqlValue | boolean | undefined;

let SQL: SqlJsStatic | null = null;

async function loadSql(): Promise<SqlJsStatic> {
  if (!SQL) {
    const wasmPath =
      typeof require === 'function'
        ? require.resolve('sql.js/dist/sql-wasm.wasm')
        : path.resolve('node_modules/sql.js/dist/sql-wasm.wasm');
    const wasmBinary = fs.readFileSync(wasmPath);
    SQL = await initSqlJs({ wasmBinary: wasmBinary.buffer.slice(wasmBinary.byteOffset, wasmBinary.byteOffset + wasmBinary.byteLength) as ArrayBuffer });
  }
  return SQL;
}

function bind(params: Param[]): SqlValue[] {
  return params.map((p) => (p === undefined ? null : typeof p === 'boolean' ? (p ? 1 : 0) : p));
}

/**
 * SQLite (sql.js/WASM) giữ trong bộ nhớ, ghi xuống file sau mỗi transaction
 * theo kiểu ghi file tạm rồi rename để tránh hỏng file khi bị tắt ngang.
 */
export class Db {
  private inTx = false;

  private constructor(
    private db: Database,
    private readonly filePath: string | null,
  ) {
    this.applyPragmas();
  }

  /** Có dữ liệu cũ cần nâng cấp schema thì sao lưu nguyên bản vào backups/ trước khi chạy migration. */
  static async open(filePath: string | null, migrations: Migration[] = MIGRATIONS): Promise<Db> {
    const sql = await loadSql();
    let data: Uint8Array | undefined;
    if (filePath && fs.existsSync(filePath)) data = fs.readFileSync(filePath);
    const db = new Db(new sql.Database(data), filePath);
    const current = db.scalar<number>('PRAGMA user_version') ?? 0;
    const target = migrations[migrations.length - 1].version;
    if (filePath && data && current > 0 && current < target) {
      const dir = path.join(path.dirname(filePath), 'backups');
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, `pre-migrate-v${current}-to-v${target}-${Date.now()}.sqlite`), data);
    }
    migrate(db, migrations);
    if (filePath && !data) db.persist();
    return db;
  }

  static async validateBytes(bytes: Uint8Array): Promise<void> {
    const sql = await loadSql();
    const probe = new sql.Database(bytes);
    try {
      const rows = probe.exec("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('projects','job_years')");
      if (!rows.length || rows[0].values.length < 2) throw new Error('File backup không chứa dữ liệu PPM hợp lệ.');
    } finally {
      probe.close();
    }
  }

  private applyPragmas() {
    // sql.js export() đóng/mở lại DB nên pragma bị reset, phải bật lại sau mỗi lần export.
    this.db.run('PRAGMA foreign_keys = ON');
  }

  all<T = Record<string, SqlValue>>(sql: string, params: Param[] = []): T[] {
    const stmt = this.db.prepare(sql);
    try {
      stmt.bind(bind(params));
      const out: T[] = [];
      while (stmt.step()) out.push(stmt.getAsObject() as T);
      return out;
    } finally {
      stmt.free();
    }
  }

  get<T = Record<string, SqlValue>>(sql: string, params: Param[] = []): T | undefined {
    return this.all<T>(sql, params)[0];
  }

  scalar<T extends SqlValue = number>(sql: string, params: Param[] = []): T {
    const row = this.get<Record<string, SqlValue>>(sql, params);
    return (row ? Object.values(row)[0] : null) as T;
  }

  run(sql: string, params: Param[] = []): void {
    this.db.run(sql, bind(params));
  }

  exec(sql: string): void {
    this.db.exec(sql);
  }

  tx<T>(fn: () => T): T {
    if (this.inTx) return fn();
    this.inTx = true;
    this.db.exec('BEGIN');
    try {
      const result = fn();
      this.db.exec('COMMIT');
      this.inTx = false;
      this.persist();
      return result;
    } catch (err) {
      try {
        this.db.exec('ROLLBACK');
      } catch {
        /* đã rollback */
      }
      this.inTx = false;
      throw err;
    }
  }

  exportBytes(): Uint8Array {
    const bytes = this.db.export();
    this.applyPragmas();
    return bytes;
  }

  persist(): void {
    if (!this.filePath) return;
    const bytes = this.exportBytes();
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const tmp = `${this.filePath}.tmp`;
    const fd = fs.openSync(tmp, 'w');
    try {
      fs.writeSync(fd, bytes);
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    fs.renameSync(tmp, this.filePath);
  }

  async replaceWith(bytes: Uint8Array): Promise<void> {
    const sql = await loadSql();
    this.db.close();
    this.db = new sql.Database(bytes);
    this.applyPragmas();
    migrate(this);
    this.persist();
  }

  close(): void {
    this.db.close();
  }
}
