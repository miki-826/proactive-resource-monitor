// Mock data for initial prototype
// In a real scenario, this would fetch from a local API endpoint
async function updateMetrics() {
    try {
        // Simulating data fetch
        const cpu = Math.floor(Math.random() * 100);
        const mem = Math.floor(Math.random() * 100);
        
        document.getElementById('cpu-gauge').innerText = `${cpu}%`;
        document.getElementById('mem-gauge').innerText = `${mem}%`;
        
        const badge = document.getElementById('status-badge');
        badge.innerText = 'Online';
        badge.style.color = '#10b981';

        const info = document.getElementById('sys-info');
        info.innerText = `
OS: Linux (arm64)
Uptime: 4d 12h 30m
Disk: 45GB / 128GB (35%)
Gateway: Connected (v0.1.0)
Last Check: ${new Date().toLocaleTimeString()}
        `.trim();

    } catch (error) {
        console.error('Failed to update metrics', error);
    }
}

// Update every 5 seconds
setInterval(updateMetrics, 5000);
updateMetrics();
