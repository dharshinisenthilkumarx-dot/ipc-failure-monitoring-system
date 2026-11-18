import { ArrowRight } from 'lucide-react';
import { SuccessVsFailedChart, TrendLineChart } from '../components/Charts.tsx';
import { ProcessFlowDiagram } from '../components/ProcessFlowDiagram.tsx';
import { StatusLabel } from '../components/StatusLabel.tsx';
import type {
  DashboardSummary,
  IpcFailureRecord,
  ProcessId,
  ProcessRecord,
  QueueMetricPoint,
  SimulationStateSnapshot,
} from '../types/ipc.ts';

interface DashboardPageProps {
  summary: DashboardSummary;
  processes: ProcessRecord[];
  recentFailures: IpcFailureRecord[];
  queueHistory: QueueMetricPoint[];
  successVsFailed: Array<{ label: string; successful: number; failed: number; delayed: number }>;
  simulation: SimulationStateSnapshot;
  onNavigate: (page: string) => void;
  onRecoverProcess: (id: ProcessId) => void;
}

export function DashboardPage({
  summary,
  processes,
  recentFailures,
  queueHistory,
  successVsFailed,
  simulation,
  onNavigate,
  onRecoverProcess,
}: DashboardPageProps) {
  const kpis = [
    { label: 'Total Orders Processed', value: summary.totalOrdersProcessed, sub: 'Lifecycle tracked' },
    { label: 'Messages Sent', value: summary.messagesSent, sub: 'Published to broker' },
    { label: 'Messages Received', value: summary.messagesReceived, sub: 'Consumed by workers' },
    { label: 'Successful Messages', value: summary.successfulMessages, sub: 'ACK committed', accent: 'text-emerald-700' },
    { label: 'Failed Messages', value: summary.failedMessages, sub: `${summary.deadLetterCount} in DLQ`, accent: 'text-red-700' },
    { label: 'Delayed Messages', value: summary.delayedMessages, sub: 'Latency > 1500 ms', accent: 'text-amber-700' },
    { label: 'Duplicate Messages', value: summary.duplicateMessages, sub: 'Idempotency filtered', accent: 'text-indigo-700' },
    { label: 'Current Queue Length', value: summary.currentQueueLength, sub: 'Across 4 queues' },
    {
      label: 'Communication Success Rate',
      value: `${summary.overallSuccessRate}%`,
      sub: `${summary.unresolvedFailures} open failures`,
      accent: summary.overallSuccessRate >= 90 ? 'text-blue-700' : 'text-amber-700',
    },
  ];

  const queueTrend = queueHistory.map((pt) => ({
    label: new Date(pt.recorded_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    value: pt.queue_length,
  }));

  return (
    <div className="space-y-6">
      {/* 9-Metric KPI Grid */}
      <section aria-label="IPC Communication Metrics">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4">
          {kpis.map((kpi) => (
            <div
              key={kpi.label}
              className="bg-white border border-slate-200 rounded-xl p-4 flex flex-col justify-between"
            >
              <span className="text-xs font-medium text-slate-500">{kpi.label}</span>
              <div className={`text-2xl font-display font-bold tabular-nums mt-2 ${kpi.accent ?? 'text-slate-900'}`}>
                {kpi.value}
              </div>
              <span className="text-xs text-slate-400 mt-1">{kpi.sub}</span>
            </div>
          ))}
        </div>
      </section>

      {/* Live Pipeline Architecture Preview */}
      <section className="bg-white border border-slate-200 rounded-xl p-5">
        <div className="flex flex-wrap items-center justify-between gap-4 mb-4">
          <div>
            <h2 className="text-base font-semibold text-slate-900">
              Food Delivery IPC Pipeline
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Live status across Order Receiver, Payment Processor, Delivery Status Updater, and Partner Notifier
            </p>
          </div>
          <button
            type="button"
            onClick={() => onNavigate('simulation')}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-blue-700 hover:bg-blue-800 text-white text-xs font-medium transition-colors whitespace-nowrap shrink-0"
          >
            Open Simulation Workbench
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>

        <ProcessFlowDiagram
          processes={processes}
          activePackets={simulation.activePackets}
          onRecoverProcess={onRecoverProcess}
          compact
        />
      </section>

      {/* Charts Row */}
      <section className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <div className="mb-3">
            <h2 className="text-base font-semibold text-slate-900">
              Message Outcomes by Process
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Successful acknowledgements versus delayed and failed frames per stage
            </p>
          </div>
          <SuccessVsFailedChart data={successVsFailed} />
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <div className="mb-3">
            <h2 className="text-base font-semibold text-slate-900">
              Queue Length Over Time
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Aggregate broker queue depth sampled across recent simulation intervals
            </p>
          </div>
          <TrendLineChart data={queueTrend} strokeColor="#1d4ed8" fillColor="rgba(29, 78, 216, 0.08)" />
        </div>
      </section>

      {/* Recent Failures Table */}
      <section className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between gap-4">
          <div>
            <h2 className="text-base font-semibold text-slate-900">Recent IPC Failure Detections</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Latest anomalies captured by acknowledgement timeouts, sequence checks, and idempotency filters
            </p>
          </div>
          <button
            type="button"
            onClick={() => onNavigate('failures')}
            className="text-xs font-medium text-blue-700 hover:text-blue-800 whitespace-nowrap shrink-0"
          >
            View All Failures
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50/70 text-xs font-medium text-slate-500">
                <th className="py-2.5 px-4">Failure Type</th>
                <th className="py-2.5 px-4">Order ID</th>
                <th className="py-2.5 px-4">Process</th>
                <th className="py-2.5 px-4">Error Details</th>
                <th className="py-2.5 px-4">State</th>
                <th className="py-2.5 px-4 text-right">Occurred</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-sm">
              {recentFailures.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-slate-400 text-sm">
                    No IPC failures detected yet.
                  </td>
                </tr>
              ) : (
                recentFailures.map((f) => (
                  <tr key={f.id} className="hover:bg-slate-50/80 transition-colors">
                    <td className="py-2.5 px-4">
                      <StatusLabel value={f.failure_type} />
                    </td>
                    <td className="py-2.5 px-4 font-mono text-xs text-slate-800">{f.order_id}</td>
                    <td className="py-2.5 px-4 font-mono text-xs text-slate-600">{f.process_id ?? 'broker'}</td>
                    <td className="py-2.5 px-4 text-xs text-slate-600 max-w-md truncate" title={f.error_details}>
                      {f.error_details}
                    </td>
                    <td className="py-2.5 px-4">
                      <StatusLabel value={f.resolved ? 'RESOLVED' : 'FAILED'} />
                    </td>
                    <td className="py-2.5 px-4 text-right font-mono text-xs tabular-nums text-slate-500 whitespace-nowrap">
                      {new Date(f.occurred_at).toLocaleTimeString()}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
