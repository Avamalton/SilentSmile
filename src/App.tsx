import React, { useEffect } from 'react';
import { RouterProvider, useRouter } from './router';
import { SimulationProvider, useSimulation } from './simulation/store';
import { I18nProvider } from './utils/i18n';
import { AppShell } from './components/layout/AppShell';
import { OverviewView } from './views/OverviewView';
import { TradingTerminalView } from './views/TradingTerminalView';
import { MarketsView } from './views/MarketsView';
import { PortfolioView } from './views/PortfolioView';
import { OrdersView } from './views/OrdersView';
import { HistoryView } from './views/HistoryView';
import { SettingsView } from './views/SettingsView';
import { AuthView } from './views/AuthView';
import { AdminView } from './views/AdminView';
import { MarketMakerView } from './views/MarketMakerView';
import { MMConfigView } from './views/MMConfigView';
import { KycView } from './views/KycView';
import { SecurityView } from './views/SecurityView';
import { ApiKeyView } from './views/ApiKeyView';

const RouteDispatcher: React.FC = () => {
  const { currentRoute, params } = useRouter();
  const { selectPair, markets } = useSimulation();

  useEffect(() => {
    if (params.pair) {
      const normalized = params.pair.replace('-', '/').toUpperCase();
      const exists = markets.find((m) => m.id === normalized);
      if (exists) {
        selectPair(exists.id);
      }
    }
  }, [params.pair, markets, selectPair]);

  let content: React.ReactNode;
  switch (currentRoute) {
    case '/':
      content = <OverviewView />;
      break;
    case '/trade':
      content = <TradingTerminalView />;
      break;
    case '/markets':
      content = <MarketsView />;
      break;
    case '/portfolio':
      content = <PortfolioView />;
      break;
    case '/orders':
      content = <OrdersView />;
      break;
    case '/history':
      content = <HistoryView />;
      break;
    case '/settings':
      content = <SettingsView />;
      break;
    case '/login':
      content = <AuthView initialMode="login" />;
      break;
    case '/register':
      content = <AuthView initialMode="register" />;
      break;
    case '/admin':
      content = <AdminView />;
      break;
    case '/mm':
      content = <MarketMakerView />;
      break;
    case '/mm-config':
      content = <MMConfigView />;
      break;
    case '/kyc':
      content = <KycView />;
      break;
    case '/security':
      content = <SecurityView />;
      break;
    case '/api-keys':
      content = <ApiKeyView />;
      break;
    default:
      content = <OverviewView />;
  }

  return <AppShell>{content}</AppShell>;
};

export default function App() {
  return (
    <I18nProvider>
      <RouterProvider>
        <SimulationProvider>
          <RouteDispatcher />
        </SimulationProvider>
      </RouterProvider>
    </I18nProvider>
  );
}
