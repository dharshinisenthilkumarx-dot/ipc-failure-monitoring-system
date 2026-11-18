import { useState } from 'react';

interface BarSeriesItem {
  label: string;
  successful: number;
  failed: number;
  delayed: number;
}

export function SuccessVsFailedChart({ data }: { data: BarSeriesItem[] }) {
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);
  const maxVal = Math.max(
    4,
    ...data.map((d) => Math.max(d.successful, d.failed, d.delayed))
  );

  return (
    <div className="w-full">
      <div className="flex items-center justify-end gap-5 text-xs text-slate-600 mb-3">
        <span className="inline-flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-xs bg-blue-700 inline-block" />
          Successful
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-xs bg-amber-500 inline-block" />
          Delayed
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-xs bg-red-600 inline-block" />
          Failed
        </span>
      </div>

      <div className="relative h-56 flex items-end gap-4 border-b border-slate-200 pb-2 pt-6 px-2">
        {/* Horizontal gridlines */}
        <div className="absolute inset-x-0 top-6 bottom-2 flex flex-col justify-between pointer-events-none">
          {[1, 0.75, 0.5, 0.25, 0].map((ratio) => (
            <div key={ratio} className="w-full border-t border-slate-100 relative">
              <span className="absolute -top-2.5 left-0 text-[10px] font-mono tabular-nums text-slate-400">
                {Math.round(maxVal * ratio)}
              </span>
            </div>
          ))}
        </div>

        {data.map((item, idx) => {
          const okPct = (item.successful / maxVal) * 100;
          const delPct = (item.delayed / maxVal) * 100;
          const failPct = (item.failed / maxVal) * 100;
          return (
            <div
              key={item.label}
              onMouseEnter={() => setHoveredIdx(idx)}
              onMouseLeave={() => setHoveredIdx(null)}
              className="flex-1 h-full flex flex-col justify-end items-center relative pl-4 group"
            >
              {hoveredIdx === idx && (
                <div className="absolute -top-2 z-20 bg-slate-900 text-white text-[11px] px-2.5 py-1.5 rounded-md shadow-md whitespace-nowrap pointer-events-none font-mono tabular-nums">
                  {item.label}: {item.successful} ok · {item.delayed} delayed · {item.failed} failed
                </div>
              )}
              <div className="w-full max-w-[84px] h-full flex items-end justify-center gap-1.5 z-10">
                <div
                  className="w-4 bg-blue-700 rounded-t-xs transition-all duration-200 group-hover:bg-blue-600"
                  style={{ height: `${Math.max(okPct, item.successful > 0 ? 4 : 0)}%` }}
                  title={`Successful: ${item.successful}`}
                />
                <div
                  className="w-4 bg-amber-500 rounded-t-xs transition-all duration-200 group-hover:bg-amber-400"
                  style={{ height: `${Math.max(delPct, item.delayed > 0 ? 4 : 0)}%` }}
                  title={`Delayed: ${item.delayed}`}
                />
                <div
                  className="w-4 bg-red-600 rounded-t-xs transition-all duration-200 group-hover:bg-red-500"
                  style={{ height: `${Math.max(failPct, item.failed > 0 ? 4 : 0)}%` }}
                  title={`Failed: ${item.failed}`}
                />
              </div>
            </div>
          );
        })}
      </div>

      <div className="flex gap-4 px-2 pt-2">
        {data.map((item) => (
          <div key={item.label} className="flex-1 text-center pl-4">
            <span className="text-xs font-medium text-slate-600 block truncate" title={item.label}>
              {item.label}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

interface LineSeriesPoint {
  label: string;
  value: number;
  secondary?: number;
}

export function TrendLineChart({
  data,
  unit = '',
  strokeColor = '#1d4ed8',
  fillColor = 'rgba(29, 78, 216, 0.08)',
  minZero = true,
  maxOverride,
}: {
  data: LineSeriesPoint[];
  unit?: string;
  strokeColor?: string;
  fillColor?: string;
  minZero?: boolean;
  maxOverride?: number;
}) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  if (data.length === 0) {
    return (
      <div className="h-52 flex items-center justify-center text-sm text-slate-400 border border-dashed border-slate-200 rounded-lg">
        No telemetry samples recorded yet.
      </div>
    );
  }

  const width = 620;
  const height = 190;
  const padL = 38;
  const padR = 16;
  const padT = 16;
  const padB = 28;
  const innerW = width - padL - padR;
  const innerH = height - padT - padB;

  const rawMax = Math.max(...data.map((d) => d.value), 1);
  const maxVal = maxOverride ?? Math.ceil(rawMax * 1.15);
  const minVal = minZero ? 0 : Math.floor(Math.min(...data.map((d) => d.value)) * 0.9);
  const span = Math.max(maxVal - minVal, 1);

  const coords = data.map((d, i) => {
    const x = padL + (data.length === 1 ? innerW / 2 : (i / (data.length - 1)) * innerW);
    const y = padT + innerH - ((d.value - minVal) / span) * innerH;
    return { x, y, ...d };
  });

  const linePath = coords.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');
  const areaPath = `${linePath} L ${coords[coords.length - 1].x.toFixed(1)} ${padT + innerH} L ${coords[0].x.toFixed(1)} ${padT + innerH} Z`;

  return (
    <div className="w-full relative">
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-52 overflow-visible">
        {[0, 0.25, 0.5, 0.75, 1].map((r) => {
          const y = padT + innerH * (1 - r);
          const val = Math.round(minVal + span * r);
          return (
            <g key={r}>
              <line x1={padL} y1={y} x2={width - padR} y2={y} stroke="#e2e8f0" strokeWidth="1" />
              <text x={padL - 6} y={y + 3} textAnchor="end" className="fill-slate-400 text-[10px] font-mono">
                {val}
                {unit}
              </text>
            </g>
          );
        })}

        <path d={areaPath} fill={fillColor} />
        <path d={linePath} fill="none" stroke={strokeColor} strokeWidth="2.25" strokeLinejoin="round" />

        {coords.map((pt, i) => (
          <g
            key={`${pt.label}-${i}`}
            onMouseEnter={() => setHoverIdx(i)}
            onMouseLeave={() => setHoverIdx(null)}
            className="cursor-pointer"
          >
            <circle
              cx={pt.x}
              cy={pt.y}
              r={hoverIdx === i ? 5 : 3.2}
              fill="#ffffff"
              stroke={strokeColor}
              strokeWidth="2"
            />
            {(i === 0 || i === coords.length - 1 || i % Math.max(1, Math.floor(coords.length / 5)) === 0) && (
              <text x={pt.x} y={height - 6} textAnchor="middle" className="fill-slate-400 text-[10px] font-mono">
                {pt.label}
              </text>
            )}
          </g>
        ))}

        {hoverIdx !== null && coords[hoverIdx] && (
          <g transform={`translate(${Math.min(Math.max(coords[hoverIdx].x - 52, 10), width - 125)}, ${Math.max(coords[hoverIdx].y - 34, 4)})`}>
            <rect width="112" height="24" rx="4" fill="#0f172a" />
            <text x="56" y="15.5" textAnchor="middle" className="fill-white text-[10px] font-mono">
              {coords[hoverIdx].label} · {coords[hoverIdx].value}
              {unit}
            </text>
          </g>
        )}
      </svg>
    </div>
  );
}

export function HorizontalMetricBars({
  items,
  valueSuffix = '',
  barColor = 'bg-blue-700',
}: {
  items: Array<{ label: string; value: number; subtext?: string }>;
  valueSuffix?: string;
  barColor?: string;
}) {
  const maxVal = Math.max(1, ...items.map((i) => i.value));

  return (
    <div className="space-y-3.5">
      {items.map((item) => {
        const pct = Math.min(100, Math.round((item.value / maxVal) * 100));
        return (
          <div key={item.label} className="space-y-1.5">
            <div className="flex items-center justify-between text-xs">
              <span className="font-medium text-slate-700 truncate pr-2">{item.label}</span>
              <span className="font-mono tabular-nums text-slate-900 font-semibold shrink-0">
                {item.value}
                {valueSuffix}
                {item.subtext ? <span className="text-slate-400 font-normal ml-2">{item.subtext}</span> : null}
              </span>
            </div>
            <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
              <div
                className={`h-full ${barColor} rounded-full transition-all duration-300`}
                style={{ width: `${Math.max(pct, item.value > 0 ? 3 : 0)}%` }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}
