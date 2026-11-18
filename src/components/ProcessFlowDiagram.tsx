import { ArrowRight, RefreshCw, ServerCrash } from 'lucide-react';
import type { ActiveTransitPacket, ProcessId, ProcessRecord } from '../types/ipc.ts';
import { StatusLabel } from './StatusLabel.tsx';

interface ProcessFlowDiagramProps {
  processes: ProcessRecord[];
  activePackets: ActiveTransitPacket[];
  onRecoverProcess?: (processId: ProcessId) => void;
  compact?: boolean;
}

const STAGE_DESCRIPTIONS: Record<ProcessId, string> = {
  'order-receiver': 'Validates customer orders & assigns correlation IDs',
  'payment-processor': 'Authorizes payment & confirms transaction',
  'delivery-updater': 'Updates kitchen & rider dispatch milestones',
  'partner-notifier': 'Sends push/SMS notifications to rider & customer',
};

export function ProcessFlowDiagram({
  processes,
  activePackets,
  onRecoverProcess,
  compact = false,
}: ProcessFlowDiagramProps) {
  const ordered = [...processes].sort((a, b) => a.stage_order - b.stage_order);

  const packetColor = (status: ActiveTransitPacket['status']) => {
    switch (status) {
      case 'FAILED':
        return 'bg-red-600 text-white';
      case 'DELAYED':
        return 'bg-amber-600 text-white';
      case 'DUPLICATE':
        return 'bg-indigo-600 text-white';
      case 'OUT_OF_ORDER':
        return 'bg-orange-600 text-white';
      default:
        return 'bg-blue-700 text-white';
    }
  };

  return (
    <div className="w-full overflow-x-auto pb-2">
      <div className="min-w-[820px] grid grid-cols-[1fr_72px_1fr_72px_1fr_72px_1fr] items-stretch gap-0">
        {ordered.map((proc, index) => {
          const isCrashed = proc.is_crashed === 1 || proc.status === 'FAILED';
          const incomingPackets = activePackets.filter((p) => p.toStage === proc.stage_order);

          return (
            <div key={proc.id} className="contents">
              {/* Process Node */}
              <div
                className={`rounded-xl border p-4 flex flex-col justify-between transition-colors ${
                  isCrashed
                    ? 'bg-red-50/70 border-red-300'
                    : proc.status === 'RUNNING'
                    ? 'bg-blue-50/50 border-blue-300'
                    : 'bg-white border-slate-200'
                }`}
              >
                <div>
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <span className="text-xs font-mono tabular-nums text-slate-500">
                      Stage 0{proc.stage_order}
                    </span>
                    <StatusLabel value={proc.status} />
                  </div>

                  <h3 className="text-sm font-semibold text-slate-900 leading-snug">
                    {proc.name}
                  </h3>
                  {!compact && (
                    <p className="text-xs text-slate-500 mt-1 leading-relaxed">
                      {STAGE_DESCRIPTIONS[proc.id]}
                    </p>
                  )}
                </div>

                <div className="mt-4 pt-3 border-t border-slate-100 space-y-1.5">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-slate-500">Queue</span>
                    <span className="font-mono text-[11px] text-slate-700 truncate max-w-[140px]" title={proc.queue_name}>
                      {proc.queue_name}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-xs font-mono tabular-nums">
                    <span className="text-slate-500 font-sans">Depth / Acked</span>
                    <span className="text-slate-900 font-medium">
                      {proc.current_queue_depth} · {proc.processed_count}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-xs font-mono tabular-nums">
                    <span className="text-slate-500 font-sans">Avg Latency</span>
                    <span className="text-slate-700">{Math.round(proc.avg_latency_ms)} ms</span>
                  </div>

                  {isCrashed && onRecoverProcess && (
                    <button
                      type="button"
                      onClick={() => onRecoverProcess(proc.id)}
                      className="mt-2 w-full inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-600 hover:bg-red-700 text-white text-xs font-medium transition-colors whitespace-nowrap"
                    >
                      <RefreshCw className="w-3.5 h-3.5" />
                      Recover Process
                    </button>
                  )}

                  {isCrashed && !onRecoverProcess && (
                    <div className="mt-2 flex items-center gap-1.5 text-xs text-red-700 font-medium">
                      <ServerCrash className="w-3.5 h-3.5" />
                      Consumer offline
                    </div>
                  )}
                </div>
              </div>

              {/* Broker Channel Connector between nodes */}
              {index < ordered.length - 1 && (
                <div className="flex flex-col items-center justify-center px-1 relative">
                  <div className="w-full h-[2px] bg-slate-200 relative overflow-visible flex items-center justify-center">
                    <ArrowRight className="w-4 h-4 text-slate-400 bg-slate-50 px-0.5 z-10" />
                    {incomingPackets.length > 0 && (
                      <div className="absolute inset-x-0 -top-4 flex justify-center pointer-events-none">
                        <span
                          className={`text-[10px] font-mono px-1.5 py-0.5 rounded shadow-xs animate-packet whitespace-nowrap ${packetColor(
                            incomingPackets[0].status
                          )}`}
                        >
                          {incomingPackets[0].orderId}
                        </span>
                      </div>
                    )}
                  </div>
                  <span className="text-[10px] font-mono text-slate-400 mt-2 whitespace-nowrap">
                    AMQP
                  </span>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Incoming packets waiting at Stage 1 or summary strip */}
      {activePackets.length > 0 && (
        <div className="mt-4 pt-3 border-t border-slate-200 flex flex-wrap items-center gap-3 text-xs text-slate-600">
          <span className="font-medium text-slate-800">Active In-Flight Frames:</span>
          {activePackets.slice(0, 5).map((pkt) => (
            <span
              key={pkt.id}
              className="inline-flex items-center gap-1.5 font-mono text-[11px] text-slate-700 bg-slate-100 px-2 py-0.5 rounded"
            >
              <span>{pkt.orderId}</span>
              <span aria-hidden="true">·</span>
              <span>{pkt.eventType}</span>
              <span aria-hidden="true">·</span>
              <span
                className={
                  pkt.status === 'FAILED'
                    ? 'text-red-700 font-semibold'
                    : pkt.status === 'DELAYED'
                    ? 'text-amber-700 font-semibold'
                    : pkt.status === 'DUPLICATE'
                    ? 'text-indigo-700 font-semibold'
                    : pkt.status === 'OUT_OF_ORDER'
                    ? 'text-orange-700 font-semibold'
                    : 'text-blue-700 font-semibold'
                }
              >
                {pkt.status}
              </span>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
