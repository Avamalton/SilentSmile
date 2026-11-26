import React, { useState } from 'react';
import { useRouter, AppRoute } from '../../router';
import { useSimulation } from '../../simulation/store';
import { formatIDR } from '../../utils/formatters';
import { useTranslation } from '../../utils/i18n';
import {
  LayoutDashboard,
  CandlestickChart,
  Coins,
  Briefcase,
  ListOrdered,
  History,
  Settings,
  ShieldAlert,
  Bell,
  Search,
  ChevronRight,
  LogOut,
  UserCheck,
  Menu,
  X,
  SlidersHorizontal,
  Bot,
  Table2,
  Globe,
  ShieldCheck,
  KeyRound,
  Lock,
} from 'lucide-react';

export const AppShell: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { currentRoute, navigate } = useRouter();
  const {
    currentUser,
    switchUser,
    allUsers,
    portfolioValueIDR,
    auditLogs,
    markets,
    selectPair,
    activePair,
    orderBook,
  } = useSimulation();

  const { language, setLanguage, t } = useTranslation();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchFocused, setSearchFocused] = useState(false);

  // Organized institutional navigation groups preserving all routes and behavior
  const navGroups: {
    groupLabel: string;
    items: {
      name: string;
      route: AppRoute;
      icon: React.FC<{ className?: string }>;
      badge?: string;
    }[];
  }[] = [
    {
      groupLabel: 'Trading Desk',
      items: [
        { name: t('nav_home'), route: '/', icon: LayoutDashboard },
        { name: t('nav_trade'), route: '/trade', icon: CandlestickChart },
        { name: t('nav_markets'), route: '/markets', icon: Coins },
        { name: t('nav_wallet'), route: '/portfolio', icon: Briefcase },
        { name: t('nav_orders'), route: '/orders', icon: ListOrdered },
        { name: t('nav_history'), route: '/history', icon: History },
      ],
    },
    {
      groupLabel: 'Account & Security',
      items: [
        { name: t('nav_kyc'), route: '/kyc' as AppRoute, icon: ShieldCheck, badge: 'KYC' },
        { name: t('nav_security'), route: '/security' as AppRoute, icon: Lock },
        { name: t('nav_api'), route: '/api-keys' as AppRoute, icon: KeyRound },
        { name: 'Settings', route: '/settings', icon: Settings },
      ],
    },
    {
      groupLabel: 'Liquidity & Ops',
      items: [
        { name: 'MM Matrix (cs_*)', route: '/mm-config' as AppRoute, icon: Table2, badge: 'SETUP' },
        { name: 'MM Station', route: '/mm' as AppRoute, icon: Bot, badge: 'DMM' },
        { name: t('nav_admin'), route: '/admin' as AppRoute, icon: SlidersHorizontal, badge: 'OPS' },
      ],
    },
  ];

  const allNavLinks = navGroups.flatMap((g) => g.items);

  const filteredSearchMarkets = markets.filter(
    (m) =>
      m.id.toLowerCase().includes(searchQuery.toLowerCase()) ||
      m.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const isMM = currentUser.role === 'market_maker';
  const isAdmin = currentUser.role === 'admin';
  const isTrader = currentUser.role === 'trader';

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-[#0B100E] text-[#F1F5F2]">
      {/* 1. Desktop Left Sidebar — Emerald Noir Institutional */}
      <aside
        className={`hidden md:flex flex-col border-r border-[#26372D] bg-[#0B100E] transition-all duration-200 z-30 shrink-0 ${
          sidebarCollapsed ? 'w-16' : 'w-60'
        }`}
      >
        {/* Brand Lockup */}
        <div className="h-14 flex items-center justify-between px-3.5 border-b border-[#26372D] bg-[#101A15]">
          <div
            onClick={() => navigate('/')}
            className="flex items-center gap-2.5 cursor-pointer select-none overflow-hidden"
          >
            <div className="w-8 h-8 rounded-lg bg-[#064E3B] border border-[#10B981]/50 flex items-center justify-center shrink-0">
              <svg
                className="w-4 h-4 text-[#10B981]"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.25"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M4 14c4 4 12 4 16 0" />
                <path d="M7 9h.01" />
                <path d="M17 9h.01" />
              </svg>
            </div>

            {!sidebarCollapsed && (
              <div className="flex flex-col">
                <span className="text-sm font-bold tracking-tight text-[#F1F5F2] flex items-center">
                  SILENT<span className="text-[#10B981] ml-1">SMILE</span>
                </span>
                <span className="text-[9.5px] font-mono tracking-wider font-medium text-[#647168] uppercase">
                  {isMM ? 'Liquidity Desk' : isAdmin ? 'Exchange Governance' : 'Institutional Spot'}
                </span>
              </div>
            )}
          </div>

          <button
            onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
            className="p-1 rounded text-[#A1ADA5] hover:text-[#F1F5F2] hover:bg-[#192820] transition-colors"
            title={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            aria-label="Toggle Sidebar"
          >
            <ChevronRight className={`w-4 h-4 transition-transform ${sidebarCollapsed ? '' : 'rotate-180'}`} />
          </button>
        </div>

        {/* Navigation Groups */}
        <nav className="flex-1 py-3 px-2.5 space-y-4 overflow-y-auto">
          {navGroups.map((group) => (
            <div key={group.groupLabel} className="space-y-1">
              {!sidebarCollapsed && (
                <div className="px-2.5 pb-1 text-[10px] font-semibold uppercase tracking-wider text-[#647168]">
                  {group.groupLabel}
                </div>
              )}
              {group.items.map((item) => {
                const Icon = item.icon;
                const isActive = currentRoute === item.route;
                return (
                  <button
                    key={item.route}
                    onClick={() => navigate(item.route)}
                    className={`w-full flex items-center justify-between gap-2.5 px-2.5 py-2 rounded-lg text-xs font-medium transition-colors text-left group ${
                      isActive
                        ? 'bg-[#142019] text-[#F1F5F2] border border-[#10B981]/50'
                        : 'text-[#A1ADA5] hover:text-[#F1F5F2] hover:bg-[#101A15] border border-transparent'
                    }`}
                    title={sidebarCollapsed ? item.name : undefined}
                  >
                    <span className="flex items-center gap-2.5 min-w-0">
                      <Icon
                        className={`w-4 h-4 shrink-0 transition-colors ${
                          isActive ? 'text-[#10B981]' : 'text-[#647168] group-hover:text-[#A1ADA5]'
                        }`}
                      />
                      {!sidebarCollapsed && <span className="truncate">{item.name}</span>}
                    </span>
                    {!sidebarCollapsed && item.badge && (
                      <span
                        className={`text-[9.5px] font-mono px-1.5 py-0.5 rounded border ${
                          isActive
                            ? 'bg-[#064E3B] text-[#34D399] border-[#10B981]/40'
                            : 'bg-[#101A15] text-[#647168] border-[#26372D]'
                        }`}
                      >
                        {item.badge}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          ))}
        </nav>

        {/* Bottom Profile & Simulation Tag */}
        <div className="p-3 border-t border-[#26372D] bg-[#101A15]">
          {!sidebarCollapsed ? (
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-2 p-2 rounded-lg bg-[#142019] border border-[#26372D]">
                <img
                  src={currentUser.avatarUrl}
                  alt={currentUser.name}
                  referrerPolicy="no-referrer"
                  className="w-7 h-7 rounded-full object-cover border border-[#26372D] shrink-0"
                />
                <div className="flex-1 min-w-0">
                  <div className="text-[11.5px] font-semibold text-[#F1F5F2] truncate">
                    {currentUser.name}
                  </div>
                  <div className="text-[10px] text-[#34D399] truncate uppercase font-mono">
                    {currentUser.role}
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-between text-[10px] text-[#EAB866] font-mono px-1">
                <span>SIMULATED VIRTUAL</span>
                <span className="w-1.5 h-1.5 rounded-full bg-[#EAB866]"></span>
              </div>
            </div>
          ) : (
            <div className="flex justify-center">
              <img
                src={currentUser.avatarUrl}
                alt={currentUser.name}
                referrerPolicy="no-referrer"
                className="w-8 h-8 rounded-full object-cover border border-[#26372D]"
                title={`${currentUser.name} (${currentUser.role})`}
              />
            </div>
          )}
        </div>
      </aside>

      {/* 2. Main Viewport & Header */}
      <div className="flex-1 flex flex-col min-w-0 h-full overflow-hidden">
        {/* Top Header */}
        <header className="h-14 border-b border-[#26372D] bg-[#101A15] px-4 flex items-center justify-between gap-4 z-20 shrink-0">
          {/* Left: Mobile hamburger & Simulation Notice */}
          <div className="flex items-center gap-3">
            <button
              onClick={() => setMobileMenuOpen(true)}
              className="md:hidden p-1.5 rounded-lg text-[#A1ADA5] hover:text-[#F1F5F2] hover:bg-[#192820]"
              aria-label="Open Navigation Menu"
            >
              <Menu className="w-5 h-5" />
            </button>

            <div className="flex items-center gap-2 px-2.5 py-1 rounded-md bg-[#142019] border border-[#EAB866]/30 text-[#EAB866] text-[11px] font-mono font-medium tracking-tight">
              <ShieldAlert className="w-3.5 h-3.5 text-[#EAB866] shrink-0" />
              <span className="hidden sm:inline">SIMULATION MODE — NO REAL ASSETS</span>
              <span className="sm:hidden">SIMULATION</span>
            </div>
          </div>

          {/* Center: Quick Market Search */}
          <div className="relative max-w-xs w-full hidden md:block">
            <div className="flex items-center bg-[#0B100E] border border-[#26372D] rounded-lg px-2.5 py-1.5 focus-within:border-[#10B981] transition-colors">
              <Search className="w-3.5 h-3.5 text-[#647168] mr-2 shrink-0" />
              <input
                type="text"
                placeholder="Search markets..."
                value={searchQuery}
                onFocus={() => setSearchFocused(true)}
                onBlur={() => setTimeout(() => setSearchFocused(false), 200)}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full bg-transparent text-xs text-[#F1F5F2] placeholder-[#647168] outline-none"
              />
            </div>

            {searchFocused && (
              <div className="absolute left-0 right-0 mt-1 glass-dropdown rounded-lg p-1.5 z-50">
                {filteredSearchMarkets.length === 0 ? (
                  <div className="p-2 text-xs text-[#647168] text-center">No market pairs match.</div>
                ) : (
                  filteredSearchMarkets.map((m) => (
                    <div
                      key={m.id}
                      onMouseDown={() => {
                        selectPair(m.id);
                        navigate('/trade');
                      }}
                      className="flex items-center justify-between px-2.5 py-1.5 hover:bg-[#142019] rounded-md cursor-pointer text-xs"
                    >
                      <span className="font-semibold text-[#F1F5F2]">{m.id}</span>
                      <span className="font-mono text-[#34D399]">{formatIDR(m.lastPrice)}</span>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>

          {/* Role-Specific Live Station HUD */}
          {isMM && (
            <div className="hidden lg:flex items-center gap-2.5 px-3 py-1 rounded-lg bg-[#142019] border border-[#26372D] text-xs">
              <div className="flex items-center gap-1.5 font-mono">
                <Bot className="w-4 h-4 text-[#10B981]" />
                <span className="font-semibold text-[#34D399] text-[11px] tracking-wide">DMM DESK</span>
              </div>
              <span className="text-[#26372D]">|</span>
              <div className="flex items-center gap-2 font-mono text-[11px] text-[#A1ADA5]">
                <span>
                  {activePair.id} Spread: <strong className="text-[#F1F5F2]">{orderBook.spreadPercent}%</strong>
                </span>
                <span className="text-[#647168]">·</span>
                <span>
                  Depth: <strong className="text-[#10B981]">{orderBook.bids.length + orderBook.asks.length}</strong> lvls
                </span>
              </div>
              <button
                onClick={() => navigate('/mm')}
                className="ml-1 px-2.5 py-1 rounded-md bg-[#10B981] hover:bg-[#34D399] text-[#0B100E] font-bold text-[10.5px] transition-colors"
              >
                MM Station
              </button>
            </div>
          )}

          {isAdmin && (
            <div className="hidden lg:flex items-center gap-2.5 px-3 py-1 rounded-lg bg-[#142019] border border-[#26372D] text-xs">
              <div className="flex items-center gap-1.5 font-mono">
                <SlidersHorizontal className="w-4 h-4 text-[#10B981]" />
                <span className="font-semibold text-[#34D399] text-[11px] tracking-wide">ADMIN OPS</span>
              </div>
              <span className="text-[#26372D]">|</span>
              <div className="flex items-center gap-2 font-mono text-[11px] text-[#A1ADA5]">
                <span>
                  Engine: <strong className="text-[#10B981]">ONLINE</strong>
                </span>
                <span className="text-[#647168]">·</span>
                <span>
                  Audits: <strong className="text-[#F1F5F2]">{auditLogs.length}</strong>
                </span>
              </div>
              <button
                onClick={() => navigate('/admin')}
                className="ml-1 px-2.5 py-1 rounded-md bg-[#10B981] hover:bg-[#34D399] text-[#0B100E] font-bold text-[10.5px] transition-colors"
              >
                Exchange Admin
              </button>
            </div>
          )}

          {isTrader && (
            <div className="hidden lg:flex items-center gap-2.5 px-3 py-1 rounded-lg bg-[#142019] border border-[#26372D] text-xs">
              <div className="flex items-center gap-1.5 font-mono">
                <CandlestickChart className="w-4 h-4 text-[#10B981]" />
                <span className="font-semibold text-[#34D399] text-[11px] tracking-wide">SPOT DESK</span>
              </div>
              <span className="text-[#26372D]">|</span>
              <span className="font-mono text-[11px] text-[#A1ADA5] truncate max-w-[140px]">
                {currentUser.tier.split('&')[0]}
              </span>
              <button
                onClick={() => navigate('/trade')}
                className="ml-1 px-2.5 py-1 rounded-md bg-[#064E3B] hover:bg-[#10B981] text-[#34D399] hover:text-[#0B100E] border border-[#10B981]/40 font-semibold text-[10.5px] transition-colors"
              >
                Trade Spot
              </button>
            </div>
          )}

          {/* Right Zone: Quick Matrix, Portfolio Equity, Language, Bell, User Switcher */}
          <div className="flex items-center gap-2.5">
            <button
              onClick={() => navigate('/mm-config')}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-[#142019] hover:bg-[#192820] text-[#F1F5F2] border border-[#26372D] hover:border-[#10B981]/50 text-xs font-semibold transition-colors"
              title="Open Institutional Market Maker Configuration (MMConfigTable)"
            >
              <Table2 className="w-3.5 h-3.5 text-[#10B981]" />
              <span className="hidden sm:inline">MM Matrix (cs_*)</span>
            </button>

            <div className="hidden lg:flex flex-col text-right font-mono-nums">
              <span className="text-[10px] text-[#A1ADA5]">Virtual Portfolio</span>
              <span className="text-xs font-bold text-[#34D399]">{formatIDR(portfolioValueIDR)}</span>
            </div>

            <button
              onClick={() => setLanguage(language === 'id' ? 'en' : 'id')}
              className="flex items-center gap-1 px-2 py-1 rounded-lg bg-[#142019] border border-[#26372D] hover:border-[#10B981]/50 text-xs font-mono font-bold text-[#A1ADA5] hover:text-[#F1F5F2] transition-colors"
              title="Ganti Bahasa / Switch Language"
            >
              <Globe className="w-3.5 h-3.5 text-[#10B981]" />
              <span>{language.toUpperCase()}</span>
            </button>

            {/* Notifications Button */}
            <div className="relative">
              <button
                onClick={() => setNotifOpen(!notifOpen)}
                className="p-2 text-[#A1ADA5] hover:text-[#F1F5F2] hover:bg-[#192820] rounded-lg transition-colors relative"
                title="System and Trading Alerts"
                aria-label="Alerts"
              >
                <Bell className="w-4 h-4" />
                <span className="absolute top-1.5 right-1.5 w-1.5 h-1.5 rounded-full bg-[#10B981]"></span>
              </button>

              {notifOpen && (
                <div className="absolute right-0 mt-2 w-80 glass-dropdown rounded-lg p-3 z-50">
                  <div className="flex items-center justify-between pb-2 border-b border-[#26372D] mb-2">
                    <span className="text-xs font-semibold text-[#F1F5F2]">Simulation Activity</span>
                    <span className="text-[11px] text-[#34D399] font-mono">Live Engine</span>
                  </div>
                  <div className="space-y-2 max-h-60 overflow-y-auto">
                    {auditLogs.slice(0, 5).map((log, idx) => (
                      <div key={`${log.id || 'log'}-${idx}`} className="text-xs p-2 rounded-md bg-[#142019] border border-[#26372D]">
                        <div className="flex justify-between text-[10.5px] text-[#A1ADA5] font-mono mb-0.5">
                          <span>{log.action}</span>
                          <span>{new Date(log.timestamp).toLocaleTimeString()}</span>
                        </div>
                        <div className="text-[#F1F5F2] text-[11px] leading-tight">{log.details}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* User Profile Switcher */}
            <div className="relative">
              <button
                onClick={() => setUserMenuOpen(!userMenuOpen)}
                className="flex items-center gap-2 p-1 pl-2 pr-2.5 rounded-lg bg-[#142019] hover:bg-[#192820] border border-[#26372D] transition-colors"
                aria-label="User Account Menu"
              >
                <img
                  src={currentUser.avatarUrl}
                  alt={currentUser.name}
                  referrerPolicy="no-referrer"
                  className="w-6 h-6 rounded-full object-cover border border-[#26372D]"
                />
                <span className="text-xs font-semibold text-[#F1F5F2] hidden sm:inline max-w-[100px] truncate">
                  {currentUser.name.split(' ')[0]}
                </span>
              </button>

              {userMenuOpen && (
                <div className="absolute right-0 mt-2 w-64 glass-dropdown rounded-lg p-3 z-50">
                  <div className="pb-2 border-b border-[#26372D] mb-2">
                    <div className="text-xs font-bold text-[#F1F5F2]">{currentUser.name}</div>
                    <div className="text-[11px] text-[#A1ADA5]">{currentUser.email}</div>
                    <div className="text-[10px] text-[#34D399] font-mono mt-0.5">{currentUser.tier}</div>
                  </div>

                  <div className="text-[10.5px] font-semibold text-[#647168] uppercase tracking-wider mb-1.5 flex items-center justify-between">
                    <span>Switch Demo Account</span>
                    <span className="text-[9.5px] text-[#34D399] font-mono">Distinct Portfolios</span>
                  </div>

                  <div className="space-y-1 mb-2">
                    {allUsers.map((usr) => {
                      const isSelected = currentUser.id === usr.id;
                      return (
                        <button
                          key={usr.id}
                          onClick={() => {
                            switchUser(usr.id);
                            setUserMenuOpen(false);
                          }}
                          className={`w-full flex items-center justify-between p-2 rounded-lg text-xs hover:bg-[#142019] text-left transition-colors ${
                            isSelected
                              ? 'bg-[#064E3B]/60 border border-[#10B981]/50 text-[#F1F5F2] font-medium'
                              : 'text-[#A1ADA5] border border-transparent'
                          }`}
                        >
                          <div className="min-w-0 pr-2">
                            <div className="font-semibold truncate flex items-center gap-1.5 text-[#F1F5F2]">
                              <span>{usr.name}</span>
                              <span className="text-[9px] px-1 py-0.2 rounded bg-[#101A15] text-[#A1ADA5] border border-[#26372D] font-mono uppercase">
                                {usr.role}
                              </span>
                            </div>
                            <div className="text-[10px] text-[#647168] truncate">{usr.tier}</div>
                          </div>
                          {isSelected && <UserCheck className="w-4 h-4 text-[#10B981] shrink-0" />}
                        </button>
                      );
                    })}
                  </div>

                  <div className="pt-2 border-t border-[#26372D]">
                    <button
                      onClick={() => {
                        navigate('/login');
                        setUserMenuOpen(false);
                      }}
                      className="w-full flex items-center gap-2 px-2 py-1.5 text-xs text-[#EF6464] hover:bg-[#EF6464]/10 rounded-md transition-colors"
                    >
                      <LogOut className="w-3.5 h-3.5" />
                      <span>Switch / Sign Out Demo</span>
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </header>

        {/* Content Viewport */}
        <main className="flex-1 min-h-0 overflow-y-auto p-3 sm:p-4 md:p-5 relative pb-20 md:pb-5 bg-[#0B100E]">
          {children}
        </main>

        {/* 3. Mobile Fixed Bottom Navigation */}
        <nav className="md:hidden fixed bottom-0 left-0 right-0 h-16 bg-[#101A15] border-t border-[#26372D] flex items-center justify-around px-2 z-40">
          {[
            { name: 'Overview', route: '/' as AppRoute, icon: LayoutDashboard },
            { name: 'Markets', route: '/markets' as AppRoute, icon: Coins },
            { name: 'Trade', route: '/trade' as AppRoute, icon: CandlestickChart },
            { name: 'Portfolio', route: '/portfolio' as AppRoute, icon: Briefcase },
            { name: 'Orders', route: '/orders' as AppRoute, icon: ListOrdered },
          ].map((item) => {
            const Icon = item.icon;
            const isActive = currentRoute === item.route;
            return (
              <button
                key={item.route}
                onClick={() => navigate(item.route)}
                className={`flex flex-col items-center justify-center w-14 h-full transition-colors ${
                  isActive ? 'text-[#10B981] font-semibold' : 'text-[#647168] hover:text-[#A1ADA5]'
                }`}
              >
                <Icon className="w-4 h-4 mb-1" />
                <span className="text-[10px]">{item.name}</span>
              </button>
            );
          })}
        </nav>
      </div>

      {/* Mobile Sidebar Modal */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-50 flex md:hidden bg-black/80 backdrop-blur-sm">
          <div className="w-64 bg-[#0B100E] h-full p-4 flex flex-col border-r border-[#26372D]">
            <div className="flex items-center justify-between pb-4 border-b border-[#26372D]">
              <div className="flex items-center gap-2">
                <span className="text-base font-bold text-[#F1F5F2]">
                  SILENT<span className="text-[#10B981] ml-1">SMILE</span>
                </span>
              </div>
              <button
                onClick={() => setMobileMenuOpen(false)}
                className="p-1 rounded text-[#A1ADA5] hover:text-[#F1F5F2]"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <nav className="flex-1 py-4 space-y-1 overflow-y-auto">
              {allNavLinks.map((item) => {
                const Icon = item.icon;
                const isActive = currentRoute === item.route;
                return (
                  <button
                    key={item.route}
                    onClick={() => {
                      navigate(item.route);
                      setMobileMenuOpen(false);
                    }}
                    className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-xs font-medium text-left ${
                      isActive
                        ? 'bg-[#142019] text-[#F1F5F2] border border-[#10B981]/50'
                        : 'text-[#A1ADA5] hover:text-[#F1F5F2]'
                    }`}
                  >
                    <Icon className={`w-4 h-4 ${isActive ? 'text-[#10B981]' : 'text-[#647168]'}`} />
                    <span>{item.name}</span>
                  </button>
                );
              })}
            </nav>

            <div className="p-2 border-t border-[#26372D] text-[11px] text-[#EAB866] font-mono">
              SIMULATION MODE — NO REAL ASSETS
            </div>
          </div>
          <div className="flex-1" onClick={() => setMobileMenuOpen(false)} />
        </div>
      )}
    </div>
  );
};
