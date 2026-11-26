# SilentSmile Exchange — Spot Trading Simulator

> "Trade with clarity."

**SilentSmile Exchange** is a centralized exchange-style spot trading simulator focused on Indonesian Rupiah (IDR) pairs and simulated local tokens (including the archetype **DNA/IDR** local token). Designed with premium dark glassmorphism, a high-density pro-trader terminal, real-time simulated order matching, and a comprehensive virtual portfolio.

---

## ⚠️ Important Simulation Notice

**THIS IS A PRACTICE SIMULATION ENVIRONMENT ONLY.**
* All balances, prices, order executions, trades, portfolio values, and market activity are **DEMO / SYNTHETIC**.
* No real fiat deposits, cryptocurrency custody, payment processing, or blockchain transactions are supported or initiated.
* All figures are expressed in simulated Indonesian Rupiah (IDR) and demonstration token archetypes.

---

## Key Features

1. **Pro-Trader Terminal (`/trade/[pair]`)**
   - Interactive candlestick charts powered by Lightweight Charts with volume histograms, moving averages (MA7, MA25), crosshairs, and timeframe selectors (`1m`, `5m`, `15m`, `1h`, `4h`, `1D`).
   - Real-time two-sided Order Book with bid/ask depth visualization, spread metrics, and one-click price prefill.
   - Segmented Market and Limit order form with percentage shortcuts (`25%`, `50%`, `75%`, `100%`), real-time fee calculation, balance reservation, and confirmation modal.
   - Real-time Open Orders and personal trade execution logs with cancellation.

2. **Market Overview & Discovery (`/`, `/markets`)**
   - High-density market overview with multi-criteria filtering (All, Favorites, Gainers, Losers, Local Tokens).
   - Dynamic 7-day SVG sparkline trend graphs.
   - Interactive column sorting by price, 24h change, and volume.

3. **Virtual Portfolio Dashboard (`/portfolio`)**
   - Mark-to-market live valuation in IDR.
   - Visual multi-asset allocation breakdown.
   - Unrealized and realized P&L tracking.
   - Built-in Virtual Faucet to credit test funds (IDR, BTC, ETH, SOL, DNA, USDT).

4. **Audit & Order History (`/orders`, `/history`)**
   - Comprehensive status filtering (Open, Partially Filled, Filled, Cancelled, Rejected).
   - Detailed order inspection modal.
   - Immutable audit event log recording all user and administrative actions.

5. **Demo Authentication & Protected Admin Console (`/login`, `/admin`)**
   - Quick one-click profile switching between **Pro Trader (Arya Pratama)** and **Operations Admin (Dr. Sarah Danubrata)**.
   - Role-gated admin portal with pair fee configuration (maker/taker bps), market suspension/resumption, synthetic volatility controls, and full environment reset.

---

## Architecture & Simulation Engine

* **Deterministic Market Engine (`src/simulation/marketData.ts`)**: Seeded pseudorandom candle and order book generators ensuring consistent historical data without random jitter.
* **Authoritative Matching Engine (`src/simulation/matchingEngine.ts`)**: Price-time priority matching engine handling balance locking, taker/maker fee deduction, partial fills, and tick-triggered limit order fills.
* **State Store (`src/simulation/store.tsx`)**: Centralized React Context with persistent localStorage caching and controlled simulation clock.
* **Responsive Layout (`src/components/layout/AppShell.tsx`)**: Desktop sidebar with 1440px wide optimization, persistent simulation mode badges, and mobile-friendly bottom navigation.

---

## Getting Started

```bash
# Install dependencies
npm install

# Start development server
npm run dev

# Run TypeScript typechecks
npm run lint

# Build production bundle
npm run build
```
