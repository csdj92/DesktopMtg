import React from 'react';
import { useTaskProgress } from '../hooks/useTaskProgress';
import { Progress } from './ui/progress';

const TaskProgressOverlay = () => {
  const progress = useTaskProgress();

  const download = progress['download'] || {};
  const python = progress['python-db'] || {};
  const importing = progress['import'] || {};

  const isVisible =
    (download.state && download.state !== 'done') ||
    (python.state && python.state !== 'done') ||
    (importing.state && importing.state !== 'done');

  if (!isVisible) return null;

  const renderTask = (label, task) => {
    if (!task || (task.state === 'done' || task.state === 'fail')) return null;
    const percent = task.percent ?? (task.state === 'start' ? 0 : undefined);
    return (
      <div className="mb-4 last:mb-0">
        <div className="mb-1 text-sm font-medium text-primary-foreground">{label} {percent !== undefined ? `${percent}%` : ''}</div>
        {percent !== undefined && <Progress value={percent} />}
        {percent === undefined && <div className="h-2 bg-primary/20 rounded-full animate-pulse" />}
      </div>
    );
  };

  return (
    <div className="fixed bottom-4 left-4 w-80 bg-background/90 backdrop-blur border rounded-lg shadow-lg p-4 z-50">
      {renderTask('Downloading card database…', download)}
      {renderTask('Building Python database…', python)}
      {renderTask('Importing cards…', importing)}
    </div>
  );
};

export default TaskProgressOverlay; 