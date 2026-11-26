import React, { useEffect, useRef, useState } from 'react';
import {
  IChartingLibraryWidget,
  ResolutionString,
  TIMEFRAME_TO_RESOLUTION,
  TradingViewLibraryAvailability,
  TradingViewNamespace,
} from './chartTypes';
import { DimonexDatafeed } from './dimonexDatafeed';
import { TimeFrame } from '../../simulation/types';
import { AlertTriangle, CheckCircle2, ExternalLink, FileCode2, ShieldAlert, ArrowRight } from 'lucide-react';

declare global {
  interface Window {
    TradingView?: TradingViewNamespace;
  }
}

export interface TradingViewChartProps {
  pairId: string;
  timeframe: TimeFrame;
  datafeed: DimonexDatafeed;
  onFallbackToPro: () => void;
}

const DEFAULT_LIBRARY_PATH =
  (typeof import.meta !== 'undefined' && (import.meta as any).env?.VITE_TRADINGVIEW_LIBRARY_PATH) ||
  '/charting_library/';

const TV_LAYOUT_STORAGE_KEY = 'silentsmile_tv_chart_layouts_v1';

function createLocalStorageSaveLoadAdapter() {
  const readAll = (): Array<{ id: string; name: string; timestamp: number; content: string }> => {
    try {
      const raw = localStorage.getItem(TV_LAYOUT_STORAGE_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  };

  const writeAll = (items: Array<{ id: string; name: string; timestamp: number; content: string }>) => {
    try {
      localStorage.setItem(TV_LAYOUT_STORAGE_KEY, JSON.stringify(items));
    } catch {}
  };

  return {
    getAllCharts: async () => readAll().map(({ id, name, timestamp }) => ({ id, name, timestamp, symbol: '', resolution: '15' })),
    removeChart: async (id: string) => {
      writeAll(readAll().filter((c) => c.id !== id));
    },
    saveChart: async (chartData: any) => {
      const id = chartData.id || `tv_${Date.now()}`;
      const list = readAll().filter((c) => c.id !== id);
      list.unshift({
        id,
        name: chartData.name || `Layout ${new Date().toLocaleTimeString('id-ID')}`,
        timestamp: Math.floor(Date.now() / 1000),
        content: chartData.content || '',
      });
      writeAll(list.slice(0, 20));
      return id;
    },
    getChartContent: async (id: string) => {
      const found = readAll().find((c) => c.id === id);
      return found?.content || '';
    },
  };
}

async function probeAndLoadTradingViewLibrary(libraryPath: string): Promise<TradingViewLibraryAvailability> {
  const cleanBase = libraryPath.endsWith('/') ? libraryPath : `${libraryPath}/`;
  const candidates = [
    `${cleanBase}charting_library.standalone.js`,
    `${cleanBase}charting_library.js`,
  ];

  if (typeof window !== 'undefined' && typeof window.TradingView?.widget === 'function') {
    return {
      status: 'available',
      libraryPath: cleanBase,
      scriptUrl: candidates[0],
      version: typeof window.TradingView.version === 'function' ? window.TradingView.version() : 'licensed',
    };
  }

  for (const scriptUrl of candidates) {
    try {
      const res = await fetch(scriptUrl, { method: 'GET' });
      const contentType = res.headers.get('content-type') || '';
      if (!res.ok || !contentType.includes('javascript')) {
        // Reject Vite SPA HTML fallback (text/html) or 404s cleanly
        continue;
      }

      await new Promise<void>((resolve, reject) => {
        const existing = document.querySelector(`script[data-tv-library="${scriptUrl}"]`);
        if (existing) {
          resolve();
          return;
        }
        const script = document.createElement('script');
        script.src = scriptUrl;
        script.async = true;
        script.dataset.tvLibrary = scriptUrl;
        script.onload = () => resolve();
        script.onerror = () => reject(new Error(`Failed to execute ${scriptUrl}`));
        document.head.appendChild(script);
      });

      if (typeof window.TradingView?.widget === 'function') {
        return {
          status: 'available',
          libraryPath: cleanBase,
          scriptUrl,
          version: typeof window.TradingView.version === 'function' ? window.TradingView.version() : 'licensed',
        };
      }
    } catch {
      // Try next candidate
    }
  }

  return {
    status: 'license_required',
    libraryPath: cleanBase,
    scriptUrl: candidates[0],
    reason:
      'Official TradingView Advanced Charts (Charting Library) distribution files were not found in public/charting_library/.',
  };
}

export const TradingViewChart: React.FC<TradingViewChartProps> = ({
  pairId,
  timeframe,
  datafeed,
  onFallbackToPro,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetRef = useRef<IChartingLibraryWidget | null>(null);
  const chartReadyRef = useRef(false);

  const [availability, setAvailability] = useState<TradingViewLibraryAvailability>({
    status: 'checking',
    libraryPath: DEFAULT_LIBRARY_PATH,
    scriptUrl: `${DEFAULT_LIBRARY_PATH}charting_library.standalone.js`,
  });
  const [datafeedReadyCheck, setDatafeedReadyCheck] = useState<'pending' | 'ready' | 'error'>('pending');
  const [symbolCheckLabel, setSymbolCheckLabel] = useState<string>('Checking...');

  const resolution: ResolutionString = TIMEFRAME_TO_RESOLUTION[timeframe] || '15';

  // Verify DimonexDatafeed contract readiness honestly
  useEffect(() => {
    let active = true;
    datafeed.onReady(() => {
      if (active) setDatafeedReadyCheck('ready');
    });

    datafeed.resolveSymbol(
      pairId,
      (info) => {
        if (active) {
          setSymbolCheckLabel(`${info.full_name} · ${info.timezone} · ${info.currency_code}`);
        }
      },
      (err) => {
        if (active) setSymbolCheckLabel(`Unavailable (${err})`);
      }
    );

    return () => {
      active = false;
    };
  }, [datafeed, pairId]);

  // Probe and mount official TradingView Charting Library Widget if licensed files are present
  useEffect(() => {
    let cancelled = false;

    const mountWidget = async () => {
      const probe = await probeAndLoadTradingViewLibrary(DEFAULT_LIBRARY_PATH);
      if (cancelled) return;
      setAvailability(probe);

      if (probe.status !== 'available' || !containerRef.current || !window.TradingView?.widget) {
        return;
      }

      if (widgetRef.current) {
        try {
          widgetRef.current.remove();
        } catch {}
        widgetRef.current = null;
        chartReadyRef.current = false;
      }

      try {
        const tvWidget = new window.TradingView.widget({
          symbol: pairId,
          interval: resolution,
          container: containerRef.current,
          datafeed,
          library_path: probe.libraryPath,
          locale: 'en',
          timezone: 'Asia/Jakarta',
          theme: 'dark',
          autosize: true,
          disabled_features: [],
          enabled_features: [
            'study_templates',
            'use_localstorage_for_settings',
            'side_toolbar_in_fullscreen_mode',
            'header_in_fullscreen_mode',
          ],
          charts_storage_api_version: '1.1',
          client_id: 'silentsmile_exchange',
          user_id: 'spot_terminal',
          save_load_adapter: createLocalStorageSaveLoadAdapter(),
          overrides: {
            'paneProperties.background': '#0B100E',
            'paneProperties.backgroundType': 'solid',
          },
        });

        widgetRef.current = tvWidget;
        tvWidget.onChartReady(() => {
          if (cancelled) return;
          chartReadyRef.current = true;
        });
      } catch (err: any) {
        if (!cancelled) {
          setAvailability({
            status: 'error',
            libraryPath: probe.libraryPath,
            scriptUrl: probe.scriptUrl,
            reason: err?.message || 'Failed to mount official TradingView widget',
          });
        }
      }
    };

    mountWidget();

    return () => {
      cancelled = true;
      chartReadyRef.current = false;
      if (widgetRef.current) {
        try {
          widgetRef.current.remove();
        } catch {}
        widgetRef.current = null;
      }
    };
  }, [datafeed]);

  // Sync symbol / resolution changes cleanly onto mounted official widget
  useEffect(() => {
    if (widgetRef.current && chartReadyRef.current) {
      try {
        widgetRef.current.setSymbol(pairId, resolution);
      } catch {}
    }
  }, [pairId, resolution]);

  if (availability.status === 'available') {
    return (
      <div className="relative flex-1 w-full h-full min-h-[380px] bg-[#0B100E]">
        <div ref={containerRef} className="absolute inset-0 w-full h-full" />
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center justify-center flex-1 w-full h-full min-h-[380px] bg-[#0B100E] p-6 text-[#F1F5F2] overflow-y-auto">
      <div className="w-full max-w-xl rounded-xl border border-[#26372D] bg-[#142019] p-6 space-y-5">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-lg bg-[#EAB866]/15 border border-[#EAB866]/30 flex items-center justify-center shrink-0">
            <ShieldAlert className="w-5 h-5 text-[#EAB866]" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-[#F1F5F2]">
              {availability.status === 'checking'
                ? 'Checking Official TradingView Advanced Charts Library...'
                : 'Official TradingView Advanced Charts Library Not Installed'}
            </h3>
            <p className="text-xs text-[#A1ADA5] mt-1 leading-relaxed">
              TradingView Advanced Charts (Charting Library) requires an official commercial license from TradingView.
              Per policy, no unofficial copy or fake SVG renderer is bundled.
            </p>
          </div>
        </div>

        <div className="rounded-lg border border-[#26372D] bg-[#101A15] p-3.5 space-y-2 text-xs">
          <div className="flex items-center justify-between">
            <span className="text-[#A1ADA5] flex items-center gap-1.5">
              <FileCode2 className="w-3.5 h-3.5 text-[#10B981]" />
              Expected Library Path
            </span>
            <code className="font-mono text-[#EAB866] text-[11px]">{availability.scriptUrl}</code>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-[#A1ADA5] flex items-center gap-1.5">
              {datafeedReadyCheck === 'ready' ? (
                <CheckCircle2 className="w-3.5 h-3.5 text-[#10B981]" />
              ) : (
                <AlertTriangle className="w-3.5 h-3.5 text-[#EAB866]" />
              )}
              SILENT SMILE Datafeed API
            </span>
            <span className="font-mono text-[11px] text-[#10B981]">
              {datafeedReadyCheck === 'ready' ? 'IDatafeedChartApi Ready' : 'Initializing'}
            </span>
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="text-[#A1ADA5] shrink-0">Active Symbol Mapping</span>
            <span className="font-mono text-[11px] text-[#F1F5F2] truncate">{symbolCheckLabel}</span>
          </div>
        </div>

        <div className="text-xs text-[#A1ADA5] space-y-1.5">
          <div className="font-medium text-[#F1F5F2]">Required to enable TradingView Advanced Charts:</div>
          <ol className="list-decimal list-inside space-y-1 text-[11px] leading-relaxed">
            <li>Obtain approved access to the official <span className="font-mono text-[#F1F5F2]">tradingview/charting_library</span> repository.</li>
            <li>Copy the official <span className="font-mono text-[#F1F5F2]">charting_library/</span> assets into <span className="font-mono text-[#F1F5F2]">public/charting_library/</span> (or set <span className="font-mono text-[#F1F5F2]">VITE_TRADINGVIEW_LIBRARY_PATH</span>).</li>
            <li>Reload this view — the adapter will automatically bind <span className="font-mono text-[#F1F5F2]">DimonexDatafeed</span> to <span className="font-mono text-[#F1F5F2]">window.TradingView.widget</span>.</li>
          </ol>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
          <a
            href="https://www.tradingview.com/HTML5-stock-forex-bitcoin-charting-library/"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-xs text-[#34D399] hover:text-[#10B981] transition-colors"
          >
            <span>TradingView Licensing Info</span>
            <ExternalLink className="w-3.5 h-3.5" />
          </a>

          <button
            type="button"
            onClick={onFallbackToPro}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[#10B981] hover:bg-[#34D399] text-[#0B100E] font-semibold text-xs transition-colors whitespace-nowrap shrink-0"
          >
            <span>Use SILENT SMILE Pro (Fallback)</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
};
