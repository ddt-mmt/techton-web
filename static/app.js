const { useState, useEffect } = React;

function App() {
  const [config, setConfig] = useState({
    target_ip: '',
    mode: 'load',
    vus: 50,
    duration: '60s',
    user_dn: '',
    password: '',
    base_dn: '', // New field
    attackType: 'single', // single vs csv
    file: null
  });
  const [status, setStatus] = useState({ status: 'stopped', duration: 0 });
  const [log, setLog] = useState([]);
  const [report, setReport] = useState(null);
  const [history, setHistory] = useState([]);
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 10;
  const [selectedReport, setSelectedReport] = useState(null);

  useEffect(() => {
    const ws_protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(`${ws_protocol}//${window.location.host}/ws/status`);
    
    ws.onmessage = (event) => {
        const data = JSON.parse(event.data);
        
        setStatus(prevStatus => {
            if (prevStatus.status === 'running' && data.status === 'finished') {
                handleStop(true); // Test finished on its own, trigger report
            }
            return data;
        });

        // Live Log Updates from Backend (k6 output)
        if (data.logs && data.logs.length > 0) {
            setLog(prev => {
                const newLogs = data.logs.filter(l => !prev.includes(l));
                if (newLogs.length > 0) {
                    return [...prev.slice(-15), ...newLogs];
                }
                return prev;
            });
        } else if(data.status === 'running') {
            // Only add timestamp tick if no real logs
            setLog(prev => {
                const lastMsg = prev[prev.length - 1];
                if (!lastMsg || !lastMsg.includes("Test in progress")) {
                     return [...prev.slice(-9), `[${new Date().toLocaleTimeString()}] Test in progress... (${data.duration}s)`];
                }
                return prev; // Avoid spamming "Test in progress" every second
            });
        }
    };

    ws.onclose = () => {
        console.log("WebSocket disconnected.");
        setStatus({ status: 'stopped', duration: 0 });
    };
    
    ws.onerror = (error) => {
        console.error("WebSocket Error:", error);
    };

    return () => {
        ws.close();
    };
  }, []);
  
  useEffect(() => {
      fetchHistory();
  }, []);

  const fetchHistory = () => {
      fetch('/api/reports/history')
        .then(res => res.json())
        .then(data => setHistory(data))
        .catch(err => console.error("History Error:", err));
  };

  const handleStart = async () => {
    try {
      const formData = new FormData();
      formData.append('target_ip', config.target_ip || '127.0.0.1'); // Use default if empty
      formData.append('vus', config.vus);
      formData.append('duration', config.duration);
      formData.append('mode', config.mode);
      formData.append('base_dn', config.base_dn); // Add Base DN
      if(config.attackType === 'single') {
          formData.append('user_dn', config.user_dn);
          formData.append('password', config.password);
          formData.append('use_csv', 'False');
      } else {
          if(!config.file) { alert("Please upload a CSV file!"); return; }
          formData.append('use_csv', 'True');
          formData.append('csv_file', config.file);
          formData.append('user_dn', 'dummy'); 
          formData.append('password', 'dummy');
      }

      const res = await fetch('/api/start', {
        method: 'POST',
        body: formData 
      });
      
      if(res.ok) {
          setLog(["Initializing " + config.mode.toUpperCase() + " Vector...", "Attack Type: " + config.attackType.toUpperCase(), "Spawning Virtual Users..."]);
          setReport(null);
      } else {
          const err = await res.json();
          alert("Error: " + err.detail);
      }
    } catch(err) {
      alert("Failed to start: " + err);
    }
  };

  const handleStop = async (isAutoStop = false) => {
    if (!isAutoStop) {
        setLog(prev => [...prev, "--- INITIATING MANUAL ABORT ---"]);
        await fetch('/api/stop', { method: 'POST' });
        setLog(prev => [...prev, "--- ATTACK MANUALLY ABORTED ---"]);
    } else {
         setLog(prev => [...prev, "--- TEST COMPLETED NORMALLY ---"]);
    }
    
    setLog(prev => [...prev, "Generating Final Report..."]);
    setStatus({ status: 'stopped', duration: status.duration }); // Immediate UI feedback
    
    // Poll for report
    let attempts = 0;
    const pollReport = async () => {
        try {
            const res = await fetch('/api/report');
            if(res.ok) {
                const data = await res.json();
                setReport(data);
                setLog(prev => [...prev, "REPORT GENERATED SUCCESSFULLY."]);
                // Ensure history is fetched first
                fetch('/api/reports/history')
                    .then(res => res.json())
                    .then(newHistory => {
                        setHistory(newHistory); // Update history state
                        if (newHistory.length > 0) {
                            // Automatically open the latest report
                            const latestRun = newHistory[0];
                            viewReport(latestRun);
                        }
                    })
                    .catch(err => console.error("History Refresh Error:", err));
            } else if (attempts < 5) {
                attempts++;
                setTimeout(pollReport, 1000);
            } else {
                setLog(prev => [...prev, "Failed to generate report after multiple attempts."]);
            }
        } catch(e) {
            console.error("Report Fetch Error:", e);
            if (attempts < 5) {
                attempts++;
                setTimeout(pollReport, 1000);
            }
        }
    };
    
    pollReport();
  };
  
  const viewReport = async (run) => {
    // Path looks like results/run_...
    const runName = run.Path.split('/').filter(Boolean).pop();
    const target = run.Target;
    const vus = run.Users;
    const duration = run.Duration.split('/')[1]?.trim() || run.Duration;
    
    try {
      const res = await fetch(`/api/reports/view/${runName}?target=${target}&mode=load&vus=${vus}&duration=${duration}`);
      if (res.ok) {
        const reportHtml = await res.text();
        setSelectedReport(reportHtml);
      } else {
        alert("Failed to load detailed report. Make sure report_gen.py has run.");
      }
    } catch (err) {
      console.error(err);
      alert("Error loading report");
    }
  };

  const clearHistory = async () => {
      if (confirm("Are you sure you want to clear all report history? This action cannot be undone.")) {
          try {
              const res = await fetch('/api/reports/clear', { method: 'POST' });
              if (res.ok) {
                  fetchHistory();
                  alert("Report history cleared.");
              } else {
                  alert("Failed to clear history.");
              }
          } catch (err) {
              console.error(err);
              alert("Error clearing history.");
          }
      }
  };

  // --- Trend Analysis Logic ---
  const [chartInstance, setChartInstance] = useState(null);
  const [trendFilter, setTrendFilter] = useState({
      ip: 'All',
      startDate: '',
      endDate: ''
  });

  const getUniqueIPs = () => {
      const ips = new Set(history.map(h => h.Target));
      return ['All', ...Array.from(ips)];
  };

  useEffect(() => {
      if (history.length === 0) return;
      renderChart();
  }, [history, trendFilter]);

  const renderChart = () => {
      const ctx = document.getElementById('trendChart');
      if (!ctx) return;

      if (chartInstance) chartInstance.destroy();

      // Filter Data
      let data = history.filter(h => {
          let matchIp = trendFilter.ip === 'All' || h.Target === trendFilter.ip;
          let date = new Date(h.Timestamp);
          let matchStart = !trendFilter.startDate || date >= new Date(trendFilter.startDate);
          let matchEnd = !trendFilter.endDate || date <= new Date(trendFilter.endDate + 'T23:59:59');
          return matchIp && matchStart && matchEnd;
      });

      // Sort by date ascending for the chart
      data.sort((a, b) => new Date(a.Timestamp) - new Date(b.Timestamp));

      const labels = data.map(h => h.Timestamp);
      const vus = data.map(h => parseInt(h.Users));
      
      // Parse duration "60s / 60s" -> take the first part (actual survival)
      const durations = data.map(h => {
          let d = h.Duration.split('/')[0].replace('s', '').trim();
          return parseInt(d);
      });

      const newChart = new Chart(ctx, {
          type: 'bar',
          data: {
              labels: labels,
              datasets: [
                  {
                      label: 'Virtual Users (Load)',
                      data: vus,
                      backgroundColor: 'rgba(56, 189, 248, 0.5)', // Blue
                      borderColor: '#38bdf8',
                      borderWidth: 1,
                      yAxisID: 'y'
                  },
                  {
                      label: 'Survival Time (Sec)',
                      data: durations,
                      type: 'line',
                      borderColor: '#22c55e', // Green
                      backgroundColor: 'rgba(34, 197, 94, 0.2)',
                      pointBackgroundColor: '#22c55e',
                      pointRadius: 4,
                      tension: 0.1,
                      yAxisID: 'y1'
                  }
              ]
          },
          options: {
              responsive: true,
              maintainAspectRatio: false,
              interaction: {
                  mode: 'index',
                  intersect: false,
              },
              plugins: {
                  legend: { labels: { color: '#cbd5e1' } },
                  title: { display: true, text: 'Load vs Survival Trend', color: '#fff' },
                  tooltip: {
                      callbacks: {
                          footer: (tooltipItems) => {
                              let index = tooltipItems[0].dataIndex;
                              let item = data[index];
                              return `Status: ${item.Status}\nTarget: ${item.Target}`;
                          }
                      }
                  }
              },
              scales: {
                  x: { ticks: { color: '#94a3b8' }, grid: { color: '#334155' } },
                  y: {
                      type: 'linear',
                      display: true,
                      position: 'left',
                      title: { display: true, text: 'Virtual Users', color: '#38bdf8' },
                      ticks: { color: '#94a3b8' }, 
                      grid: { color: '#334155' } 
                  },
                  y1: {
                      type: 'linear',
                      display: true,
                      position: 'right',
                      title: { display: true, text: 'Seconds', color: '#22c55e' },
                      ticks: { color: '#94a3b8' },
                      grid: { drawOnChartArea: false }
                  }
              }
          }
      });
      setChartInstance(newChart);
  };
  
  return (
    <div className="container mx-auto p-8 max-w-7xl">
      <header className="mb-8 text-center border-b border-green-500 pb-4">
        <h1 className="text-4xl font-bold text-green-400 tracking-wider">TECHTON <span className="text-white text-sm">v2.5 ENTERPRISE</span></h1>
        <p className="text-slate-400 mt-2">Active Directory Stress & Resilience Suite</p>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        {/* Configuration Panel */}
        <div className="bg-slate-800 p-6 rounded-lg cyber-border relative overflow-hidden">
          <div className="absolute top-0 left-0 bg-green-500 text-black text-xs font-bold px-2 py-1">CONFIGURATION</div>
          
          <div className="space-y-4 mt-4">
            <div>
              <label className="block text-green-300 text-sm mb-1">Target AD Server (IP)</label>
              <input 
                className="input-field rounded" 
                placeholder="e.g., 192.168.1.100"
                value={config.target_ip} 
                onChange={e => setConfig({...config, target_ip: e.target.value})} 
              />
            </div>

            <div>
              <label className="block text-green-300 text-sm mb-1">Attack Mode</label>
              <select 
                className="input-field rounded"
                value={config.mode}
                onChange={e => setConfig({...config, mode: e.target.value})}
              >
                  <option value="load">Stress Test (Load Generation)</option>
                  <option value="audit">Security Audit (Conf/Vuln)</option>
              </select>
            </div>
            
            <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-green-300 text-sm mb-1">Virtual Users (VUs)</label>
                  <input 
                    type="number"
                    className="input-field rounded" 
                    value={config.vus} 
                    onChange={e => setConfig({...config, vus: parseInt(e.target.value)})} 
                  />
                </div>
                <div>
                  <label className="block text-green-300 text-sm mb-1">Duration</label>
                  <input 
                    className="input-field rounded" 
                    value={config.duration} 
                    placeholder="e.g., 60s, 2m"
                    onChange={e => setConfig({...config, duration: e.target.value})} 
                  />
                </div>
            </div>

            {/* Advanced Section */}
            <div className="bg-slate-900/50 p-3 rounded border border-slate-700">
                <label className="block text-slate-400 text-[10px] uppercase font-bold mb-2 tracking-widest">Advanced Configuration (Optional)</label>
                <div>
                  <label className="block text-green-300 text-xs mb-1">Search Base DN Override</label>
                  <input 
                    className="input-field rounded text-xs py-1" 
                    placeholder="e.g. OU=User,OU=BRIN,DC=net,DC=brin,DC=go,DC=id"
                    value={config.base_dn} 
                    onChange={e => setConfig({...config, base_dn: e.target.value})} 
                  />
                  <p className="text-[10px] text-slate-500 mt-1">If empty, system will attempt auto-discovery from credentials.</p>
                </div>
            </div>

            {/* Attack Type Toggle */}
            <div className="flex bg-slate-900 rounded p-1">
                <button 
                    className={`flex-1 py-1 text-xs font-bold rounded ${config.attackType === 'single' ? 'bg-green-600 text-white' : 'text-slate-400'}`}
                    onClick={() => setConfig({...config, attackType: 'single'})}
                >
                    SINGLE USER
                </button>
                <button 
                    className={`flex-1 py-1 text-xs font-bold rounded ${config.attackType === 'csv' ? 'bg-green-600 text-white' : 'text-slate-400'}`}
                    onClick={() => setConfig({...config, attackType: 'csv'})}
                >
                    MULTI-USER (CSV)
                </button>
            </div>

            {config.attackType === 'single' ? (
                <>
                    <div>
                    <label className="block text-green-300 text-sm mb-1">User Credential</label>
                    <input 
                        className="input-field rounded placeholder-slate-500" 
                        placeholder="DOMAIN\Username (e.g. BRIN\dity001)"
                        value={config.user_dn} 
                        onChange={e => setConfig({...config, user_dn: e.target.value})} 
                    />
                    <p className="text-[10px] text-slate-500 mt-1">Use NetBIOS format (DOMAIN\User). Email format may fail.</p>
                    </div>

                    <div>
                    <label className="block text-green-300 text-sm mb-1">Password</label>
                    <input 
                        type="password"
                        placeholder="••••••••"
                        className="input-field rounded" 
                        value={config.password} 
                        onChange={e => setConfig({...config, password: e.target.value})} 
                    />
                    </div>
                </>
            ) : (
                <div className="border border-dashed border-slate-600 p-4 rounded text-center">
                    <label className="block text-green-300 text-sm mb-2">Upload User List (CSV)</label>
                    <input 
                        type="file" 
                        accept=".csv"
                        className="text-xs text-slate-400 file:mr-2 file:py-1 file:px-2 file:rounded file:border-0 file:text-xs file:bg-green-700 file:text-white hover:file:bg-green-600"
                        onChange={e => setConfig({...config, file: e.target.files[0]})}
                    />
                    <p className="text-xs text-slate-500 mt-2">Format: username/email, password</p>
                </div>
            )}

            {status.status === 'running' && (
                <div className="bg-red-900/30 border border-red-500 p-3 rounded text-xs text-red-200">
                    <strong>⚠️ MONITORING ADVISORY:</strong> Pantau utilizasi CPU/RAM server <strong>{config.target_ip}</strong>. 
                    Jika latensi &gt;5s atau terjadi saturasi resource, segera tekan <strong>STOP</strong> untuk mencegah kegagalan layanan (Outage).
                </div>
            )}

            <div className="pt-4 flex gap-4">
                <button 
                    onClick={handleStart}
                    disabled={status.status === 'running'}
                    className={`flex-1 py-3 font-bold rounded ${status.status === 'running' ? 'bg-slate-600 cursor-not-allowed' : 'bg-green-600 hover:bg-green-500 text-white'}`}
                >
                    {status.status === 'running' ? 'RUNNING...' : 'INITIATE STRESS TEST'}
                </button>
                
                {status.status === 'running' && (
                    <button 
                        onClick={() => handleStop(false)}
                        className="flex-1 py-3 font-bold rounded bg-red-600 hover:bg-red-500 text-white"
                    >
                        STOP & REPORT
                    </button>
                )}
            </div>
          </div>
        </div>
        
        {/* RIGHT PANEL Code (Status, Log, Report) remains here */}
        <div className="space-y-6">
            {/* Live Stats */}
            <div className="bg-slate-900 p-6 rounded-lg border border-slate-700">
                <h3 className="text-green-400 text-lg mb-4 flex items-center gap-2">
                    <span className={`w-3 h-3 rounded-full ${status.status === 'running' ? 'bg-red-500 animate-ping' : 'bg-slate-500'}`}></span>
                    LIVE TELEMETRY
                </h3>
                
                <div className="grid grid-cols-2 gap-4 text-center">
                    <div className="bg-slate-800 p-4 rounded">
                        <div className="text-3xl font-mono text-white">{status.status === 'running' ? config.vus : '0'}</div>
                        <div className="text-xs text-slate-400">ACTIVE THREADS</div>
                    </div>
                    <div className="bg-slate-800 p-4 rounded">
                        <div className="text-3xl font-mono text-green-400">{status.status === 'finished' ? 'DONE' : `${status.duration}s`}</div>
                        <div className="text-xs text-slate-400">ELAPSED TIME</div>
                    </div>
                </div>
            </div>

            {/* Console Log */}
            <div className="bg-black p-4 rounded-lg border border-slate-700 h-96 overflow-y-auto font-mono text-xs">
                <div className="text-slate-500 border-b border-slate-800 mb-2 pb-1">SYSTEM LOG {status.status === 'running' ? '(ACTIVE)' : ''}</div>
                {log.map((l, i) => (
                    <div key={i} className="text-green-500">> {l}</div>
                ))}
                {log.length === 0 && <div className="text-slate-600 italic">Ready for command...</div>}
            </div>

            {/* REPORT CARD (Shows only when report is ready) */}
            {report ? (
                <div className="bg-slate-800 p-6 rounded-lg border-l-4 border-blue-500 shadow-lg animate-fade-in">
                    <div className="flex justify-between items-start mb-4">
                        <h2 className="text-xl font-bold text-white">📑 EXECUTIVE REPORT</h2>
                        <div className={`text-xl font-bold px-3 py-1 rounded ${report.status === 'COMPLETED' || report.status === 'STABLE' ? 'bg-green-600' : 'bg-red-600'}`}>
                            STATUS: {report.status}
                        </div>
                    </div>
                    
                    <div className="text-sm text-slate-300 mb-4 font-mono">
                        <p className="mb-2 font-bold text-green-400">{report.summary}</p>
                        <p className="text-xs text-slate-500">Run At: {report.timestamp} | Target: {report.target}</p>
                    </div>

                    <div className="grid grid-cols-3 gap-2 mb-4 text-center">
                         <div className="bg-slate-900 p-2 rounded">
                            <div className="text-lg font-bold text-white">{report.stats.peak_vus}</div>
                            <div className="text-[10px] text-slate-400">PEAK USERS</div>
                         </div>
                         <div className="bg-slate-900 p-2 rounded">
                            <div className="text-lg font-bold text-yellow-400">{report.stats.survival_time}</div>
                            <div className="text-[10px] text-slate-400">SURVIVAL TIME</div>
                         </div>
                         <div className="bg-slate-900 p-2 rounded">
                            <div className="text-lg font-bold text-red-400">{report.stats.error_rate}</div>
                            <div className="text-[10px] text-slate-400">ERROR RATE</div>
                         </div>
                    </div>

                    <div className="bg-slate-900 p-4 rounded border border-slate-700">
                        <h4 className="text-blue-400 font-bold text-xs mb-2 uppercase">🔍 Technical Analysis</h4>
                        <ul className="list-disc pl-4 space-y-1">
                            {report.recommendations.length > 0 ? report.recommendations.map((rec, i) => (
                                <li key={i} className="text-xs text-slate-300">{rec}</li>
                            )) : <li className="text-xs text-slate-500">No specific issues detected.</li>}
                        </ul>
                    </div>
                </div>
            ) : status.status === 'stopped' && log.includes("Generating Final Report...") && (
                <div className="bg-slate-800 p-6 rounded-lg border border-slate-700 animate-pulse text-center">
                    <p className="text-green-400">Compiling stress test metrics...</p>
                </div>
            )}
        </div>
      </div>
      
      {/* Trend Analysis Section */}
      <div className="mt-8 mb-8">
        <h2 className="text-xl font-bold text-green-400 mb-4 px-1">Trend Analysis</h2>
        <div className="bg-slate-800 p-6 rounded-lg border border-slate-700 w-full">
            {/* Filters */}
            <div className="flex flex-wrap gap-4 mb-6">
                <div>
                    <label className="block text-xs text-slate-400 mb-1">Filter IP</label>
                    <select 
                        className="bg-slate-700 text-white p-2 rounded text-sm border border-slate-600"
                        value={trendFilter.ip}
                        onChange={e => setTrendFilter({...trendFilter, ip: e.target.value})}
                    >
                        {getUniqueIPs().map(ip => <option key={ip} value={ip}>{ip}</option>)}
                    </select>
                </div>
                <div>
                    <label className="block text-xs text-slate-400 mb-1">Start Date</label>
                    <input 
                        type="date" 
                        className="bg-slate-700 text-white p-2 rounded text-sm border border-slate-600"
                        value={trendFilter.startDate}
                        onChange={e => setTrendFilter({...trendFilter, startDate: e.target.value})}
                    />
                </div>
                <div>
                    <label className="block text-xs text-slate-400 mb-1">End Date</label>
                    <input 
                        type="date" 
                        className="bg-slate-700 text-white p-2 rounded text-sm border border-slate-600"
                        value={trendFilter.endDate}
                        onChange={e => setTrendFilter({...trendFilter, endDate: e.target.value})}
                    />
                </div>
            </div>

            {/* Chart Container */}
            <div className="relative h-96 w-full">
                {history.length > 0 ? (
                    <canvas id="trendChart"></canvas>
                ) : (
                    <div className="flex items-center justify-center h-full text-slate-500">
                        No data available for analysis.
                    </div>
                )}
            </div>
        </div>
      </div>

      {/* History Section */}
      <div>
        <div className="flex justify-between items-center mb-4">
            <h2 className="text-2xl font-bold text-green-400">Historical Reports</h2>
            <div className="flex items-center gap-4">
                <p className="text-sm text-slate-400">Showing last 100 runs</p>
                <button onClick={clearHistory} className="bg-red-600 hover:bg-red-500 text-white text-xs font-bold py-1 px-3 rounded">
                    Clear History
                </button>
            </div>
        </div>
        <div className="bg-slate-800 rounded-lg cyber-border overflow-hidden">
            <table className="w-full text-sm text-left">
                <thead className="bg-slate-900 text-xs text-slate-400 uppercase">
                    <tr>
                        <th className="p-3">Timestamp</th>
                        <th className="p-3">Target</th>
                        <th className="p-3">VUs</th>
                        <th className="p-3">Duration (Actual/Target)</th>
                        <th className="p-3">Latency</th>
                        <th className="p-3">Errors</th>
                        <th className="p-3">Status</th>
                        <th className="p-3"></th>
                    </tr>
                </thead>
                <tbody>
                    {history.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage).map((run, i) => (
                        <tr key={i} className="border-b border-slate-700 hover:bg-slate-700">
                            <td className="p-3 font-mono">{run.Timestamp}</td>
                            <td className="p-3 font-mono">{run.Target}</td>
                            <td className="p-3">{run.Users}</td>
                            <td className={`p-3 font-mono ${parseInt(run.Duration.split('/')[0]) > parseInt(run.Duration.split('/')[1]) + 10 ? 'text-red-400' : 'text-slate-300'}`}>
                                {run.Duration}
                            </td>
                            <td className="p-3">{run.AvgLatency}</td>
                            <td className="p-3">{run.Errors}</td>
                            <td className="p-3">
                                <span className={`px-2 py-1 text-xs rounded-full font-bold ${['PASS', 'COMPLETED', 'STABLE', 'SUCCESS'].includes(run.Status?.toUpperCase()) ? 'bg-green-500/20 text-green-400 border border-green-500' : 'bg-red-500/20 text-red-400 border border-red-500'}`}>
                                    {run.Status}
                                </span>
                            </td>
                            <td className="p-3 text-right">
                                <button onClick={() => viewReport(run)} className="text-green-400 hover:underline text-xs">View Report</button>
                            </td>
                        </tr>
                    ))}
                     {history.length === 0 && (
                        <tr>
                            <td colSpan="8" className="text-center p-8 text-slate-500">No historical data available.</td>
                        </tr>
                    )}
                </tbody>
            </table>
        </div>
        
        {/* Pagination Controls */}
        <div className="flex justify-between items-center mt-4 px-2">
            <button 
                onClick={() => setCurrentPage(prev => Math.max(prev - 1, 1))}
                disabled={currentPage === 1}
                className={`px-4 py-2 text-xs font-bold rounded ${currentPage === 1 ? 'bg-slate-800 text-slate-600 cursor-not-allowed' : 'bg-slate-700 hover:bg-slate-600 text-white'}`}
            >
                Previous
            </button>
            <span className="text-slate-400 text-xs font-mono">
                Page {currentPage} of {Math.max(1, Math.ceil(history.length / itemsPerPage))}
            </span>
            <button 
                onClick={() => setCurrentPage(prev => Math.min(prev + 1, Math.ceil(history.length / itemsPerPage)))}
                disabled={currentPage >= Math.ceil(history.length / itemsPerPage)}
                className={`px-4 py-2 text-xs font-bold rounded ${currentPage >= Math.ceil(history.length / itemsPerPage) ? 'bg-slate-800 text-slate-600 cursor-not-allowed' : 'bg-slate-700 hover:bg-slate-600 text-white'}`}
            >
                Next
            </button>
        </div>
      </div>
      
      {selectedReport && (
        <div className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center p-4">
            <div className="bg-slate-800 rounded-lg w-full max-w-6xl h-[90vh] flex flex-col">
                <header className="p-4 border-b border-slate-700 flex justify-between items-center">
                    <h2 className="text-lg font-bold text-white">Detailed Report</h2>
                    <button onClick={() => setSelectedReport(null)} className="text-slate-400 hover:text-white">Close</button>
                </header>
                <div className="flex-grow p-4 overflow-y-auto">
                    <iframe srcDoc={selectedReport} className="w-full h-full border-0"/>
                </div>
            </div>
        </div>
      )}
    </div>
  );
}

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(<App />);