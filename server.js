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

// --- Mock REST API Endpoints for ERP Customer Journey ---

// 1. New Catalogue / New Arrivals
app.get('/api/mock/new-arrivals', (req, res) => {
    res.json([
        { sku_id: 1, sku_code: 'KURTI-FES-01-BLU-L', color: 'Blue', size: 'L', base_price: 500.00, available_qty: 50 },
        { sku_id: 2, sku_code: 'KURTI-FES-01-RED-M', color: 'Red', size: 'M', base_price: 500.00, available_qty: 35 },
        { sku_id: 3, sku_code: 'KURTI-FES-01-GRN-S', color: 'Green', size: 'S', base_price: 500.00, available_qty: 20 },
        { sku_id: 4, sku_code: 'SAREE-SIL-02-RED-FS', color: 'Red', size: 'Free Size', base_price: 1200.00, available_qty: 15 },
        { sku_id: 5, sku_code: 'SHIRT-COT-01-WHT-L', color: 'White', size: 'L', base_price: 450.00, available_qty: 40 },
        { sku_id: 6, sku_code: 'SHIRT-COT-01-BLK-XL', color: 'Black', size: 'XL', base_price: 450.00, available_qty: 25 },
        { sku_id: 7, sku_code: 'PANT-DEN-01-BLU-L', color: 'Blue', size: 'L', base_price: 750.00, available_qty: 30 }
    ]);
});

// 2. Fastest/Top Selling products
app.get('/api/mock/fastest-selling', (req, res) => {
    res.json([
        { sku_id: 1, sku_code: 'KURTI-FES-01-BLU-L', color: 'Blue', size: 'L', base_price: 500.00, total_sold: 150 },
        { sku_id: 5, sku_code: 'SHIRT-COT-01-WHT-L', color: 'White', size: 'L', base_price: 450.00, total_sold: 80 }
    ]);
});

// 3. Stock availability search
app.get('/api/mock/stock-availability', (req, res) => {
    let { skuIdOrCode, color, size, garmentType } = req.query;

    console.log('[Mock API] Stock availability query params received:', { skuIdOrCode, color, size, garmentType });

    if (skuIdOrCode === 'null' || skuIdOrCode === 'undefined') skuIdOrCode = null;
    if (color === 'null' || color === 'undefined') color = null;
    if (size === 'null' || size === 'undefined') size = null;
    if (garmentType === 'null' || garmentType === 'undefined') garmentType = null;

    const items = [
        { sku_id: 1, sku_code: 'KURTI-FES-01-BLU-L', color: 'Blue', size: 'L', physical_qty: 50, reserved_qty: 0, available_qty: 50 },
        { sku_id: 2, sku_code: 'KURTI-FES-01-RED-M', color: 'Red', size: 'M', physical_qty: 35, reserved_qty: 0, available_qty: 35 },
        { sku_id: 3, sku_code: 'KURTI-FES-01-GRN-S', color: 'Green', size: 'S', physical_qty: 20, reserved_qty: 0, available_qty: 20 },
        { sku_id: 4, sku_code: 'SAREE-SIL-02-RED-FS', color: 'Red', size: 'Free Size', physical_qty: 15, reserved_qty: 0, available_qty: 15 },
        { sku_id: 5, sku_code: 'SHIRT-COT-01-WHT-L', color: 'White', size: 'L', physical_qty: 40, reserved_qty: 0, available_qty: 40 },
        { sku_id: 6, sku_code: 'SHIRT-COT-01-BLK-XL', color: 'Black', size: 'XL', physical_qty: 25, reserved_qty: 0, available_qty: 25 },
        { sku_id: 7, sku_code: 'PANT-DEN-01-BLU-L', color: 'Blue', size: 'L', physical_qty: 30, reserved_qty: 0, available_qty: 30 }
    ];

    if (skuIdOrCode) {
        const match = items.find(i => i.sku_id === parseInt(skuIdOrCode) || i.sku_code.toLowerCase().includes(skuIdOrCode.toLowerCase()));
        if (match) return res.json(match);
    }

    if (color || size || garmentType) {
        const match = items.find(i => {
            const colorOk = !color || i.color.toLowerCase().includes(color.toLowerCase()) || color.toLowerCase().includes(i.color.toLowerCase());
            const sizeOk = !size || i.size.toLowerCase() === size.toLowerCase();
            const typeOk = !garmentType || i.sku_code.toLowerCase().includes(garmentType.toLowerCase()) || garmentType.toLowerCase().includes(i.sku_code.toLowerCase());
            return colorOk && sizeOk && typeOk;
        });
        if (match) return res.json(match);
    }

    res.status(404).json({ error: 'Item not found' });
});

