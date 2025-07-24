import React, { useState, useEffect } from 'react';
import './DailyPriceStatus.css';

const DailyPriceStatus = () => {
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(false);
  const [updating, setUpdating] = useState(false);

  const fetchStatus = async () => {
    try {
      setLoading(true);
      const result = await window.electronAPI.getDailyPriceStatus();
      setStatus(result);
    } catch (error) {
      console.error('Error fetching daily price status:', error);
      setStatus({ error: error.message });
    } finally {
      setLoading(false);
    }
  };

  const triggerUpdate = async () => {
    try {
      setUpdating(true);
      const result = await window.electronAPI.triggerDailyPriceUpdate();
      if (result.success) {
        // Refresh status after successful update
        await fetchStatus();
      } else {
        console.error('Price update failed:', result.error);
      }
    } catch (error) {
      console.error('Error triggering price update:', error);
    } finally {
      setUpdating(false);
    }
  };

  useEffect(() => {
    fetchStatus();
  }, []);

  if (loading) {
    return (
      <div className="daily-price-status">
        <div className="status-loading">Loading price update status...</div>
      </div>
    );
  }

  if (!status) {
    return (
      <div className="daily-price-status">
        <div className="status-error">Unable to load price update status</div>
      </div>
    );
  }

  return (
    <div className="daily-price-status">
      <div className="status-header">
        <h3>💰 Daily Price Updates</h3>
        <div className={`status-indicator ${status.needsUpdate ? 'needs-update' : 'up-to-date'}`}>
          {status.needsUpdate ? '⚠️ Needs Update' : '✅ Up to Date'}
        </div>
      </div>
      
      <div className="status-details">
        <div className="status-item">
          <span className="label">Last Update:</span>
          <span className="value">{status.lastUpdate}</span>
        </div>
        
        <div className="status-item">
          <span className="label">Scheduler:</span>
          <span className={`value ${status.schedulerActive ? 'active' : 'inactive'}`}>
            {status.schedulerActive ? '🟢 Active' : '🔴 Inactive'}
          </span>
        </div>
        
        {status.error && (
          <div className="status-error">
            Error: {status.error}
          </div>
        )}
      </div>
      
      <div className="status-actions">
        <button 
          onClick={triggerUpdate}
          disabled={updating}
          className="update-button"
        >
          {updating ? '🔄 Updating...' : '🔄 Update Now'}
        </button>
        
        <button 
          onClick={fetchStatus}
          disabled={loading}
          className="refresh-button"
        >
          🔄 Refresh Status
        </button>
      </div>
    </div>
  );
};

export default DailyPriceStatus; 