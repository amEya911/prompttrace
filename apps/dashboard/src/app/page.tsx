'use client';

import { useState, useEffect } from 'react';
import TraceDetail from './components/TraceDetail';

export default function Dashboard() {
  const [traces, setTraces] = useState<any[]>([]);
  const [selectedHash, setSelectedHash] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/traces')
      .then(r => r.json())
      .then(data => {
        if (data.traces) setTraces(data.traces);
      })
      .catch(err => console.error("Could not load traces", err));
  }, []);

  const selectedTrace = traces.find(t => t.id === selectedHash) || traces[0];

  return (
    <div className="layout">
      <div className="sidebar">
        <div className="sidebar-header">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path></svg>
          <h1>Prompttrace Optimization</h1>
        </div>

        <div className="request-list">
          {traces.length === 0 ? (
            <div style={{ padding: 20, color: '#a1a1aa', fontSize: 13 }}>No traces found. Run an example!</div>
          ) : (
            traces.map(trace => (
              <div
                key={trace.id}
                className={`request-item ${selectedTrace?.id === trace.id ? 'active' : ''}`}
                onClick={() => setSelectedHash(trace.id)}
              >
                <div className="request-meta">
                  <span>{new Date(trace.timestamp).toLocaleTimeString()}</span>
                  <span style={{ color: 'var(--warning)', fontWeight: 600 }}>${(trace.projectedMonthlyCost || 0).toFixed(2)}/mo</span>
                </div>
                <div className="request-title">
                  <span>{trace.model}</span>
                  {trace.cacheHits > 0 && <span className="chip" style={{ background: 'rgba(59,130,246,0.2)', color: 'var(--info)' }}>{trace.cacheHits} Hits</span>}
                </div>
                <div style={{ marginTop: 6, fontSize: 12, color: '#a1a1aa' }}>
                  {trace.totalTokens} tokens • RAW: ${trace.cost.toFixed(5)}
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      <div className="main-content">
        {selectedTrace ? (
          <TraceDetail trace={selectedTrace} />
        ) : (
          <div className="empty-state">Select a trace to analyze optimization opportunities.</div>
        )}
      </div>
    </div>
  );
}
