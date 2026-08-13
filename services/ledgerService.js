const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');
const os = require('os');
const axios = require('axios');

const PORT = process.env.PORT || 10000;
const getBaseUrl = () => process.env.API_BASE_URL || `http://localhost:${PORT}`;

class LedgerService {
    /**
     * Get Customer Credit and Outstanding balance details.
     */
    static async getCustomerOutstanding(db, customerId) {
        try {
            const res = await axios.get(`${getBaseUrl()}/api/mock/customer-outstanding`, {
                params: { customerId }
            });
            return res.data;
        } catch (err) {
            console.error("API customer-outstanding call failed, falling back to local DB:", err.message);
            const query = `
                SELECT customer_id, name, credit_limit, used_credit, outstanding_balance 
                FROM customers 
                WHERE customer_id = ?
            `;
            return await db.get(query, [customerId]);
        }
    }

    /**
     * Retrieves financial ledger transactions for a customer.
     */
    static async getTransactions(db, customerId) {
        try {
            const res = await axios.get(`${getBaseUrl()}/api/mock/customer-transactions`, {
                params: { customerId }
            });
            return res.data;
        } catch (err) {
            console.error("API customer-transactions call failed, falling back to local DB:", err.message);
            const query = `
                SELECT txn_id, txn_type, amount, reference_id, created_at 
                FROM financial_transactions 
                WHERE customer_id = ? 
                ORDER BY created_at DESC
            `;
            return await db.all(query, [customerId]);
        }
    }

    /**
     * Generates a Ledger Statement PDF for the customer and saves it to scratch or returns it.
     */
    static async generateLedgerPDF(db, customerId) {
        const customer = await this.getCustomerOutstanding(db, customerId);
        if (!customer) throw new Error('Customer not found');

        const transactions = await this.getTransactions(db, customerId);

        // Use system temp directory
        const tempDir = os.tmpdir();
        const filePath = path.join(tempDir, `ledger_${customerId}_${Date.now()}.pdf`);
        const doc = new PDFDocument();
        const stream = fs.createWriteStream(filePath);
        
        doc.pipe(stream);

        // PDF Styling & Header
        doc.fontSize(20).text('DIGIFY SOFT ERP - ACCOUNT STATEMENT', { align: 'center' });
        doc.moveDown();
        doc.fontSize(12).text(`Customer Name: ${customer.name}`);
        doc.text(`Outstanding Balance: Rs. ${customer.outstanding_balance}`);
        doc.text(`Credit Limit: Rs. ${customer.credit_limit}`);
        doc.text(`Used Credit: Rs. ${customer.used_credit}`);
        doc.moveDown();
        doc.text('------------------------------------------------------------');
        doc.moveDown();

        doc.fontSize(14).text('Transaction History:', { underline: true });
        doc.moveDown();

        if (transactions.length === 0) {
            doc.fontSize(10).text('No transactions found.');
        } else {
            transactions.forEach(t => {
                doc.fontSize(10).text(
                    `[${t.created_at}] ${t.txn_type} | Ref: ${t.reference_id || 'N/A'} | Amount: Rs. ${t.amount}`
                );
            });
        }

        doc.end();

        return new Promise((resolve, reject) => {
            stream.on('finish', () => resolve(filePath));
            stream.on('error', reject);
        });
    }
}

module.exports = LedgerService;
