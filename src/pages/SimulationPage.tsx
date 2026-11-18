import { useState } from 'react';
import {
  AlertTriangle,
  Clock,
  Copy,
  Layers,
  Pause,
  Play,
  RotateCcw,
  ServerCrash,
  Shuffle,
  SkipForward,
  Square,
  WifiOff,
} from 'lucide-react';
import { ProcessFlowDiagram } from '../components/ProcessFlowDiagram.tsx';
import { StatusLabel } from '../components/StatusLabel.tsx';
import type { FailureType, ProcessId, SimulationStateSnapshot } from '../types/ipc.ts';

interface SimulationPageProps {
  simulation: SimulationStateSnapshot;
  onControl: (action: string, payload?: Record<string, unknown>) => Promise<void>;
  onInjectFailure: (failureType: FailureType, targetProcess: ProcessId) => Promise<{
    message: string;
    failureType: FailureType;
    affectedOrderId: string;
  } | null>;
  onRecoverProcess: (id: ProcessId) => Promise<void>;
}

const FAILURE_TRIGGERS: Array<{
  type: FailureType;
  label: string;
  description: string;
  icon: typeof WifiOff;
}> = [
  {
    type: 'MESSAGE_LOSS',
    label: 'Simulate Message Loss',
    description: 'Drops packet in transit before consumer ACK, triggering exponential backoff retry.',
    icon: WifiOff,
  },
  {
    type: 'MESSAGE_DELAY',
    label: 'Simulate Message Delay',
    description: 'Injects 2800ms RabbitMQ broker latency exceeding SLA threshold.',
    icon: Clock,
  },
  {
    type: 'DUPLICATE_MESSAGE',
    label: 'Simulate Duplicate Message',
    description: 'Re-emits identical Message ID to test idempotent deduplication.',
    icon: Copy,
  },
  {
    type: 'OUT_OF_ORDER',
    label: 'Simulate Out-of-Order',
    description: 'Dispatches Sequence 3 ahead of Sequence 1 to trigger sequence validation.',
    icon: Shuffle,
  },
  {
    type: 'PROCESS_CRASH',
    label: 'Simulate Process Crash',
    description: 'Brings down selected microservice consumer, causing NACKs and queue buildup.',
    icon: ServerCrash,
  },
  {
    type: 'QUEUE_OVERFLOW',
    label: 'Simulate Queue Overflow',
    description: 'Floods queue beyond max depth (10), routing excess frames to DLQ.',
    icon: Layers,
  },
];

