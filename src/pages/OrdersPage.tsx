import { useState, type FormEvent } from 'react';
import { Plus, Send, Trash2 } from 'lucide-react';
import { StatusLabel } from '../components/StatusLabel.tsx';
import type { OrderRecord, OrderStatus, PaymentStatus } from '../types/ipc.ts';

interface OrdersPageProps {
  orders: OrderRecord[];
  onRefresh: () => Promise<void>;
  onNotify: (msg: string, type?: 'info' | 'error') => void;
}

const ORDER_STATUSES: OrderStatus[] = [
  'RECEIVED',
  'PAYMENT_VERIFIED',
  'PREPARING',
  'OUT_FOR_DELIVERY',
  'DELIVERED',
  'FAILED',
];

const PAYMENT_STATUSES: PaymentStatus[] = ['PENDING', 'PAID', 'FAILED', 'REFUNDED'];

export function OrdersPage({ orders, onRefresh, onNotify }: OrdersPageProps) {
  const [orderId, setOrderId] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [foodItem, setFoodItem] = useState('');
  const [amount, setAmount] = useState('18.50');
  const [paymentStatus, setPaymentStatus] = useState<PaymentStatus>('PENDING');
  const [autoDispatch, setAutoDispatch] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [search, setSearch] = useState('');

  async function handleCreateOrder(e: FormEvent) {
    e.preventDefault();
    if (!customerName.trim() || !foodItem.trim()) {
      onNotify('Customer name and food item are required.', 'error');
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch('/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: orderId.trim() || undefined,
          customer_name: customerName.trim(),
          food_item: foodItem.trim(),
          amount: Number(amount),
          payment_status: paymentStatus,
          dispatch: autoDispatch,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        onNotify(data.error || 'Failed to create order.', 'error');
      } else {
        setOrderId('');
        setCustomerName('');
        setFoodItem('');
        setAmount('18.50');
        setPaymentStatus('PENDING');
        onNotify(
          `Order ${data.order.id} created${autoDispatch ? ' and dispatched to Order Receiver' : ''}.`
        );
        await onRefresh();
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function handleStatusUpdate(id: string, field: 'order_status' | 'payment_status', value: string) {
    const res = await fetch(`/api/orders/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ [field]: value }),
    });
    if (res.ok) {
      onNotify(`Updated ${id} (${field.replace('_', ' ')} -> ${value}).`);
      await onRefresh();
    } else {
      onNotify('Failed to update order.', 'error');
    }
  }

  async function handleDispatch(id: string) {
    const res = await fetch(`/api/orders/${encodeURIComponent(id)}/dispatch`, { method: 'POST' });
    if (res.ok) {
      onNotify(`Dispatched ${id} into Order Receiver queue.`);
      await onRefresh();
    } else {
      onNotify('Failed to dispatch order.', 'error');
    }
  }

  async function handleDelete(id: string) {
    const res = await fetch(`/api/orders/${encodeURIComponent(id)}`, { method: 'DELETE' });
    if (res.ok) {
      onNotify(`Deleted order ${id}.`);
      await onRefresh();
    } else {
      onNotify('Failed to delete order.', 'error');
    }
  }

  const filtered = orders.filter((o) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      o.id.toLowerCase().includes(q) ||
      o.customer_name.toLowerCase().includes(q) ||
      o.food_item.toLowerCase().includes(q) ||
      o.correlation_id.toLowerCase().includes(q)
    );
  });

  return (
    <div className="space-y-6">
      {/* Add New Order Form */}
      <section className="bg-white border border-slate-200 rounded-xl p-5">
        <div className="mb-4">
          <h2 className="text-base font-semibold text-slate-900">Create Food Delivery Order</h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Submit a new order into the MySQL/SQLite persistence layer and optionally publish an ORDER_CREATED frame to RabbitMQ
          </p>
        </div>

        <form onSubmit={handleCreateOrder} className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-6 gap-4 items-end">
          <div>
            <label htmlFor="ord-id" className="block text-xs font-medium text-slate-700 mb-1.5">
              Order ID (optional)
            </label>
            <input
              id="ord-id"
              type="text"
              value={orderId}
              onChange={(e) => setOrderId(e.target.value)}
              placeholder="Auto (e.g. ORD-1142)"
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600 font-mono"
            />
          </div>

          <div>
            <label htmlFor="cust-name" className="block text-xs font-medium text-slate-700 mb-1.5">
              Customer Name
            </label>
            <input
              id="cust-name"
              type="text"
              required
              value={customerName}
              onChange={(e) => setCustomerName(e.target.value)}
              placeholder="e.g. Ananya Rao"
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
            />
          </div>

          <div className="lg:col-span-2">
            <label htmlFor="food-item" className="block text-xs font-medium text-slate-700 mb-1.5">
              Food Item
            </label>
            <input
              id="food-item"
              type="text"
              required
              value={foodItem}
              onChange={(e) => setFoodItem(e.target.value)}
              placeholder="e.g. Paneer Butter Masala & Naan"
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
            />
          </div>

          <div>
            <label htmlFor="ord-amount" className="block text-xs font-medium text-slate-700 mb-1.5">
              Order Amount ($)
            </label>
            <input
              id="ord-amount"
              type="number"
              step="0.01"
              min="1"
              required
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600 font-mono tabular-nums"
            />
          </div>

          <div>
            <label htmlFor="pay-status" className="block text-xs font-medium text-slate-700 mb-1.5">
              Payment Status
            </label>
            <select
              id="pay-status"
              value={paymentStatus}
              onChange={(e) => setPaymentStatus(e.target.value as PaymentStatus)}
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-600"
            >
              {PAYMENT_STATUSES.map((ps) => (
                <option key={ps} value={ps}>
                  {ps}
                </option>
              ))}
            </select>
          </div>

          <div className="md:col-span-2 lg:col-span-6 flex flex-wrap items-center justify-between gap-4 pt-2 border-t border-slate-100">
            <label className="inline-flex items-center gap-2 text-xs text-slate-700 cursor-pointer">
              <input
                type="checkbox"
                checked={autoDispatch}
                onChange={(e) => setAutoDispatch(e.target.checked)}
                className="rounded border-slate-300 text-blue-700 focus:ring-blue-600"
              />
              Immediately publish ORDER_CREATED message through 4-stage IPC pipeline
            </label>

            <button
              type="submit"
              disabled={submitting}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-blue-700 hover:bg-blue-800 disabled:opacity-60 text-white text-xs font-medium transition-colors whitespace-nowrap"
            >
              <Plus className="w-4 h-4" />
              {submitting ? 'Creating Order...' : 'Add Order'}
            </button>
          </div>
        </form>
      </section>

      {/* Orders Table */}
      <section className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200 flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="text-base font-semibold text-slate-900">All Food Delivery Orders</h2>
            <p className="text-xs text-slate-500 mt-0.5 font-mono tabular-nums">
              {filtered.length} records shown · {orders.length} total stored
            </p>
          </div>

          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search Order ID, customer, item, or correlation ID..."
            className="w-full sm:w-80 px-3 py-1.5 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
          />
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50/70 text-xs font-medium text-slate-500">
                <th className="py-2.5 px-4">Order ID</th>
                <th className="py-2.5 px-4">Customer</th>
                <th className="py-2.5 px-4">Food Item</th>
                <th className="py-2.5 px-4 text-right">Amount</th>
                <th className="py-2.5 px-4">Payment Status</th>
                <th className="py-2.5 px-4">Order Status</th>
                <th className="py-2.5 px-4">Correlation ID</th>
                <th className="py-2.5 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-sm">
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-10 text-center text-slate-400">
                    No matching orders found. Add a new food order above to get started.
                  </td>
                </tr>
              ) : (
                filtered.map((order) => (
                  <tr key={order.id} className="hover:bg-slate-50/80 transition-colors">
                    <td className="py-2.5 px-4 font-mono text-xs font-semibold text-slate-900 whitespace-nowrap">
                      {order.id}
                    </td>
                    <td className="py-2.5 px-4 text-slate-800 whitespace-nowrap">{order.customer_name}</td>
                    <td className="py-2.5 px-4 text-slate-600 max-w-[240px] truncate" title={order.food_item}>
                      {order.food_item}
                    </td>
                    <td className="py-2.5 px-4 text-right font-mono text-xs tabular-nums text-slate-900 whitespace-nowrap">
                      ${order.amount.toFixed(2)}
                    </td>
                    <td className="py-2.5 px-4">
                      <select
                        aria-label={`Payment status for ${order.id}`}
                        value={order.payment_status}
                        onChange={(e) => handleStatusUpdate(order.id, 'payment_status', e.target.value)}
                        className="text-xs border border-slate-200 rounded-md px-2 py-1 bg-white focus:outline-none focus:ring-2 focus:ring-blue-600"
                      >
                        {PAYMENT_STATUSES.map((ps) => (
                          <option key={ps} value={ps}>
                            {ps}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="py-2.5 px-4">
                      <div className="flex items-center gap-2">
                        <StatusLabel value={order.order_status} />
                        <select
                          aria-label={`Order status for ${order.id}`}
                          value={order.order_status}
                          onChange={(e) => handleStatusUpdate(order.id, 'order_status', e.target.value)}
                          className="text-xs border border-slate-200 rounded-md px-2 py-1 bg-white focus:outline-none focus:ring-2 focus:ring-blue-600"
                        >
                          {ORDER_STATUSES.map((os) => (
                            <option key={os} value={os}>
                              {os}
                            </option>
                          ))}
                        </select>
                      </div>
                    </td>
                    <td className="py-2.5 px-4 font-mono text-xs text-slate-500 whitespace-nowrap">
                      {order.correlation_id}
                    </td>
                    <td className="py-2.5 px-4 text-right whitespace-nowrap">
                      <div className="inline-flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => handleDispatch(order.id)}
                          title="Dispatch through IPC pipeline"
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md border border-slate-200 hover:bg-blue-50 hover:border-blue-200 text-xs font-medium text-blue-700 transition-colors"
                        >
                          <Send className="w-3 h-3" />
                          Dispatch
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDelete(order.id)}
                          title="Delete order"
                          className="inline-flex items-center justify-center p-1.5 rounded-md border border-slate-200 hover:bg-red-50 hover:border-red-200 text-red-600 transition-colors"
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
    </div>
  );
}
