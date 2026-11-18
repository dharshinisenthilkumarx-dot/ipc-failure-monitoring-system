import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { createServer as createViteServer } from 'vite';
import { ipcEngine } from './src/broker/ipcEngine.ts';
import {
  getAllOrders,
  getAllProcesses,
  getAnalyticsData,
  getDashboardSummary,
  getDb,
  getDeadLetterMessages,
  getFailures,
  getFilteredMessages,
  getMessageLogs,
} from './src/db/database.ts';
import type { FailureType, ProcessId } from './src/types/ipc.ts';

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT) || 3000;

  app.use(express.json());

  // Initialize DB eagerly
  getDb();

  // Health Check
  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, timestamp: new Date().toISOString() });
  });

  // Real-time Server-Sent Events stream for live broker updates
  app.get('/api/stream', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    const sendSnapshot = (snapshot: unknown) => {
      res.write(`data: ${JSON.stringify(snapshot)}\n\n`);
    };

    sendSnapshot(ipcEngine.getSnapshot());
    const unsubscribe = ipcEngine.subscribe(sendSnapshot);

    const heartbeat = setInterval(() => {
      res.write(`: heartbeat\n\n`);
    }, 15_000);

    req.on('close', () => {
      clearInterval(heartbeat);
      unsubscribe();
    });
  });

  // Dashboard Overview
  app.get('/api/dashboard', (_req, res) => {
    const db = getDb();
    const summary = getDashboardSummary(db);
    const processes = getAllProcesses(db);
    const recentFailures = getFailures(db).slice(0, 6);
    const analytics = getAnalyticsData(db, {});
    res.json({
      summary,
      processes,
      recentFailures,
      queueHistory: analytics.queueHistory,
      successVsFailed: analytics.successVsFailed,
      simulation: ipcEngine.getSnapshot(),
    });
  });

  // Orders CRUD + Pipeline Dispatch
  app.get('/api/orders', (_req, res) => {
    res.json({ orders: getAllOrders(getDb()) });
  });

  app.post('/api/orders', (req, res) => {
    const db = getDb();
    const {
      id,
      customer_name,
      food_item,
      amount,
      payment_status = 'PENDING',
      order_status = 'RECEIVED',
      dispatch = true,
    } = req.body ?? {};

    if (!customer_name || !food_item || amount === undefined || Number.isNaN(Number(amount))) {
      res.status(400).json({ error: 'customer_name, food_item, and numeric amount are required.' });
      return;
    }

    const orderId =
      typeof id === 'string' && id.trim().length > 0
        ? id.trim().toUpperCase()
        : `ORD-${1100 + Math.floor(Math.random() * 8800)}`;

    const existing = db.prepare(`SELECT id FROM orders WHERE id = ?`).get(orderId);
    if (existing) {
      res.status(409).json({ error: `Order ID ${orderId} already exists.` });
      return;
    }

    const correlationId = `CORR-${Math.random().toString(36).substring(2, 8).toUpperCase()}`;
    const now = new Date().toISOString();

    db.prepare(
      `INSERT INTO orders (id, customer_name, food_item, amount, payment_status, order_status, correlation_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      orderId,
      String(customer_name).trim(),
      String(food_item).trim(),
      Number(amount),
      payment_status,
      order_status,
      correlationId,
      now,
      now
    );

    if (dispatch) {
      ipcEngine.dispatchOrderPipeline(orderId);
    }

    const created = db.prepare(`SELECT * FROM orders WHERE id = ?`).get(orderId);
    res.status(201).json({ order: created });
  });

  app.patch('/api/orders/:id', (req, res) => {
    const db = getDb();
    const { id } = req.params;
    const { order_status, payment_status, food_item, amount } = req.body ?? {};
    const existing = db.prepare(`SELECT * FROM orders WHERE id = ?`).get(id) as Record<string, unknown> | undefined;
    if (!existing) {
      res.status(404).json({ error: 'Order not found.' });
      return;
    }

    const now = new Date().toISOString();
    db.prepare(
      `UPDATE orders
       SET order_status = COALESCE(?, order_status),
           payment_status = COALESCE(?, payment_status),
           food_item = COALESCE(?, food_item),
           amount = COALESCE(?, amount),
           updated_at = ?
       WHERE id = ?`
    ).run(order_status ?? null, payment_status ?? null, food_item ?? null, amount ?? null, now, id);

    const updated = db.prepare(`SELECT * FROM orders WHERE id = ?`).get(id);
    res.json({ order: updated });
  });

  app.delete('/api/orders/:id', (req, res) => {
    const db = getDb();
    const { id } = req.params;
    const result = db.prepare(`DELETE FROM orders WHERE id = ?`).run(id);
    if (result.changes === 0) {
      res.status(404).json({ error: 'Order not found.' });
      return;
    }
    res.json({ deleted: id });
  });

  app.post('/api/orders/:id/dispatch', (req, res) => {
    const db = getDb();
    const { id } = req.params;
    const existing = db.prepare(`SELECT id FROM orders WHERE id = ?`).get(id);
    if (!existing) {
      res.status(404).json({ error: 'Order not found.' });
      return;
    }
    ipcEngine.dispatchOrderPipeline(id);
    res.json({ dispatched: id, simulation: ipcEngine.getSnapshot() });
  });

  // Simulation Controls
  app.get('/api/simulation/state', (_req, res) => {
    res.json(ipcEngine.getSnapshot());
  });

  app.post('/api/simulation/control', (req, res) => {
    const { action, speedMs, autoGenerateOrders } = req.body ?? {};
    let snapshot = ipcEngine.getSnapshot();
    switch (action) {
      case 'start':
        snapshot = ipcEngine.start();
        break;
      case 'pause':
        snapshot = ipcEngine.pause();
        break;
      case 'resume':
        snapshot = ipcEngine.resume();
        break;
      case 'stop':
        snapshot = ipcEngine.stop();
        break;
      case 'reset':
        snapshot = ipcEngine.reset();
        break;
      case 'step':
        snapshot = ipcEngine.stepOnce();
        break;
      case 'speed':
        snapshot = ipcEngine.setSpeed(Number(speedMs));
        break;
      case 'auto_generate':
        snapshot = ipcEngine.setAutoGenerate(Boolean(autoGenerateOrders));
        break;
      default:
        res.status(400).json({ error: 'Unknown simulation action.' });
        return;
    }
    res.json(snapshot);
  });

  // Processes Monitoring & Recovery
  app.get('/api/processes', (_req, res) => {
    res.json({ processes: getAllProcesses(getDb()) });
  });

  app.post('/api/processes/:id/recover', (req, res) => {
    ipcEngine.recoverProcess(req.params.id as ProcessId);
    res.json({ processes: getAllProcesses(getDb()) });
  });

  app.post('/api/processes/:id/crash', (req, res) => {
    ipcEngine.crashProcess(req.params.id as ProcessId);
    res.json({ processes: getAllProcesses(getDb()) });
  });

  // Message Monitoring & Logs
  app.get('/api/messages', (req, res) => {
    const { search, status, process: proc, ack, sortBy, sortDir, limit } = req.query;
    const messages = getFilteredMessages(getDb(), {
      search: typeof search === 'string' ? search : undefined,
      status: typeof status === 'string' ? status : undefined,
      process: typeof proc === 'string' ? proc : undefined,
      ack: typeof ack === 'string' ? ack : undefined,
      sortBy: typeof sortBy === 'string' ? sortBy : undefined,
      sortDir: sortDir === 'asc' ? 'asc' : 'desc',
      limit: typeof limit === 'string' ? Number(limit) : undefined,
    });
    res.json({ messages });
  });

  app.post('/api/messages/:id/retry', (req, res) => {
    const ok = ipcEngine.retryMessage(req.params.id);
    if (!ok) {
      res.status(404).json({ error: 'Message not found.' });
      return;
    }
    res.json({ retried: req.params.id, simulation: ipcEngine.getSnapshot() });
  });

  app.get('/api/logs', (req, res) => {
    const { search, status, limit } = req.query;
    const logs = getMessageLogs(getDb(), {
      search: typeof search === 'string' ? search : undefined,
      status: typeof status === 'string' ? status : undefined,
      limit: typeof limit === 'string' ? Number(limit) : undefined,
    });
    res.json({ logs });
  });

  // Failure Detection & Injection
  app.get('/api/failures', (_req, res) => {
    res.json({ failures: getFailures(getDb()) });
  });

  app.post('/api/failures/inject', (req, res) => {
    const { failureType, targetProcess } = req.body ?? {};
    const validTypes: FailureType[] = [
      'MESSAGE_LOSS',
      'MESSAGE_DELAY',
      'DUPLICATE_MESSAGE',
      'OUT_OF_ORDER',
      'PROCESS_CRASH',
      'QUEUE_OVERFLOW',
    ];
    if (!validTypes.includes(failureType)) {
      res.status(400).json({ error: 'Invalid failureType.' });
      return;
    }
    const result = ipcEngine.injectFailure(failureType, (targetProcess as ProcessId) || 'payment-processor');
    res.json({ result, failures: getFailures(getDb()), simulation: ipcEngine.getSnapshot() });
  });

  app.post('/api/failures/:id/resolve', (req, res) => {
    const db = getDb();
    db.prepare(
      `UPDATE ipc_failures SET resolved = 1, recovery_action = COALESCE(recovery_action, 'Marked resolved by operator') WHERE id = ?`
    ).run(req.params.id);
    res.json({ failures: getFailures(db) });
  });

  // Dead Letter Queue
  app.get('/api/dlq', (_req, res) => {
    res.json({ items: getDeadLetterMessages(getDb()) });
  });

  app.post('/api/dlq/:id/requeue', (req, res) => {
    const ok = ipcEngine.requeueDeadLetter(req.params.id);
    if (!ok) {
      res.status(404).json({ error: 'Dead-letter record not found.' });
      return;
    }
    res.json({ requeued: req.params.id, items: getDeadLetterMessages(getDb()) });
  });

  app.delete('/api/dlq/:id', (req, res) => {
    const db = getDb();
    const result = db.prepare(`DELETE FROM dead_letter_messages WHERE id = ?`).run(req.params.id);
    if (result.changes === 0) {
      res.status(404).json({ error: 'Dead-letter record not found.' });
      return;
    }
    res.json({ deleted: req.params.id, items: getDeadLetterMessages(db) });
  });

  // Analytics & CSV Export
  app.get('/api/analytics', (req, res) => {
    const { startDate, endDate } = req.query;
    const data = getAnalyticsData(getDb(), {
      startDate: typeof startDate === 'string' && startDate ? startDate : undefined,
      endDate: typeof endDate === 'string' && endDate ? endDate : undefined,
    });
    res.json(data);
  });

  app.get('/api/analytics/export', (req, res) => {
    const db = getDb();
    const { startDate, endDate } = req.query;
    const messages = getFilteredMessages(db, { limit: 1000 });
    const filtered = messages.filter((m) => {
      if (typeof startDate === 'string' && startDate && m.created_at < startDate) return false;
      if (typeof endDate === 'string' && endDate && m.created_at > `${endDate}T23:59:59.999Z`) return false;
      return true;
    });

    const header = [
      'Message ID',
      'Order ID',
      'Correlation ID',
      'Sequence Number',
      'Sender Process',
      'Receiver Process',
      'Event Type',
      'Status',
      'Ack Status',
      'Retry Count',
      'Processing Time (ms)',
      'Duplicate Flag',
      'Out Of Order Flag',
      'Timestamp',
    ].join(',');

    const escapeCsv = (val: unknown) => {
      const s = String(val ?? '');
      return `"${s.replace(/"/g, '""')}"`;
    };

    const rows = filtered.map((m) =>
      [
        m.id,
        m.order_id,
        m.correlation_id,
        m.sequence_number,
        m.sender_process,
        m.receiver_process,
        m.event_type,
        m.status,
        m.ack_status,
        m.retry_count,
        m.processing_time_ms,
        m.is_duplicate ? 'YES' : 'NO',
        m.is_out_of_order ? 'YES' : 'NO',
        m.created_at,
      ]
        .map(escapeCsv)
        .join(',')
    );

    const csv = [header, ...rows].join('\n');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="ipc_monitoring_report.csv"');
    res.send(csv);
  });

  // Vite Dev Middleware or Production Static Serve
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(process.cwd(), 'dist');
    if (fs.existsSync(distPath)) {
      app.use(express.static(distPath));
      app.get('*', (_req, res) => {
        res.sendFile(path.join(distPath, 'index.html'));
      });
    }
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`IPC Failure Monitoring System running on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
