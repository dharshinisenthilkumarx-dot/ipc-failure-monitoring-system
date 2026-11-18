import { useState } from 'react';
import { Eye, RotateCw, Trash2, X } from 'lucide-react';
import { StatusLabel } from '../components/StatusLabel.tsx';
import type { DeadLetterRecord } from '../types/ipc.ts';

interface DeadLetterQueuePageProps {
  items: DeadLetterRecord[];
  onRequeue: (id: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}

export function DeadLetterQueuePage({ items, onRequeue, onDelete }: DeadLetterQueuePageProps) {
  const [inspectItem, setInspectItem] = useState<DeadLetterRecord | null>(null);
  const [showRequeued, setShowRequeued] = useState<'PENDING' | 'ALL'>('PENDING');

  const visible = showRequeued === 'PENDING' ? items.filter((i) => i.requeued === 0) : items;

  return (
    <div className="space-y-6">
      <section className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200 flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="text-base font-semibold text-slate-900">
              Dead Letter Queue (dlq.food_delivery)
            </h2>
            <p className="text-xs text-slate-500 mt-0.5 font-mono tabular-nums">
              {items.filter((i) => i.requeued === 0).length} unrecovered frames · {items.length} total routed to DLQ
            </p>
          </div>

          <div className="inline-flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
            <button
              type="button"
              onClick={() => setShowRequeued('PENDING')}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                showRequeued === 'PENDING' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Active DLQ ({items.filter((i) => i.requeued === 0).length})
            </button>
            <button
              type="button"
              onClick={() => setShowRequeued('ALL')}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                showRequeued === 'ALL' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              All History ({items.length})
            </button>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50/70 text-xs font-medium text-slate-500">
                <th className="py-2.5 px-4">DLQ ID</th>
                <th className="py-2.5 px-4">Original Message</th>
                <th className="py-2.5 px-4">Order / Seq</th>
                <th className="py-2.5 px-4">Target Process</th>
                <th className="py-2.5 px-4">Failure Reason</th>
                <th className="py-2.5 px-4 text-right">Retries</th>
                <th className="py-2.5 px-4">State</th>
                <th className="py-2.5 px-4">Moved At</th>
                <th className="py-2.5 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-xs">
              {visible.length === 0 ? (
                <tr>
                  <td colSpan={9} className="py-10 text-center text-slate-400">
                    Dead Letter Queue is clear. Repeatedly failed or overflowed messages appear here.
                  </td>
                </tr>
              ) : (
                visible.map((item) => (
                  <tr key={item.id} className="hover:bg-slate-50/80 transition-colors">
                    <td className="py-2.5 px-4 font-mono font-semibold text-slate-900 whitespace-nowrap">
                      {item.id}
                    </td>
                    <td className="py-2.5 px-4 font-mono text-slate-700 whitespace-nowrap">
                      <div>{item.original_message_id}</div>
                      <div className="text-[10px] text-slate-400">{item.correlation_id}</div>
                    </td>
                    <td className="py-2.5 px-4 font-mono text-slate-800 whitespace-nowrap">
                      {item.order_id} · #{item.sequence_number}
                    </td>
                    <td className="py-2.5 px-4 font-mono text-slate-600 whitespace-nowrap">
                      {item.receiver_process}
                    </td>
                    <td className="py-2.5 px-4 text-slate-700 max-w-xs">{item.failure_reason}</td>
                    <td className="py-2.5 px-4 text-right font-mono tabular-nums text-slate-700">
                      {item.retry_attempts}
                    </td>
                    <td className="py-2.5 px-4">
                      <StatusLabel value={item.requeued ? 'RESOLVED' : 'DEAD_LETTERED'} />
                    </td>
                    <td className="py-2.5 px-4 font-mono tabular-nums text-slate-500 whitespace-nowrap">
                      {new Date(item.moved_at).toLocaleString()}
                    </td>
                    <td className="py-2.5 px-4 text-right whitespace-nowrap">
                      <div className="inline-flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => setInspectItem(item)}
                          title="Inspect dead-letter payload"
                          className="p-1.5 rounded-md border border-slate-200 hover:bg-slate-100 text-slate-600"
                        >
                          <Eye className="w-3.5 h-3.5" />
                        </button>
                        {item.requeued === 0 && (
                          <button
                            type="button"
                            onClick={() => void onRequeue(item.id)}
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-blue-700 hover:bg-blue-800 text-white font-medium transition-colors"
                          >
                            <RotateCw className="w-3 h-3" />
                            Requeue
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => void onDelete(item.id)}
                          title="Purge dead-letter record"
                          className="p-1.5 rounded-md border border-slate-200 hover:bg-red-50 hover:border-red-200 text-red-600"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      {inspectItem && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-xl max-w-lg w-full p-5 shadow-xl space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-base font-semibold text-slate-900">Dead Letter Payload Inspector</h3>
                <p className="text-xs font-mono text-slate-500">
                  {inspectItem.id} · Original: {inspectItem.original_message_id}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setInspectItem(null)}
                className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="text-xs space-y-2 border-y border-slate-100 py-3">
              <div>
                <span className="text-slate-500">Failure Reason: </span>
                <span className="text-red-700 font-medium">{inspectItem.failure_reason}</span>
              </div>
              <div>
                <span className="text-slate-500">Route: </span>
                <span className="font-mono text-slate-800">
                  {inspectItem.sender_process} → {inspectItem.receiver_process} ({inspectItem.event_type})
                </span>
              </div>
            </div>

            <div>
              <span className="text-xs font-medium text-slate-700 block mb-1.5">Dead-Letter Message Body</span>
              <pre className="bg-slate-950 text-slate-100 p-3.5 rounded-lg text-xs font-mono overflow-x-auto">
                {(() => {
                  try {
                    return JSON.stringify(JSON.parse(inspectItem.payload), null, 2);
                  } catch {
                    return inspectItem.payload;
                  }
                })()}
              </pre>
            </div>

            {inspectItem.requeued === 0 && (
              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={async () => {
                    await onRequeue(inspectItem.id);
                    setInspectItem(null);
                  }}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-blue-700 hover:bg-blue-800 text-white text-xs font-medium"
                >
                  <RotateCw className="w-3.5 h-3.5" />
                  Requeue Message for Delivery
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
