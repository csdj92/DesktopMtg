export const safeConfirm = (message) => {
  try {
    if (typeof window !== 'undefined' && typeof window.confirm === 'function') {
      return window.confirm(message);
    }
  } catch (_) {
    /* ignored */
  }
  return false;
};

export const safeAlert = (message) => {
  try {
    if (typeof window !== 'undefined' && typeof window.alert === 'function') {
      return window.alert(message);
    }
  } catch (_) {
    /* ignored */
  }
  // no-op in environments without alert
  return undefined;
};


