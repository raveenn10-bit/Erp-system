import { describe, it, expect, beforeEach } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { passwordHash, verifyPassword } from '../src/security';

describe('Username and 4-Digit Passcode Authentication', () => {
  let db: DatabaseSync;

  beforeEach(async () => {
    db = new DatabaseSync(':memory:');
    db.exec(`
      CREATE TABLE roles(id TEXT PRIMARY KEY, name TEXT NOT NULL, admin INTEGER NOT NULL);
      CREATE TABLE users(
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        username TEXT UNIQUE,
        email TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        passcode_hash TEXT,
        role_id TEXT NOT NULL REFERENCES roles(id),
        active INTEGER NOT NULL CHECK(active IN(0,1)),
        created_at TEXT NOT NULL
      );
      INSERT INTO roles VALUES('admin', 'Admin', 1), ('sales_rep', 'Sales Representative', 0);
    `);

    const adminPw = await passwordHash('Admin2026');
    const adminPin = await passwordHash('2026');
    db.prepare(`
      INSERT INTO users(id, name, username, email, password_hash, passcode_hash, role_id, active, created_at)
      VALUES(?,?,?,?,?,?,?,?,?)
    `).run('u1', 'Admin', 'Admin', 'admin@example.lk', adminPw, adminPin, 'admin', 1, new Date().toISOString());

    const repPw = await passwordHash('RepPass123');
    const repPin = await passwordHash('1234');
    db.prepare(`
      INSERT INTO users(id, name, username, email, password_hash, passcode_hash, role_id, active, created_at)
      VALUES(?,?,?,?,?,?,?,?,?)
    `).run('u2', 'Kamal Rep', 'kamal', 'kamal@example.lk', repPw, repPin, 'sales_rep', 1, new Date().toISOString());
  });

  it('authenticates Admin with username "Admin" (case-insensitive) and password "Admin2026"', async () => {
    const row = db.prepare('SELECT * FROM users WHERE LOWER(username) = LOWER(?)').get('admin') as any;
    expect(row).toBeDefined();
    expect(row.username).toBe('Admin');
    const isValid = await verifyPassword('Admin2026', row.password_hash);
    expect(isValid).toBe(true);
  });

  it('authenticates with 4-digit passcode "2026" for quick login', async () => {
    const row = db.prepare('SELECT * FROM users WHERE LOWER(username) = LOWER(?)').get('Admin') as any;
    expect(row.passcode_hash).toBeDefined();
    const isPinValid = await verifyPassword('2026', row.passcode_hash);
    expect(isPinValid).toBe(true);
    const isWrongPinValid = await verifyPassword('9999', row.passcode_hash);
    expect(isWrongPinValid).toBe(false);
  });

  it('allows Admin to change username and 4-digit passcode', async () => {
    const newUsername = 'SuperAdmin';
    const newPin = '8888';
    const newPinHash = await passwordHash(newPin);

    db.prepare('UPDATE users SET username = ?, passcode_hash = ? WHERE id = ?').run(newUsername, newPinHash, 'u1');

    const updated = db.prepare('SELECT * FROM users WHERE id = ?').get('u1') as any;
    expect(updated.username).toBe('SuperAdmin');
    expect(await verifyPassword('8888', updated.passcode_hash)).toBe(true);
  });
});
