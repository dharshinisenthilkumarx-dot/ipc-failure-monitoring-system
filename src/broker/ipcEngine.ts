import {
  getAllProcesses,
  getDashboardSummary,
  getDb,
  getMessageLogs,
  seedInitialDataIfEmpty,
} from '../db/database.ts';
import type {
  ActiveTransitPacket,
  FailureType,
  OrderRecord,
  ProcessId,
  SimulationRunState,
  SimulationStateSnapshot,
} from '../types/ipc.ts';

interface QueuedEnvelope {
  messageId: string;
  orderId: string;
  correlationId: string;
  sequenceNumber: number;
  senderProcess: ProcessId | 'client-gateway';
  receiverProcess: ProcessId;
  eventType: string;
  payload: string;
  retryCount: number;
  deliverAt: number;
  injectedDelayMs?: number;
  forceDrop?: boolean;
  isDuplicateAttempt?: boolean;
  isOutOfOrderAttempt?: boolean;
}

const STAGE_CHAIN: Array<{
  seq: number;
  sender: ProcessId | 'client-gateway';
  receiver: ProcessId;
  eventType: string;
}> = [
  { seq: 1, sender: 'client-gateway', receiver: 'order-receiver', eventType: 'ORDER_CREATED' },
  { seq: 2, sender: 'order-receiver', receiver: 'payment-processor', eventType: 'PAYMENT_CONFIRMED' },
  { seq: 3, sender: 'payment-processor', receiver: 'delivery-updater', eventType: 'DELIVERY_UPDATED' },
  { seq: 4, sender: 'delivery-updater', receiver: 'partner-notifier', eventType: 'PARTNER_NOTIFIED' },
];

const STAGE_INDEX: Record<string, number> = {
  'client-gateway': 0,
  'order-receiver': 1,
  'payment-processor': 2,
  'delivery-updater': 3,
  'partner-notifier': 4,
};

const SAMPLE_CUSTOMERS = [
  'Rohan Deshmukh',
  'Sophia Lindqvist',
  'Karthik Subramanian',
  'Maya Patel',
  'Lucas Fernandez',
  'Hannah Kim',
  'Zayd Al-Mansoor',
  'Chloe Bennett',
];

const SAMPLE_ITEMS = [
  'Butter Chicken & Garlic Naan',
  'Truffle Mushroom Risotto',
  'Crispy Katsu Curry Bento',
  'Wood-Fired Pepperoni Pizza',
  'Pad Thai & Spring Rolls',
  'Avocado Poke Bowl',
  'Tandoori Paneer Platter',
  'Classic Ramen & Gyoza',
];

const MAX_QUEUE_CAPACITY = 10;

class IpcBrokerEngine {
  private runState: SimulationRunState = 'STOPPED';
  private tickCount = 0;
  private speedMs = 1100;
  private autoGenerateOrders = true;
  private timer: ReturnType<typeof setInterval> | null = null;
  private metricTimerCounter = 0;
  private queues: Record<ProcessId, QueuedEnvelope[]> = {
    'order-receiver': [],
    'payment-processor': [],
    'delivery-updater': [],
    'partner-notifier': [],
  };
  private activePackets: ActiveTransitPacket[] = [];
  private nextInjectedFailure: { type: FailureType; targetProcess?: ProcessId } | null = null;
  private orderExpectedSequence: Map<string, number> = new Map();
  private listeners: Set<(snapshot: SimulationStateSnapshot) => void> = new Set();

  constructor() {
    this.syncProcessQueueDepths();
  }

