import Database from 'better-sqlite3';
import path from 'node:path';
import type {
  AnalyticsResponse,
  DashboardSummary,
  DeadLetterRecord,
  FailureType,
  IpcFailureRecord,
  MessageLogRecord,
  MessageRecord,
  OrderRecord,
  ProcessId,
  ProcessRecord,
  QueueMetricPoint,
} from '../types/ipc.ts';

const DB_PATH = path.resolve(process.cwd(), 'ipc_monitor.db');

let dbInstance: Database.Database | null = null;

export function getDb(): Database.Database {
  if (!dbInstance) {
    dbInstance = new Database(DB_PATH);
    dbInstance.pragma('journal_mode = WAL');
    dbInstance.pragma('foreign_keys = ON');
    initializeSchema(dbInstance);
    seedInitialDataIfEmpty(dbInstance);
  }
  return dbInstance;
}

function initializeSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS processes (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      stage_order INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'WAITING',
      queue_name TEXT NOT NULL,
      current_queue_depth INTEGER NOT NULL DEFAULT 0,
      processed_count INTEGER NOT NULL DEFAULT 0,
      failed_count INTEGER NOT NULL DEFAULT 0,
      avg_latency_ms REAL NOT NULL DEFAULT 0,
      is_crashed INTEGER NOT NULL DEFAULT 0,
      last_heartbeat TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS orders (
      id TEXT PRIMARY KEY,
      customer_name TEXT NOT NULL,
      food_item TEXT NOT NULL,
      amount REAL NOT NULL,
      payment_status TEXT NOT NULL DEFAULT 'PENDING',
      order_status TEXT NOT NULL DEFAULT 'RECEIVED',
      correlation_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      order_id TEXT NOT NULL,
      correlation_id TEXT NOT NULL,
      sequence_number INTEGER NOT NULL,
      sender_process TEXT NOT NULL,
      receiver_process TEXT NOT NULL,
      event_type TEXT NOT NULL,
      payload TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'QUEUED',
      retry_count INTEGER NOT NULL DEFAULT 0,
      max_retries INTEGER NOT NULL DEFAULT 3,
      processing_time_ms INTEGER NOT NULL DEFAULT 0,
      ack_status TEXT NOT NULL DEFAULT 'PENDING',
      is_duplicate INTEGER NOT NULL DEFAULT 0,
      is_out_of_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
      FOREIGN KEY (receiver_process) REFERENCES processes(id)
    );

    CREATE TABLE IF NOT EXISTS message_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      message_id TEXT NOT NULL,
      order_id TEXT NOT NULL,
      correlation_id TEXT NOT NULL,
      sequence_number INTEGER NOT NULL,
      sender_process TEXT NOT NULL,
      receiver_process TEXT NOT NULL,
      event_type TEXT NOT NULL,
      status TEXT NOT NULL,
      ack_status TEXT NOT NULL,
      retry_count INTEGER NOT NULL DEFAULT 0,
      processing_time_ms INTEGER NOT NULL DEFAULT 0,
      details TEXT NOT NULL,
      logged_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS ipc_failures (
      id TEXT PRIMARY KEY,
      failure_type TEXT NOT NULL,
      order_id TEXT NOT NULL,
      message_id TEXT,
      process_id TEXT,
      error_details TEXT NOT NULL,
      resolved INTEGER NOT NULL DEFAULT 0,
      recovery_action TEXT,
      occurred_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS dead_letter_messages (
      id TEXT PRIMARY KEY,
      original_message_id TEXT NOT NULL,
      order_id TEXT NOT NULL,
      correlation_id TEXT NOT NULL,
      sequence_number INTEGER NOT NULL,
      sender_process TEXT NOT NULL,
      receiver_process TEXT NOT NULL,
      event_type TEXT NOT NULL,
      payload TEXT NOT NULL,
      failure_reason TEXT NOT NULL,
      retry_attempts INTEGER NOT NULL DEFAULT 3,
      requeued INTEGER NOT NULL DEFAULT 0,
      moved_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS idempotency_keys (
      message_id TEXT NOT NULL,
      process_id TEXT NOT NULL,
      order_id TEXT NOT NULL,
      processed_at TEXT NOT NULL,
      PRIMARY KEY (message_id, process_id)
    );

    CREATE TABLE IF NOT EXISTS queue_metrics_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      recorded_at TEXT NOT NULL,
      queue_length INTEGER NOT NULL,
      successful_count INTEGER NOT NULL,
      failed_count INTEGER NOT NULL,
      avg_processing_ms REAL NOT NULL,
      success_rate REAL NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_messages_order_id ON messages(order_id);
    CREATE INDEX IF NOT EXISTS idx_messages_status ON messages(status);
    CREATE INDEX IF NOT EXISTS idx_messages_corr ON messages(correlation_id);
    CREATE INDEX IF NOT EXISTS idx_logs_logged_at ON message_logs(logged_at);
    CREATE INDEX IF NOT EXISTS idx_failures_type ON ipc_failures(failure_type);
    CREATE INDEX IF NOT EXISTS idx_dlq_moved_at ON dead_letter_messages(moved_at);
  `);
}

function isoMinutesAgo(minutes: number): string {
  return new Date(Date.now() - minutes * 60_000).toISOString();
}

export function seedInitialDataIfEmpty(db: Database.Database): void {
  const processCount = (db.prepare('SELECT COUNT(*) as c FROM processes').get() as { c: number }).c;
  if (processCount === 0) {
    const now = new Date().toISOString();
    const insertProc = db.prepare(`
      INSERT INTO processes (id, name, stage_order, status, queue_name, current_queue_depth, processed_count, failed_count, avg_latency_ms, is_crashed, last_heartbeat, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
    `);
    insertProc.run('order-receiver', 'Order Receiver', 1, 'COMPLETED', 'order.received.queue', 0, 14, 0, 42, now, now);
    insertProc.run('payment-processor', 'Payment Processor', 2, 'COMPLETED', 'payment.process.queue', 1, 13, 2, 118, now, now);
    insertProc.run('delivery-updater', 'Delivery Status Updater', 3, 'WAITING', 'delivery.update.queue', 1, 11, 1, 76, now, now);
    insertProc.run('partner-notifier', 'Partner Notifier', 4, 'COMPLETED', 'partner.notify.queue', 0, 10, 1, 58, now, now);
  }

  const orderCount = (db.prepare('SELECT COUNT(*) as c FROM orders').get() as { c: number }).c;
  if (orderCount > 0) return;

  const insertOrder = db.prepare(`
    INSERT INTO orders (id, customer_name, food_item, amount, payment_status, order_status, correlation_id, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertMsg = db.prepare(`
    INSERT INTO messages (id, order_id, correlation_id, sequence_number, sender_process, receiver_process, event_type, payload, status, retry_count, max_retries, processing_time_ms, ack_status, is_duplicate, is_out_of_order, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertLog = db.prepare(`
    INSERT INTO message_logs (message_id, order_id, correlation_id, sequence_number, sender_process, receiver_process, event_type, status, ack_status, retry_count, processing_time_ms, details, logged_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertIdemp = db.prepare(`
    INSERT OR IGNORE INTO idempotency_keys (message_id, process_id, order_id, processed_at)
    VALUES (?, ?, ?, ?)
  `);
  const insertFailure = db.prepare(`
    INSERT INTO ipc_failures (id, failure_type, order_id, message_id, process_id, error_details, resolved, recovery_action, occurred_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertDlq = db.prepare(`
    INSERT INTO dead_letter_messages (id, original_message_id, order_id, correlation_id, sequence_number, sender_process, receiver_process, event_type, payload, failure_reason, retry_attempts, requeued, moved_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertMetric = db.prepare(`
    INSERT INTO queue_metrics_history (recorded_at, queue_length, successful_count, failed_count, avg_processing_ms, success_rate)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  const seedOrders: Array<{
    id: string;
    customer: string;
    item: string;
    amount: number;
    pay: string;
    status: string;
    corr: string;
    minsAgo: number;
    outcome: 'DELIVERED' | 'DELAYED' | 'DUPLICATE' | 'OUT_OF_ORDER' | 'FAILED_DLQ' | 'IN_PROGRESS';
  }> = [
    {
      id: 'ORD-1001',
      customer: 'Aarav Mehta',
      item: 'Margherita Pizza & Garlic Bread',
      amount: 24.5,
      pay: 'PAID',
      status: 'DELIVERED',
      corr: 'CORR-91A401',
      minsAgo: 55,
      outcome: 'DELIVERED',
    },
    {
      id: 'ORD-1002',
      customer: 'Priya Nair',
      item: 'Hyderabadi Chicken Biryani',
      amount: 18.75,
      pay: 'PAID',
      status: 'DELIVERED',
      corr: 'CORR-91A402',
      minsAgo: 48,
      outcome: 'DELAYED',
    },
    {
      id: 'ORD-1003',
      customer: 'Marcus Chen',
      item: 'Spicy Tonkotsu Ramen Bowl',
      amount: 21.0,
      pay: 'PAID',
      status: 'DELIVERED',
      corr: 'CORR-91A403',
      minsAgo: 40,
      outcome: 'DUPLICATE',
    },
    {
      id: 'ORD-1004',
      customer: 'Elena Rostova',
      item: 'Grilled Paneer Tikka Wrap',
      amount: 14.2,
      pay: 'FAILED',
      status: 'FAILED',
      corr: 'CORR-91A404',
      minsAgo: 32,
      outcome: 'FAILED_DLQ',
    },
    {
      id: 'ORD-1005',
      customer: 'Liam OConnor',
      item: 'Double Smash Burger Combo',
      amount: 19.9,
      pay: 'PAID',
      status: 'DELIVERED',
      corr: 'CORR-91A405',
      minsAgo: 24,
      outcome: 'OUT_OF_ORDER',
    },
    {
      id: 'ORD-1006',
      customer: 'Divya Krishnan',
      item: 'Masala Dosa & Filter Coffee',
      amount: 12.6,
      pay: 'PAID',
      status: 'OUT_FOR_DELIVERY',
      corr: 'CORR-91A406',
      minsAgo: 12,
      outcome: 'IN_PROGRESS',
    },
    {
      id: 'ORD-1007',
      customer: 'Noah Alvarez',
      item: 'Mediterranean Falafel Platter',
      amount: 17.4,
      pay: 'FAILED',
      status: 'FAILED',
      corr: 'CORR-91A407',
      minsAgo: 6,
      outcome: 'FAILED_DLQ',
    },
  ];

  const stages: Array<{
    seq: number;
    sender: string;
    receiver: ProcessId;
    event: string;
  }> = [
    { seq: 1, sender: 'client-gateway', receiver: 'order-receiver', event: 'ORDER_CREATED' },
    { seq: 2, sender: 'order-receiver', receiver: 'payment-processor', event: 'PAYMENT_CONFIRMED' },
    { seq: 3, sender: 'payment-processor', receiver: 'delivery-updater', event: 'DELIVERY_UPDATED' },
    { seq: 4, sender: 'delivery-updater', receiver: 'partner-notifier', event: 'PARTNER_NOTIFIED' },
  ];

  const tx = db.transaction(() => {
    for (const o of seedOrders) {
      const createdAt = isoMinutesAgo(o.minsAgo);
      const updatedAt = isoMinutesAgo(Math.max(1, o.minsAgo - 2));
      insertOrder.run(o.id, o.customer, o.item, o.amount, o.pay, o.status, o.corr, createdAt, updatedAt);

      for (const st of stages) {
        const msgId = `MSG-${o.id.split('-')[1]}-${st.seq}`;
        const ts = isoMinutesAgo(Math.max(1, o.minsAgo - (st.seq - 1)));
        const payload = JSON.stringify({
          orderId: o.id,
          customerName: o.customer,
          foodItem: o.item,
          amount: o.amount,
          stage: st.event,
          sequenceNumber: st.seq,
          correlationId: o.corr,
        });

        let status = 'DELIVERED';
        let ack = 'ACKED';
        let retry = 0;
        let procTime = 35 + st.seq * 18;
        let isDup = 0;
        let isOoo = 0;
        let details = `Stage ${st.seq} acknowledged cleanly by ${st.receiver}`;

        if (o.outcome === 'DELAYED' && st.seq === 3) {
          status = 'DELAYED';
          procTime = 2480;
          details = 'Broker network delay exceeded 2000ms SLA threshold before ACK';
        } else if (o.outcome === 'DUPLICATE' && st.seq === 2) {
          isDup = 1;
          details = 'Original message ACKed; duplicate delivery suppressed via idempotency store';
        } else if (o.outcome === 'OUT_OF_ORDER' && st.seq === 3) {
          isOoo = 1;
          retry = 1;
          procTime = 310;
          details = 'Out-of-order sequence detected (seq 3 arrived ahead of seq 2); re-sequenced and ACKed';
        } else if (o.outcome === 'FAILED_DLQ') {
          if (o.id === 'ORD-1004' && st.seq === 2) {
            status = 'DEAD_LETTERED';
            ack = 'NACKED';
            retry = 3;
            procTime = 940;
            details = 'Payment gateway timeout after 3 exponential backoff retries; routed to DLQ';
          } else if (o.id === 'ORD-1004' && st.seq > 2) {
            continue;
          } else if (o.id === 'ORD-1007' && st.seq === 4) {
            status = 'DEAD_LETTERED';
            ack = 'NACKED';
            retry = 3;
            procTime = 815;
            details = 'Partner webhook unreachable (503) after 3 retries; routed to DLQ';
          }
        } else if (o.outcome === 'IN_PROGRESS' && st.seq === 4) {
          status = 'QUEUED';
          ack = 'PENDING';
          procTime = 0;
          details = 'Queued in partner.notify.queue awaiting consumer slot';
        }

        insertMsg.run(
          msgId,
          o.id,
          o.corr,
          st.seq,
          st.sender,
          st.receiver,
          st.event,
          payload,
          status,
          retry,
          3,
          procTime,
          ack,
          isDup,
          isOoo,
          ts,
          ts
        );

        insertLog.run(
          msgId,
          o.id,
          o.corr,
          st.seq,
          st.sender,
          st.receiver,
          st.event,
          status,
          ack,
          retry,
          procTime,
          details,
          ts
        );

        if (ack === 'ACKED') {
          insertIdemp.run(msgId, st.receiver, o.id, ts);
        }

        if (o.outcome === 'DUPLICATE' && st.seq === 2) {
          const dupMsgId = `${msgId}-DUP`;
          insertMsg.run(
            dupMsgId,
            o.id,
            o.corr,
            st.seq,
            st.sender,
            st.receiver,
            st.event,
            payload,
            'DUPLICATE_DROPPED',
            0,
            3,
            12,
            'ACKED',
            1,
            0,
            ts,
            ts
          );
          insertLog.run(
            dupMsgId,
            o.id,
            o.corr,
            st.seq,
            st.sender,
            st.receiver,
            st.event,
            'DUPLICATE_DROPPED',
            'ACKED',
            0,
            12,
            `Idempotent filter caught duplicate Message ID ${msgId} for ${o.id}`,
            ts
          );
        }
      }
    }

    insertFailure.run(
      'FAIL-201',
      'MESSAGE_DELAY',
      'ORD-1002',
      'MSG-1002-3',
      'delivery-updater',
      'Delivery Status Updater experienced 2480ms broker transit delay (SLA: 1000ms).',
      1,
      'Auto-recovered after delayed ACK',
      isoMinutesAgo(46)
    );
    insertFailure.run(
      'FAIL-202',
      'DUPLICATE_MESSAGE',
      'ORD-1003',
      'MSG-1003-2-DUP',
      'payment-processor',
      'Duplicate PAYMENT_CONFIRMED frame received for MSG-1003-2; dropped by idempotency key check.',
      1,
      'Idempotent deduplication applied',
      isoMinutesAgo(39)
    );
    insertFailure.run(
      'FAIL-203',
      'MESSAGE_LOSS',
      'ORD-1004',
      'MSG-1004-2',
      'payment-processor',
      'Payment Processor failed to return ACK within timeout window across 3 exponential backoff attempts.',
      0,
      'Routed to Dead Letter Queue (dlq.food_delivery)',
      isoMinutesAgo(30)
    );
    insertFailure.run(
      'FAIL-204',
      'OUT_OF_ORDER',
      'ORD-1005',
      'MSG-1005-3',
      'delivery-updater',
      'Sequence 3 (DELIVERY_UPDATED) arrived prior to Sequence 2 ACK; held for re-sequencing.',
      1,
      'Sequence reordered and ACKed',
      isoMinutesAgo(22)
    );
    insertFailure.run(
      'FAIL-205',
      'PROCESS_CRASH',
      'ORD-1007',
      'MSG-1007-4',
      'partner-notifier',
      'Partner Notifier consumer connection dropped during dispatch; max retries exhausted.',
      0,
      'Awaiting manual DLQ replay',
      isoMinutesAgo(5)
    );

    insertDlq.run(
      'DLQ-301',
      'MSG-1004-2',
      'ORD-1004',
      'CORR-91A404',
      2,
      'order-receiver',
      'payment-processor',
      'PAYMENT_CONFIRMED',
      JSON.stringify({
        orderId: 'ORD-1004',
        customerName: 'Elena Rostova',
        foodItem: 'Grilled Paneer Tikka Wrap',
        amount: 14.2,
        correlationId: 'CORR-91A404',
      }),
      'Max retries (3/3) exhausted due to simulated payment gateway NACK',
      3,
      0,
      isoMinutesAgo(29)
    );
    insertDlq.run(
      'DLQ-302',
      'MSG-1007-4',
      'ORD-1007',
      'CORR-91A407',
      4,
      'delivery-updater',
      'partner-notifier',
      'PARTNER_NOTIFIED',
      JSON.stringify({
        orderId: 'ORD-1007',
        customerName: 'Noah Alvarez',
        foodItem: 'Mediterranean Falafel Platter',
        amount: 17.4,
        correlationId: 'CORR-91A407',
      }),
      'Partner webhook consumer crashed during delivery notification',
      3,
      0,
      isoMinutesAgo(4)
    );

    const historySnapshots = [
      { mins: 50, q: 1, ok: 4, fail: 0, ms: 64, rate: 100 },
      { mins: 42, q: 2, ok: 8, fail: 0, ms: 412, rate: 100 },
      { mins: 34, q: 3, ok: 12, fail: 1, ms: 265, rate: 92.3 },
      { mins: 26, q: 2, ok: 16, fail: 1, ms: 198, rate: 94.1 },
      { mins: 18, q: 1, ok: 20, fail: 1, ms: 145, rate: 95.2 },
      { mins: 10, q: 2, ok: 23, fail: 2, ms: 162, rate: 92.0 },
      { mins: 3, q: 2, ok: 25, fail: 2, ms: 158, rate: 92.6 },
    ];
    for (const h of historySnapshots) {
      insertMetric.run(isoMinutesAgo(h.mins), h.q, h.ok, h.fail, h.ms, h.rate);
    }
  });

  tx();
}

export function getDashboardSummary(db: Database.Database): DashboardSummary {
  const totalOrdersProcessed = (
    db.prepare(`SELECT COUNT(*) as c FROM orders WHERE order_status IN ('DELIVERED', 'FAILED', 'OUT_FOR_DELIVERY', 'PAYMENT_VERIFIED', 'PREPARING')`).get() as { c: number }
  ).c;

  const messagesSent = (db.prepare(`SELECT COUNT(*) as c FROM messages`).get() as { c: number }).c;
  const messagesReceived = (
    db.prepare(`SELECT COUNT(*) as c FROM messages WHERE ack_status IN ('ACKED', 'NACKED')`).get() as { c: number }
  ).c;
  const successfulMessages = (
    db.prepare(`SELECT COUNT(*) as c FROM messages WHERE status IN ('DELIVERED', 'DELAYED') AND ack_status = 'ACKED'`).get() as { c: number }
  ).c;
  const failedMessages = (
    db.prepare(`SELECT COUNT(*) as c FROM messages WHERE status IN ('FAILED', 'DEAD_LETTERED')`).get() as { c: number }
  ).c;
  const delayedMessages = (
    db.prepare(`SELECT COUNT(*) as c FROM messages WHERE status = 'DELAYED'`).get() as { c: number }
  ).c;
  const duplicateMessages = (
    db.prepare(`SELECT COUNT(*) as c FROM messages WHERE is_duplicate = 1 OR status = 'DUPLICATE_DROPPED'`).get() as { c: number }
  ).c;
  const currentQueueLength = (
    db.prepare(`SELECT COALESCE(SUM(current_queue_depth), 0) as q FROM processes`).get() as { q: number }
  ).q;
  const deadLetterCount = (
    db.prepare(`SELECT COUNT(*) as c FROM dead_letter_messages WHERE requeued = 0`).get() as { c: number }
  ).c;
  const unresolvedFailures = (
    db.prepare(`SELECT COUNT(*) as c FROM ipc_failures WHERE resolved = 0`).get() as { c: number }
  ).c;

  const denominator = successfulMessages + failedMessages;
  const overallSuccessRate = denominator > 0 ? Number(((successfulMessages / denominator) * 100).toFixed(1)) : 100;

  return {
    totalOrdersProcessed,
    messagesSent,
    messagesReceived,
    successfulMessages,
    failedMessages,
    delayedMessages,
    duplicateMessages,
    currentQueueLength,
    overallSuccessRate,
    deadLetterCount,
    unresolvedFailures,
  };
}

export function getAllProcesses(db: Database.Database): ProcessRecord[] {
  return db.prepare(`SELECT * FROM processes ORDER BY stage_order ASC`).all() as ProcessRecord[];
}

export function getAllOrders(db: Database.Database): OrderRecord[] {
  return db.prepare(`SELECT * FROM orders ORDER BY created_at DESC`).all() as OrderRecord[];
}

export function getFilteredMessages(
  db: Database.Database,
  opts: {
    search?: string;
    status?: string;
    process?: string;
    ack?: string;
    sortBy?: string;
    sortDir?: 'asc' | 'desc';
    limit?: number;
  }
): MessageRecord[] {
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (opts.search && opts.search.trim()) {
    const q = `%${opts.search.trim()}%`;
    conditions.push(`(id LIKE ? OR order_id LIKE ? OR correlation_id LIKE ? OR event_type LIKE ?)`);
    params.push(q, q, q, q);
  }
  if (opts.status && opts.status !== 'ALL') {
    conditions.push(`status = ?`);
    params.push(opts.status);
  }
  if (opts.process && opts.process !== 'ALL') {
    conditions.push(`(sender_process = ? OR receiver_process = ?)`);
    params.push(opts.process, opts.process);
  }
  if (opts.ack && opts.ack !== 'ALL') {
    conditions.push(`ack_status = ?`);
    params.push(opts.ack);
  }

  const allowedSortColumns: Record<string, string> = {
    created_at: 'created_at',
    sequence_number: 'sequence_number',
    processing_time_ms: 'processing_time_ms',
    retry_count: 'retry_count',
    status: 'status',
    order_id: 'order_id',
  };
  const sortCol = allowedSortColumns[opts.sortBy ?? 'created_at'] ?? 'created_at';
  const sortDir = opts.sortDir === 'asc' ? 'ASC' : 'DESC';
  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const limit = Math.min(Math.max(opts.limit ?? 250, 1), 1000);

  return db
    .prepare(`SELECT * FROM messages ${whereClause} ORDER BY ${sortCol} ${sortDir} LIMIT ?`)
    .all(...params, limit) as MessageRecord[];
}

export function getMessageLogs(
  db: Database.Database,
  opts: { search?: string; status?: string; limit?: number }
): MessageLogRecord[] {
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (opts.search && opts.search.trim()) {
    const q = `%${opts.search.trim()}%`;
    conditions.push(`(message_id LIKE ? OR order_id LIKE ? OR correlation_id LIKE ? OR details LIKE ?)`);
    params.push(q, q, q, q);
  }
  if (opts.status && opts.status !== 'ALL') {
    conditions.push(`status = ?`);
    params.push(opts.status);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const limit = Math.min(Math.max(opts.limit ?? 200, 1), 1000);

  return db
    .prepare(`SELECT * FROM message_logs ${whereClause} ORDER BY id DESC LIMIT ?`)
    .all(...params, limit) as MessageLogRecord[];
}

export function getFailures(db: Database.Database): IpcFailureRecord[] {
  return db.prepare(`SELECT * FROM ipc_failures ORDER BY occurred_at DESC LIMIT 200`).all() as IpcFailureRecord[];
}

export function getDeadLetterMessages(db: Database.Database): DeadLetterRecord[] {
  return db.prepare(`SELECT * FROM dead_letter_messages ORDER BY moved_at DESC LIMIT 200`).all() as DeadLetterRecord[];
}

export function getAnalyticsData(
  db: Database.Database,
  opts: { startDate?: string; endDate?: string }
): AnalyticsResponse {
  const dateFilterMsgs: string[] = [];
  const dateFilterFail: string[] = [];
  const dateFilterHist: string[] = [];
  const msgParams: unknown[] = [];
  const failParams: unknown[] = [];
  const histParams: unknown[] = [];

  if (opts.startDate) {
    dateFilterMsgs.push(`created_at >= ?`);
    dateFilterFail.push(`occurred_at >= ?`);
    dateFilterHist.push(`recorded_at >= ?`);
    msgParams.push(opts.startDate);
    failParams.push(opts.startDate);
    histParams.push(opts.startDate);
  }
  if (opts.endDate) {
    const endIso = opts.endDate.length === 10 ? `${opts.endDate}T23:59:59.999Z` : opts.endDate;
    dateFilterMsgs.push(`created_at <= ?`);
    dateFilterFail.push(`occurred_at <= ?`);
    dateFilterHist.push(`recorded_at <= ?`);
    msgParams.push(endIso);
    failParams.push(endIso);
    histParams.push(endIso);
  }

  const msgWhere = dateFilterMsgs.length ? `WHERE ${dateFilterMsgs.join(' AND ')}` : '';
  const failWhere = dateFilterFail.length ? `WHERE ${dateFilterFail.join(' AND ')}` : '';
  const histWhere = dateFilterHist.length ? `WHERE ${dateFilterHist.join(' AND ')}` : '';

  const summary = getDashboardSummary(db);
  const processes = getAllProcesses(db);

  const stageRows = db
    .prepare(
      `SELECT receiver_process,
        SUM(CASE WHEN status IN ('DELIVERED') AND ack_status = 'ACKED' THEN 1 ELSE 0 END) as successful,
        SUM(CASE WHEN status IN ('FAILED', 'DEAD_LETTERED') THEN 1 ELSE 0 END) as failed,
        SUM(CASE WHEN status = 'DELAYED' THEN 1 ELSE 0 END) as delayed,
        AVG(CASE WHEN processing_time_ms > 0 THEN processing_time_ms ELSE NULL END) as avg_ms
       FROM messages ${msgWhere}
       GROUP BY receiver_process`
    )
    .all(...msgParams) as Array<{
    receiver_process: string;
    successful: number;
    failed: number;
    delayed: number;
    avg_ms: number | null;
  }>;

  const stageMap = new Map(stageRows.map((r) => [r.receiver_process, r]));

  const successVsFailed = processes.map((p) => {
    const row = stageMap.get(p.id);
    return {
      label: p.name,
      successful: row?.successful ?? 0,
      failed: row?.failed ?? 0,
      delayed: row?.delayed ?? 0,
    };
  });

  const processingTimeByProcess = processes.map((p) => {
    const row = stageMap.get(p.id);
    return {
      processId: p.id,
      name: p.name,
      avgMs: Math.round(row?.avg_ms ?? p.avg_latency_ms ?? 0),
      processed: p.processed_count,
      failed: p.failed_count,
    };
  });

  const failureTypes: FailureType[] = [
    'MESSAGE_LOSS',
    'MESSAGE_DELAY',
    'DUPLICATE_MESSAGE',
    'OUT_OF_ORDER',
    'PROCESS_CRASH',
    'QUEUE_OVERFLOW',
  ];

  const failRows = db
    .prepare(
      `SELECT failure_type, COUNT(*) as count, SUM(CASE WHEN resolved = 1 THEN 1 ELSE 0 END) as resolvedCount
       FROM ipc_failures ${failWhere}
       GROUP BY failure_type`
    )
    .all(...failParams) as Array<{ failure_type: FailureType; count: number; resolvedCount: number }>;

  const failMap = new Map(failRows.map((r) => [r.failure_type, r]));
  const failureFrequency = failureTypes.map((ft) => ({
    failureType: ft,
    count: failMap.get(ft)?.count ?? 0,
    resolvedCount: failMap.get(ft)?.resolvedCount ?? 0,
  }));

  const queueHistory = db
    .prepare(`SELECT * FROM queue_metrics_history ${histWhere} ORDER BY id DESC LIMIT 30`)
    .all(...histParams) as QueueMetricPoint[];
  queueHistory.reverse();

  const processPerformance = processes.map((p) => {
    const total = p.processed_count + p.failed_count;
    const rate = total > 0 ? Number(((p.processed_count / total) * 100).toFixed(1)) : 100;
    return {
      processId: p.id,
      name: p.name,
      throughput: p.processed_count,
      successRate: rate,
      avgLatencyMs: Math.round(p.avg_latency_ms),
      queueDepth: p.current_queue_depth,
    };
  });

  return {
    summary,
    successVsFailed,
    processingTimeByProcess,
    failureFrequency,
    queueHistory,
    processPerformance,
  };
}
