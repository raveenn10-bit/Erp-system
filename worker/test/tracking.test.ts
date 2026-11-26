import { describe, it, expect } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { colomboDayRange, haversine, routeDistance, sessionsDistance, shouldStore } from '../src/geo';

describe('GPS helpers', () => {
  it('haversine ≈ known distance (Colombo Fort → Kandy ≈ 94 km)', () => {
    const d = haversine({ lat: 6.9344, lng: 79.8428 }, { lat: 7.2906, lng: 80.6337 });
    expect(d / 1000).toBeGreaterThan(92);
    expect(d / 1000).toBeLessThan(97);
  });
  it('route distance ignores jitter, bad accuracy and GPS jumps', () => {
    const t = (m: number) => new Date(Date.UTC(2026, 10, 26, 3, m)).toISOString();
    const pts = [
      { lat: 7.0, lng: 80.0, t: t(0), acc: 10 },
      { lat: 7.00003, lng: 80.0, t: t(1), acc: 10 }, // ~3 m jitter
      { lat: 7.009, lng: 80.0, t: t(2), acc: 10 }, // ~1 km in 1 min (60 km/h)
      { lat: 7.5, lng: 80.0, t: t(3), acc: 10 }, // 55 km in 1 min → jump
      { lat: 7.018, lng: 80.0, t: t(4), acc: 500 }, // inaccurate
      { lat: 7.018, lng: 80.0, t: t(5), acc: 15 }, // another ~1 km
    ];
    const d = routeDistance(pts);
    expect(d).toBeGreaterThan(1900);
    expect(d).toBeLessThan(2100);
  });
  it('distance is per duty session (no line between two sessions)', () => {
    const pts = [
      { session_id: 'a', lat: 7.0, lng: 80.0, t: '2026-11-26T03:00:00.000Z', acc: 10 },
      { session_id: 'a', lat: 7.009, lng: 80.0, t: '2026-11-26T03:01:00.000Z', acc: 10 },
      { session_id: 'b', lat: 7.3, lng: 80.0, t: '2026-11-26T08:00:00.000Z', acc: 10 },
      { session_id: 'b', lat: 7.309, lng: 80.0, t: '2026-11-26T08:01:00.000Z', acc: 10 },
    ];
    const d = sessionsDistance(pts);
    expect(d).toBeGreaterThan(1950);
    expect(d).toBeLessThan(2050);
  });
  it('thinning keeps moves and 5-minute heartbeats only', () => {
    const a = { lat: 7, lng: 80, t: '2026-11-26T03:00:00.000Z', acc: 8 };
    expect(shouldStore(null, a)).toBe(true);
    expect(shouldStore(a, { ...a, t: '2026-11-26T03:00:30.000Z', lat: 7.00002 })).toBe(false);
    expect(shouldStore(a, { ...a, t: '2026-11-26T03:00:30.000Z', lat: 7.0005 })).toBe(true);
    expect(shouldStore(a, { ...a, t: '2026-11-26T03:05:00.000Z' })).toBe(true);
  });
  it('Colombo day range is UTC+05:30', () => {
    expect(colomboDayRange('2026-11-26')).toEqual({ from: '2026-11-25T18:30:00.000Z', to: '2026-11-26T18:30:00.000Z' });
  });
});

describe('GPS tracking migration', () => {
  it('applies on top of all migrations and enforces its constraints', () => {
    const dir = path.resolve(__dirname, '..', 'migrations');
    const db = new DatabaseSync(':memory:');
    db.exec('PRAGMA foreign_keys = ON;');
    for (const f of fs.readdirSync(dir).filter(f => f.endsWith('.sql')).sort()) db.exec(fs.readFileSync(path.join(dir, f), 'utf8'));
    const now = '2026-11-26T03:00:00.000Z';
    db.prepare('INSERT INTO users(id,name,email,password_hash,role_id,active,created_at) VALUES(?,?,?,?,?,?,?)').run('rep', 'Rep', 'r@x.lk', 'h', 'sales_rep', 1, now);
    db.prepare("INSERT INTO rep_duty_sessions(id,user_id,started_at,source,created_at) VALUES('s1','rep',?,'android',?)").run(now, now);
    // only one open duty per rep
    expect(() => db.prepare("INSERT INTO rep_duty_sessions(id,user_id,started_at,source,created_at) VALUES('s2','rep',?,'android',?)").run(now, now)).toThrow();
    const ins = db.prepare("INSERT OR IGNORE INTO rep_locations(id,user_id,session_id,recorded_at,lat,lng,source,received_at) VALUES(?,?,?,?,?,?,?,?)");
    ins.run('p1', 'rep', 's1', now, 7, 80, 'android', now);
    ins.run('p1', 'rep', 's1', now, 7, 80, 'android', now); // replay → ignored
    expect((db.prepare('SELECT COUNT(*) n FROM rep_locations').get() as any).n).toBe(1);
    const plain = db.prepare("INSERT INTO rep_locations(id,user_id,session_id,recorded_at,lat,lng,source,received_at) VALUES(?,?,?,?,?,?,?,?)");
    expect(() => plain.run('p2', 'rep', 's1', now, 95, 80, 'android', now)).toThrow(); // invalid latitude (CHECK)
    expect(() => ins.run('p3', 'rep', 'nope', now, 7, 80, 'android', now)).toThrow(); // unknown session (FK)
    expect(() => db.prepare("UPDATE rep_duty_sessions SET ended_at='2026-11-25T00:00:00.000Z' WHERE id='s1'").run()).toThrow(); // end before start
  });
});
