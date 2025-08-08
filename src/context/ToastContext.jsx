import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';

const ToastContext = createContext(null);

let toastIdCounter = 0;

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);

  const remove = useCallback((id) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const push = useCallback(({ title, description, variant = 'info', duration = 3000 }) => {
    const id = ++toastIdCounter;
    setToasts((prev) => [...prev, { id, title, description, variant }]);
    if (duration > 0) {
      setTimeout(() => remove(id), duration);
    }
    return id;
  }, [remove]);

  const api = useMemo(() => ({
    push,
    success: (title, description, duration) => push({ title, description, duration, variant: 'success' }),
    error: (title, description, duration) => push({ title, description, duration, variant: 'error' }),
    info: (title, description, duration) => push({ title, description, duration, variant: 'info' }),
    warning: (title, description, duration) => push({ title, description, duration, variant: 'warning' }),
    remove,
  }), [push, remove]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div style={styles.container} aria-live="polite" aria-atomic="true">
        {toasts.map((t) => (
          <div key={t.id} style={{ ...styles.toast, ...styles[t.variant] }}>
            {t.title && <div style={styles.title}>{t.title}</div>}
            {t.description && <div style={styles.description}>{t.description}</div>}
            <button style={styles.close} onClick={() => remove(t.id)} aria-label="Dismiss">×</button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within ToastProvider');
  return ctx;
}

const styles = {
  container: {
    position: 'fixed',
    top: 12,
    right: 12,
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
    zIndex: 10000,
    pointerEvents: 'none',
  },
  toast: {
    pointerEvents: 'auto',
    minWidth: 240,
    maxWidth: 360,
    padding: '10px 12px',
    borderRadius: 8,
    boxShadow: '0 6px 20px rgba(0,0,0,0.2)',
    color: '#fff',
    position: 'relative',
    overflow: 'hidden',
  },
  success: { background: '#16a34a' },
  error: { background: '#dc2626' },
  info: { background: '#2563eb' },
  warning: { background: '#d97706' },
  title: { fontWeight: 700, marginBottom: 4 },
  description: { opacity: 0.95 },
  close: {
    position: 'absolute',
    top: 6,
    right: 8,
    border: 'none',
    background: 'transparent',
    color: '#fff',
    cursor: 'pointer',
    fontSize: 16,
  },
};

export default ToastContext;


