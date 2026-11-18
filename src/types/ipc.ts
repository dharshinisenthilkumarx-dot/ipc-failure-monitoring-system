export type ProcessId =
  | 'order-receiver'
  | 'payment-processor'
  | 'delivery-updater'
  | 'partner-notifier';

export type ProcessStatus = 'RUNNING' | 'WAITING' | 'FAILED' | 'COMPLETED';

export type PaymentStatus = 'PENDING' | 'PAID' | 'FAILED' | 'REFUNDED';

export type OrderStatus =
  | 'RECEIVED'
  | 'PAYMENT_VERIFIED'
  | 'PREPARING'
  | 'OUT_FOR_DELIVERY'
  | 'DELIVERED'
  | 'FAILED';

export type MessageStatus =
  | 'QUEUED'
  | 'IN_TRANSIT'
  | 'DELIVERED'
  | 'DELAYED'
  | 'FAILED'
  | 'DUPLICATE_DROPPED'
  | 'DEAD_LETTERED';

export type AckStatus = 'PENDING' | 'ACKED' | 'NACKED';

export type FailureType =
  | 'MESSAGE_LOSS'
  | 'MESSAGE_DELAY'
  | 'DUPLICATE_MESSAGE'
  | 'OUT_OF_ORDER'
  | 'PROCESS_CRASH'
  | 'QUEUE_OVERFLOW';

export type SimulationRunState = 'RUNNING' | 'PAUSED' | 'STOPPED';

export interface OrderRecord {
  id: string;
  customer_name: string;
  food_item: string;
  amount: number;
  payment_status: PaymentStatus;
  order_status: OrderStatus;
  correlation_id: string;
  created_at: string;
  updated_at: string;
}

export interface ProcessRecord {
  id: ProcessId;
  name: string;
  stage_order: number;
  status: ProcessStatus;
  queue_name: string;
  current_queue_depth: number;
  processed_count: number;
  failed_count: number;
  avg_latency_ms: number;
  is_crashed: number;
  last_heartbeat: string;
  updated_at: string;
}

export interface MessageRecord {
  id: string;
  order_id: string;
  correlation_id: string;
  sequence_number: number;
  sender_process: ProcessId | 'client-gateway';
  receiver_process: ProcessId;
  event_type: string;
  payload: string;
  status: MessageStatus;
  retry_count: number;
  max_retries: number;
  processing_time_ms: number;
  ack_status: AckStatus;
  is_duplicate: number;
  is_out_of_order: number;
  created_at: string;
  updated_at: string;
}

export interface MessageLogRecord {
  id: number;
  message_id: string;
  order_id: string;
  correlation_id: string;
  sequence_number: number;
  sender_process: string;
  receiver_process: string;
  event_type: string;
  status: string;
  ack_status: string;
  retry_count: number;
  processing_time_ms: number;
  details: string;
  logged_at: string;
}

export interface IpcFailureRecord {
  id: string;
  failure_type: FailureType;
  order_id: string;
  message_id: string | null;
  process_id: string | null;
  error_details: string;
  resolved: number;
  recovery_action: string | null;
  occurred_at: string;
}

export interface DeadLetterRecord {
  id: string;
  original_message_id: string;
  order_id: string;
  correlation_id: string;
  sequence_number: number;
  sender_process: string;
  receiver_process: string;
  event_type: string;
  payload: string;
  failure_reason: string;
  retry_attempts: number;
  requeued: number;
  moved_at: string;
}

export interface QueueMetricPoint {
  id: number;
  recorded_at: string;
  queue_length: number;
  successful_count: number;
  failed_count: number;
  avg_processing_ms: number;
  success_rate: number;
}

export interface ActiveTransitPacket {
  id: string;
  orderId: string;
  correlationId: string;
  fromStage: number; // 0 = Gateway, 1 = Order Receiver, 2 = Payment Processor, 3 = Delivery Updater
  toStage: number; // 1, 2, 3, 4
  eventType: string;
  status: 'NORMAL' | 'DELAYED' | 'FAILED' | 'DUPLICATE' | 'OUT_OF_ORDER';
  sequenceNumber: number;
  startedAt: number;
}

export interface DashboardSummary {
  totalOrdersProcessed: number;
  messagesSent: number;
  messagesReceived: number;
  successfulMessages: number;
  failedMessages: number;
  delayedMessages: number;
  duplicateMessages: number;
  currentQueueLength: number;
  overallSuccessRate: number;
  deadLetterCount: number;
  unresolvedFailures: number;
}

export interface SimulationStateSnapshot {
  runState: SimulationRunState;
  tickCount: number;
  speedMs: number;
  autoGenerateOrders: boolean;
  activePackets: ActiveTransitPacket[];
  processes: ProcessRecord[];
  recentEvents: MessageLogRecord[];
  summary: DashboardSummary;
}

export interface AnalyticsResponse {
  summary: DashboardSummary;
  successVsFailed: Array<{ label: string; successful: number; failed: number; delayed: number }>;
  processingTimeByProcess: Array<{ processId: string; name: string; avgMs: number; processed: number; failed: number }>;
  failureFrequency: Array<{ failureType: FailureType; count: number; resolvedCount: number }>;
  queueHistory: QueueMetricPoint[];
  processPerformance: Array<{
    processId: ProcessId;
    name: string;
    throughput: number;
    successRate: number;
    avgLatencyMs: number;
    queueDepth: number;
  }>;
}
