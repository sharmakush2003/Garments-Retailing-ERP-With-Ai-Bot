process.env.PORT = '3002';
process.env.USE_REDIS = 'false'; // use resilient in-memory queue fallback for testing

const app = require('../server');
const axios = require('axios');
const assert = require('assert');
const { getTenantDb } = require('../services/dbManager');
const QueryParserService = require('../services/queryParser');
const InventoryService = require('../services/inventoryService');

const PORT = 3002;

// Start the gateway server for testing
const server = app.listen(PORT, async () => {
    console.log(`[Test] Server is running on port ${PORT}`);
    try {
        const db = await getTenantDb('Co_102');

        // Test Case 1: Check Stock via Query Parser
        console.log('\n--- Running Test Case 1: Stock Enquiry ---');
        const parsed1 = await QueryParserService.parseMessage('Blue Kurti size L available hai kya?');
        assert.strictEqual(parsed1.intent, 'INVENTORY_LOOKUP');
        
        const stockData = await InventoryService.getStockAvailability(db, parsed1.args.skuCode, parsed1.args);
        const replyText1 = QueryParserService.formatResponse(parsed1.intent, stockData, { role: 'Customer', companyName: 'Kaira' });
        
        console.log('Parsed intent:', parsed1.intent);
        console.log('Formatted response:', replyText1);
        assert.ok(replyText1.includes('Blue'));
        console.log('✓ Test Case 1 Passed!');

        // Test Case 2: Colors Lookup Test
        console.log('\n--- Running Test Case 2: Colors Lookup ---');
        const parsed2 = await QueryParserService.parseMessage('What colours are available?');
        assert.strictEqual(parsed2.intent, 'COLOURS_LOOKUP');
        const filteredCols = await InventoryService.getProductsByFilters(db, parsed2.args);
        const replyText2 = QueryParserService.formatResponse(parsed2.intent, filteredCols, { role: 'Customer' });
        console.log('Formatted response:', replyText2);
        assert.ok(replyText2.includes('Available Colours Matrix'));
        console.log('✓ Test Case 2 Passed!');

        // Test Case 3: Sizes Lookup Test
        console.log('\n--- Running Test Case 3: Sizes Lookup ---');
        const parsed3 = await QueryParserService.parseMessage('What sizes do you have?');
        assert.strictEqual(parsed3.intent, 'SIZES_LOOKUP');
        const filteredSizes = await InventoryService.getProductsByFilters(db, parsed3.args);
        const replyText3 = QueryParserService.formatResponse(parsed3.intent, filteredSizes, { role: 'Customer' });
        console.log('Formatted response:', replyText3);
        assert.ok(replyText3.includes('Available Sizes Matrix'));
        console.log('✓ Test Case 3 Passed!');

        // Test Case 4: Price Lookup
        console.log('\n--- Running Test Case 4: Wholesale Rate check ---');
        const parsed4 = await QueryParserService.parseMessage('What is the wholesale price of SKU KURTI-FES-BLU-L?');
        assert.strictEqual(parsed4.intent, 'PRICE_LOOKUP');
        const skuObj = await InventoryService.getStockAvailability(db, parsed4.args.skuCode, parsed4.args);
        const priceVal = await InventoryService.getItemPrice(db, skuObj.sku_id, 1);
        const replyText4 = QueryParserService.formatResponse(parsed4.intent, priceVal, { role: 'Customer', companyName: 'Kaira' });
        console.log('Formatted response:', replyText4);
        assert.ok(replyText4.includes('Wholesale Price'));
        console.log('✓ Test Case 4 Passed!');

        // Test Case 5: Filtered Product Lookup Test
        console.log('\n--- Running Test Case 5: Filtered Product Lookup ---');
        const parsed5 = await QueryParserService.parseMessage('Show me cotton shirts under 500');
        assert.strictEqual(parsed5.intent, 'PRODUCT_FILTERED');
        assert.strictEqual(parsed5.args.maxPrice, 500);
        assert.strictEqual(parsed5.args.fabric, 'cotton');
        assert.strictEqual(parsed5.args.garmentType, 'SHIRT');
        const filteredProds = await InventoryService.getProductsByFilters(db, parsed5.args);
        const replyText5 = QueryParserService.formatResponse(parsed5.intent, filteredProds, { role: 'Customer' });
        console.log('Formatted response:', replyText5);
        assert.ok(replyText5.includes('Garments Search Results') || replyText5.includes('Wholesale Product Catalog'));
        console.log('✓ Test Case 5 Passed!');

        // Test Case 6: Hinglish Stock Lookup
        console.log('\n--- Running Test Case 6: Hinglish Stock Lookup ---');
        const parsed6 = await QueryParserService.parseMessage('Bhai, Kurti ka XL mein kitna maal hai?');
        assert.strictEqual(parsed6.intent, 'INVENTORY_LOOKUP');
        assert.strictEqual(parsed6.args.size, 'XL');
        console.log('Parsed intent:', parsed6.intent);
        console.log('✓ Test Case 6 Passed!');

        // Test Case 7: WhatsApp Webhook Immediate HTTP 200 Response
        console.log('\n--- Running Test Case 7: WhatsApp Webhook Ingestion ---');
        let res = await axios.post(`http://localhost:${PORT}/webhook`, {
            number: '919045099111',
            message: 'Check stock'
        });
        console.log('Response Status:', res.status);
        console.log('Response Body:', JSON.stringify(res.data, null, 2));
        assert.strictEqual(res.status, 200);
        assert.strictEqual(res.data.status, 'Accepted');
        console.log('✓ Test Case 7 Passed!');

        // Test Case 8: AutobotChat Webhook Ingestion
        console.log('\n--- Running Test Case 8: AutobotChat Webhook Ingestion ---');
        res = await axios.post(`http://localhost:${PORT}/webhook`, {
            sender_id: '919045099111',
            from: '919876543210',
            text: {
                body: 'Blue Kurti size L available?'
            }
        });
        console.log('Response Status:', res.status);
        console.log('Response Body:', JSON.stringify(res.data, null, 2));
        assert.strictEqual(res.status, 200);
        assert.strictEqual(res.data.status, 'Accepted');
        console.log('✓ Test Case 8 Passed!');

        // Test Case 9: AutobotChat Delivery Report Webhook
        console.log('\n--- Running Test Case 9: AutobotChat Delivery Report Webhook ---');
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
        console.log('✓ Test Case 9 Passed!');

        // Test Case 10: Mock Categories API Endpoint
        console.log('\n--- Running Test Case 10: Mock Categories API ---');
        res = await axios.get(`http://localhost:${PORT}/api/mock/categories`);
        console.log('Response Status:', res.status);
        console.log('Response Body:', JSON.stringify(res.data, null, 2));
        assert.strictEqual(res.status, 200);
        assert.ok(res.data.some(c => c.name === 'Kurti'));
        console.log('✓ Test Case 10 Passed!');

        // Test Case 11: Mock Subcategories API Endpoint
        console.log('\n--- Running Test Case 11: Mock Subcategories API ---');
        res = await axios.get(`http://localhost:${PORT}/api/mock/subcategories`);
        console.log('Response Status:', res.status);
        console.log('Response Body:', JSON.stringify(res.data, null, 2));
        assert.strictEqual(res.status, 200);
        assert.ok(res.data.some(s => s.name === 'Festive'));
        console.log('✓ Test Case 11 Passed!');

        // Test Case 12: Mock Old Shipments API Endpoint & Query Parsing
        console.log('\n--- Running Test Case 12: Mock Old Shipments API ---');
        res = await axios.get(`http://localhost:${PORT}/api/mock/old-shipments`);
        console.log('Response Status:', res.status);
        assert.strictEqual(res.status, 200);
        assert.ok(res.data.some(s => s.transporter_name === 'SafeExpress Logistics'));
        // Parse message
        const parsed12 = await QueryParserService.parseMessage('Show me my past shipments history');
        assert.strictEqual(parsed12.intent, 'OLD_SHIPMENT_INQUIRY');
        const replyText12 = QueryParserService.formatResponse(parsed12.intent, res.data, { role: 'Customer' });
        console.log('Formatted response:', replyText12);
        assert.ok(replyText12.includes('Old Shipment History Summary'));
        console.log('✓ Test Case 12 Passed!');

        // Test Case 13: Mock Ledger Status API Endpoint & Query Parsing
        console.log('\n--- Running Test Case 13: Mock Ledger Status API ---');
        res = await axios.get(`http://localhost:${PORT}/api/mock/old-ledger-status`);
        console.log('Response Status:', res.status);
        assert.strictEqual(res.status, 200);
        assert.ok(res.data.some(l => l.reference_id === 'INV-2026-003'));
        // Parse message
        const parsed13 = await QueryParserService.parseMessage('Send me my ledger khata status');
        assert.strictEqual(parsed13.intent, 'OLD_LEDGER_STATUS');
        const replyText13 = QueryParserService.formatResponse(parsed13.intent, res.data, { role: 'Customer' });
        console.log('Formatted response:', replyText13);
        assert.ok(replyText13.includes('Account Ledger Status Statement'));
        console.log('✓ Test Case 13 Passed!');

        // Test Case 14: Mock Last Invoice Copy API Endpoint & Query Parsing
        console.log('\n--- Running Test Case 14: Mock Last Invoice Copy API ---');
        res = await axios.get(`http://localhost:${PORT}/api/mock/last-invoice-copy`);
        console.log('Response Status:', res.status);
        assert.strictEqual(res.status, 200);
        assert.strictEqual(res.data.invoice_number, 'INV-2026-003');
        // Parse message
        const parsed14 = await QueryParserService.parseMessage('Send me my last invoice copy');
        assert.strictEqual(parsed14.intent, 'LAST_INVOICE_COPY');
        const replyText14 = QueryParserService.formatResponse(parsed14.intent, res.data, { role: 'Customer' });
        console.log('Formatted response:', replyText14);
        assert.ok(replyText14.includes('Latest Invoice Details'));
        console.log('✓ Test Case 14 Passed!');

        // Test Case 15: Mock Shipment Status/Tracking API Endpoint & Query Parsing
        console.log('\n--- Running Test Case 15: Mock Shipment Status/Tracking API ---');
        res = await axios.get(`http://localhost:${PORT}/api/mock/shipment-status`);
        console.log('Response Status:', res.status);
        assert.strictEqual(res.status, 200);
        assert.strictEqual(res.data.status, 'In Transit');
        // Parse message
        const parsed15 = await QueryParserService.parseMessage('where is my shipment, tracking status check?');
        assert.strictEqual(parsed15.intent, 'SHIPMENT_TRACKING');
        const replyText15 = QueryParserService.formatResponse(parsed15.intent, res.data, { role: 'Customer' });
        console.log('Formatted response:', replyText15);
        assert.ok(replyText15.includes('Active Shipment Tracking Status'));
        console.log('✓ Test Case 15 Passed!');

        // Test Case 16: Mock Outstanding Balance API Endpoint & Query Parsing
        console.log('\n--- Running Test Case 16: Mock Outstanding Balance API ---');
        res = await axios.get(`http://localhost:${PORT}/api/mock/outstanding`, {
            params: { phone: '919045099111' }
        });
        console.log('Response Status:', res.status);
        assert.strictEqual(res.status, 200);
        assert.strictEqual(res.data.customer_name, 'Aarav Wholesalers');
        // Parse message
        const parsed16 = await QueryParserService.parseMessage('what is my total outstanding due payment?');
        assert.strictEqual(parsed16.intent, 'OUTSTANDING_LOOKUP');
        const replyText16 = QueryParserService.formatResponse(parsed16.intent, res.data, { role: 'Customer' });
        console.log('Formatted response:', replyText16);
        assert.ok(replyText16.includes('Credit & Outstanding Status Summary'));
        console.log('✓ Test Case 16 Passed!');

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
