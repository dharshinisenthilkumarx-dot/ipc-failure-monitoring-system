import { AlertCircle, CheckCircle2, Clock, Copy, PauseCircle, PlayCircle, ShieldAlert, XCircle } from 'lucide-react';

interface StatusLabelProps {
  value: string;
}

export function StatusLabel({ value }: StatusLabelProps) {
  const normalized = value.toUpperCase();

  if (
    normalized === 'COMPLETED' ||
    normalized === 'DELIVERED' ||
    normalized === 'ACKED' ||
    normalized === 'PAID' ||
    normalized === 'RESOLVED'
  ) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-700 whitespace-nowrap">
        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
        <span>{value}</span>
      </span>
    );
  }

  if (normalized === 'RUNNING' || normalized === 'IN_TRANSIT' || normalized === 'PAYMENT_VERIFIED' || normalized === 'OUT_FOR_DELIVERY') {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-blue-700 whitespace-nowrap">
        <PlayCircle className="w-3.5 h-3.5 text-blue-600 shrink-0" />
        <span>{value}</span>
      </span>
    );
  }

  if (normalized === 'WAITING' || normalized === 'QUEUED' || normalized === 'PENDING' || normalized === 'RECEIVED' || normalized === 'PREPARING') {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-700 whitespace-nowrap">
        <PauseCircle className="w-3.5 h-3.5 text-slate-500 shrink-0" />
        <span>{value}</span>
      </span>
    );
  }

  if (normalized === 'DELAYED' || normalized === 'MESSAGE_DELAY' || normalized === 'OUT_OF_ORDER') {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-amber-700 whitespace-nowrap">
        <Clock className="w-3.5 h-3.5 text-amber-600 shrink-0" />
        <span>{value}</span>
      </span>
    );
  }

  if (normalized === 'DUPLICATE_DROPPED' || normalized === 'DUPLICATE_MESSAGE' || normalized === 'REFUNDED') {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-indigo-700 whitespace-nowrap">
        <Copy className="w-3.5 h-3.5 text-indigo-600 shrink-0" />
        <span>{value}</span>
      </span>
    );
  }

  if (normalized === 'DEAD_LETTERED' || normalized === 'QUEUE_OVERFLOW') {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-rose-700 whitespace-nowrap">
        <ShieldAlert className="w-3.5 h-3.5 text-rose-600 shrink-0" />
        <span>{value}</span>
      </span>
    );
  }

  if (normalized === 'FAILED' || normalized === 'NACKED' || normalized === 'MESSAGE_LOSS' || normalized === 'PROCESS_CRASH') {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-red-700 whitespace-nowrap">
        <XCircle className="w-3.5 h-3.5 text-red-600 shrink-0" />
        <span>{value}</span>
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-700 whitespace-nowrap">
      <AlertCircle className="w-3.5 h-3.5 text-slate-500 shrink-0" />
      <span>{value}</span>
    </span>
  );
}
