require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const path = require('path');
const webhookRouter = require('./routes/webhook');
const { useMemoryFallback } = require('./workers/messageWorker');
const { getTenantDb } = require('./services/dbManager');
const OrderService = require('./services/orderService');

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

// Serve generated PDF documents statically
app.use('/public', express.static(path.join(__dirname, 'public')));

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
            <title>Digify Soft Solutions - Kaira Chatbot</title>
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
                <h1>Digify Soft Solutions — Kaira Chatbot</h1>
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

// --- Mock REST API Endpoints for ERP Customer Journey ---

// 1. Get all products (with optional filters)
app.get('/api/mock/products', (req, res) => {
    let items = require('./mock_data/products.json');
    const { category, subcategory, color, size, maxPrice } = req.query;

    if (category) {
        const catClean = category.toLowerCase().trim();
        items = items.filter(i => i.category && (
            i.category.toLowerCase() === catClean ||
            i.category.toLowerCase().includes(catClean) ||
            catClean.includes(i.category.toLowerCase())
        ));
    }
    if (subcategory) items = items.filter(i => i.subcategory && i.subcategory.toLowerCase() === subcategory.toLowerCase());
    if (color) items = items.filter(i => i.color && i.color.toLowerCase() === color.toLowerCase());
    if (size) items = items.filter(i => i.size && i.size.toLowerCase() === size.toLowerCase());
    if (maxPrice) items = items.filter(i => i.price <= parseFloat(maxPrice));

    res.json(items);
});

// 2. Stock availability search
app.get('/api/mock/stock-availability', (req, res) => {
    let { skuIdOrCode, color, size, garmentType } = req.query;

    console.log('[Mock API] Stock availability query params received:', { skuIdOrCode, color, size, garmentType });

    if (skuIdOrCode === 'null' || skuIdOrCode === 'undefined') skuIdOrCode = null;
    if (color === 'null' || color === 'undefined') color = null;
    if (size === 'null' || size === 'undefined') size = null;
    if (garmentType === 'null' || garmentType === 'undefined') garmentType = null;

    const items = require('./mock_data/products.json');

    if (skuIdOrCode) {
        const match = items.find(i => i.sku_id === parseInt(skuIdOrCode) || i.sku_code.toLowerCase().includes(skuIdOrCode.toLowerCase()));
        if (match) return res.json(match);
    }

    if (color || size || garmentType) {
        const match = items.find(i => {
            const colorOk = !color || i.color.toLowerCase().includes(color.toLowerCase()) || color.toLowerCase().includes(i.color.toLowerCase());
            const sizeOk = !size || i.size.toLowerCase() === size.toLowerCase();
            const typeOk = !garmentType || i.category.toLowerCase() === garmentType.toLowerCase() || i.sku_code.toLowerCase().includes(garmentType.toLowerCase());
            return colorOk && sizeOk && typeOk;
        });
        if (match) return res.json(match);
    }

    res.status(404).json({ error: 'Item not found' });
});

// 3. Item Price Lookup
app.get('/api/mock/item-price', (req, res) => {
    const { skuId, tierId } = req.query;
    const items = require('./mock_data/products.json');
    const matchedItem = items.find(i => i.sku_id === parseInt(skuId));
    const base = matchedItem ? matchedItem.price : 480.00;
    
    // Apply discount for VIP (tier 1)
    let finalPrice = base;
    if (parseInt(tierId) === 1) {
        finalPrice = base * 0.90; // 10% discount for tier 1
    } else if (parseInt(tierId) === 2) {
        finalPrice = base * 0.96; // 4% discount for tier 2
    }
    res.json({ price: finalPrice });
});

// 4. Get all categories
app.get('/api/mock/categories', (req, res) => {
    const items = require('./mock_data/categories.json');
    res.json(items);
});

// 5. Get all subcategories
app.get('/api/mock/subcategories', (req, res) => {
    const items = require('./mock_data/subcategories.json');
    res.json(items);
});

