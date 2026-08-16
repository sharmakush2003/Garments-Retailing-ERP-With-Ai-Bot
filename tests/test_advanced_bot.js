process.env.PORT = '3003';
process.env.USE_REDIS = 'false'; // Run fallback in-memory queue for testing
process.env.GEMINI_API_KEY = 'MOCK_API_KEY_FOR_TESTS'; // Enable LLM check logic in parser

const app = require('../server');
const axios = require('axios');
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const PDFGeneratorService = require('../services/pdfGenerator');
const QueryParserService = require('../services/queryParser');

const PORT = 3003;

// Start the server for testing
const server = app.listen(PORT, async () => {
    console.log(`[Test Suite] Server started on port ${PORT}`);

    try {
        // --- Test Case 1: PDF Generation Test ---
        console.log('\n--- Running Test Case 1: Dynamic PDF Generation ---');
        
        const mockInvoiceData = require('../mock_data/last_invoice_copy.json');
        const invoicePath = path.join(__dirname, '../public/test_invoice.pdf');
        
        // Generate Invoice PDF
        await PDFGeneratorService.generateInvoicePDF(mockInvoiceData, invoicePath);
        console.log('Invoice PDF created at:', invoicePath);
        assert.ok(fs.existsSync(invoicePath), 'Invoice PDF should be generated on disk');
        assert.ok(fs.statSync(invoicePath).size > 0, 'Invoice PDF should not be empty');

        const mockLedgerData = require('../mock_data/old_ledger_status.json');
        const ledgerPath = path.join(__dirname, '../public/test_ledger.pdf');
        
        // Generate Ledger PDF
        await PDFGeneratorService.generateLedgerPDF(mockLedgerData, ledgerPath);
        console.log('Ledger PDF created at:', ledgerPath);
        assert.ok(fs.existsSync(ledgerPath), 'Ledger PDF should be generated on disk');
        assert.ok(fs.statSync(ledgerPath).size > 0, 'Ledger PDF should not be empty');
        
        console.log('✓ Test Case 1 Passed!');

        // --- Test Case 2: Voice Note Webhook Ingestion ---
        console.log('\n--- Running Test Case 2: Voice Note Webhook Ingestion ---');
        
        // Send simulated WhatsApp voice note payload to the webhook
        const voiceWebhookPayload = {
            sender_id: '919876543210',
            media_type: 'audio',
            media_url: 'MOCK_AUDIO_URL', // will bypass download and run fallback text parse in mock tests
            message: 'Check stock'
        };

        const res = await axios.post(`http://localhost:${PORT}/webhook`, voiceWebhookPayload);
        console.log('Webhook Response Status:', res.status);
        console.log('Webhook Response Data:', JSON.stringify(res.data, null, 2));
        
        assert.strictEqual(res.status, 200);
        assert.strictEqual(res.data.status, 'Accepted');
        console.log('✓ Test Case 2 Passed!');

        // --- Test Case 3: Public Static File Serving ---
        console.log('\n--- Running Test Case 3: Public File HTTP Request ---');
        
        const fileRes = await axios.get(`http://localhost:${PORT}/public/test_invoice.pdf`, {
            responseType: 'arraybuffer'
        });
        console.log('HTTP Static File Status:', fileRes.status);
        console.log('HTTP Static File Size (bytes):', fileRes.data.byteLength);
        
        assert.strictEqual(fileRes.status, 200);
        assert.ok(fileRes.data.byteLength > 0, 'Served static file should contain data');
        console.log('✓ Test Case 3 Passed!');

        // Clean up test files
        if (fs.existsSync(invoicePath)) fs.unlinkSync(invoicePath);
        if (fs.existsSync(ledgerPath)) fs.unlinkSync(ledgerPath);
        
        console.log('\nAll advanced bot tests passed successfully! 🎉');
        server.close(() => {
            process.exit(0);
        });

    } catch (err) {
        console.error('\n❌ Test Suite Failed:', err.message);
        if (err.response) {
            console.error('Response data:', err.response.data.toString());
        }
        server.close(() => {
            process.exit(1);
        });
    }
});
