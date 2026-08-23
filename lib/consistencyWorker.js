// lib/consistencyWorker.js
// Continuous Consistency Verification Worker for HaulBoX (IMP-204)
// Compares kv_store (haulline:state) with Normalized Relational Postgres Tables

const kv = require('./kvstore');
const db = require('./db');
const audit = require('./auditStore');
const notifications = require('./notificationStore');

class ConsistencyWorker {
  constructor(options = {}) {
    this.intervalMs = options.intervalMs || 60 * 60 * 1000; // Default: 1 hour
    this.timer = null;
    this.isRunning = false;
    this.lastAuditResult = null;
  }

  start() {
    if (this.timer) return;
    console.log(`[ConsistencyWorker] Starting continuous audit worker (Interval: ${this.intervalMs / 1000}s)`);
    this.runAudit().catch(err => console.error('[ConsistencyWorker] Audit error on startup:', err));
    this.timer = setInterval(() => {
      this.runAudit().catch(err => console.error('[ConsistencyWorker] Periodic audit error:', err));
    }, this.intervalMs);
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      console.log('[ConsistencyWorker] Audit worker stopped.');
    }
  }

  async runAudit() {
    if (this.isRunning) return;
    this.isRunning = true;

    const timestamp = new Date().toISOString();
    const discrepancies = [];

    try {
      await db.ensureSchema();
      const pool = db.getPool();

      // 1. Fetch kv_store state
      const rawKv = await kv.get('haulline:state');
      if (!rawKv) {
        this.isRunning = false;
        return { ok: true, message: 'No kv_store state present to audit' };
      }

      const kvState = JSON.parse(rawKv);
      const kvDispatchers = kvState.dispatchers || [];
      const kvBrokers = kvState.brokers || [];
      const kvDrivers = kvState.drivers || [];
      const kvLoads = kvState.loads || [];

      // 2. Fetch relational state
      const [sqlDisp, sqlBrokers, sqlDrivers, sqlLoads] = await Promise.all([
        pool.query('SELECT * FROM dispatchers'),
        pool.query('SELECT * FROM brokers'),
        pool.query('SELECT * FROM drivers'),
        pool.query('SELECT * FROM loads')
      ]);

      // A. Check Entity Counts
      const countCheck = {
        dispatchers: { kv: kvDispatchers.length, sql: sqlDisp.rows.length },
        brokers: { kv: kvBrokers.length, sql: sqlBrokers.rows.length },
        drivers: { kv: kvDrivers.length, sql: sqlDrivers.rows.length },
        loads: { kv: kvLoads.length, sql: sqlLoads.rows.length }
      };

      for (const [entity, counts] of Object.entries(countCheck)) {
        if (counts.kv !== counts.sql) {
          discrepancies.push({
            type: 'COUNT_MISMATCH',
            entity,
            details: `KV store has ${counts.kv} records while Postgres table has ${counts.sql}`
          });
        }
      }

      // B. Deep Check: Driver Statuses & Codes
      const sqlDriverMap = new Map(sqlDrivers.rows.map(d => [d.id, d]));
      for (const d of kvDrivers) {
        const sqlD = sqlDriverMap.get(String(d.id));
        if (!sqlD) {
          discrepancies.push({ type: 'MISSING_SQL_ROW', entity: 'drivers', id: d.id, name: d.name });
        } else if (sqlD.status !== (d.status || 'Active')) {
          discrepancies.push({
            type: 'FIELD_MISMATCH',
            entity: 'drivers',
            id: d.id,
            field: 'status',
            kv: d.status,
            sql: sqlD.status
          });
        }
      }

      // C. Deep Check: Load Statuses & Amounts
      const sqlLoadMap = new Map(sqlLoads.rows.map(l => [l.id, l]));
      for (const l of kvLoads) {
        const sqlL = sqlLoadMap.get(String(l.id));
        if (!sqlL) {
          discrepancies.push({ type: 'MISSING_SQL_ROW', entity: 'loads', id: l.id, loadNumber: l.loadNumber });
        } else {
          if (sqlL.status !== (l.status || 'ASSIGNED')) {
            discrepancies.push({
              type: 'FIELD_MISMATCH',
              entity: 'loads',
              id: l.id,
              field: 'status',
              kv: l.status,
              sql: sqlL.status
            });
          }
          if (Math.abs(Number(sqlL.rate) - Number(l.rate || 0)) > 0.01) {
            discrepancies.push({
              type: 'FIELD_MISMATCH',
              entity: 'loads',
              id: l.id,
              field: 'rate',
              kv: l.rate,
              sql: sqlL.rate
            });
          }
        }
      }

      const isConsistent = discrepancies.length === 0;
      this.lastAuditResult = {
        timestamp,
        isConsistent,
        countCheck,
        discrepancyCount: discrepancies.length,
        discrepancies
      };

      if (!isConsistent) {
        console.warn(`[ConsistencyWorker] ⚠️ Discrepancy detected during consistency audit (${discrepancies.length} issues)`);
        await audit.log({
          actorType: 'system',
          actorId: 'consistency-worker',
          actorName: 'Audit Daemon',
          action: 'CONSISTENCY_DRIFT_DETECTED',
          targetType: 'SYSTEM_AUDIT',
          targetId: 'haulline:state_vs_postgres',
          details: this.lastAuditResult
        }).catch(() => {});
      } else {
        console.log(`[ConsistencyWorker] ✓ Audit clean: 100% consistency between kv_store and relational PostgreSQL (${timestamp})`);
      }

      return this.lastAuditResult;
    } finally {
      this.isRunning = false;
    }
  }

  getStatus() {
    return {
      active: !!this.timer,
      intervalMs: this.intervalMs,
      lastAudit: this.lastAuditResult
    };
  }
}

const defaultWorker = new ConsistencyWorker();

module.exports = {
  ConsistencyWorker,
  consistencyWorker: defaultWorker,
  verifyConsistency: () => defaultWorker.runAudit()
};
