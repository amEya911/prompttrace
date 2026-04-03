import React from 'react';

export default function TraceDetail({ trace }: { trace: any }) {
  const { breakdown, totalTokens, impactSimulations, cacheHits } = trace;

  const sysPct = totalTokens ? (breakdown.systemTokens / totalTokens) * 100 : 0;
  const histPct = totalTokens ? (breakdown.historyTokens / totalTokens) * 100 : 0;
  const usrPct = totalTokens ? (breakdown.userTokens / totalTokens) * 100 : 0;
  const outPct = totalTokens ? (breakdown.outputTokens / totalTokens) * 100 : 0;

  return (
    <div>
      <div className="detail-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <h2>{trace.model}</h2>
          {cacheHits > 0 && <span className="chip warning">HOTSPOT: Seen {cacheHits + 1} Times</span>}
        </div>
        <div style={{ color: "var(--text-secondary)", fontSize: 13, marginTop: 4 }}>
          ID: {trace.id} • {new Date(trace.timestamp).toLocaleString()}
        </div>
      </div>

      <div className="metrics-grid">
        <div className="metric-card" style={{ borderLeft: '4px solid var(--warning)' }}>
          <div className="metric-label" style={{ color: 'var(--warning)' }}>Monthly Pain (10k req)</div>
          <div className="metric-val" style={{ color: 'var(--warning)' }}>${(trace.projectedMonthlyCost || 0).toFixed(2)}</div>
        </div>
        <div className="metric-card">
          <div className="metric-label">Raw Cost</div>
          <div className="metric-val">${trace.cost.toFixed(5)}</div>
        </div>
        <div className="metric-card">
          <div className="metric-label">Total Tokens</div>
          <div className="metric-val">{trace.totalTokens}</div>
        </div>
        <div className="metric-card">
          <div className="metric-label">Latency</div>
          <div className="metric-val">{trace.latency}ms</div>
        </div>
      </div>

      {impactSimulations && impactSimulations.length > 0 && (
        <div style={{ background: 'rgba(16, 185, 129, 0.1)', border: '1px solid rgba(16, 185, 129, 0.3)', padding: 20, borderRadius: 8, marginBottom: 30 }}>
          <h3 style={{ marginTop: 0, marginBottom: 12, fontSize: 14, color: '#10b981' }}>📈 Impact Simulation</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {impactSimulations.map((sim: any, i: number) => (
              <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'rgba(0,0,0,0.2)', padding: '12px 16px', borderRadius: 6 }}>
                <div>
                  <div style={{ fontWeight: 600, fontSize: 14, color: '#e2e8f0' }}>{sim.scenario}</div>
                  <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 4 }}>
                    Drops {sim.potentialSavingsTokens} tokens instantly
                  </div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontWeight: 700, color: '#10b981', fontSize: 16 }}>-${sim.projectedMonthlySavings.toFixed(2)} / mo</div>
                  <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>Projected Savings</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {trace.insights && trace.insights.length > 0 && (
        <div className="insights-box">
          <h3 style={{ marginTop: 0, marginBottom: 12, fontSize: 14 }}>Actionable Diagnostics</h3>
          {trace.insights.map((ins: any, i: number) => (
            <div key={i} className="insight-item">
              <span className={`insight-icon ${ins.type}`}>
                {ins.type === 'warning' ? '⚠️' : 'ℹ️'}
              </span>
              <span style={{ fontSize: 14 }}>{ins.message}</span>
            </div>
          ))}
        </div>
      )}

      <h3 className="section-title">Token Distribution</h3>
      <div className="token-bar-container">
        <div className="token-segment" title="System" style={{ width: `${sysPct}%`, backgroundColor: 'var(--token-system)' }}></div>
        <div className="token-segment" title="History" style={{ width: `${histPct}%`, backgroundColor: 'var(--token-history)' }}></div>
        <div className="token-segment" title="User" style={{ width: `${usrPct}%`, backgroundColor: 'var(--token-user)' }}></div>
        <div className="token-segment" title="Output" style={{ width: `${outPct}%`, backgroundColor: '#eab308' }}></div>
      </div>

      <div className="token-legend">
        <div className="legend-item">
          <div className="legend-color" style={{ backgroundColor: 'var(--token-system)' }}></div>
          System: {breakdown.systemTokens}
        </div>
        <div className="legend-item">
          <div className="legend-color" style={{ backgroundColor: 'var(--token-history)' }}></div>
          History: {breakdown.historyTokens}
        </div>
        <div className="legend-item">
          <div className="legend-color" style={{ backgroundColor: 'var(--token-user)' }}></div>
          User: {breakdown.userTokens}
        </div>
        <div className="legend-item">
          <div className="legend-color" style={{ backgroundColor: '#eab308' }}></div>
          Output: {breakdown.outputTokens}
        </div>
      </div>

      <h3 className="section-title">Messages ({trace.messages.length})</h3>
      {trace.messages.map((msg: any, i: number) => (
        <div key={i} className="message-box">
          <div className="message-role">{msg.role}</div>
          <div className="message-content">{msg.content}</div>
        </div>
      ))}
    </div>
  );
}
