import React, { useState, useEffect, createContext, useContext } from 'react';

export type AppRoute =
  | '/'
  | '/trade'
  | '/markets'
  | '/portfolio'
  | '/orders'
  | '/history'
  | '/settings'
  | '/login'
  | '/register'
  | '/admin'
  | '/mm'
  | '/mm-config'
  | '/kyc'
  | '/security'
  | '/api-keys';

interface RouterContextType {
  currentRoute: AppRoute;
  params: Record<string, string>;
  navigate: (route: AppRoute, params?: Record<string, string>) => void;
}

const RouterContext = createContext<RouterContextType>({
  currentRoute: '/',
  params: {},
  navigate: () => {},
});

export const RouterProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [currentRoute, setCurrentRoute] = useState<AppRoute>(() => {
    const hash = window.location.hash.replace('#', '') || '/';
    const base = hash.split('?')[0].split('/')[1];
    if (base === 'trade') return '/trade';
    if (base === 'markets') return '/markets';
    if (base === 'portfolio') return '/portfolio';
    if (base === 'orders') return '/orders';
    if (base === 'history') return '/history';
    if (base === 'settings') return '/settings';
    if (base === 'login') return '/login';
    if (base === 'register') return '/register';
    if (base === 'admin') return '/admin';
    if (base === 'mm') return '/mm';
    if (base === 'mm-config') return '/mm-config';
    if (base === 'kyc') return '/kyc';
    if (base === 'security') return '/security';
    if (base === 'api-keys') return '/api-keys';
    return '/';
  });

  const [params, setParams] = useState<Record<string, string>>({});

  useEffect(() => {
    const handleHashChange = () => {
      const hash = window.location.hash.replace('#', '') || '/';
      const parts = hash.split('?')[0].split('/').filter(Boolean);
      const base = parts[0] ? `/${parts[0]}` as AppRoute : '/';

      const validRoutes: AppRoute[] = [
        '/',
        '/trade',
        '/markets',
        '/portfolio',
        '/orders',
        '/history',
        '/settings',
        '/login',
        '/register',
        '/admin',
        '/mm',
        '/mm-config',
        '/kyc',
        '/security',
        '/api-keys',
      ];

      if (validRoutes.includes(base)) {
        setCurrentRoute(base);
      } else {
        setCurrentRoute('/');
      }

      // Extract pair or query params if any
      const queryParams: Record<string, string> = {};
      if (parts[1]) {
        queryParams['pair'] = parts[1];
      }
      if (hash.includes('?')) {
        const queryStr = hash.split('?')[1];
        const search = new URLSearchParams(queryStr);
        search.forEach((val, key) => {
          queryParams[key] = val;
        });
      }
      setParams(queryParams);
    };

    window.addEventListener('hashchange', handleHashChange);
    handleHashChange();
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, []);

  const navigate = (route: AppRoute, newParams?: Record<string, string>) => {
    let hash = `#${route === '/' ? '' : route}`;
    if (newParams) {
      if (newParams.pair && route === '/trade') {
        hash = `#/trade/${newParams.pair}`;
      }
      const search = new URLSearchParams();
      for (const [k, v] of Object.entries(newParams)) {
        if (k !== 'pair') search.append(k, v);
      }
      const qs = search.toString();
      if (qs) hash += `?${qs}`;
    }
    window.location.hash = hash;
    setCurrentRoute(route);
    setParams(newParams || {});
  };

  return (
    <RouterContext.Provider value={{ currentRoute, params, navigate }}>
      {children}
    </RouterContext.Provider>
  );
};

export const useRouter = () => useContext(RouterContext);