// 6. Get old shipment inquiry (all/completed shipments)
app.get('/api/mock/old-shipments', (req, res) => {
    const items = require('./mock_data/old_shipment_inquiry.json');
    const { phone } = req.query;
    if (phone) {
        const match = items.find(i => i.phone && (i.phone.includes(phone) || phone.includes(i.phone)));
        if (match) return res.json(match.shipments || []);
    }
    res.json(items[0] ? items[0].shipments || [] : []);
});

// 7. Get old ledger status
app.get('/api/mock/old-ledger-status', (req, res) => {
    const items = require('./mock_data/old_ledger_status.json');
    const { phone } = req.query;
    if (phone) {
        const match = items.find(i => i.phone && (i.phone.includes(phone) || phone.includes(i.phone)));
        if (match) return res.json(match.transactions || []);
    }
    res.json(items[0] ? items[0].transactions || [] : []);
});

// 8. Get last invoice copy
app.get('/api/mock/last-invoice-copy', (req, res) => {
    const items = require('./mock_data/last_invoice_copy.json');
    const { phone } = req.query;
    if (phone) {
        const match = items.find(i => i.phone && (i.phone.includes(phone) || phone.includes(i.phone)));
        if (match) return res.json(match);
    }
    res.json(items[0] || {});
});

// 9. Get active shipment tracking status
app.get('/api/mock/shipment-status', (req, res) => {
    const items = require('./mock_data/shipment_status.json');
    const { orderId, dispatchId, trackingNumber, phone } = req.query;
    if (dispatchId) {
        const match = items.find(i => 
            i.dispatch_id === parseInt(dispatchId) || 
            (i.tracking_number && i.tracking_number.toLowerCase() === dispatchId.toLowerCase()) || 
            (i.lr_number && i.lr_number.toLowerCase() === dispatchId.toLowerCase())
        );
        if (match) return res.json(match);
        return res.status(404).json({ error: 'Shipment not found' });
    }
    if (orderId) {
        const match = items.find(i => i.order_id === parseInt(orderId));
        if (match) return res.json(match);
        return res.status(404).json({ error: 'Shipment not found' });
    }
    if (trackingNumber) {
        const match = items.find(i => 
            (i.tracking_number && i.tracking_number.toLowerCase() === trackingNumber.toLowerCase()) || 
            (i.lr_number && i.lr_number.toLowerCase() === trackingNumber.toLowerCase())
        );
        if (match) return res.json(match);
        return res.status(404).json({ error: 'Shipment not found' });
    }
    if (phone) {
        const match = items.find(i => i.phone && (i.phone.includes(phone) || phone.includes(i.phone)));
        if (match) return res.json(match);
        return res.status(404).json({ error: 'Shipment not found' });
    }
    res.json(items[0] || {});
});

// 10. Get outstanding balance status
app.get('/api/mock/outstanding', (req, res) => {
    const items = require('./mock_data/outstanding.json');
    const { phone } = req.query;
    if (phone) {
        const match = items.find(i => i.phone && (i.phone.includes(phone) || phone.includes(i.phone)));
        if (match) return res.json(match);
    }
    res.json(items[0] || {});
});

// 11. Create a new Sales Order
app.post('/api/orders', async (req, res) => {
    try {
        const { customerId, items } = req.body;
        const tenantId = req.headers['x-tenant-id'] || 'Co_102';
        const db = await getTenantDb(tenantId);

        const order = await OrderService.createOrder(db, customerId || 1, items);
        res.status(201).json(order);
    } catch (err) {
        console.error('[API] Failed to create order:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// 12. Reorder a past order
app.post('/api/orders/reorder', async (req, res) => {
    try {
        const { orderId } = req.body;
        const tenantId = req.headers['x-tenant-id'] || 'Co_102';
        const db = await getTenantDb(tenantId);

        const order = await OrderService.reorder(db, orderId);
        res.status(201).json(order);
    } catch (err) {
        console.error('[API] Failed to reorder:', err.message);
        res.status(500).json({ error: err.message });
    }
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
        console.log(`   DIGIFY SOFT SOLUTIONS - KAIRA CHATBOT IS RUNNING   `);
        console.log(`   Server port: ${PORT}                               `);
        console.log(`   Webhook URL: http://localhost:${PORT}/webhook      `);
        console.log(`=======================================================`);
    });
}

module.exports = app;
