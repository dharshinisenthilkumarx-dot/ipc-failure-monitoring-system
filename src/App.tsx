import { useCallback, useEffect, useState } from 'react';
import {
  Activity,
  AlertOctagon,
  BarChart3,
  Cpu,
  Inbox,
  LayoutDashboard,
  Menu,
  MessageSquareText,
  Pause,
  Play,
  ShoppingBag,
  X,
} from 'lucide-react';
import { AnalyticsPage } from './pages/AnalyticsPage.tsx';
import { DashboardPage } from './pages/DashboardPage.tsx';
import { DeadLetterQueuePage } from './pages/DeadLetterQueuePage.tsx';
import { FailureDetectionPage } from './pages/FailureDetectionPage.tsx';
import { MessageLogsPage } from './pages/MessageLogsPage.tsx';
import { OrdersPage } from './pages/OrdersPage.tsx';
import { ProcessMonitoringPage } from './pages/ProcessMonitoringPage.tsx';
import { SimulationPage } from './pages/SimulationPage.tsx';
import type {
  DashboardSummary,
  DeadLetterRecord,
  FailureType,
  IpcFailureRecord,
  OrderRecord,
  ProcessId,
  ProcessRecord,
  QueueMetricPoint,
  SimulationStateSnapshot,
} from './types/ipc.ts';

type PageKey =
  | 'dashboard'
  | 'orders'
  | 'simulation'
  | 'processes'
  | 'messages'
  | 'failures'
  | 'dlq'
  | 'analytics';

