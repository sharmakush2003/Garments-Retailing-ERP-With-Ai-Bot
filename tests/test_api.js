process.env.PORT = '3002';
process.env.USE_REDIS = 'false'; // use resilient in-memory queue fallback for testing

const app = require('../server');
const axios = require('axios');
const assert = require('assert');
const { getTenantDb } = require('../services/dbManager');
const QueryParserService = require('../services/queryParser');
const InventoryService = require('../services/inventoryService');
const LedgerService = require('../services/ledgerService');
const SalesService = require('../services/salesService');

const PORT = 3002;

// Start the gateway server for testing
const server = app.listen(PORT, async () => {
    console.log(`[Test] Server is running on port ${PORT}`);
    try {
        const db = await getTenantDb('Co_102');
        
        // Seed order and dispatch record inside test database
        await db.run(`
            INSERT OR IGNORE INTO sales_orders (order_id, customer_id, order_status, total_amount)
            VALUES (1, 1, 'Packed', 810.00)
        `);

        await db.run(`
            INSERT OR IGNORE INTO order_items (order_item_id, order_id, sku_id, qty, price_per_item)
            VALUES (1, 1, 1, 2, 405.00)
        `);
        
        await db.run(`
            INSERT OR IGNORE INTO order_dispatches (dispatch_id, order_id, transporter_name, lr_number, dispatch_date, estimated_delivery, status)
            VALUES (1, 1, 'Jaipur Golden Transport', 'LR-987654', '2026-08-08', '2026-08-11', 'Packed')
        `);

        // Test Case 1: Check Stock via Query Parser
        console.log('\n--- Running Test Case 1: Stock Enquiry ---');
        const parsed1 = await QueryParserService.parseMessage('Blue Kurti size L available hai kya?');
        assert.strictEqual(parsed1.intent, 'INVENTORY_LOOKUP');
        
        const stockData = await InventoryService.getStockAvailability(db, parsed1.args.skuCode, parsed1.args);
        const replyText1 = QueryParserService.formatResponse(parsed1.intent, stockData, { role: 'Customer', companyName: 'Aarav Creations' });
        
        console.log('Parsed intent:', parsed1.intent);
        console.log('Formatted response:', replyText1);
        assert.ok(replyText1.includes('Blue'));
        console.log('✓ Test Case 1 Passed!');

        // Test Case 2: Check Outstanding Balance via Query Parser
        console.log('\n--- Running Test Case 2: Outstanding Balance ---');
        const parsed2 = await QueryParserService.parseMessage('What is my outstanding balance?');
        assert.strictEqual(parsed2.intent, 'OUTSTANDING_LOOKUP');
        
        const outstandingData = await LedgerService.getCustomerOutstanding(db, 1);
        const replyText2 = QueryParserService.formatResponse(parsed2.intent, outstandingData, { role: 'Customer', companyName: 'Aarav Creations' });
        
        console.log('Parsed intent:', parsed2.intent);
        console.log('Formatted response:', replyText2);
        assert.ok(replyText2.includes('128450'));
        console.log('✓ Test Case 2 Passed!');

        // Test Case 3: Book Order via Query Parser
        console.log('\n--- Running Test Case 3: Order Booking ---');
        const parsed3 = await QueryParserService.parseMessage('Book 5 pieces please');
        assert.strictEqual(parsed3.intent, 'ORDER_BOOKING');
        
        const orderResult = await SalesService.createSalesOrder(db, 1, parsed3.args.items, 'Customer');
        const replyText3 = QueryParserService.formatResponse(parsed3.intent, orderResult, { role: 'Customer', companyName: 'Aarav Creations' });
        
        console.log('Parsed intent:', parsed3.intent);
        console.log('Formatted response:', replyText3);
        assert.ok(replyText3.includes('booked') || replyText3.includes('created') || replyText3.includes('Successfully'));
        console.log('✓ Test Case 3 Passed!');

        // Test Case 4: Dispatch Tracking via Query Parser
        console.log('\n--- Running Test Case 4: Dispatch/LR Status ---');
        const parsed4 = await QueryParserService.parseMessage('Has my order #1 shipped?');
        assert.strictEqual(parsed4.intent, 'ORDER_TRACKING');
        
        const trackingData = await SalesService.getDispatchTracking(db, parsed4.args.orderId);
        const replyText4 = QueryParserService.formatResponse(parsed4.intent, trackingData, { role: 'Customer', companyName: 'Aarav Creations' });
        
        console.log('Parsed intent:', parsed4.intent);
        console.log('Formatted response:', replyText4);
        assert.ok(replyText4.includes('Jaipur Golden Transport'));
        console.log('✓ Test Case 4 Passed!');

        // Test Case 5: WhatsApp Webhook Immediate HTTP 200 Response
        console.log('\n--- Running Test Case 5: WhatsApp Webhook Ingestion ---');
        let res = await axios.post(`http://localhost:${PORT}/webhook`, {
            number: '919045099111',
            message: 'Send ledger statement'
        });
        console.log('Response Status:', res.status);
        console.log('Response Body:', JSON.stringify(res.data, null, 2));
        assert.strictEqual(res.status, 200);
        assert.strictEqual(res.data.status, 'Accepted');
        console.log('✓ Test Case 5 Passed!');

        // Test Case 6: AutobotChat Webhook Ingestion
        console.log('\n--- Running Test Case 6: AutobotChat Webhook Ingestion ---');
        res = await axios.post(`http://localhost:${PORT}/webhook`, {
            sender_id: '919045099111',
            from: '919876543210',
            text: {
                body: 'What is my outstanding balance?'
            }
        });
        console.log('Response Status:', res.status);
        console.log('Response Body:', JSON.stringify(res.data, null, 2));
        assert.strictEqual(res.status, 200);
        assert.strictEqual(res.data.status, 'Accepted');
        console.log('✓ Test Case 6 Passed!');

        // Test Case 7: AutobotChat Delivery Report Webhook
        console.log('\n--- Running Test Case 7: AutobotChat Delivery Report Webhook ---');
        res = await axios.post(`http://localhost:${PORT}/webhook`, {
            id: '43227',
            receiver: '919045099111',
            status: '1',
            delivery_time: '12:31',
            delivery_date: '2021-08-24'
        });
        console.log('Response Status:', res.status);
        console.log('Response Body:', JSON.stringify(res.data, null, 2));
        assert.strictEqual(res.status, 200);
        assert.strictEqual(res.data.status, 'Report received');
        console.log('✓ Test Case 7 Passed!');

        // Test Case 8: Hinglish Stock Lookup
        console.log('\n--- Running Test Case 8: Hinglish Stock Lookup ---');
        const parsed8 = await QueryParserService.parseMessage('Bhai, 102 ka XL mein kitna maal hai?');
        assert.strictEqual(parsed8.intent, 'INVENTORY_LOOKUP');
        assert.strictEqual(parsed8.args.size, 'XL');
        console.log('Parsed intent:', parsed8.intent);
        console.log('✓ Test Case 8 Passed!');

        // Test Case 9: Repeat Order
        console.log('\n--- Running Test Case 9: Repeat Order ---');
        const parsed9 = await QueryParserService.parseMessage('Repeat my last order');
        assert.strictEqual(parsed9.intent, 'REPEAT_ORDER');
        const lastOrder = await SalesService.getLastOrder(db, 1);
        const replyText9 = QueryParserService.formatResponse(parsed9.intent, lastOrder, { role: 'Customer', companyName: 'Aarav Creations' });
        console.log('Formatted response:', replyText9);
        assert.ok(replyText9.includes('Repeat Previous Order'));
        console.log('✓ Test Case 9 Passed!');

        // Test Case 10: Owner Dashboard Report
        console.log('\n--- Running Test Case 10: Owner Report (Sales) ---');
        const parsed10 = await QueryParserService.parseMessage('What is today\'s sales?');
        assert.strictEqual(parsed10.intent, 'OWNER_REPORT');
        assert.strictEqual(parsed10.args.reportType, 'SALES');
        const OwnerService = require('../services/ownerService');
        const salesValue = await OwnerService.getTodaySales(db);
        const replyText10 = QueryParserService.formatResponse(parsed10.intent, { type: 'SALES', value: salesValue }, { role: 'Owner', companyName: 'Aarav Creations' });
        console.log('Formatted response:', replyText10);
        assert.ok(replyText10.includes('Today\'s Sales'));
        console.log('✓ Test Case 10 Passed!');

        // Test Case 11: Multi-item Booking Parser
        console.log('\n--- Running Test Case 11: Multi-item Booking Parser ---');
        const parsed11 = await QueryParserService.parseMessage('Book 20 blue and 10 white');
        assert.strictEqual(parsed11.intent, 'ORDER_BOOKING');
        assert.strictEqual(parsed11.args.items.length, 2);
        assert.strictEqual(parsed11.args.items[0].qty, 20);
        assert.strictEqual(parsed11.args.items[1].qty, 10);
        console.log('✓ Test Case 11 Passed!');

        console.log('\n======================================');
        console.log('★ ALL INTEGRATION TESTS PASSED ★');
        console.log('======================================');
        server.close();
        process.exit(0);
    } catch (err) {
        console.error('✘ Test Suite Failed:', err.message);
        if (err.response) {
            console.error('Response Data:', err.response.data);
        }
        server.close();
        process.exit(1);
    }
});