  subscribe(listener: (snapshot: SimulationStateSnapshot) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emit(): void {
    const snapshot = this.getSnapshot();
    for (const listener of this.listeners) {
      try {
        listener(snapshot);
      } catch {
        // Ignore disconnected listeners
      }
    }
  }

  getSnapshot(): SimulationStateSnapshot {
    const db = getDb();
    const now = Date.now();
    this.activePackets = this.activePackets.filter((p) => now - p.startedAt < 1800);
    return {
      runState: this.runState,
      tickCount: this.tickCount,
      speedMs: this.speedMs,
      autoGenerateOrders: this.autoGenerateOrders,
      activePackets: [...this.activePackets],
      processes: getAllProcesses(db),
      recentEvents: getMessageLogs(db, { limit: 15 }),
      summary: getDashboardSummary(db),
    };
  }

  start(): SimulationStateSnapshot {
    if (this.runState === 'RUNNING') return this.getSnapshot();
    this.runState = 'RUNNING';
    this.startLoop();
    // Dispatch an order immediately on start if queues are empty so movement is visible right away
    const totalQueued = Object.values(this.queues).reduce((sum, q) => sum + q.length, 0);
    if (totalQueued === 0) {
      this.createAndDispatchRandomOrder();
    }
    this.emit();
    return this.getSnapshot();
  }

  pause(): SimulationStateSnapshot {
    if (this.runState === 'RUNNING') {
      this.runState = 'PAUSED';
      this.stopLoop();
      this.emit();
    }
    return this.getSnapshot();
  }

  resume(): SimulationStateSnapshot {
    if (this.runState === 'PAUSED') {
      this.runState = 'RUNNING';
      this.startLoop();
      this.emit();
    }
    return this.getSnapshot();
  }

  stop(): SimulationStateSnapshot {
    this.runState = 'STOPPED';
    this.stopLoop();
    const db = getDb();
    db.prepare(`UPDATE processes SET status = CASE WHEN is_crashed = 1 THEN 'FAILED' ELSE 'WAITING' END, updated_at = ?`).run(
      new Date().toISOString()
    );
    this.activePackets = [];
    this.emit();
    return this.getSnapshot();
  }

  reset(): SimulationStateSnapshot {
    this.stopLoop();
    this.runState = 'STOPPED';
    this.tickCount = 0;
    this.activePackets = [];
    this.nextInjectedFailure = null;
    this.orderExpectedSequence.clear();
    this.queues = {
      'order-receiver': [],
      'payment-processor': [],
      'delivery-updater': [],
      'partner-notifier': [],
    };

    const db = getDb();
    const resetTx = db.transaction(() => {
      db.prepare('DELETE FROM message_logs').run();
      db.prepare('DELETE FROM messages').run();
      db.prepare('DELETE FROM ipc_failures').run();
      db.prepare('DELETE FROM dead_letter_messages').run();
      db.prepare('DELETE FROM idempotency_keys').run();
      db.prepare('DELETE FROM queue_metrics_history').run();
      db.prepare('DELETE FROM orders').run();
      db.prepare('DELETE FROM processes').run();
    });
    resetTx();
    seedInitialDataIfEmpty(db);
    this.syncProcessQueueDepths();
    this.emit();
    return this.getSnapshot();
  }

  setSpeed(speedMs: number): SimulationStateSnapshot {
    this.speedMs = Math.min(Math.max(Number(speedMs) || 1100, 350), 3000);
    if (this.runState === 'RUNNING') {
      this.stopLoop();
      this.startLoop();
    }
    this.emit();
    return this.getSnapshot();
  }

  setAutoGenerate(enabled: boolean): SimulationStateSnapshot {
    this.autoGenerateOrders = enabled;
    this.emit();
    return this.getSnapshot();
  }

  stepOnce(): SimulationStateSnapshot {
    const totalQueued = Object.values(this.queues).reduce((sum, q) => sum + q.length, 0);
    if (totalQueued === 0) {
      this.createAndDispatchRandomOrder();
    }
    this.tick();
    return this.getSnapshot();
  }

  private startLoop(): void {
    this.stopLoop();
    this.timer = setInterval(() => {
      this.tick();
    }, this.speedMs);
  }

  private stopLoop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private createAndDispatchRandomOrder(): void {
    const db = getDb();
    const orderNum = 1008 + Math.floor(Math.random() * 8900);
    const orderId = `ORD-${orderNum}`;
    const customer = SAMPLE_CUSTOMERS[Math.floor(Math.random() * SAMPLE_CUSTOMERS.length)];
    const foodItem = SAMPLE_ITEMS[Math.floor(Math.random() * SAMPLE_ITEMS.length)];
    const amount = Number((11 + Math.random() * 28).toFixed(2));
    const corrId = `CORR-${Math.random().toString(36).substring(2, 8).toUpperCase()}`;
    const now = new Date().toISOString();

    db.prepare(
      `INSERT OR IGNORE INTO orders (id, customer_name, food_item, amount, payment_status, order_status, correlation_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'PENDING', 'RECEIVED', ?, ?, ?)`
    ).run(orderId, customer, foodItem, amount, corrId, now, now);

    this.dispatchOrderPipeline(orderId);
  }

  dispatchOrderPipeline(orderId: string): void {
    const db = getDb();
    const order = db.prepare(`SELECT * FROM orders WHERE id = ?`).get(orderId) as OrderRecord | undefined;
    if (!order) return;

    this.orderExpectedSequence.set(order.id, 1);
    const stage = STAGE_CHAIN[0];
    const msgId = `MSG-${Date.now().toString(36).toUpperCase()}-${Math.floor(100 + Math.random() * 899)}`;
    const payload = JSON.stringify({
      orderId: order.id,
      customerName: order.customer_name,
      foodItem: order.food_item,
      amount: order.amount,
      correlationId: order.correlation_id,
      sequenceNumber: stage.seq,
    });

    this.enqueueMessage({
      messageId: msgId,
      orderId: order.id,
      correlationId: order.correlation_id,
      sequenceNumber: stage.seq,
      senderProcess: stage.sender,
      receiverProcess: stage.receiver,
      eventType: stage.eventType,
      payload,
      retryCount: 0,
      deliverAt: Date.now(),
    });

    this.emit();
  }

  private enqueueMessage(env: QueuedEnvelope): void {
    const db = getDb();
    const now = new Date().toISOString();

    // Apply queued failure injection if pending
    if (this.nextInjectedFailure) {
      const inj = this.nextInjectedFailure;
      if (inj.type === 'MESSAGE_LOSS') {
        env.forceDrop = true;
        this.nextInjectedFailure = null;
      } else if (inj.type === 'MESSAGE_DELAY') {
        env.injectedDelayMs = 2800;
        env.deliverAt = Date.now() + 2800;
        this.nextInjectedFailure = null;
      }
    }

    const queue = this.queues[env.receiverProcess];
    if (queue.length >= MAX_QUEUE_CAPACITY) {
      // Queue overflow handling
      db.prepare(
        `INSERT OR REPLACE INTO messages (id, order_id, correlation_id, sequence_number, sender_process, receiver_process, event_type, payload, status, retry_count, max_retries, processing_time_ms, ack_status, is_duplicate, is_out_of_order, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'DEAD_LETTERED', ?, 3, 0, 'NACKED', 0, 0, ?, ?)`
      ).run(
        env.messageId,
        env.orderId,
        env.correlationId,
        env.sequenceNumber,
        env.senderProcess,
        env.receiverProcess,
        env.eventType,
        env.payload,
        env.retryCount,
        now,
        now
      );

      this.recordFailure(
        'QUEUE_OVERFLOW',
        env.orderId,
        env.messageId,
        env.receiverProcess,
        `Queue ${env.receiverProcess} exceeded capacity (${MAX_QUEUE_CAPACITY}); frame ${env.messageId} rejected to DLQ.`
      );
      this.moveToDlq(env, `Queue overflow on ${env.receiverProcess} (depth >= ${MAX_QUEUE_CAPACITY})`);
      this.logMessageEvent(
        env,
        'DEAD_LETTERED',
        'NACKED',
        0,
        `Queue overflow threshold (${MAX_QUEUE_CAPACITY}) exceeded; routed directly to Dead Letter Queue.`
      );
      this.syncProcessQueueDepths();
      return;
    }

    // Persist message record if new
    const existing = db.prepare(`SELECT id FROM messages WHERE id = ?`).get(env.messageId);
    const initialStatus = env.injectedDelayMs ? 'DELAYED' : 'QUEUED';
    if (!existing) {
      db.prepare(
        `INSERT INTO messages (id, order_id, correlation_id, sequence_number, sender_process, receiver_process, event_type, payload, status, retry_count, max_retries, processing_time_ms, ack_status, is_duplicate, is_out_of_order, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 3, 0, 'PENDING', ?, ?, ?, ?)`
      ).run(
        env.messageId,
        env.orderId,
        env.correlationId,
        env.sequenceNumber,
        env.senderProcess,
        env.receiverProcess,
        env.eventType,
        env.payload,
        initialStatus,
        env.retryCount,
        env.isDuplicateAttempt ? 1 : 0,
        env.isOutOfOrderAttempt ? 1 : 0,
        now,
        now
      );
    } else {
      db.prepare(`UPDATE messages SET status = ?, retry_count = ?, updated_at = ? WHERE id = ?`).run(
        initialStatus,
        env.retryCount,
        now,
        env.messageId
      );
    }

    queue.push(env);
    this.activePackets.push({
      id: `${env.messageId}-${Date.now()}`,
      orderId: env.orderId,
      correlationId: env.correlationId,
      fromStage: STAGE_INDEX[env.senderProcess] ?? 0,
      toStage: STAGE_INDEX[env.receiverProcess] ?? 1,
      eventType: env.eventType,
      status: env.forceDrop
        ? 'FAILED'
        : env.injectedDelayMs
        ? 'DELAYED'
        : env.isDuplicateAttempt
        ? 'DUPLICATE'
        : env.isOutOfOrderAttempt
        ? 'OUT_OF_ORDER'
        : 'NORMAL',
      sequenceNumber: env.sequenceNumber,
      startedAt: Date.now(),
    });

    this.logMessageEvent(
      env,
      initialStatus,
      'PENDING',
      0,
      env.injectedDelayMs
        ? `Message delayed in transit (+${env.injectedDelayMs}ms simulated latency).`
        : `Published to ${env.receiverProcess} queue.`
    );
    this.syncProcessQueueDepths();
  }

  private tick(): void {
    this.tickCount += 1;
    const db = getDb();
    const nowMs = Date.now();
    const nowIso = new Date(nowMs).toISOString();

    // Periodically generate new orders if simulation is running & queue is light
    if (this.runState === 'RUNNING' && this.autoGenerateOrders && this.tickCount % 3 === 0) {
      const totalDepth = Object.values(this.queues).reduce((s, q) => s + q.length, 0);
      if (totalDepth < 5) {
        this.createAndDispatchRandomOrder();
      }
    }

    const processIds: ProcessId[] = [
      'order-receiver',
      'payment-processor',
      'delivery-updater',
      'partner-notifier',
    ];

    for (const pid of processIds) {
      const procRow = db.prepare(`SELECT * FROM processes WHERE id = ?`).get(pid) as {
        is_crashed: number;
        processed_count: number;
        failed_count: number;
        avg_latency_ms: number;
      };
      const queue = this.queues[pid];

      if (procRow.is_crashed === 1) {
        db.prepare(`UPDATE processes SET status = 'FAILED', updated_at = ? WHERE id = ?`).run(nowIso, pid);
        // Process next ready message as NACK due to crash
        const readyIdx = queue.findIndex((m) => m.deliverAt <= nowMs);
        if (readyIdx !== -1) {
          const [env] = queue.splice(readyIdx, 1);
          this.handleFailedDelivery(
            env,
            `Target process ${pid} is crashed / unresponsive (NACK returned).`,
            'PROCESS_CRASH'
          );
        }
        continue;
      }

      const readyIdx = queue.findIndex((m) => m.deliverAt <= nowMs);
      if (readyIdx === -1) {
        const nextStatus = queue.length > 0 ? 'WAITING' : procRow.processed_count > 0 ? 'COMPLETED' : 'WAITING';
        db.prepare(`UPDATE processes SET status = ?, last_heartbeat = ?, updated_at = ? WHERE id = ?`).run(
          nextStatus,
          nowIso,
          nowIso,
          pid
        );
        continue;
      }

      const [env] = queue.splice(readyIdx, 1);
      db.prepare(`UPDATE processes SET status = 'RUNNING', last_heartbeat = ?, updated_at = ? WHERE id = ?`).run(
        nowIso,
        nowIso,
        pid
      );

      this.consumeEnvelope(env);
    }

    this.syncProcessQueueDepths();

    this.metricTimerCounter += 1;
    if (this.metricTimerCounter % 2 === 0) {
      this.recordMetricPoint();
    }

    this.emit();
  }

  private consumeEnvelope(env: QueuedEnvelope): void {
    const db = getDb();
    const nowIso = new Date().toISOString();

    // 1. Check simulated packet loss
    if (env.forceDrop) {
      env.forceDrop = false;
      this.handleFailedDelivery(
        env,
        `Packet dropped in transit before consumer ACK (${env.senderProcess} -> ${env.receiverProcess}).`,
        'MESSAGE_LOSS'
      );
      return;
    }

    // 2. Idempotency / Duplicate Detection check
    const alreadyProcessed = db
      .prepare(`SELECT message_id FROM idempotency_keys WHERE message_id = ? AND process_id = ?`)
      .get(env.messageId, env.receiverProcess);

    if (alreadyProcessed || env.isDuplicateAttempt) {
      const dupRecordId = env.isDuplicateAttempt ? `${env.messageId}-DUP-${Math.floor(Math.random() * 999)}` : env.messageId;
      db.prepare(
        `INSERT OR REPLACE INTO messages (id, order_id, correlation_id, sequence_number, sender_process, receiver_process, event_type, payload, status, retry_count, max_retries, processing_time_ms, ack_status, is_duplicate, is_out_of_order, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'DUPLICATE_DROPPED', ?, 3, 14, 'ACKED', 1, 0, ?, ?)`
      ).run(
        dupRecordId,
        env.orderId,
        env.correlationId,
        env.sequenceNumber,
        env.senderProcess,
        env.receiverProcess,
        env.eventType,
        env.payload,
        env.retryCount,
        nowIso,
        nowIso
      );

      this.recordFailure(
        'DUPLICATE_MESSAGE',
        env.orderId,
        dupRecordId,
        env.receiverProcess,
        `Duplicate Message ID ${env.messageId} detected by idempotency filter at ${env.receiverProcess}; dropped safely.`,
        1,
        'Idempotent deduplication applied'
      );
      this.logMessageEvent(
        { ...env, messageId: dupRecordId },
        'DUPLICATE_DROPPED',
        'ACKED',
        14,
        `Idempotent filter suppressed duplicate delivery of ${env.messageId}.`
      );
      return;
    }

    // 3. Sequence Number Validation
    const expectedSeq = this.orderExpectedSequence.get(env.orderId) ?? 1;
    if (env.sequenceNumber > expectedSeq || env.isOutOfOrderAttempt) {
      const isFirstOutOfOrder = env.isOutOfOrderAttempt;
      env.isOutOfOrderAttempt = false;
      db.prepare(`UPDATE messages SET is_out_of_order = 1, status = 'QUEUED', ack_status = 'NACKED', updated_at = ? WHERE id = ?`).run(
        nowIso,
        env.messageId
      );
      this.recordFailure(
        'OUT_OF_ORDER',
        env.orderId,
        env.messageId,
        env.receiverProcess,
        `Sequence mismatch for ${env.orderId}: received seq=${env.sequenceNumber}, expected seq=${expectedSeq}. Held for re-sequencing.`,
        1,
        'Re-queued behind preceding stage'
      );
      this.logMessageEvent(
        env,
        'QUEUED',
        'NACKED',
        25,
        `Sequence validator flagged out-of-order message (got seq=${env.sequenceNumber}, expected=${expectedSeq}); requeued.`
      );
      if (isFirstOutOfOrder) {
        // Re-insert into queue behind current stage
        env.deliverAt = Date.now() + this.speedMs * 2;
        this.queues[env.receiverProcess].push(env);
        return;
      }
    }

    // 4. Successful Idempotent Processing & ACK
    const baseLatency = 38 + Math.floor(Math.random() * 85);
    const totalLatency = env.injectedDelayMs ? env.injectedDelayMs + baseLatency : baseLatency;
    const finalStatus = env.injectedDelayMs ? 'DELAYED' : 'DELIVERED';

    if (env.injectedDelayMs) {
      this.recordFailure(
        'MESSAGE_DELAY',
        env.orderId,
        env.messageId,
        env.receiverProcess,
        `Transit latency ${totalLatency}ms exceeded 1500ms IPC SLA threshold.`,
        1,
        'Delayed ACK committed'
      );
    }

    db.prepare(`INSERT OR IGNORE INTO idempotency_keys (message_id, process_id, order_id, processed_at) VALUES (?, ?, ?, ?)`).run(
      env.messageId,
      env.receiverProcess,
      env.orderId,
      nowIso
    );

    db.prepare(
      `UPDATE messages SET status = ?, ack_status = 'ACKED', processing_time_ms = ?, retry_count = ?, updated_at = ? WHERE id = ?`
    ).run(finalStatus, totalLatency, env.retryCount, nowIso, env.messageId);

    db.prepare(
      `UPDATE processes
       SET processed_count = processed_count + 1,
           avg_latency_ms = ROUND(((avg_latency_ms * processed_count) + ?) / (processed_count + 1), 1),
           status = 'COMPLETED',
           last_heartbeat = ?,
           updated_at = ?
       WHERE id = ?`
    ).run(totalLatency, nowIso, nowIso, env.receiverProcess);

    this.orderExpectedSequence.set(env.orderId, env.sequenceNumber + 1);

    // Update order lifecycle status
    const orderStateByStage: Record<number, { orderStatus: string; paymentStatus?: string }> = {
      1: { orderStatus: 'RECEIVED' },
      2: { orderStatus: 'PAYMENT_VERIFIED', paymentStatus: 'PAID' },
      3: { orderStatus: 'OUT_FOR_DELIVERY', paymentStatus: 'PAID' },
      4: { orderStatus: 'DELIVERED', paymentStatus: 'PAID' },
    };
    const nextOrderState = orderStateByStage[env.sequenceNumber];
    if (nextOrderState) {
      if (nextOrderState.paymentStatus) {
        db.prepare(`UPDATE orders SET order_status = ?, payment_status = ?, updated_at = ? WHERE id = ?`).run(
          nextOrderState.orderStatus,
          nextOrderState.paymentStatus,
          nowIso,
          env.orderId
        );
      } else {
        db.prepare(`UPDATE orders SET order_status = ?, updated_at = ? WHERE id = ?`).run(
          nextOrderState.orderStatus,
          nowIso,
          env.orderId
        );
      }
    }

    this.logMessageEvent(
      env,
      finalStatus,
      'ACKED',
      totalLatency,
      `${env.receiverProcess} processed ${env.eventType} in ${totalLatency}ms and sent ACK.`
    );

    // Forward to next stage in pipeline
    const nextStage = STAGE_CHAIN.find((s) => s.seq === env.sequenceNumber + 1);
    if (nextStage) {
      const nextMsgId = `MSG-${env.orderId.replace('ORD-', '')}-${nextStage.seq}-${Math.floor(10 + Math.random() * 89)}`;
      this.enqueueMessage({
        messageId: nextMsgId,
        orderId: env.orderId,
        correlationId: env.correlationId,
        sequenceNumber: nextStage.seq,
        senderProcess: nextStage.sender,
        receiverProcess: nextStage.receiver,
        eventType: nextStage.eventType,
        payload: env.payload,
        retryCount: 0,
        deliverAt: Date.now() + Math.floor(this.speedMs * 0.45),
      });
    }
  }

  private handleFailedDelivery(env: QueuedEnvelope, reason: string, failureType: FailureType): void {
    const db = getDb();
    const nowIso = new Date().toISOString();
    const maxRetries = 3;

    db.prepare(`UPDATE processes SET failed_count = failed_count + 1, updated_at = ? WHERE id = ?`).run(
      nowIso,
      env.receiverProcess
    );

    if (env.retryCount < maxRetries) {
      const nextRetry = env.retryCount + 1;
      const backoffMs = Math.pow(2, nextRetry) * 450; // Exponential backoff: 900ms, 1800ms, 3600ms
      env.retryCount = nextRetry;
      env.deliverAt = Date.now() + backoffMs;

      db.prepare(`UPDATE messages SET status = 'FAILED', ack_status = 'NACKED', retry_count = ?, updated_at = ? WHERE id = ?`).run(
        nextRetry,
        nowIso,
        env.messageId
      );

      this.logMessageEvent(
        env,
        'FAILED',
        'NACKED',
        0,
        `${reason} Scheduled retry ${nextRetry}/${maxRetries} with ${backoffMs}ms exponential backoff.`
      );

      this.queues[env.receiverProcess].push(env);
      return;
    }

    // Exhausted retries -> Dead Letter Queue
    db.prepare(
      `UPDATE messages SET status = 'DEAD_LETTERED', ack_status = 'NACKED', retry_count = ?, updated_at = ? WHERE id = ?`
    ).run(env.retryCount, nowIso, env.messageId);

    db.prepare(`UPDATE orders SET order_status = 'FAILED', updated_at = ? WHERE id = ?`).run(nowIso, env.orderId);

    this.recordFailure(failureType, env.orderId, env.messageId, env.receiverProcess, reason, 0, 'Routed to Dead Letter Queue');
    this.moveToDlq(env, reason);
    this.logMessageEvent(
      env,
      'DEAD_LETTERED',
      'NACKED',
      0,
      `Exhausted ${maxRetries} retries. Message moved to Dead Letter Queue (dlq.food_delivery).`
    );
  }

  private moveToDlq(env: QueuedEnvelope, reason: string): void {
    const db = getDb();
    const dlqId = `DLQ-${Date.now().toString(36).toUpperCase()}-${Math.floor(10 + Math.random() * 89)}`;
    db.prepare(
      `INSERT INTO dead_letter_messages (id, original_message_id, order_id, correlation_id, sequence_number, sender_process, receiver_process, event_type, payload, failure_reason, retry_attempts, requeued, moved_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`
    ).run(
      dlqId,
      env.messageId,
      env.orderId,
      env.correlationId,
      env.sequenceNumber,
      env.senderProcess,
      env.receiverProcess,
      env.eventType,
      env.payload,
      reason,
      env.retryCount,
      new Date().toISOString()
    );
  }

  private recordFailure(
    type: FailureType,
    orderId: string,
    messageId: string | null,
    processId: string | null,
    details: string,
    resolved = 0,
    recoveryAction: string | null = null
  ): void {
    const db = getDb();
    const failId = `FAIL-${Date.now().toString(36).toUpperCase()}-${Math.floor(10 + Math.random() * 89)}`;
    db.prepare(
      `INSERT INTO ipc_failures (id, failure_type, order_id, message_id, process_id, error_details, resolved, recovery_action, occurred_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(failId, type, orderId, messageId, processId, details, resolved, recoveryAction, new Date().toISOString());
  }

  private logMessageEvent(
    env: QueuedEnvelope,
    status: string,
    ackStatus: string,
    processingMs: number,
    details: string
  ): void {
    const db = getDb();
    db.prepare(
      `INSERT INTO message_logs (message_id, order_id, correlation_id, sequence_number, sender_process, receiver_process, event_type, status, ack_status, retry_count, processing_time_ms, details, logged_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      env.messageId,
      env.orderId,
      env.correlationId,
      env.sequenceNumber,
      env.senderProcess,
      env.receiverProcess,
      env.eventType,
      status,
      ackStatus,
      env.retryCount,
      processingMs,
      details,
      new Date().toISOString()
    );
  }

  private syncProcessQueueDepths(): void {
    const db = getDb();
    const now = new Date().toISOString();
    const stmt = db.prepare(`UPDATE processes SET current_queue_depth = ?, updated_at = ? WHERE id = ?`);
    for (const pid of Object.keys(this.queues) as ProcessId[]) {
      stmt.run(this.queues[pid].length, now, pid);
    }
  }

  private recordMetricPoint(): void {
    const db = getDb();
    const summary = getDashboardSummary(db);
    const avgRow = db
      .prepare(`SELECT COALESCE(AVG(NULLIF(processing_time_ms, 0)), 85) as avg_ms FROM messages`)
      .get() as { avg_ms: number };

    db.prepare(
      `INSERT INTO queue_metrics_history (recorded_at, queue_length, successful_count, failed_count, avg_processing_ms, success_rate)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(
      new Date().toISOString(),
      summary.currentQueueLength,
      summary.successfulMessages,
      summary.failedMessages,
      Math.round(avgRow.avg_ms),
      summary.overallSuccessRate
    );
  }

  injectFailure(failureType: FailureType, targetProcess: ProcessId = 'payment-processor'): {
    message: string;
    failureType: FailureType;
    affectedOrderId: string;
  } {
    const db = getDb();
    const now = new Date().toISOString();
    const latestOrder =
      (db.prepare(`SELECT * FROM orders ORDER BY created_at DESC LIMIT 1`).get() as OrderRecord | undefined) ?? null;

    let orderId = latestOrder?.id ?? 'ORD-1001';
    let correlationId = latestOrder?.correlation_id ?? 'CORR-91A401';

    if (failureType === 'PROCESS_CRASH') {
      db.prepare(`UPDATE processes SET is_crashed = 1, status = 'FAILED', updated_at = ? WHERE id = ?`).run(
        now,
        targetProcess
      );
      this.recordFailure(
        'PROCESS_CRASH',
        orderId,
        null,
        targetProcess,
        `Process ${targetProcess} suffered simulated crash; consumer channel closed.`,
        0,
        'Waiting for process recovery'
      );
      this.emit();
      return {
        message: `${targetProcess} crashed. Incoming messages will NACK until recovered.`,
        failureType,
        affectedOrderId: orderId,
      };
    }

    if (failureType === 'DUPLICATE_MESSAGE') {
      const targetMsg = db
        .prepare(`SELECT * FROM messages WHERE status = 'DELIVERED' ORDER BY created_at DESC LIMIT 1`)
        .get() as {
        id: string;
        order_id: string;
        correlation_id: string;
        sequence_number: number;
        sender_process: ProcessId | 'client-gateway';
        receiver_process: ProcessId;
        event_type: string;
        payload: string;
      } | undefined;

      if (targetMsg) {
        orderId = targetMsg.order_id;
        correlationId = targetMsg.correlation_id;
        this.enqueueMessage({
          messageId: targetMsg.id,
          orderId: targetMsg.order_id,
          correlationId: targetMsg.correlation_id,
          sequenceNumber: targetMsg.sequence_number,
          senderProcess: targetMsg.sender_process,
          receiverProcess: targetMsg.receiver_process,
          eventType: targetMsg.event_type,
          payload: targetMsg.payload,
          retryCount: 0,
          deliverAt: Date.now(),
          isDuplicateAttempt: true,
        });
        this.tick();
      }
      return {
        message: `Injected duplicate message frame (${targetMsg?.id ?? orderId}) into ${targetMsg?.receiver_process ?? targetProcess}.`,
        failureType,
        affectedOrderId: orderId,
      };
    }

    if (failureType === 'OUT_OF_ORDER') {
      const newOrderId = `ORD-${2000 + Math.floor(Math.random() * 7999)}`;
      const newCorr = `CORR-${Math.random().toString(36).substring(2, 8).toUpperCase()}`;
      db.prepare(
        `INSERT INTO orders (id, customer_name, food_item, amount, payment_status, order_status, correlation_id, created_at, updated_at)
         VALUES (?, 'Elena Vasquez', 'Artisan Sourdough Margherita', 22.50, 'PENDING', 'RECEIVED', ?, ?, ?)`
      ).run(newOrderId, newCorr, now, now);
      this.orderExpectedSequence.set(newOrderId, 1);

      const outOfOrderMsgId = `MSG-${newOrderId.replace('ORD-', '')}-3-OOO`;
      this.enqueueMessage({
        messageId: outOfOrderMsgId,
        orderId: newOrderId,
        correlationId: newCorr,
        sequenceNumber: 3,
        senderProcess: 'payment-processor',
        receiverProcess: 'delivery-updater',
        eventType: 'DELIVERY_UPDATED',
        payload: JSON.stringify({ orderId: newOrderId, sequenceNumber: 3, correlationId: newCorr }),
        retryCount: 0,
        deliverAt: Date.now(),
        isOutOfOrderAttempt: true,
      });
      this.tick();
      return {
        message: `Dispatched seq=3 ahead of seq=1 for ${newOrderId}; sequence validator flagged and re-queued.`,
        failureType,
        affectedOrderId: newOrderId,
      };
    }

    if (failureType === 'QUEUE_OVERFLOW') {
      const floodCount = 12;
      for (let i = 0; i < floodCount; i++) {
        const floodMsgId = `MSG-FLOOD-${Date.now().toString(36).toUpperCase()}-${i}`;
        this.enqueueMessage({
          messageId: floodMsgId,
          orderId,
          correlationId,
          sequenceNumber: 2,
          senderProcess: 'order-receiver',
          receiverProcess: targetProcess,
          eventType: 'PAYMENT_CONFIRMED',
          payload: JSON.stringify({ orderId, burstIndex: i + 1, correlationId }),
          retryCount: 0,
          deliverAt: Date.now() + 3000,
        });
      }
      this.emit();
      return {
        message: `Flooded ${targetProcess} queue with ${floodCount} burst frames; overflow messages routed to DLQ.`,
        failureType,
        affectedOrderId: orderId,
      };
    }

    // MESSAGE_LOSS or MESSAGE_DELAY
    this.nextInjectedFailure = { type: failureType, targetProcess };
    const injMsgId = `MSG-${Date.now().toString(36).toUpperCase()}-INJ`;
    const stage = STAGE_CHAIN.find((s) => s.receiver === targetProcess) ?? STAGE_CHAIN[1];
    this.enqueueMessage({
      messageId: injMsgId,
      orderId,
      correlationId,
      sequenceNumber: stage.seq,
      senderProcess: stage.sender,
      receiverProcess: stage.receiver,
      eventType: stage.eventType,
      payload: JSON.stringify({ orderId, injectedFailure: failureType, correlationId }),
      retryCount: 0,
      deliverAt: Date.now(),
    });

    if (failureType === 'MESSAGE_LOSS') {
      this.tick();
    } else {
      this.emit();
    }

    return {
      message:
        failureType === 'MESSAGE_LOSS'
          ? `Injected packet loss for ${injMsgId}; exponential backoff retry initiated.`
          : `Injected 2800ms network delay on ${injMsgId} to ${stage.receiver}.`,
      failureType,
      affectedOrderId: orderId,
    };
  }

  crashProcess(processId: ProcessId): void {
    this.injectFailure('PROCESS_CRASH', processId);
  }

  recoverProcess(processId: ProcessId): void {
    const db = getDb();
    const now = new Date().toISOString();
    db.prepare(`UPDATE processes SET is_crashed = 0, status = 'RUNNING', last_heartbeat = ?, updated_at = ? WHERE id = ?`).run(
      now,
      now,
      processId
    );
    db.prepare(
      `UPDATE ipc_failures SET resolved = 1, recovery_action = 'Process restarted and consumer channel restored'
       WHERE process_id = ? AND failure_type = 'PROCESS_CRASH' AND resolved = 0`
    ).run(processId);
    this.emit();
  }

  retryMessage(messageId: string): boolean {
    const db = getDb();
    const msg = db.prepare(`SELECT * FROM messages WHERE id = ?`).get(messageId) as {
      id: string;
      order_id: string;
      correlation_id: string;
      sequence_number: number;
      sender_process: ProcessId | 'client-gateway';
      receiver_process: ProcessId;
      event_type: string;
      payload: string;
      retry_count: number;
    } | undefined;

    if (!msg) return false;
    const now = new Date().toISOString();
    db.prepare(`UPDATE processes SET is_crashed = 0, status = 'RUNNING', updated_at = ? WHERE id = ?`).run(
      now,
      msg.receiver_process
    );

    this.enqueueMessage({
      messageId: msg.id,
      orderId: msg.order_id,
      correlationId: msg.correlation_id,
      sequenceNumber: msg.sequence_number,
      senderProcess: msg.sender_process,
      receiverProcess: msg.receiver_process,
      eventType: msg.event_type,
      payload: msg.payload,
      retryCount: msg.retry_count + 1,
      deliverAt: Date.now(),
    });
    this.tick();
    return true;
  }

  requeueDeadLetter(dlqId: string): boolean {
    const db = getDb();
    const dlq = db.prepare(`SELECT * FROM dead_letter_messages WHERE id = ?`).get(dlqId) as {
      id: string;
      original_message_id: string;
      order_id: string;
      correlation_id: string;
      sequence_number: number;
      sender_process: ProcessId | 'client-gateway';
      receiver_process: ProcessId;
      event_type: string;
      payload: string;
    } | undefined;

    if (!dlq) return false;

    const now = new Date().toISOString();
    db.prepare(`UPDATE dead_letter_messages SET requeued = 1 WHERE id = ?`).run(dlqId);
    db.prepare(`UPDATE processes SET is_crashed = 0, status = 'RUNNING', updated_at = ? WHERE id = ?`).run(
      now,
      dlq.receiver_process
    );
    db.prepare(
      `UPDATE ipc_failures SET resolved = 1, recovery_action = 'Requeued from Dead Letter Queue and acknowledged'
       WHERE message_id = ? AND resolved = 0`
    ).run(dlq.original_message_id);

    this.orderExpectedSequence.set(dlq.order_id, dlq.sequence_number);

    const replayId = `${dlq.original_message_id}-REPLAY`;
    this.enqueueMessage({
      messageId: replayId,
      orderId: dlq.order_id,
      correlationId: dlq.correlation_id,
      sequenceNumber: dlq.sequence_number,
      senderProcess: dlq.sender_process,
      receiverProcess: dlq.receiver_process,
      eventType: dlq.event_type,
      payload: dlq.payload,
      retryCount: 0,
      deliverAt: Date.now(),
    });

    this.tick();
    return true;
  }
}

export const ipcEngine = new IpcBrokerEngine();
