import { Power, RefreshCw, ShieldCheck } from 'lucide-react';
import { StatusLabel } from '../components/StatusLabel.tsx';
import type { ProcessId, ProcessRecord } from '../types/ipc.ts';

interface ProcessMonitoringPageProps {
  processes: ProcessRecord[];
  onCrashProcess: (id: ProcessId) => Promise<void>;
  onRecoverProcess: (id: ProcessId) => Promise<void>;
}

const PROCESS_RESPONSIBILITIES: Record<ProcessId, { role: string; protocol: string }> = {
  'order-receiver': {
    role: 'Ingests checkout requests, validates payload schema, generates Correlation ID, and emits ORDER_CREATED (seq=1).',
    protocol: 'Queue: order.received.queue · Manual ACK + Schema Guard',
  },
  'payment-processor': {
    role: 'Executes idempotent payment debit via Idempotency Key Store and publishes PAYMENT_CONFIRMED (seq=2).',
    protocol: 'Queue: payment.process.queue · Exponential Backoff (3 retries)',
  },
  'delivery-updater': {
    role: 'Validates message sequence order (seq=3), updates kitchen/rider state, and triggers DELIVERY_UPDATED.',
    protocol: 'Queue: delivery.update.queue · Sequence Validator',
  },
  'partner-notifier': {
    role: 'Dispatches final rider & customer notifications (PARTNER_NOTIFIED, seq=4) with Dead-Letter fallback.',
    protocol: 'Queue: partner.notify.queue · DLQ Routing on NACK',
  },
};

export function ProcessMonitoringPage({
  processes,
  onCrashProcess,
  onRecoverProcess,
}: ProcessMonitoringPageProps) {
  const ordered = [...processes].sort((a, b) => a.stage_order - b.stage_order);

  return (
    <div className="space-y-6">
      <section className="grid grid-cols-1 md:grid-cols-2 gap-5">
        {ordered.map((proc) => {
          const isCrashed = proc.is_crashed === 1 || proc.status === 'FAILED';
          const total = proc.processed_count + proc.failed_count;
          const successRate = total > 0 ? ((proc.processed_count / total) * 100).toFixed(1) : '100.0';
          const queuePct = Math.min(100, Math.round((proc.current_queue_depth / 10) * 100));
          const meta = PROCESS_RESPONSIBILITIES[proc.id];

          return (
            <div
              key={proc.id}
              className={`bg-white border rounded-xl p-5 flex flex-col justify-between ${
                isCrashed ? 'border-red-300 bg-red-50/30' : 'border-slate-200'
              }`}
            >
              <div>
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <div className="text-xs font-mono text-slate-500">
                      Process 0{proc.stage_order} · {proc.queue_name}
                    </div>
                    <h2 className="text-lg font-semibold text-slate-900 mt-0.5">{proc.name}</h2>
                  </div>
                  <StatusLabel value={proc.status} />
                </div>

                <p className="text-xs text-slate-600 mt-2.5 leading-relaxed">{meta.role}</p>
                <p className="text-[11px] font-mono text-slate-500 mt-1.5">{meta.protocol}</p>

                <div className="grid grid-cols-3 gap-4 mt-5 pt-4 border-t border-slate-100">
                  <div>
                    <span className="text-xs text-slate-500 block">Acked Messages</span>
                    <span className="text-lg font-display font-bold tabular-nums text-slate-900">
                      {proc.processed_count}
                    </span>
                  </div>
                  <div>
                    <span className="text-xs text-slate-500 block">Failed / NACK</span>
                    <span className="text-lg font-display font-bold tabular-nums text-red-700">
                      {proc.failed_count}
                    </span>
                  </div>
                  <div>
                    <span className="text-xs text-slate-500 block">Success Rate</span>
                    <span className="text-lg font-display font-bold tabular-nums text-blue-700">
                      {successRate}%
                    </span>
                  </div>
                </div>

                <div className="mt-4 space-y-1.5">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-slate-600">Queue Utilization (Capacity: 10)</span>
                    <span className="font-mono tabular-nums text-slate-800 font-medium">
                      {proc.current_queue_depth} / 10
                    </span>
                  </div>
                  <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all duration-300 ${
                        proc.current_queue_depth >= 8
                          ? 'bg-red-600'
                          : proc.current_queue_depth >= 5
                          ? 'bg-amber-500'
                          : 'bg-blue-700'
                      }`}
                      style={{ width: `${queuePct}%` }}
                    />
                  </div>
                </div>
              </div>

              <div className="mt-5 pt-4 border-t border-slate-100 flex flex-wrap items-center justify-between gap-3">
                <div className="text-xs font-mono tabular-nums text-slate-500">
                  Avg Latency: {Math.round(proc.avg_latency_ms)} ms · Heartbeat:{' '}
                  {new Date(proc.last_heartbeat).toLocaleTimeString()}
                </div>

                {isCrashed ? (
                  <button
                    type="button"
                    onClick={() => onRecoverProcess(proc.id)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-medium transition-colors whitespace-nowrap"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                    Recover Process
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => onCrashProcess(proc.id)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 hover:bg-red-50 hover:border-red-200 text-red-700 text-xs font-medium transition-colors whitespace-nowrap"
                  >
                    <Power className="w-3.5 h-3.5" />
                    Simulate Crash
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </section>

      {/* Fault Tolerance & Recovery Mechanisms */}
      <section className="bg-white border border-slate-200 rounded-xl p-5">
        <div className="flex items-center gap-2 mb-4">
          <ShieldCheck className="w-4 h-4 text-blue-700" />
          <h2 className="text-base font-semibold text-slate-900">
            Active IPC Fault-Tolerance & Recovery Mechanisms
          </h2>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-5 text-xs">
          <div className="space-y-1">
            <h3 className="font-semibold text-slate-900">Acknowledgements & Exponential Backoff</h3>
            <p className="text-slate-600 leading-relaxed">
              Every consumer returns an explicit ACK on commit or NACK on error. Failed frames retry up to 3 times at 900ms, 1800ms, and 3600ms intervals.
            </p>
          </div>
          <div className="space-y-1">
            <h3 className="font-semibold text-slate-900">Idempotency & Duplicate Suppression</h3>
            <p className="text-slate-600 leading-relaxed">
              Consumed Message IDs are persisted in the idempotency key store per process, preventing duplicate charges or state mutations on redelivery.
            </p>
          </div>
          <div className="space-y-1">
            <h3 className="font-semibold text-slate-900">Sequence Validation & DLQ Routing</h3>
            <p className="text-slate-600 leading-relaxed">
              Correlation IDs trace stages 1 through 4. Out-of-order frames are held for re-sequencing, while exhausted retries route to the Dead Letter Queue.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
