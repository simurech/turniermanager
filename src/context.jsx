import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { clearAdmin, getAdmin, setAdmin } from './lib/auth.js';
import { verifyAdmin } from './lib/api.js';

const AppContext = createContext(null);
export const useApp = () => useContext(AppContext);

export function AppProvider({ children }) {
  const [admin, setAdminFlag] = useState(() => Boolean(getAdmin()));
  const [toasts, setToasts] = useState([]);

  const toast = useCallback((message, kind = 'ok') => {
    const id = Math.random();
    setToasts((list) => [...list, { id, message, kind }]);
    setTimeout(() => setToasts((list) => list.filter((t) => t.id !== id)), 3800);
  }, []);

  const loginAdmin = useCallback(async (code) => {
    await verifyAdmin(code);
    setAdmin(code);
    setAdminFlag(true);
  }, []);

  const logoutAdmin = useCallback(() => {
    clearAdmin();
    setAdminFlag(false);
  }, []);

  const value = useMemo(() => ({ admin, toast, loginAdmin, logoutAdmin }), [admin, toast, loginAdmin, logoutAdmin]);

  return (
    <AppContext.Provider value={value}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.kind === 'bad' ? 'bad' : ''}`}>
            {t.message}
          </div>
        ))}
      </div>
    </AppContext.Provider>
  );
}
