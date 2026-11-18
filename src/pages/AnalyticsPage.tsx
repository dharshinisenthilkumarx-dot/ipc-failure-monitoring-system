import { useEffect, useState } from 'react';
import { Download } from 'lucide-react';
import {
  HorizontalMetricBars,
  SuccessVsFailedChart,
  TrendLineChart,
} from '../components/Charts.tsx';
import type { AnalyticsResponse } from '../types/ipc.ts';

interface AnalyticsPageProps {
  refreshSignal: number;
}

export function AnalyticsPage({ refreshSignal }: AnalyticsPageProps) {
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [data, setData] = useState<AnalyticsResponse | null>(null);
  const [loading, setLoading] = useState(true);

  async function fetchAnalytics() {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (startDate) params.set('startDate', startDate);
      if (endDate) params.set('endDate', endDate);
      const res = await fetch(`/api/analytics?${params.toString()}`);
      const json = (await res.json()) as AnalyticsResponse;
      setData(json);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void fetchAnalytics();
  }, [startDate, endDate, refreshSignal]);

  function handleExportCsv() {
    const params = new URLSearchParams();
    if (startDate) params.set('startDate', startDate);
    if (endDate) params.set('endDate', endDate);
    window.location.href = `/api/analytics/export?${params.toString()}`;
  }

  const queueTrend =
    data?.queueHistory.map((pt) => ({
      label: new Date(pt.recorded_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      value: pt.queue_length,
    })) ?? [];

  const successRateTrend =
    data?.queueHistory.map((pt) => ({
      label: new Date(pt.recorded_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      value: Math.round(pt.success_rate),
    })) ?? [];

  const latencyBars =
    data?.processingTimeByProcess.map((p) => ({
      label: p.name,
      value: p.avgMs,
      subtext: `${p.processed} acks`,
    })) ?? [];

  const failureBars =
    data?.failureFrequency.map((f) => ({
      label: f.failureType,
      value: f.count,
      subtext: `${f.resolvedCount} resolved`,
    })) ?? [];

  return (
    <div className="space-y-6">
      {/* Date Filter & CSV Export Bar */}
      <section className="bg-white border border-slate-200 rounded-xl p-4 flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-wrap items-end gap-4">
          <div>
            <label htmlFor="start-date" className="block text-xs font-medium text-slate-600 mb-1">
              From Date
            </label>
            <input
              id="start-date"
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="text-xs border border-slate-200 rounded-lg px-3 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-blue-600"
            />
          </div>
          <div>
            <label htmlFor="end-date" className="block text-xs font-medium text-slate-600 mb-1">
              To Date
            </label>
            <input
              id="end-date"
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="text-xs border border-slate-200 rounded-lg px-3 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-blue-600"
            />
          </div>
          {(startDate || endDate) && (
            <button
              type="button"
              onClick={() => {
                setStartDate('');
                setEndDate('');
              }}
              className="px-3 py-1.5 text-xs font-medium text-slate-600 hover:text-slate-900 border border-slate-200 rounded-lg"
            >
              Reset Dates
            </button>
          )}
        </div>

        <button
          type="button"
          onClick={handleExportCsv}
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-blue-700 hover:bg-blue-800 text-white text-xs font-medium transition-colors whitespace-nowrap"
        >
          <Download className="w-3.5 h-3.5" />
          Export Report (CSV)
        </button>
      </section>

      {loading && !data ? (
        <div className="bg-white border border-slate-200 rounded-xl p-12 text-center text-sm text-slate-400">
          Computing analytics from database...
        </div>
      ) : data ? (
        <>
          {/* Row 1: Successful vs Failed + Message Delivery Success Rate */}
          <section className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="bg-white border border-slate-200 rounded-xl p-5">
              <div className="mb-3">
                <h2 className="text-base font-semibold text-slate-900">
                  1. Successful vs. Failed Messages
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  Delivery outcomes across the four food delivery processes
                </p>
              </div>
              <SuccessVsFailedChart data={data.successVsFailed} />
            </div>

            <div className="bg-white border border-slate-200 rounded-xl p-5">
              <div className="mb-3">
                <h2 className="text-base font-semibold text-slate-900">
                  2. Message Delivery Success Rate (%)
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  Historical communication reliability percentage across broker snapshots
                </p>
              </div>
              <TrendLineChart
                data={successRateTrend}
                unit="%"
                strokeColor="#16a34a"
                fillColor="rgba(22, 163, 74, 0.08)"
                minZero={false}
                maxOverride={100}
              />
            </div>
          </section>

          {/* Row 2: Processing Time + IPC Failure Frequency */}
          <section className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="bg-white border border-slate-200 rounded-xl p-5">
              <div className="mb-4">
                <h2 className="text-base font-semibold text-slate-900">
                  3. Average Message Processing Time (ms)
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  Mean consumer handling latency per process stage
                </p>
              </div>
              <HorizontalMetricBars items={latencyBars} valueSuffix=" ms" barColor="bg-blue-700" />
            </div>

            <div className="bg-white border border-slate-200 rounded-xl p-5">
              <div className="mb-4">
                <h2 className="text-base font-semibold text-slate-900">
                  4. IPC Failure Frequency by Type
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  Distribution of detected communication faults across all six failure modes
                </p>
              </div>
              <HorizontalMetricBars items={failureBars} barColor="bg-red-600" />
            </div>
          </section>

          {/* Row 3: Queue Length Over Time + Process Performance */}
          <section className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="bg-white border border-slate-200 rounded-xl p-5">
              <div className="mb-3">
                <h2 className="text-base font-semibold text-slate-900">
                  5. Queue Length Over Time
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  Pending message backlog observed across RabbitMQ consumer queues
                </p>
              </div>
              <TrendLineChart
                data={queueTrend}
                strokeColor="#d97706"
                fillColor="rgba(217, 119, 6, 0.08)"
              />
            </div>

            <div className="bg-white border border-slate-200 rounded-xl p-5">
              <div className="mb-4">
                <h2 className="text-base font-semibold text-slate-900">
                  6. Process Performance Breakdown
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  Throughput, ACK reliability, average latency, and current queue depth
                </p>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-slate-200 text-slate-500 font-medium">
                      <th className="py-2 pr-3">Process</th>
                      <th className="py-2 px-3 text-right">Throughput</th>
                      <th className="py-2 px-3 text-right">Success Rate</th>
                      <th className="py-2 px-3 text-right">Avg Latency</th>
                      <th className="py-2 pl-3 text-right">Queue</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {data.processPerformance.map((p) => (
                      <tr key={p.processId}>
                        <td className="py-2.5 pr-3 font-medium text-slate-900">{p.name}</td>
                        <td className="py-2.5 px-3 text-right font-mono tabular-nums text-slate-700">
                          {p.throughput} msgs
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono tabular-nums font-semibold text-emerald-700">
                          {p.successRate}%
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono tabular-nums text-slate-700">
                          {p.avgLatencyMs} ms
                        </td>
                        <td className="py-2.5 pl-3 text-right font-mono tabular-nums text-slate-700">
                          {p.queueDepth}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </section>
        </>
      ) : null}
    </div>
  );
}
