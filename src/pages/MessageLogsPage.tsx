import { useEffect, useState } from 'react';
import { ArrowUpDown, Eye, RotateCw, X } from 'lucide-react';
import { StatusLabel } from '../components/StatusLabel.tsx';
import type { MessageLogRecord, MessageRecord } from '../types/ipc.ts';

interface MessageLogsPageProps {
  onRetryMessage: (id: string) => Promise<void>;
  refreshSignal: number;
}

export function MessageLogsPage({ onRetryMessage, refreshSignal }: MessageLogsPageProps) {
  const [tab, setTab] = useState<'messages' | 'audit'>('messages');
  const [messages, setMessages] = useState<MessageRecord[]>([]);
  const [logs, setLogs] = useState<MessageLogRecord[]>([]);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [processFilter, setProcessFilter] = useState('ALL');
  const [ackFilter, setAckFilter] = useState('ALL');
  const [sortBy, setSortBy] = useState('created_at');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [selectedPayload, setSelectedPayload] = useState<MessageRecord | null>(null);
  const [loading, setLoading] = useState(true);

  async function loadData() {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        search,
        status: statusFilter,
        process: processFilter,
        ack: ackFilter,
        sortBy,
        sortDir,
      });
      const logParams = new URLSearchParams({
        search,
        status: statusFilter,
      });
      const [msgRes, logRes] = await Promise.all([
        fetch(`/api/messages?${params.toString()}`),
        fetch(`/api/logs?${logParams.toString()}`),
      ]);
      const msgData = await msgRes.json();
      const logData = await logRes.json();
      setMessages(msgData.messages ?? []);
      setLogs(logData.logs ?? []);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadData();
  }, [search, statusFilter, processFilter, ackFilter, sortBy, sortDir, refreshSignal]);

  function toggleSort(col: string) {
    if (sortBy === col) {
      setSortDir((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortBy(col);
      setSortDir('desc');
    }
  }

  return (
    <div className="space-y-5">
      {/* Toolbar & Filters */}
      <section className="bg-white border border-slate-200 rounded-xl p-4 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="inline-flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
            <button
              type="button"
              onClick={() => setTab('messages')}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                tab === 'messages' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Message Frames ({messages.length})
            </button>
            <button
              type="button"
              onClick={() => setTab('audit')}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                tab === 'audit' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Broker Audit Trail ({logs.length})
            </button>
          </div>

          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search Message ID, Order ID, Correlation ID, Event..."
            className="w-full sm:w-80 px-3 py-1.5 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
          />
        </div>

        <div className="flex flex-wrap items-center gap-3 text-xs pt-3 border-t border-slate-100">
          <div className="flex items-center gap-2">
            <label htmlFor="f-status" className="text-slate-500 font-medium">
              Status:
            </label>
            <select
              id="f-status"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="border border-slate-200 rounded-lg px-2.5 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-blue-600"
            >
              <option value="ALL">All Statuses</option>
              <option value="DELIVERED">DELIVERED</option>
              <option value="DELAYED">DELAYED</option>
              <option value="QUEUED">QUEUED</option>
              <option value="FAILED">FAILED</option>
              <option value="DUPLICATE_DROPPED">DUPLICATE_DROPPED</option>
              <option value="DEAD_LETTERED">DEAD_LETTERED</option>
            </select>
          </div>

          {tab === 'messages' && (
            <>
              <div className="flex items-center gap-2">
                <label htmlFor="f-proc" className="text-slate-500 font-medium">
                  Process:
                </label>
                <select
                  id="f-proc"
                  value={processFilter}
                  onChange={(e) => setProcessFilter(e.target.value)}
                  className="border border-slate-200 rounded-lg px-2.5 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-blue-600"
                >
                  <option value="ALL">All Processes</option>
                  <option value="order-receiver">Order Receiver</option>
                  <option value="payment-processor">Payment Processor</option>
                  <option value="delivery-updater">Delivery Status Updater</option>
                  <option value="partner-notifier">Partner Notifier</option>
                </select>
              </div>

              <div className="flex items-center gap-2">
                <label htmlFor="f-ack" className="text-slate-500 font-medium">
                  Acknowledgement:
                </label>
                <select
                  id="f-ack"
                  value={ackFilter}
                  onChange={(e) => setAckFilter(e.target.value)}
                  className="border border-slate-200 rounded-lg px-2.5 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-blue-600"
                >
                  <option value="ALL">All Ack States</option>
                  <option value="ACKED">ACKED</option>
                  <option value="PENDING">PENDING</option>
                  <option value="NACKED">NACKED</option>
                </select>
              </div>
            </>
          )}
        </div>
      </section>

      {/* Main Data Table */}
      <section className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        {tab === 'messages' ? (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/70 text-xs font-medium text-slate-500">
                  <th className="py-2.5 px-3">Message ID</th>
                  <th className="py-2.5 px-3">
                    <button
                      type="button"
                      onClick={() => toggleSort('order_id')}
                      className="inline-flex items-center gap-1 hover:text-slate-900"
                    >
                      Order ID
                      <ArrowUpDown className="w-3 h-3" />
                    </button>
                  </th>
                  <th className="py-2.5 px-3">
                    <button
                      type="button"
                      onClick={() => toggleSort('sequence_number')}
                      className="inline-flex items-center gap-1 hover:text-slate-900"
                    >
                      Seq
                      <ArrowUpDown className="w-3 h-3" />
                    </button>
                  </th>
                  <th className="py-2.5 px-3">Sender → Receiver</th>
                  <th className="py-2.5 px-3">Event Type</th>
                  <th className="py-2.5 px-3">
                    <button
                      type="button"
                      onClick={() => toggleSort('status')}
                      className="inline-flex items-center gap-1 hover:text-slate-900"
                    >
                      Status
                      <ArrowUpDown className="w-3 h-3" />
                    </button>
                  </th>
                  <th className="py-2.5 px-3">Ack</th>
                  <th className="py-2.5 px-3 text-right">
                    <button
                      type="button"
                      onClick={() => toggleSort('retry_count')}
                      className="inline-flex items-center gap-1 hover:text-slate-900"
                    >
                      Retries
                      <ArrowUpDown className="w-3 h-3" />
                    </button>
                  </th>
                  <th className="py-2.5 px-3 text-right">
                    <button
                      type="button"
                      onClick={() => toggleSort('processing_time_ms')}
                      className="inline-flex items-center gap-1 hover:text-slate-900"
                    >
                      Latency
                      <ArrowUpDown className="w-3 h-3" />
                    </button>
                  </th>
                  <th className="py-2.5 px-3 text-right">
                    <button
                      type="button"
                      onClick={() => toggleSort('created_at')}
                      className="inline-flex items-center gap-1 hover:text-slate-900"
                    >
                      Timestamp
                      <ArrowUpDown className="w-3 h-3" />
                    </button>
                  </th>
                  <th className="py-2.5 px-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-xs">
                {loading && messages.length === 0 ? (
                  <tr>
                    <td colSpan={11} className="py-8 text-center text-slate-400">
                      Loading message telemetry...
                    </td>
                  </tr>
                ) : messages.length === 0 ? (
                  <tr>
                    <td colSpan={11} className="py-8 text-center text-slate-400">
                      No messages match your active filters.
                    </td>
                  </tr>
                ) : (
                  messages.map((m) => (
                    <tr key={m.id} className="hover:bg-slate-50/80 transition-colors">
                      <td className="py-2.5 px-3 font-mono text-slate-900 whitespace-nowrap">
                        <div>{m.id}</div>
                        <div className="text-[10px] text-slate-400">{m.correlation_id}</div>
                      </td>
                      <td className="py-2.5 px-3 font-mono font-semibold text-slate-800 whitespace-nowrap">
                        {m.order_id}
                      </td>
                      <td className="py-2.5 px-3 font-mono tabular-nums text-slate-700 whitespace-nowrap">
                        #{m.sequence_number}
                        {m.is_out_of_order === 1 && (
                          <span className="ml-1 text-[10px] text-amber-700 font-semibold">OOO</span>
                        )}
                      </td>
                      <td className="py-2.5 px-3 font-mono text-slate-600 whitespace-nowrap">
                        {m.sender_process} → {m.receiver_process}
                      </td>
                      <td className="py-2.5 px-3 font-mono text-slate-700 whitespace-nowrap">{m.event_type}</td>
                      <td className="py-2.5 px-3">
                        <StatusLabel value={m.status} />
                      </td>
                      <td className="py-2.5 px-3">
                        <StatusLabel value={m.ack_status} />
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono tabular-nums text-slate-700">
                        {m.retry_count}/{m.max_retries}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono tabular-nums text-slate-700 whitespace-nowrap">
                        {m.processing_time_ms} ms
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono tabular-nums text-slate-500 whitespace-nowrap">
                        {new Date(m.created_at).toLocaleTimeString()}
                      </td>
                      <td className="py-2.5 px-3 text-right whitespace-nowrap">
                        <div className="inline-flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => setSelectedPayload(m)}
                            title="Inspect payload"
                            className="p-1.5 rounded-md border border-slate-200 hover:bg-slate-100 text-slate-600"
                          >
                            <Eye className="w-3.5 h-3.5" />
                          </button>
                          {(m.status === 'FAILED' || m.status === 'DEAD_LETTERED' || m.ack_status === 'NACKED') && (
                            <button
                              type="button"
                              onClick={() => onRetryMessage(m.id)}
                              title="Retry message"
                              className="inline-flex items-center gap-1 px-2 py-1 rounded-md border border-blue-200 bg-blue-50 hover:bg-blue-100 text-blue-700 font-medium"
                            >
                              <RotateCw className="w-3 h-3" />
                              Retry
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/70 text-xs font-medium text-slate-500">
                  <th className="py-2.5 px-4">Timestamp</th>
                  <th className="py-2.5 px-4">Message ID</th>
                  <th className="py-2.5 px-4">Order ID</th>
                  <th className="py-2.5 px-4">Seq</th>
                  <th className="py-2.5 px-4">Route</th>
                  <th className="py-2.5 px-4">Status</th>
                  <th className="py-2.5 px-4">Ack</th>
                  <th className="py-2.5 px-4">Log Details</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-xs">
                {logs.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="py-8 text-center text-slate-400">
                      No broker audit logs match your query.
                    </td>
                  </tr>
                ) : (
                  logs.map((l) => (
                    <tr key={l.id} className="hover:bg-slate-50/80">
                      <td className="py-2.5 px-4 font-mono tabular-nums text-slate-500 whitespace-nowrap">
                        {new Date(l.logged_at).toLocaleTimeString()}
                      </td>
                      <td className="py-2.5 px-4 font-mono text-slate-800 whitespace-nowrap">{l.message_id}</td>
                      <td className="py-2.5 px-4 font-mono font-semibold text-slate-800 whitespace-nowrap">
                        {l.order_id}
                      </td>
                      <td className="py-2.5 px-4 font-mono tabular-nums text-slate-600">#{l.sequence_number}</td>
                      <td className="py-2.5 px-4 font-mono text-slate-600 whitespace-nowrap">
                        {l.sender_process} → {l.receiver_process}
                      </td>
                      <td className="py-2.5 px-4">
                        <StatusLabel value={l.status} />
                      </td>
                      <td className="py-2.5 px-4">
                        <StatusLabel value={l.ack_status} />
                      </td>
                      <td className="py-2.5 px-4 text-slate-600 max-w-lg">{l.details}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Payload Modal */}
      {selectedPayload && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-xl max-w-lg w-full p-5 shadow-xl space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-base font-semibold text-slate-900">Message Envelope Inspection</h3>
                <p className="text-xs font-mono text-slate-500">
                  {selectedPayload.id} · {selectedPayload.correlation_id}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedPayload(null)}
                className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="grid grid-cols-2 gap-3 text-xs border-y border-slate-100 py-3">
              <div>
                <span className="text-slate-500 block">Order ID</span>
                <span className="font-mono font-semibold text-slate-900">{selectedPayload.order_id}</span>
              </div>
              <div>
                <span className="text-slate-500 block">Sequence Number</span>
                <span className="font-mono font-semibold text-slate-900">#{selectedPayload.sequence_number}</span>
              </div>
              <div>
                <span className="text-slate-500 block">Sender → Receiver</span>
                <span className="font-mono text-slate-800">
                  {selectedPayload.sender_process} → {selectedPayload.receiver_process}
                </span>
              </div>
              <div>
                <span className="text-slate-500 block">Retry / Latency</span>
                <span className="font-mono text-slate-800">
                  {selectedPayload.retry_count}/{selectedPayload.max_retries} · {selectedPayload.processing_time_ms} ms
                </span>
              </div>
            </div>

            <div>
              <span className="text-xs font-medium text-slate-700 block mb-1.5">JSON Payload</span>
              <pre className="bg-slate-950 text-slate-100 p-3.5 rounded-lg text-xs font-mono overflow-x-auto">
                {(() => {
                  try {
                    return JSON.stringify(JSON.parse(selectedPayload.payload), null, 2);
                  } catch {
                    return selectedPayload.payload;
                  }
                })()}
              </pre>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