const NAV_ITEMS: Array<{ key: PageKey; label: string; icon: typeof LayoutDashboard }> = [
  { key: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { key: 'orders', label: 'Order Management', icon: ShoppingBag },
  { key: 'simulation', label: 'IPC Simulation', icon: Activity },
  { key: 'processes', label: 'Process Monitoring', icon: Cpu },
  { key: 'messages', label: 'Message Logs', icon: MessageSquareText },
  { key: 'failures', label: 'Failure Detection', icon: AlertOctagon },
  { key: 'dlq', label: 'Dead Letter Queue', icon: Inbox },
  { key: 'analytics', label: 'Analytics and Reports', icon: BarChart3 },
];

const EMPTY_SUMMARY: DashboardSummary = {
  totalOrdersProcessed: 0,
  messagesSent: 0,
  messagesReceived: 0,
  successfulMessages: 0,
  failedMessages: 0,
  delayedMessages: 0,
  duplicateMessages: 0,
  currentQueueLength: 0,
  overallSuccessRate: 100,
  deadLetterCount: 0,
  unresolvedFailures: 0,
};

const EMPTY_SIMULATION: SimulationStateSnapshot = {
  runState: 'STOPPED',
  tickCount: 0,
  speedMs: 1100,
  autoGenerateOrders: true,
  activePackets: [],
  processes: [],
  recentEvents: [],
  summary: EMPTY_SUMMARY,
};

export default function App() {
  const [activePage, setActivePage] = useState<PageKey>('dashboard');
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const [summary, setSummary] = useState<DashboardSummary>(EMPTY_SUMMARY);
  const [processes, setProcesses] = useState<ProcessRecord[]>([]);
  const [orders, setOrders] = useState<OrderRecord[]>([]);
  const [failures, setFailures] = useState<IpcFailureRecord[]>([]);
  const [dlqItems, setDlqItems] = useState<DeadLetterRecord[]>([]);
  const [queueHistory, setQueueHistory] = useState<QueueMetricPoint[]>([]);
  const [successVsFailed, setSuccessVsFailed] = useState<
    Array<{ label: string; successful: number; failed: number; delayed: number }>
  >([]);
  const [simulation, setSimulation] = useState<SimulationStateSnapshot>(EMPTY_SIMULATION);
  const [refreshSignal, setRefreshSignal] = useState(0);
  const [toast, setToast] = useState<{ text: string; type: 'info' | 'error' } | null>(null);

  const notify = useCallback((text: string, type: 'info' | 'error' = 'info') => {
    setToast({ text, type });
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast]);

  const fetchAllData = useCallback(async () => {
    const [dashRes, ordRes, failRes, dlqRes] = await Promise.all([
      fetch('/api/dashboard'),
      fetch('/api/orders'),
      fetch('/api/failures'),
      fetch('/api/dlq'),
    ]);
    if (dashRes.ok) {
      const dash = await dashRes.json();
      setSummary(dash.summary);
      setProcesses(dash.processes);
      setQueueHistory(dash.queueHistory ?? []);
      setSuccessVsFailed(dash.successVsFailed ?? []);
      if (dash.simulation) setSimulation(dash.simulation);
    }
    if (ordRes.ok) {
      const ord = await ordRes.json();
      setOrders(ord.orders ?? []);
    }
    if (failRes.ok) {
      const fail = await failRes.json();
      setFailures(fail.failures ?? []);
    }
    if (dlqRes.ok) {
      const dlq = await dlqRes.json();
      setDlqItems(dlq.items ?? []);
    }
    setRefreshSignal((s) => s + 1);
  }, []);

  useEffect(() => {
    void fetchAllData();
  }, [fetchAllData]);

  // Live SSE Stream Subscription
  useEffect(() => {
    const es = new EventSource('/api/stream');
    es.onmessage = (event) => {
      try {
        const snap = JSON.parse(event.data) as SimulationStateSnapshot;
        setSimulation(snap);
        setProcesses(snap.processes);
        setSummary(snap.summary);
        setRefreshSignal((s) => s + 1);
      } catch {
        // Ignore malformed frame
      }
    };
    return () => {
      es.close();
    };
  }, []);

  // Re-sync orders, failures, dlq when simulation ticks update
  useEffect(() => {
    if (refreshSignal === 0) return;
    if (activePage === 'orders' || activePage === 'failures' || activePage === 'dlq' || activePage === 'dashboard') {
      const timer = setTimeout(async () => {
        const [dashRes, ordRes, failRes, dlqRes] = await Promise.all([
          fetch('/api/dashboard'),
          fetch('/api/orders'),
          fetch('/api/failures'),
          fetch('/api/dlq'),
        ]);
        if (dashRes.ok) {
          const dash = await dashRes.json();
          setQueueHistory(dash.queueHistory ?? []);
          setSuccessVsFailed(dash.successVsFailed ?? []);
        }
        if (ordRes.ok) setOrders((await ordRes.json()).orders ?? []);
        if (failRes.ok) setFailures((await failRes.json()).failures ?? []);
        if (dlqRes.ok) setDlqItems((await dlqRes.json()).items ?? []);
      }, 180);
      return () => clearTimeout(timer);
    }
  }, [refreshSignal, activePage]);

  async function handleSimulationControl(action: string, payload?: Record<string, unknown>) {
    const res = await fetch('/api/simulation/control', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, ...payload }),
    });
    if (res.ok) {
      const snap = (await res.json()) as SimulationStateSnapshot;
      setSimulation(snap);
      setProcesses(snap.processes);
      setSummary(snap.summary);
      if (action === 'reset') {
        await fetchAllData();
        notify('Simulation and database reset to initial state.');
      }
    }
  }

  async function handleInjectFailure(failureType: FailureType, targetProcess: ProcessId) {
    const res = await fetch('/api/failures/inject', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ failureType, targetProcess }),
    });
    const data = await res.json();
    if (res.ok) {
      notify(data.result.message);
      await fetchAllData();
      return data.result;
    }
    notify(data.error || 'Failed to inject failure.', 'error');
    return null;
  }

  async function handleRecoverProcess(processId: ProcessId) {
    const res = await fetch(`/api/processes/${encodeURIComponent(processId)}/recover`, { method: 'POST' });
    if (res.ok) {
      notify(`Process ${processId} recovered and resumed consumption.`);
      await fetchAllData();
    }
  }

  async function handleCrashProcess(processId: ProcessId) {
    const res = await fetch(`/api/processes/${encodeURIComponent(processId)}/crash`, { method: 'POST' });
    if (res.ok) {
      notify(`Simulated crash on ${processId}.`, 'error');
      await fetchAllData();
    }
  }

  async function handleRetryMessage(messageId: string) {
    const res = await fetch(`/api/messages/${encodeURIComponent(messageId)}/retry`, { method: 'POST' });
    if (res.ok) {
      notify(`Retried message ${messageId}.`);
      await fetchAllData();
    } else {
      notify('Could not retry message.', 'error');
    }
  }

  async function handleResolveFailure(id: string) {
    const res = await fetch(`/api/failures/${encodeURIComponent(id)}/resolve`, { method: 'POST' });
    if (res.ok) {
      notify(`Failure ${id} marked as resolved.`);
      await fetchAllData();
    }
  }

  async function handleRequeueDlq(id: string) {
    const res = await fetch(`/api/dlq/${encodeURIComponent(id)}/requeue`, { method: 'POST' });
    if (res.ok) {
      notify(`Dead-letter message ${id} requeued into pipeline.`);
      await fetchAllData();
    }
  }

  async function handleDeleteDlq(id: string) {
    const res = await fetch(`/api/dlq/${encodeURIComponent(id)}`, { method: 'DELETE' });
    if (res.ok) {
      notify(`Removed ${id} from Dead Letter Queue.`);
      await fetchAllData();
    }
  }

  const currentNav = NAV_ITEMS.find((n) => n.key === activePage) ?? NAV_ITEMS[0];

  return (
    <div className="min-h-screen flex bg-slate-50 text-slate-900">
      {/* Mobile Backdrop */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-30 bg-slate-950/50 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Dark Navy Sidebar */}
      <aside
        className={`fixed lg:sticky top-0 left-0 z-40 h-screen w-64 shrink-0 bg-[#0b1528] text-slate-100 flex flex-col justify-between transition-transform duration-200 ${
          sidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
        }`}
      >
        <div>
          <div className="h-16 px-5 border-b border-slate-800/80 flex items-center justify-between">
            <span className="font-display font-bold text-sm tracking-tight text-white whitespace-nowrap">
              IPC Failure Monitor
            </span>
            <button
              type="button"
              onClick={() => setSidebarOpen(false)}
              className="lg:hidden p-1 text-slate-400 hover:text-white"
              aria-label="Close navigation"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <nav className="p-3 space-y-1" aria-label="Main Navigation">
            {NAV_ITEMS.map((item) => {
              const Icon = item.icon;
              const isActive = activePage === item.key;
              return (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => {
                    setActivePage(item.key);
                    setSidebarOpen(false);
                  }}
                  className={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg text-xs font-medium transition-colors whitespace-nowrap ${
                    isActive
                      ? 'bg-blue-700 text-white'
                      : 'text-slate-300 hover:bg-slate-800/70 hover:text-white'
                  }`}
                >
                  <span className="inline-flex items-center gap-2.5">
                    <Icon className="w-4 h-4 shrink-0" />
                    <span>{item.label}</span>
                  </span>
                  {item.key === 'dlq' && summary.deadLetterCount > 0 && (
                    <span className="font-mono tabular-nums text-[11px] text-rose-300">
                      {summary.deadLetterCount}
                    </span>
                  )}
                  {item.key === 'failures' && summary.unresolvedFailures > 0 && (
                    <span className="font-mono tabular-nums text-[11px] text-amber-300">
                      {summary.unresolvedFailures}
                    </span>
                  )}
                </button>
              );
            })}
          </nav>
        </div>

        <div className="p-4 border-t border-slate-800/80 text-xs text-slate-400 space-y-1">
          <div className="font-medium text-slate-200">Food Delivery Platform</div>
          <div>4-Stage RabbitMQ IPC Study</div>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex-1 min-w-0 flex flex-col">
        {/* Top Bar */}
        <header className="sticky top-0 z-20 h-16 bg-white border-b border-slate-200 px-4 sm:px-6 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setSidebarOpen(true)}
              className="lg:hidden p-2 rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-50"
              aria-label="Open navigation"
            >
              <Menu className="w-4 h-4" />
            </button>
            <div className="min-w-0">
              <div className="text-xs text-slate-500 truncate">
                IPC Failure Monitoring System / {currentNav.label}
              </div>
              <h1 className="text-base sm:text-lg font-display font-bold text-slate-900 truncate">
                {currentNav.label}
              </h1>
            </div>
          </div>

          <div className="flex items-center gap-2.5 shrink-0">
            {simulation.runState === 'RUNNING' ? (
              <button
                type="button"
                onClick={() => void handleSimulationControl('pause')}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-amber-600 hover:bg-amber-700 text-white text-xs font-medium transition-colors whitespace-nowrap shrink-0"
              >
                <Pause className="w-3.5 h-3.5" />
                Pause Broker
              </button>
            ) : (
              <button
                type="button"
                onClick={() =>
                  void handleSimulationControl(simulation.runState === 'PAUSED' ? 'resume' : 'start')
                }
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-blue-700 hover:bg-blue-800 text-white text-xs font-medium transition-colors whitespace-nowrap shrink-0"
              >
                <Play className="w-3.5 h-3.5" />
                {simulation.runState === 'PAUSED' ? 'Resume Broker' : 'Start Broker'}
              </button>
            )}
          </div>
        </header>

        {/* Non-blocking Feedback Toast */}
        {toast && (
          <div className="px-4 sm:px-6 pt-4">
            <div
              role="status"
              className={`rounded-lg border px-4 py-2.5 text-xs flex items-center justify-between gap-3 ${
                toast.type === 'error'
                  ? 'bg-red-50 border-red-200 text-red-800'
                  : 'bg-blue-50 border-blue-200 text-blue-900'
              }`}
            >
              <span>{toast.text}</span>
              <button
                type="button"
                onClick={() => setToast(null)}
                className="text-current opacity-70 hover:opacity-100"
                aria-label="Dismiss notification"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        )}

        {/* Active Page Viewport */}
        <main className="flex-1 p-4 sm:p-6 max-w-[1440px] w-full mx-auto">
          {activePage === 'dashboard' && (
            <DashboardPage
              summary={summary}
              processes={processes}
              recentFailures={failures.slice(0, 6)}
              queueHistory={queueHistory}
              successVsFailed={successVsFailed}
              simulation={simulation}
              onNavigate={(p) => setActivePage(p as PageKey)}
              onRecoverProcess={handleRecoverProcess}
            />
          )}

          {activePage === 'orders' && (
            <OrdersPage orders={orders} onRefresh={fetchAllData} onNotify={notify} />
          )}

          {activePage === 'simulation' && (
            <SimulationPage
              simulation={simulation}
              onControl={handleSimulationControl}
              onInjectFailure={handleInjectFailure}
              onRecoverProcess={handleRecoverProcess}
            />
          )}

          {activePage === 'processes' && (
            <ProcessMonitoringPage
              processes={processes}
              onCrashProcess={handleCrashProcess}
              onRecoverProcess={handleRecoverProcess}
            />
          )}

          {activePage === 'messages' && (
            <MessageLogsPage onRetryMessage={handleRetryMessage} refreshSignal={refreshSignal} />
          )}

          {activePage === 'failures' && (
            <FailureDetectionPage
              failures={failures}
              processes={processes}
              onInjectFailure={handleInjectFailure}
              onResolveFailure={handleResolveFailure}
            />
          )}

          {activePage === 'dlq' && (
            <DeadLetterQueuePage
              items={dlqItems}
              onRequeue={handleRequeueDlq}
              onDelete={handleDeleteDlq}
            />
          )}

          {activePage === 'analytics' && <AnalyticsPage refreshSignal={refreshSignal} />}
        </main>
      </div>
    </div>
  );
}
