import { useState } from 'react';
import { Check, Clock, Copy, Layers, ServerCrash, Shuffle, WifiOff } from 'lucide-react';
import { StatusLabel } from '../components/StatusLabel.tsx';
import type { FailureType, IpcFailureRecord, ProcessId, ProcessRecord } from '../types/ipc.ts';

interface FailureDetectionPageProps {
  failures: IpcFailureRecord[];
  processes: ProcessRecord[];
  onInjectFailure: (failureType: FailureType, targetProcess: ProcessId) => Promise<{
    message: string;
    failureType: FailureType;
    affectedOrderId: string;
  } | null>;
  onResolveFailure: (id: string) => Promise<void>;
}

const FAILURE_OPTIONS: Array<{ type: FailureType; label: string; icon: typeof WifiOff }> = [
  { type: 'MESSAGE_LOSS', label: 'Message Loss', icon: WifiOff },
  { type: 'MESSAGE_DELAY', label: 'Message Delay', icon: Clock },
  { type: 'DUPLICATE_MESSAGE', label: 'Duplicate Message', icon: Copy },
  { type: 'OUT_OF_ORDER', label: 'Out-of-Order', icon: Shuffle },
  { type: 'PROCESS_CRASH', label: 'Process Crash', icon: ServerCrash },
  { type: 'QUEUE_OVERFLOW', label: 'Queue Overflow', icon: Layers },
];

export function FailureDetectionPage({
  failures,
  processes,
  onInjectFailure,
  onResolveFailure,
}: FailureDetectionPageProps) {
  const [targetProcess, setTargetProcess] = useState<ProcessId>('payment-processor');
  const [filterType, setFilterType] = useState<string>('ALL');
  const [filterState, setFilterState] = useState<'ALL' | 'OPEN' | 'RESOLVED'>('ALL');

  const filtered = failures.filter((f) => {
    if (filterType !== 'ALL' && f.failure_type !== filterType) return false;
    if (filterState === 'OPEN' && f.resolved === 1) return false;
    if (filterState === 'RESOLVED' && f.resolved === 0) return false;
    return true;
  });

  return (
    <div className="space-y-6">
      {/* Quick Fault Injection Strip */}
      <section className="bg-white border border-slate-200 rounded-xl p-5">
        <div className="flex flex-wrap items-center justify-between gap-4 mb-4">
          <div>
            <h2 className="text-base font-semibold text-slate-900">Trigger & Investigate IPC Failures</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Inject controlled anomalies into any microservice queue and inspect automated detection logs below
            </p>
          </div>
          <div className="flex items-center gap-2">
            <label htmlFor="fail-target" className="text-xs font-medium text-slate-600">
              Target Process:
            </label>
            <select
              id="fail-target"
              value={targetProcess}
              onChange={(e) => setTargetProcess(e.target.value as ProcessId)}
              className="text-xs border border-slate-200 rounded-lg px-2.5 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-blue-600"
            >
              {processes.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="flex flex-wrap gap-2.5">
          {FAILURE_OPTIONS.map((opt) => {
            const Icon = opt.icon;
            return (
              <button
                key={opt.type}
                type="button"
                onClick={() => void onInjectFailure(opt.type, targetProcess)}
                className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg border border-slate-200 hover:border-blue-300 hover:bg-blue-50/60 text-xs font-medium text-slate-800 transition-colors whitespace-nowrap"
              >
                <Icon className="w-3.5 h-3.5 text-blue-700" />
                {opt.label}
              </button>
            );
          })}
        </div>
      </section>

      {/* Failure Registry */}
      <section className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200 flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="text-base font-semibold text-slate-900">Detected IPC Failure Registry</h2>
            <p className="text-xs text-slate-500 mt-0.5 font-mono tabular-nums">
              {filtered.length} incidents shown · {failures.filter((f) => f.resolved === 0).length} unresolved
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3 text-xs">
            <select
              aria-label="Filter by failure type"
              value={filterType}
              onChange={(e) => setFilterType(e.target.value)}
              className="border border-slate-200 rounded-lg px-2.5 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-blue-600"
            >
              <option value="ALL">All Failure Types</option>
              {FAILURE_OPTIONS.map((o) => (
                <option key={o.type} value={o.type}>
                  {o.type}
                </option>
              ))}
            </select>

            <div className="inline-flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
              {(['ALL', 'OPEN', 'RESOLVED'] as const).map((st) => (
                <button
                  key={st}
                  type="button"
                  onClick={() => setFilterState(st)}
                  className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
                    filterState === st ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {st}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50/70 text-xs font-medium text-slate-500">
                <th className="py-2.5 px-4">Failure Type</th>
                <th className="py-2.5 px-4">Affected Order</th>
                <th className="py-2.5 px-4">Process / Message</th>
                <th className="py-2.5 px-4">Error Details</th>
                <th className="py-2.5 px-4">Recovery Action</th>
                <th className="py-2.5 px-4">Timestamp</th>
                <th className="py-2.5 px-4 text-right">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-xs">
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-10 text-center text-slate-400">
                    No IPC failures match the selected criteria.
                  </td>
                </tr>
              ) : (
                filtered.map((f) => (
                  <tr key={f.id} className="hover:bg-slate-50/80 transition-colors">
                    <td className="py-2.5 px-4">
                      <StatusLabel value={f.failure_type} />
                    </td>
                    <td className="py-2.5 px-4 font-mono font-semibold text-slate-900 whitespace-nowrap">
                      {f.order_id}
                    </td>
                    <td className="py-2.5 px-4 font-mono text-slate-600 whitespace-nowrap">
                      <div>{f.process_id ?? 'broker'}</div>
                      {f.message_id && <div className="text-[10px] text-slate-400">{f.message_id}</div>}
                    </td>
                    <td className="py-2.5 px-4 text-slate-700 max-w-sm">{f.error_details}</td>
                    <td className="py-2.5 px-4 text-slate-600 max-w-xs">
                      {f.recovery_action ?? 'Pending investigation'}
                    </td>
                    <td className="py-2.5 px-4 font-mono tabular-nums text-slate-500 whitespace-nowrap">
                      {new Date(f.occurred_at).toLocaleString()}
                    </td>
                    <td className="py-2.5 px-4 text-right whitespace-nowrap">
                      {f.resolved ? (
                        <StatusLabel value="RESOLVED" />
                      ) : (
                        <button
                          type="button"
                          onClick={() => void onResolveFailure(f.id)}
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md border border-slate-200 hover:bg-emerald-50 hover:border-emerald-200 text-emerald-700 font-medium transition-colors"
                        >
                          <Check className="w-3 h-3" />
                          Resolve
                        </button>
                      )}
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
