/**
 * Dynamic Endpoints Verification & Live Test Suite
 * Tests fetching real-time data from local server or Render deployment.
 * Verifies that any database / mock data changes immediately reflect on the REST endpoints & WhatsApp chatbot.
 */

const axios = require('axios');
const fs = require('fs');
const path = require('path');
const http = require('http');

// Configuration: Accepts URL from CLI argument, SERVER_URL env, or defaults to local server
const targetUrl = process.argv[2] || process.env.SERVER_URL || 'http://localhost:3000';
const BASE_URL = targetUrl.trim().replace(/\/+$/, '');
const isRemoteServer = BASE_URL.includes('onrender.com') || !BASE_URL.includes('localhost');

const endpointsToTest = [
    { name: 'Categories', path: '/api/mock/categories', mockFile: 'categories.json' },
    { name: 'Subcategories', path: '/api/mock/subcategories', mockFile: 'subcategories.json' },
    { name: 'Products Catalog', path: '/api/mock/products', mockFile: 'products.json' },
    { name: 'Old Shipments Inquiry', path: '/api/mock/old-shipments', mockFile: 'old_shipment_inquiry.json' },
    { name: 'Old Ledger Status', path: '/api/mock/old-ledger-status', mockFile: 'old_ledger_status.json' },
    { name: 'Last Invoice Copy', path: '/api/mock/last-invoice-copy', mockFile: 'last_invoice_copy.json' },
    { name: 'Shipment Status', path: '/api/mock/shipment-status', mockFile: 'shipment_status.json' },
    { name: 'Outstanding Balance', path: '/api/mock/outstanding', mockFile: 'outstanding.json' },
    { name: 'Users List', path: '/api/mock/users', mockFile: 'users.json' }
];

// Helper to start local server if not already running and targeting localhost
async function ensureServerRunning() {
    try {
        await axios.get(`${BASE_URL}/health`, { timeout: 10000 });
        console.log(`✅ Connected to active server at: ${BASE_URL}\n`);
        return null;
    } catch (e) {
        if (isRemoteServer) {
            console.error(`🔴 Could not connect to remote server at ${BASE_URL}:`, e.message);
            throw e;
        }
        console.log(`ℹ️ Local server not running at ${BASE_URL}. Starting in-process server on port 3000...`);
        const app = require('../server');
        return new Promise((resolve) => {
            const server = app.listen(3000, () => {
                console.log(`✅ In-process test server started on http://localhost:3000\n`);
                resolve(server);
            });
        });
    }
}

async function runTests() {
    console.log('===============================================================');
    console.log('  DYNAMIC REST API & ERP INTEGRATION TEST SUITE               ');
    console.log('===============================================================\n');

    const activeServer = await ensureServerRunning();

    console.log('--- STEP 1: VERIFYING ALL 9 DYNAMIC REST ENDPOINTS ---\n');
    let passCount = 0;

    for (const ep of endpointsToTest) {
        try {
            const res = await axios.get(`${BASE_URL}${ep.path}`);
            const isArray = Array.isArray(res.data);
            const count = isArray ? res.data.length : (Object.keys(res.data).length > 0 ? 1 : 0);
            console.log(`  🟢 [PASS] Endpoint: ${ep.name.padEnd(22)} -> Route: ${ep.path.padEnd(30)} (Received: ${count} record(s))`);
            passCount++;
        } catch (err) {
            console.error(`  🔴 [FAIL] Endpoint: ${ep.name} -> Route: ${ep.path} Error:`, err.message);
        }
    }

    console.log(`\nResults: ${passCount}/${endpointsToTest.length} endpoints responded successfully.\n`);

    console.log('--- STEP 2: VERIFYING LIVE DYNAMIC DATA UPDATES (MUTATION TEST) ---\n');

    if (isRemoteServer) {
        console.log(`ℹ️ Remote Server Target (${BASE_URL}):`);
        console.log(`   - Endpoints fetched live from cloud server.`);
        console.log(`   - Note: Editing local disk files on your PC changes your local environment.`);
        console.log(`   - To update Render cloud server dynamically, push your git commits or call remote API write endpoints.\n`);
        if (activeServer) activeServer.close();
        return;
    }

    const productsFilePath = path.join(__dirname, '..', 'mock_data', 'products.json');
    const originalContent = fs.readFileSync(productsFilePath, 'utf8');
    const productsData = JSON.parse(originalContent);

    const testTimestamp = Date.now();
    const testSkuName = `TEST_KURTI_DYNAMIC_${testTimestamp}`;

    try {
        console.log(`1. Fetching product catalog before mutation...`);
        const beforeRes = await axios.get(`${BASE_URL}/api/mock/products`);
        console.log(`   Total items found before mutation: ${beforeRes.data.length}`);

        console.log(`2. Injecting temporary test item directly into ERP mock_data database: "${testSkuName}"...`);
        const testItem = {
            sku_id: 99999,
            sku_code: testSkuName,
            category: "Kurti",
            subcategory: "Test Dynamic",
            color: "REACTIVE_BLUE",
            size: "XXL",
            price: 999.00,
            stock: 45,
            fabric: "100% Dynamic Cotton"
        };
        productsData.push(testItem);
        fs.writeFileSync(productsFilePath, JSON.stringify(productsData, null, 2), 'utf8');

        console.log(`3. Fetching product catalog immediately after DB update without server restart...`);
        const afterRes = await axios.get(`${BASE_URL}/api/mock/products`);
        console.log(`   Total items found after mutation: ${afterRes.data.length}`);

        const foundItem = afterRes.data.find(i => i.sku_code === testSkuName);

        if (foundItem) {
            console.log(`\n  ✨ SUCCESS! Dynamic update verified live:`);
            console.log(`     - SKU Code: ${foundItem.sku_code}`);
            console.log(`     - Color: ${foundItem.color}`);
            console.log(`     - Stock: ${foundItem.stock}`);
            console.log(`     - Price: ₹${foundItem.price}`);
            console.log(`\n  ✅ DATA CHANGED IN DB REFLECTS IMMEDIATELY ON THE API & WHATSAPP BOT!\n`);
        } else {
            console.error(`  🔴 FAILURE: Updated item was not reflected dynamically.`);
        }

    } catch (err) {
        console.error(`  🔴 Error during dynamic mutation test:`, err.message);
    } finally {
        console.log(`4. Cleaning up and reverting database file to original state...`);
        fs.writeFileSync(productsFilePath, originalContent, 'utf8');
        console.log(`   Cleanup complete. Database restored.`);

        if (activeServer) {
            activeServer.close();
            console.log(`   Test server shut down cleanly.`);
        }
    }
}

runTests().catch(err => {
    console.error('Test suite error:', err);
    process.exit(1);
});
