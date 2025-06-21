import React from 'react';

export const useTaskProgress = () => {
  const [progress, setProgress] = React.useState({});

  React.useEffect(() => {
    if (window?.electronAPI?.onTaskProgress) {
      window.electronAPI.onTaskProgress((msg) => {
        setProgress((prev) => ({ ...prev, [msg.task]: { ...prev[msg.task], ...msg } }));
      });
    }
  }, []);

  return progress;
}; 