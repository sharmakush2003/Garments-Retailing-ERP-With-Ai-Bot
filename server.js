require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const webhookRouter = require('./routes/webhook');
const { useMemoryFallback } = require('./workers/messageWorker');

// In-Memory Logger for remote diagnostics
const logStore = [];
const maxLogs = 100;
function captureLog(type, args) {
    const message = args.map(arg => typeof arg === 'object' ? JSON.stringify(arg) : arg).join(' ');
    const timestamp = new Date().toISOString();
    logStore.push(`[${timestamp}] [${type}] ${message}`);
    if (logStore.length > maxLogs) {
        logStore.shift();
    }
}
const originalLog = console.log;
const originalError = console.error;
const originalWarn = console.warn;

console.log = (...args) => {
    captureLog('INFO', args);
    originalLog(...args);
};
console.error = (...args) => {
    captureLog('ERROR', args);
    originalError(...args);
};
console.warn = (...args) => {
    captureLog('WARN', args);
    originalWarn(...args);
};

const app = express();
const PORT = process.env.PORT || 3000;

app.get('/logs', (req, res) => {
    res.type('text/plain').send(logStore.join('\n'));
});

// Enable JSON body parsing
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Register routes
app.use('/webhook', webhookRouter);
// Fallback: also accept webhooks at root / for flexibility
app.post('/', webhookRouter);

// Root GET landing page for browser status check
app.get('/', (req, res) => {
    res.send(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>Digify Soft ERP - AutomateX AI Gateway</title>
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <style>
                body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background: #0f172a; color: #f8fafc; display: flex; justify-content: center; align-items: center; min-height: 100vh; margin: 0; }
                .card { background: #1e293b; padding: 2.5rem; border-radius: 1rem; box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.5); max-width: 550px; width: 90%; border: 1px solid #334155; }
                .status { display: inline-flex; align-items: center; gap: 0.5rem; background: #064e3b; color: #34d399; padding: 0.4rem 1rem; border-radius: 9999px; font-weight: 600; font-size: 0.9rem; margin-bottom: 1.5rem; }
                .pulse { width: 10px; height: 10px; background: #10b981; border-radius: 50%; box-shadow: 0 0 10px #10b981; }
                h1 { margin: 0 0 0.5rem 0; font-size: 1.6rem; color: #38bdf8; }
                p { color: #94a3b8; line-height: 1.5; margin-bottom: 1.5rem; }
                .info-box { background: #0f172a; padding: 1rem; border-radius: 0.5rem; font-family: monospace; font-size: 0.85rem; color: #e2e8f0; border: 1px solid #334155; margin-bottom: 1rem; }
                .label { color: #64748b; font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.05em; display: block; margin-bottom: 0.3rem; }
            </style>
        </head>
        <body>
            <div class="card">
                <div class="status"><div class="pulse"></div> 24/7 ONLINE & OPERATIONAL</div>
                <h1>Digify Soft ERP — AutomateX Gateway</h1>
                <p>Wholesale Garment ERP WhatsApp Automation Engine</p>
                <div class="info-box">
                    <span class="label">Webhook Endpoint:</span>
                    POST https://garments-erp-bot.onrender.com/webhook
                </div>
                <div class="info-box">
                    <span class="label">Query Engine:</span>
                    Local Regex & NLP Parsing Engine
                </div>
                <div class="info-box">
                    <span class="label">WhatsApp Provider:</span>
                    AutobotChat WABA (Connected)
                </div>
            </div>
        </body>
        </html>
    `);
});

// Health check endpoint
app.get('/health', (req, res) => {
    res.status(200).json({ status: 'OK', message: 'Digify Soft API Gateway is operational' });
});

// Configure resilient queue fallback if Redis is not used
if (process.env.USE_REDIS !== 'true') {
    useMemoryFallback();
}

if (require.main === module) {
    app.listen(PORT, () => {
        console.log(`=======================================================`);
        console.log(`   DIGIFY SOFT ERP - AUTOMATEX GATEWAY IS RUNNING     `);
        console.log(`   Server port: ${PORT}                               `);
        console.log(`   Webhook URL: http://localhost:${PORT}/webhook      `);
        console.log(`=======================================================`);
    });
}

module.exports = app;