export function SimulationPage({
  simulation,
  onControl,
  onInjectFailure,
  onRecoverProcess,
}: SimulationPageProps) {
  const [targetProcess, setTargetProcess] = useState<ProcessId>('payment-processor');
  const [lastInjection, setLastInjection] = useState<{
    failureType: FailureType;
    affectedOrderId: string;
    message: string;
    timestamp: string;
  } | null>(null);
  const [busy, setBusy] = useState(false);

  async function triggerFailure(type: FailureType) {
    setBusy(true);
    try {
      const res = await onInjectFailure(type, targetProcess);
      if (res) {
        setLastInjection({
          ...res,
          timestamp: new Date().toISOString(),
        });
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Simulation Control Toolbar */}
      <section className="bg-white border border-slate-200 rounded-xl p-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-3">
              <h2 className="text-base font-semibold text-slate-900">IPC Broker Simulation Controls</h2>
              <StatusLabel value={simulation.runState === 'RUNNING' ? 'RUNNING' : simulation.runState === 'PAUSED' ? 'WAITING' : 'COMPLETED'} />
            </div>
            <p className="text-xs text-slate-500 mt-1 font-mono tabular-nums">
              Broker State: {simulation.runState} · Simulation Ticks: {simulation.tickCount} · Queue Depth: {simulation.summary.currentQueueLength}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {simulation.runState === 'STOPPED' && (
              <button
                type="button"
                onClick={() => onControl('start')}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-blue-700 hover:bg-blue-800 text-white text-xs font-medium transition-colors whitespace-nowrap"
              >
                <Play className="w-3.5 h-3.5" />
                Start Simulation
              </button>
            )}

            {simulation.runState === 'RUNNING' && (
              <button
                type="button"
                onClick={() => onControl('pause')}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-amber-600 hover:bg-amber-700 text-white text-xs font-medium transition-colors whitespace-nowrap"
              >
                <Pause className="w-3.5 h-3.5" />
                Pause Simulation
              </button>
            )}

            {simulation.runState === 'PAUSED' && (
              <button
                type="button"
                onClick={() => onControl('resume')}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-blue-700 hover:bg-blue-800 text-white text-xs font-medium transition-colors whitespace-nowrap"
              >
                <Play className="w-3.5 h-3.5" />
                Resume Simulation
              </button>
            )}

            <button
              type="button"
              onClick={() => onControl('step')}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-200 hover:bg-slate-50 text-slate-700 text-xs font-medium transition-colors whitespace-nowrap"
            >
              <SkipForward className="w-3.5 h-3.5" />
              Step Tick
            </button>

            <button
              type="button"
              disabled={simulation.runState === 'STOPPED'}
              onClick={() => onControl('stop')}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-200 hover:bg-slate-50 disabled:opacity-50 text-slate-700 text-xs font-medium transition-colors whitespace-nowrap"
            >
              <Square className="w-3.5 h-3.5" />
              Stop Simulation
            </button>

            <button
              type="button"
              onClick={() => onControl('reset')}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-200 hover:bg-red-50 hover:border-red-200 text-red-700 text-xs font-medium transition-colors whitespace-nowrap"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              Reset Simulation
            </button>
          </div>
        </div>

        <div className="mt-4 pt-4 border-t border-slate-100 flex flex-wrap items-center justify-between gap-4 text-xs">
          <div className="flex items-center gap-3">
            <span className="text-slate-600 font-medium">Broker Tick Interval:</span>
            <div className="inline-flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
              {[
                { label: 'Fast (550ms)', ms: 550 },
                { label: 'Normal (1100ms)', ms: 1100 },
                { label: 'Slow (2000ms)', ms: 2000 },
              ].map((opt) => (
                <button
                  key={opt.ms}
                  type="button"
                  onClick={() => onControl('speed', { speedMs: opt.ms })}
                  className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors whitespace-nowrap ${
                    simulation.speedMs === opt.ms
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          <label className="inline-flex items-center gap-2 text-slate-700 cursor-pointer">
            <input
              type="checkbox"
              checked={simulation.autoGenerateOrders}
              onChange={(e) => onControl('auto_generate', { autoGenerateOrders: e.target.checked })}
              className="rounded border-slate-300 text-blue-700 focus:ring-blue-600"
            />
            Auto-generate incoming customer orders while running
          </label>
        </div>
      </section>

      {/* Process Flow Diagram */}
      <section className="bg-white border border-slate-200 rounded-xl p-5">
        <div className="mb-4">
          <h2 className="text-base font-semibold text-slate-900">
            Inter-Process Communication Flow
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Order Receiver → Payment Processor → Delivery Status Updater → Partner Notifier via AMQP Queues
          </p>
        </div>

        <ProcessFlowDiagram
          processes={simulation.processes}
          activePackets={simulation.activePackets}
          onRecoverProcess={onRecoverProcess}
        />
      </section>

      {/* Failure Simulation Controls */}
      <section className="bg-white border border-slate-200 rounded-xl p-5">
        <div className="flex flex-wrap items-center justify-between gap-4 mb-4">
          <div>
            <h2 className="text-base font-semibold text-slate-900">IPC Failure Injection Controls</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Select a target process and trigger real-time IPC faults to observe detection and recovery behavior
            </p>
          </div>

          <div className="flex items-center gap-2">
            <label htmlFor="target-proc" className="text-xs font-medium text-slate-600 whitespace-nowrap">
              Target Process:
            </label>
            <select
              id="target-proc"
              value={targetProcess}
              onChange={(e) => setTargetProcess(e.target.value as ProcessId)}
              className="text-xs border border-slate-200 rounded-lg px-3 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-blue-600"
            >
              {simulation.processes.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} ({p.queue_name})
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3.5">
          {FAILURE_TRIGGERS.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.type}
                type="button"
                disabled={busy}
                onClick={() => triggerFailure(item.type)}
                className="text-left p-4 rounded-xl border border-slate-200 hover:border-blue-300 hover:bg-blue-50/40 transition-colors flex flex-col justify-between gap-3 disabled:opacity-60"
              >
                <div className="flex items-start justify-between gap-2">
                  <span className="text-sm font-semibold text-slate-900">{item.label}</span>
                  <Icon className="w-4 h-4 text-blue-700 shrink-0 mt-0.5" />
                </div>
                <p className="text-xs text-slate-500 leading-relaxed">{item.description}</p>
              </button>
            );
          })}
        </div>

        {lastInjection && (
          <div className="mt-4 p-4 rounded-xl border border-amber-200 bg-amber-50/70 flex flex-wrap items-start justify-between gap-3">
            <div className="flex items-start gap-2.5">
              <AlertTriangle className="w-4 h-4 text-amber-700 mt-0.5 shrink-0" />
              <div className="space-y-1">
                <div className="flex flex-wrap items-center gap-2 text-xs font-semibold text-slate-900">
                  <span>{lastInjection.failureType}</span>
                  <span aria-hidden="true">·</span>
                  <span className="font-mono">Order: {lastInjection.affectedOrderId}</span>
                  <span aria-hidden="true">·</span>
                  <span className="font-mono text-slate-500 font-normal">
                    {new Date(lastInjection.timestamp).toLocaleTimeString()}
                  </span>
                </div>
                <p className="text-xs text-slate-700">{lastInjection.message}</p>
              </div>
            </div>
          </div>
        )}
      </section>

      {/* Live Broker Event Feed */}
      <section className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-5 py-3.5 border-b border-slate-200">
          <h2 className="text-base font-semibold text-slate-900">Live Message Broker Audit Stream</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50/70 text-xs font-medium text-slate-500">
                <th className="py-2 px-4">Time</th>
                <th className="py-2 px-4">Order</th>
                <th className="py-2 px-4">Route</th>
                <th className="py-2 px-4">Status</th>
                <th className="py-2 px-4">Ack</th>
                <th className="py-2 px-4">Event Details</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-xs">
              {simulation.recentEvents.map((ev) => (
                <tr key={ev.id} className="hover:bg-slate-50/80">
                  <td className="py-2 px-4 font-mono tabular-nums text-slate-500 whitespace-nowrap">
                    {new Date(ev.logged_at).toLocaleTimeString()}
                  </td>
                  <td className="py-2 px-4 font-mono font-semibold text-slate-800 whitespace-nowrap">
                    {ev.order_id}
                  </td>
                  <td className="py-2 px-4 font-mono text-slate-600 whitespace-nowrap">
                    {ev.sender_process} → {ev.receiver_process}
                  </td>
                  <td className="py-2 px-4">
                    <StatusLabel value={ev.status} />
                  </td>
                  <td className="py-2 px-4">
                    <StatusLabel value={ev.ack_status} />
                  </td>
                  <td className="py-2 px-4 text-slate-600 max-w-md truncate" title={ev.details}>
                    {ev.details}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
