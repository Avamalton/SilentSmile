import React, { useEffect, useMemo, useRef, useState } from 'react';
import * as d3 from 'd3';
import { useSimulation } from '../../simulation/store';
import { formatCrypto, formatIDR } from '../../utils/formatters';
import {
  buildMarketDepthDataset,
  DepthPoint,
  DepthRangePct,
  DepthUnitMode,
  formatCompactIDR,
  formatCompactQty,
} from './depthChartUtils';
import { Layers, MousePointerClick } from 'lucide-react';

interface MarketDepthChartProps {
  modeSwitcherSlot?: React.ReactNode;
  onSelectPrice?: (price: number) => void;
}

const RANGE_OPTIONS: { label: string; value: DepthRangePct }[] = [
  { label: '±1%', value: 1 },
  { label: '±2%', value: 2 },
  { label: '±5%', value: 5 },
  { label: '±10%', value: 10 },
  { label: 'All', value: 'all' },
];

export const MarketDepthChart: React.FC<MarketDepthChartProps> = ({
  modeSwitcherSlot,
  onSelectPrice,
}) => {
  const { activePair, restingOrders, currentUser } = useSimulation();
  const [rangePct, setRangePct] = useState<DepthRangePct>('all');
  const [unitMode, setUnitMode] = useState<DepthUnitMode>('base');
  const [hoveredPoint, setHoveredPoint] = useState<{
    point: DepthPoint;
    x: number;
    y: number;
  } | null>(null);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [dimensions, setDimensions] = useState<{ width: number; height: number }>({
    width: 0,
    height: 0,
  });

  // Track responsive container size cleanly
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const updateSize = () => {
      const rect = el.getBoundingClientRect();
      const width = Math.floor(rect.width);
      const height = Math.floor(rect.height);
      if (width > 0 && height > 0) {
        setDimensions((prev) =>
          prev.width === width && prev.height === height ? prev : { width, height }
        );
      }
    };

    updateSize();
    const observer = new ResizeObserver(updateSize);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Clear hover state on pair or unit switch
  useEffect(() => {
    setHoveredPoint(null);
  }, [activePair.id, unitMode, rangePct]);

  const dataset = useMemo(
    () =>
      buildMarketDepthDataset(
        restingOrders,
        activePair.id,
        activePair.lastPrice,
        currentUser.id,
        rangePct,
        unitMode,
        activePair.amountDecimals
      ),
    [
      restingOrders,
      activePair.id,
      activePair.lastPrice,
      activePair.amountDecimals,
      currentUser.id,
      rangePct,
      unitMode,
    ]
  );

  const hasLiquidity = dataset.bids.length > 0 || dataset.asks.length > 0;

  // Render D3 depth chart into SVG
  useEffect(() => {
    const svgEl = svgRef.current;
    if (!svgEl || dimensions.width < 120 || dimensions.height < 100) return;

    const svg = d3.select(svgEl);
    svg.selectAll('*').remove();

    const width = dimensions.width;
    const height = dimensions.height;
    const margin = { top: 24, right: 64, bottom: 28, left: 16 };
    const innerWidth = Math.max(40, width - margin.left - margin.right);
    const innerHeight = Math.max(40, height - margin.top - margin.bottom);

    svg.attr('viewBox', `0 0 ${width} ${height}`);

    const defs = svg.append('defs');

    // Clip path strictly confines step curves to plot region
    defs
      .append('clipPath')
      .attr('id', 'depth-plot-clip')
      .append('rect')
      .attr('x', 0)
      .attr('y', 0)
      .attr('width', innerWidth)
      .attr('height', innerHeight);

    // Restrained Emerald gradient for Bid pressure
    const bidGrad = defs
      .append('linearGradient')
      .attr('id', 'depth-bid-gradient')
      .attr('x1', '0%')
      .attr('y1', '0%')
      .attr('x2', '0%')
      .attr('y2', '100%');
    bidGrad.append('stop').attr('offset', '0%').attr('stop-color', '#10B981').attr('stop-opacity', 0.28);
    bidGrad.append('stop').attr('offset', '100%').attr('stop-color', '#10B981').attr('stop-opacity', 0.02);

    // Restrained Muted Red gradient for Ask pressure
    const askGrad = defs
      .append('linearGradient')
      .attr('id', 'depth-ask-gradient')
      .attr('x1', '0%')
      .attr('y1', '0%')
      .attr('x2', '0%')
      .attr('y2', '100%');
    askGrad.append('stop').attr('offset', '0%').attr('stop-color', '#EF6464').attr('stop-opacity', 0.28);
    askGrad.append('stop').attr('offset', '100%').attr('stop-color', '#EF6464').attr('stop-opacity', 0.02);

    const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);

    const xScale = d3
      .scaleLinear()
      .domain([dataset.domainMin, dataset.domainMax])
      .range([0, innerWidth]);

    const yMaxPadded = dataset.maxCumValue * 1.12;
    const yScale = d3
      .scaleLinear()
      .domain([0, yMaxPadded])
      .nice(5)
      .range([innerHeight, 0]);

    // Subtle horizontal & vertical institutional gridlines
    const yTicks = yScale.ticks(5);
    g.append('g')
      .attr('class', 'depth-grid-y')
      .selectAll('line')
      .data(yTicks)
      .enter()
      .append('line')
      .attr('x1', 0)
      .attr('x2', innerWidth)
      .attr('y1', (d) => yScale(d))
      .attr('y2', (d) => yScale(d))
      .attr('stroke', '#26372D')
      .attr('stroke-opacity', 0.55)
      .attr('stroke-dasharray', '2,3');

    const xTickCount = Math.max(4, Math.min(8, Math.floor(innerWidth / 110)));
    const xTicks = xScale.ticks(xTickCount);
    g.append('g')
      .attr('class', 'depth-grid-x')
      .selectAll('line')
      .data(xTicks)
      .enter()
      .append('line')
      .attr('x1', (d) => xScale(d))
      .attr('x2', (d) => xScale(d))
      .attr('y1', 0)
      .attr('y2', innerHeight)
      .attr('stroke', '#26372D')
      .attr('stroke-opacity', 0.35)
      .attr('stroke-dasharray', '2,3');

    const valOf = (d: DepthPoint) => (unitMode === 'quote' ? d.cumQuote : d.cumBase);

    const plotLayer = g.append('g').attr('clip-path', 'url(#depth-plot-clip)');

    // Build Bid cumulative step geometry (left of spread, curveStepBefore)
    if (dataset.bids.length > 0) {
      const bidStepData: { price: number; val: number }[] = [];
      const firstBid = dataset.bids[0];
      const lastBid = dataset.bids[dataset.bids.length - 1];
      if (firstBid.price > dataset.domainMin) {
        bidStepData.push({ price: dataset.domainMin, val: valOf(firstBid) });
      }
      for (const b of dataset.bids) {
        bidStepData.push({ price: b.price, val: valOf(b) });
      }
      bidStepData.push({ price: lastBid.price, val: 0 });

      const bidAreaGen = d3
        .area<{ price: number; val: number }>()
        .x((d) => xScale(d.price))
        .y0(innerHeight)
        .y1((d) => yScale(d.val))
        .curve(d3.curveStepBefore);

      const bidLineGen = d3
        .line<{ price: number; val: number }>()
        .x((d) => xScale(d.price))
        .y((d) => yScale(d.val))
        .curve(d3.curveStepBefore);

      plotLayer
        .append('path')
        .datum(bidStepData)
        .attr('d', bidAreaGen)
        .attr('fill', 'url(#depth-bid-gradient)');

      plotLayer
        .append('path')
        .datum(bidStepData)
        .attr('d', bidLineGen)
        .attr('fill', 'none')
        .attr('stroke', '#10B981')
        .attr('stroke-width', 1.75);
    }

    // Build Ask cumulative step geometry (right of spread, curveStepAfter)
    if (dataset.asks.length > 0) {
      const askStepData: { price: number; val: number }[] = [];
      const firstAsk = dataset.asks[0];
      const lastAsk = dataset.asks[dataset.asks.length - 1];
      askStepData.push({ price: firstAsk.price, val: 0 });
      for (const a of dataset.asks) {
        askStepData.push({ price: a.price, val: valOf(a) });
      }
      if (lastAsk.price < dataset.domainMax) {
        askStepData.push({ price: dataset.domainMax, val: valOf(lastAsk) });
      }

      const askAreaGen = d3
        .area<{ price: number; val: number }>()
        .x((d) => xScale(d.price))
        .y0(innerHeight)
        .y1((d) => yScale(d.val))
        .curve(d3.curveStepAfter);

      const askLineGen = d3
        .line<{ price: number; val: number }>()
        .x((d) => xScale(d.price))
        .y((d) => yScale(d.val))
        .curve(d3.curveStepAfter);

      plotLayer
        .append('path')
        .datum(askStepData)
        .attr('d', askAreaGen)
        .attr('fill', 'url(#depth-ask-gradient)');

      plotLayer
        .append('path')
        .datum(askStepData)
        .attr('d', askLineGen)
        .attr('fill', 'none')
        .attr('stroke', '#EF6464')
        .attr('stroke-width', 1.75);
    }

    // Highlight Liquidity Walls (subtle amber markers on the step vertices)
    const wallPoints = [...dataset.bids, ...dataset.asks].filter(
      (p) => p.isWall && p.price >= dataset.domainMin && p.price <= dataset.domainMax
    );
    if (wallPoints.length > 0) {
      plotLayer
        .selectAll('circle.depth-wall-dot')
        .data(wallPoints)
        .enter()
        .append('circle')
        .attr('class', 'depth-wall-dot')
        .attr('cx', (d) => xScale(d.price))
        .attr('cy', (d) => yScale(valOf(d)))
        .attr('r', 3.5)
        .attr('fill', '#EAB866')
        .attr('stroke', '#0B100E')
        .attr('stroke-width', 1.2);
    }

    // Highlight Trader's Own Resting Orders
    const myOrderPoints = [...dataset.bids, ...dataset.asks].filter(
      (p) => p.myOrderAmount > 0 && p.price >= dataset.domainMin && p.price <= dataset.domainMax
    );
    if (myOrderPoints.length > 0) {
      plotLayer
        .selectAll('rect.depth-my-order')
        .data(myOrderPoints)
        .enter()
        .append('rect')
        .attr('class', 'depth-my-order')
        .attr('x', (d) => xScale(d.price) - 3)
        .attr('y', (d) => yScale(valOf(d)) - 3)
        .attr('width', 6)
        .attr('height', 6)
        .attr('rx', 1)
        .attr('fill', '#34D399')
        .attr('stroke', '#0B100E')
        .attr('stroke-width', 1);
    }

    // Mid-Price Center Line
    if (dataset.midPrice >= dataset.domainMin && dataset.midPrice <= dataset.domainMax) {
      const midX = xScale(dataset.midPrice);
      g.append('line')
        .attr('x1', midX)
        .attr('x2', midX)
        .attr('y1', 0)
        .attr('y2', innerHeight)
        .attr('stroke', '#A1ADA5')
        .attr('stroke-opacity', 0.45)
        .attr('stroke-width', 1)
        .attr('stroke-dasharray', '3,3');

      g.append('text')
        .attr('x', midX)
        .attr('y', -8)
        .attr('text-anchor', 'middle')
        .attr('fill', '#A1ADA5')
        .attr('font-size', '10px')
        .attr('font-family', 'JetBrains Mono, monospace')
        .text(`Mid ${formatIDR(dataset.midPrice)}`);
    }

    // Bottom Price Axis
    const xAxis = d3
      .axisBottom(xScale)
      .ticks(xTickCount)
      .tickSize(4)
      .tickPadding(6)
      .tickFormat((d) => formatCompactIDR(Number(d)));

    const xAxisG = g
      .append('g')
      .attr('transform', `translate(0,${innerHeight})`)
      .call(xAxis);
    xAxisG.select('.domain').attr('stroke', '#26372D');
    xAxisG.selectAll('.tick line').attr('stroke', '#26372D');
    xAxisG
      .selectAll('.tick text')
      .attr('fill', '#A1ADA5')
      .attr('font-size', '10px')
      .attr('font-family', 'JetBrains Mono, monospace');

    // Right Cumulative Depth Axis
    const yAxis = d3
      .axisRight(yScale)
      .ticks(5)
      .tickSize(4)
      .tickPadding(6)
      .tickFormat((d) =>
        unitMode === 'quote'
          ? formatCompactIDR(Number(d))
          : formatCompactQty(Number(d), activePair.amountDecimals)
      );

    const yAxisG = g
      .append('g')
      .attr('transform', `translate(${innerWidth},0)`)
      .call(yAxis);
    yAxisG.select('.domain').attr('stroke', '#26372D');
    yAxisG.selectAll('.tick line').attr('stroke', '#26372D');
    yAxisG
      .selectAll('.tick text')
      .attr('fill', '#A1ADA5')
      .attr('font-size', '10px')
      .attr('font-family', 'JetBrains Mono, monospace');

    // Interactive Crosshair Layer
    const focusGroup = g.append('g').style('display', 'none');

    const focusLineX = focusGroup
      .append('line')
      .attr('y1', 0)
      .attr('y2', innerHeight)
      .attr('stroke', '#647168')
      .attr('stroke-width', 1)
      .attr('stroke-dasharray', '3,3');

    const focusLineY = focusGroup
      .append('line')
      .attr('x1', 0)
      .attr('x2', innerWidth)
      .attr('stroke', '#647168')
      .attr('stroke-width', 1)
      .attr('stroke-dasharray', '3,3');

    const focusCircle = focusGroup
      .append('circle')
      .attr('r', 4.5)
      .attr('stroke', '#0B100E')
      .attr('stroke-width', 1.5);

    const bidBisect = d3.bisector((d: DepthPoint) => d.price).left;
    const askBisect = d3.bisector((d: DepthPoint) => d.price).right;

    const findNearestDepthPoint = (mousePrice: number): DepthPoint | null => {
      if (dataset.bids.length === 0 && dataset.asks.length === 0) return null;

      if (mousePrice <= dataset.midPrice && dataset.bids.length > 0) {
        const idx = Math.min(
          dataset.bids.length - 1,
          Math.max(0, bidBisect(dataset.bids, mousePrice))
        );
        return dataset.bids[idx];
      }
      if (mousePrice > dataset.midPrice && dataset.asks.length > 0) {
        const idx = Math.min(
          dataset.asks.length - 1,
          Math.max(0, askBisect(dataset.asks, mousePrice) - 1)
        );
        return dataset.asks[idx];
      }
      if (dataset.bids.length > 0) return dataset.bids[dataset.bids.length - 1];
      return dataset.asks[0] || null;
    };

    const overlay = g
      .append('rect')
      .attr('width', innerWidth)
      .attr('height', innerHeight)
      .attr('fill', 'transparent')
      .style('cursor', onSelectPrice ? 'crosshair' : 'default');

    overlay
      .on('mousemove', function (event) {
        const [mx] = d3.pointer(event, this);
        const mousePrice = xScale.invert(mx);
        const point = findNearestDepthPoint(mousePrice);
        if (!point) {
          focusGroup.style('display', 'none');
          setHoveredPoint(null);
          return;
        }

        const px = Math.max(0, Math.min(innerWidth, xScale(point.price)));
        const py = Math.max(0, Math.min(innerHeight, yScale(valOf(point))));
        const sideColor = point.side === 'buy' ? '#10B981' : '#EF6464';

        focusGroup.style('display', null);
        focusLineX.attr('x1', px).attr('x2', px);
        focusLineY.attr('y1', py).attr('y2', py);
        focusCircle.attr('cx', px).attr('cy', py).attr('fill', sideColor);

        setHoveredPoint({
          point,
          x: margin.left + px,
          y: margin.top + py,
        });
      })
      .on('mouseleave', () => {
        focusGroup.style('display', 'none');
        setHoveredPoint(null);
      })
      .on('click', function (event) {
        if (!onSelectPrice) return;
        const [mx] = d3.pointer(event, this);
        const point = findNearestDepthPoint(xScale.invert(mx));
        if (point) {
          onSelectPrice(point.price);
        }
      });
  }, [dataset, dimensions, unitMode, activePair.amountDecimals, onSelectPrice]);

  // Compute tooltip anchor position so it never overflows SVG bounds
  const tooltipStyle = useMemo(() => {
    if (!hoveredPoint || dimensions.width === 0) return undefined;
    const preferLeft = hoveredPoint.x > dimensions.width * 0.58;
    const clampedTop = Math.max(12, Math.min(dimensions.height - 140, hoveredPoint.y - 20));
    return preferLeft
      ? { right: `${Math.max(16, dimensions.width - hoveredPoint.x + 14)}px`, top: `${clampedTop}px` }
      : { left: `${Math.max(16, hoveredPoint.x + 14)}px`, top: `${clampedTop}px` };
  }, [hoveredPoint, dimensions]);

  return (
    <div className="flex flex-col h-full w-full glass-panel rounded-xl overflow-hidden">
      {/* Top Toolbar */}
      <div className="flex flex-wrap items-center justify-between px-3 py-2 border-b border-[#26372D] bg-[#101A15] gap-2">
        <div className="flex flex-wrap items-center gap-2">
          {modeSwitcherSlot}

          {/* Range / Zoom Controls */}
          <div className="flex items-center bg-[#0B100E] rounded-lg p-0.5 border border-[#26372D]">
            {RANGE_OPTIONS.map((opt) => (
              <button
                key={String(opt.value)}
                type="button"
                onClick={() => setRangePct(opt.value)}
                className={`px-2 py-1 text-xs font-mono rounded-md transition-colors whitespace-nowrap shrink-0 ${
                  rangePct === opt.value
                    ? 'bg-[#064E3B]/60 text-[#34D399] border border-[#10B981]/40 font-semibold'
                    : 'text-[#A1ADA5] hover:text-[#F1F5F2] hover:bg-[#192820]'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>

          {/* Base vs IDR Value Toggle */}
          <div className="flex items-center bg-[#0B100E] rounded-lg p-0.5 border border-[#26372D]">
            <button
              type="button"
              onClick={() => setUnitMode('base')}
              className={`px-2 py-1 text-[11px] font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                unitMode === 'base'
                  ? 'bg-[#192820] text-[#F1F5F2] border border-[#26372D]'
                  : 'text-[#A1ADA5] hover:text-[#F1F5F2]'
              }`}
            >
              {activePair.baseAsset} Depth
            </button>
            <button
              type="button"
              onClick={() => setUnitMode('quote')}
              className={`px-2 py-1 text-[11px] font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                unitMode === 'quote'
                  ? 'bg-[#192820] text-[#F1F5F2] border border-[#26372D]'
                  : 'text-[#A1ADA5] hover:text-[#F1F5F2]'
              }`}
            >
              IDR Value
            </button>
          </div>
        </div>

        <div className="flex items-center gap-2 text-xs font-mono tabular-nums text-[#A1ADA5]">
          <span>{activePair.id}</span>
          <span aria-hidden="true">·</span>
          <span>Spread {formatIDR(dataset.spread)} ({dataset.spreadPercent}%)</span>
        </div>
      </div>

      {/* Cumulative Buy / Sell Liquidity Pressure Summary Strip */}
      <div className="px-3 py-2 border-b border-[#26372D] bg-[#142019] flex flex-wrap items-center justify-between gap-3 text-xs">
        <div className="flex items-center gap-4 tabular-nums">
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-xs bg-[#10B981] shrink-0" />
            <span className="text-[#A1ADA5]">Bids:</span>
            <span className="font-mono font-semibold text-[#10B981]">
              {formatCrypto(dataset.totalBidBase, activePair.amountDecimals)} {activePair.baseAsset}
            </span>
            <span className="text-[#647168] font-mono hidden sm:inline">
              ({formatCompactIDR(dataset.totalBidQuote)} IDR)
            </span>
          </div>

          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-xs bg-[#EF6464] shrink-0" />
            <span className="text-[#A1ADA5]">Asks:</span>
            <span className="font-mono font-semibold text-[#EF6464]">
              {formatCrypto(dataset.totalAskBase, activePair.amountDecimals)} {activePair.baseAsset}
            </span>
            <span className="text-[#647168] font-mono hidden sm:inline">
              ({formatCompactIDR(dataset.totalAskQuote)} IDR)
            </span>
          </div>
        </div>

        {/* Bid vs Ask Imbalance Bar */}
        <div className="flex items-center gap-2 min-w-[180px] ml-auto">
          <span className="font-mono tabular-nums text-[11px] font-semibold text-[#10B981]">
            {dataset.bidPressurePct.toFixed(1)}%
          </span>
          <div className="flex-1 h-1.5 bg-[#0B100E] rounded-sm overflow-hidden flex border border-[#26372D]">
            <div
              className="h-full bg-[#10B981] transition-all duration-200"
              style={{ width: `${dataset.bidPressurePct}%` }}
            />
            <div
              className="h-full bg-[#EF6464] transition-all duration-200"
              style={{ width: `${dataset.askPressurePct}%` }}
            />
          </div>
          <span className="font-mono tabular-nums text-[11px] font-semibold text-[#EF6464]">
            {dataset.askPressurePct.toFixed(1)}%
          </span>
        </div>
      </div>

      {/* Main D3 Chart Viewport */}
      <div ref={containerRef} className="relative flex-1 min-h-0 bg-[#0B100E] select-none">
        {hasLiquidity ? (
          <svg
            ref={svgRef}
            className="w-full h-full block"
            role="img"
            aria-label={`Cumulative market depth chart for ${activePair.id}`}
          />
        ) : (
          <div className="flex flex-col items-center justify-center h-full text-center px-6">
            <div className="w-10 h-10 rounded-lg bg-[#142019] border border-[#26372D] flex items-center justify-center mb-3">
              <Layers className="w-5 h-5 text-[#647168]" />
            </div>
            <p className="text-sm font-medium text-[#F1F5F2]">No Resting Order Book Liquidity</p>
            <p className="text-xs text-[#A1ADA5] max-w-sm mt-1">
              Place limit buy or sell orders—or activate a Market Maker bot—to render cumulative buy and sell pressure for {activePair.id}.
            </p>
          </div>
        )}

        {/* Interactive Crosshair Hover Tooltip */}
        {hoveredPoint && tooltipStyle && hasLiquidity && (
          <div
            style={tooltipStyle}
            className="pointer-events-none absolute z-20 w-56 rounded-lg bg-[#142019]/95 border border-[#26372D] p-2.5 text-xs shadow-lg"
          >
            <div className="flex items-center justify-between pb-1.5 mb-1.5 border-b border-[#26372D]">
              <span
                className={`font-semibold ${
                  hoveredPoint.point.side === 'buy' ? 'text-[#10B981]' : 'text-[#EF6464]'
                }`}
              >
                {hoveredPoint.point.side === 'buy' ? 'Bid Liquidity' : 'Ask Liquidity'}
              </span>
              <span className="font-mono tabular-nums text-[11px] text-[#A1ADA5]">
                {hoveredPoint.point.pctFromMid >= 0 ? '+' : ''}
                {hoveredPoint.point.pctFromMid.toFixed(2)}%
              </span>
            </div>

            <div className="space-y-1 tabular-nums">
              <div className="flex items-center justify-between">
                <span className="text-[#A1ADA5]">Price</span>
                <span className="font-mono font-semibold text-[#F1F5F2]">
                  {formatIDR(hoveredPoint.point.price)}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[#A1ADA5]">Level Size</span>
                <span className="font-mono text-[#F1F5F2]">
                  {formatCrypto(hoveredPoint.point.amount, activePair.amountDecimals)} {activePair.baseAsset}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[#A1ADA5]">Cumulative</span>
                <span
                  className={`font-mono font-semibold ${
                    hoveredPoint.point.side === 'buy' ? 'text-[#34D399]' : 'text-[#EF6464]'
                  }`}
                >
                  {formatCrypto(hoveredPoint.point.cumBase, activePair.amountDecimals)} {activePair.baseAsset}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[#A1ADA5]">Total Value</span>
                <span className="font-mono text-[#F1F5F2]">
                  {formatIDR(hoveredPoint.point.cumQuote)}
                </span>
              </div>
            </div>

            {(hoveredPoint.point.isWall || hoveredPoint.point.myOrderAmount > 0 || onSelectPrice) && (
              <div className="mt-1.5 pt-1.5 border-t border-[#26372D] flex items-center justify-between text-[10px]">
                <div className="flex items-center gap-2">
                  {hoveredPoint.point.isWall && (
                    <span className="font-mono font-semibold text-[#EAB866]">WALL</span>
                  )}
                  {hoveredPoint.point.myOrderAmount > 0 && (
                    <span className="font-mono font-semibold text-[#34D399]">
                      YOU: {formatCrypto(hoveredPoint.point.myOrderAmount, activePair.amountDecimals)}
                    </span>
                  )}
                </div>
                {onSelectPrice && (
                  <span className="text-[#647168] flex items-center gap-1 ml-auto">
                    <MousePointerClick className="w-3 h-3" />
                    <span>Click to fill</span>
                  </span>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
