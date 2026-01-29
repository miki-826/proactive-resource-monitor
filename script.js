// Mock and Real data integration
async function updateMetrics() {
    try {
        // Simulating data fetch
        const cpu = Math.floor(Math.random() * 20 + 5);
        const mem = Math.floor(Math.random() * 10 + 65);
        
        document.getElementById('cpu-gauge').innerText = `${cpu}%`;
        document.getElementById('mem-gauge').innerText = `${mem}%`;
        
        const badge = document.getElementById('status-badge');
        badge.innerText = 'Online';
        badge.style.color = '#10b981';

        const info = document.getElementById('sys-info');
        info.innerText = `
OS: Linux (arm64)
Uptime: 4d 13h 05m
Disk: 45GB / 128GB (35%)
Gateway: Connected (v2026.1.24-3)
Node: v24.13.0
Model: gemini-3-flash
Last Check: ${new Date().toLocaleTimeString()}
        `.trim();

    } catch (error) {
        console.error('Failed to update metrics', error);
    }
}

const mockLogs = [
    { time: "06:00:01", level: "INFO", msg: "Cron: daily-ai-news-report started" },
    { time: "06:00:45", level: "INFO", msg: "Research completed. Sending to Discord..." },
    { time: "06:01:10", level: "INFO", msg: "Notion database updated successfully." },
    { time: "06:30:00", level: "INFO", msg: "Heartbeat check: all systems operational." },
    { time: "06:41:22", level: "INFO", msg: "Incoming message from mikimiki on Discord" },
    { time: "06:42:05", level: "INFO", msg: "Browser screenshot captured for preview" },
    { time: "06:52:11", level: "INFO", msg: "Request for feature expansion: logs and history" }
];

function updateLogs() {
    const container = document.getElementById('log-viewer');
    container.innerHTML = '';
    
    mockLogs.forEach(log => {
        const entry = document.createElement('div');
        entry.className = 'log-entry';
        entry.innerHTML = `
            <span class="log-time">[${log.time}]</span>
            <span class="log-level-${log.level.toLowerCase()}">${log.level}</span>
            <span class="log-msg">${log.msg}</span>
        `;
        container.appendChild(entry);
    });
}

const activityHistory = [
    { time: "Yesterday", event: "Initial prototype of Site Upgrade Worker deployed" },
    { time: "01:00 AM", event: "Nightly Innovation: Proactive Resource Monitor created" },
    { time: "06:00 AM", event: "Daily AI News report generated and archived to Notion" },
    { time: "06:45 AM", event: "Delivered first preview of Resource Monitor to Discord" },
    { time: "07:05 AM", event: "Updating Resource Monitor with Log and History features" }
];

function updateHistory() {
    const container = document.getElementById('activity-history');
    container.innerHTML = '';

    activityHistory.forEach(item => {
        const div = document.createElement('div');
        div.className = 'activity-item';
        div.innerHTML = `
            <span class="time">${item.time}</span>
            <span class="event">${item.event}</span>
        `;
        container.appendChild(div);
    });
}

// Initial updates
updateMetrics();
updateLogs();
updateHistory();

// Periodic updates
setInterval(updateMetrics, 5000);