// 4. Item Price Lookup
app.get('/api/mock/item-price', (req, res) => {
    const { skuId, tierId } = req.query;
    const basePrices = { 1: 500.00, 2: 500.00, 3: 500.00, 4: 1200.00, 5: 450.00, 6: 450.00, 7: 750.00 };
    const base = basePrices[skuId] || 480.00;
    
    // Apply discount for VIP (tier 1)
    let finalPrice = base;
    if (parseInt(tierId) === 1) {
        finalPrice = base * 0.90; // 10% discount for tier 1
    } else if (parseInt(tierId) === 2) {
        finalPrice = base * 0.96; // 4% discount for tier 2
    }
    res.json({ price: finalPrice });
});

// 5. Active Discount Scheme Lookup
app.post('/api/mock/active-scheme', (req, res) => {
    const { subtotal, totalQty } = req.body;
    if (subtotal >= 800.00) {
        res.json({
            scheme_id: 1,
            name: 'Festive 10%',
            discountAmount: subtotal * 0.10
        });
    } else {
        res.json(null);
    }
});

// 6. Customer Outstanding Balance and Credit Details
app.get('/api/mock/customer-outstanding', (req, res) => {
    const { customerId } = req.query;
    const customers = {
        1: { customer_id: 1, name: 'Aarav Wholesalers', credit_limit: 500000.00, used_credit: 360000.00, outstanding_balance: 128450.00 },
        2: { customer_id: 2, name: 'Kush Sharma Retailers', credit_limit: 250000.00, used_credit: 110000.00, outstanding_balance: 45600.00 }
    };
    const customer = customers[customerId] || customers[1];
    res.json(customer);
});

// 7. Customer Transactions
app.get('/api/mock/customer-transactions', (req, res) => {
    const { customerId } = req.query;
    res.json([
        { txn_id: 1, txn_type: 'Invoice', amount: 810.00, reference_id: 'INV-001', created_at: '2026-08-08 11:00:00' },
        { txn_id: 2, txn_type: 'Payment', amount: 5000.00, reference_id: 'PAY-Razorpay-11', created_at: '2026-08-09 15:30:00' }
    ]);
});

// 8. Create Sales Order
app.post('/api/mock/create-sales-order', (req, res) => {
    const { customerId, items, role } = req.body;
    let subtotal = 0;
    let totalQty = 0;
    const itemPrices = { 1: 450.00, 2: 480.00, 3: 500.00, 4: 1200.00, 5: 400.00, 6: 420.00, 7: 750.00 };
    
    items.forEach(i => {
        const price = itemPrices[i.sku_id] || 450.00;
        subtotal += price * i.qty;
        totalQty += i.qty;
    });

    const discount = subtotal >= 800.00 ? subtotal * 0.10 : 0.00;
    const finalTotal = subtotal - discount;
    const orderStatus = (finalTotal + 128450.00 > 500000.00) ? 'Pending_Approval' : 'Pending_Payment';

    res.json({
        success: true,
        order_id: 2,
        customer_name: parseInt(customerId) === 2 ? 'Kush Sharma Retailers' : 'Aarav Wholesalers',
        subtotal,
        discount,
        final_total: finalTotal,
        scheme_applied: discount > 0 ? 'Festive 10%' : 'None',
        order_status: orderStatus
    });
});

// 9. Dispatch Status/LR Tracking
app.get('/api/mock/dispatch-tracking', (req, res) => {
    const { orderId } = req.query;
    res.json({
        dispatch_id: 1,
        order_id: parseInt(orderId) || 1,
        transporter_name: 'Jaipur Golden Transport',
        lr_number: 'LR-987654',
        dispatch_date: '2026-08-08',
        estimated_delivery: '2026-08-11',
        status: 'Packed'
    });
});

// 10. Repeat Last Order
app.get('/api/mock/last-order', (req, res) => {
    const { customerId } = req.query;
    res.json({
        order_id: 1,
        total_amount: 810.00,
        order_status: 'Packed',
        created_at: '2026-08-08 11:00:00',
        items: [
            { sku_id: 1, sku_code: 'KURTI-FES-01-BLU-L', color: 'Blue', size: 'L', qty: 2, price_per_item: 405.00 }
        ]
    });
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
