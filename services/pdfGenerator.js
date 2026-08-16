const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');

class PDFGeneratorService {
    /**
     * Generates a beautifully styled, grid-aligned PDF invoice document.
     */
    static generateInvoicePDF(data, outputPath) {
        return new Promise((resolve, reject) => {
            try {
                // Ensure parent directory exists
                const dir = path.dirname(outputPath);
                if (!fs.existsSync(dir)) {
                    fs.mkdirSync(dir, { recursive: true });
                }

                const doc = new PDFDocument({ margin: 50, size: 'A4' });
                const stream = fs.createWriteStream(outputPath);
                doc.pipe(stream);

                // --- HEADER SECTION ---
                doc.fillColor('#0f172a').fontSize(20).text('DIGIFY GARMENTS SOLUTIONS', 50, 50, { align: 'left', bold: true });
                doc.fillColor('#64748b').fontSize(10).text('Wholesale Garment Manufacturer & Distributor\nIndustrial Area Phase-1, Jaipur, India\nSupport: +91 99999-XXXXX | sales@digifygarments.com', 50, 75);

                doc.fillColor('#1e3a8a').fontSize(18).text('TAX INVOICE', 400, 50, { align: 'right' });
                doc.fillColor('#475569').fontSize(10).text(`Invoice No: ${data.invoice_number || 'INV-2026-001'}\nDate: ${data.invoice_date || '16-Aug-2026'}\nOrder ID: #${data.order_id || '9999'}`, 400, 75, { align: 'right' });

                // Draw solid header line
                doc.strokeColor('#cbd5e1').lineWidth(1).moveTo(50, 125).lineTo(545, 125).stroke();

                // --- CUSTOMER & BILLING INFO ---
                doc.fillColor('#0f172a').fontSize(12).text('BILL TO:', 50, 145, { bold: true });
                doc.fillColor('#334155').fontSize(10).text(
                    `Customer Name: ${data.customer_name || 'Valued Retailer'}\nContact Number: ${data.phone || 'N/A'}\nBilling Address: Central Bazaar Mall, Sector-5, IN\nPayment Terms: Net 30 Days`,
                    50, 165
                );

                doc.fillColor('#0f172a').fontSize(12).text('STATUS:', 400, 145, { bold: true });
                const statusColor = (data.payment_status || '').toLowerCase() === 'paid' ? '#16a34a' : '#dc2626';
                doc.fillColor(statusColor).fontSize(14).text((data.payment_status || 'PENDING').toUpperCase(), 400, 165, { bold: true });

                // --- TABLE OF ITEMS ---
                let currentY = 240;

                // Table Header
                doc.rect(50, currentY, 495, 20).fill('#1e293b');
                doc.fillColor('#ffffff').fontSize(10).text('Description', 60, currentY + 5);
                doc.text('Qty', 300, currentY + 5, { width: 40, align: 'right' });
                doc.text('Rate / Pc', 370, currentY + 5, { width: 70, align: 'right' });
                doc.text('Amount', 460, currentY + 5, { width: 75, align: 'right' });

                currentY += 20;

                // Items list
                const items = data.items || [];
                items.forEach((item, index) => {
                    // Alternate row background colors
                    if (index % 2 === 0) {
                        doc.rect(50, currentY, 495, 20).fill('#f8fafc');
                    }
                    doc.fillColor('#334155').fontSize(10).text(item.name || 'Garment Item', 60, currentY + 5);
                    doc.text((item.qty || 0).toString(), 300, currentY + 5, { width: 40, align: 'right' });
                    doc.text(`₹${item.price_per_item || 0}`, 370, currentY + 5, { width: 70, align: 'right' });
                    doc.text(`₹${item.total_amount || 0}`, 460, currentY + 5, { width: 75, align: 'right' });
                    currentY += 20;
                });

                doc.strokeColor('#e2e8f0').lineWidth(1).moveTo(50, currentY).lineTo(545, currentY).stroke();
                currentY += 15;

                // --- SUMMARY BREAKDOWN ---
                const rightX = 350;
                doc.fillColor('#475569').fontSize(10);
                doc.text('Taxable Value:', rightX, currentY);
                doc.fillColor('#0f172a').text(`₹${data.taxable_value || 0}`, 460, currentY, { align: 'right' });
                currentY += 15;

                doc.fillColor('#475569').text('CGST (2.5%):', rightX, currentY);
                doc.fillColor('#0f172a').text(`₹${data.cgst_amount || 0}`, 460, currentY, { align: 'right' });
                currentY += 15;

                doc.fillColor('#475569').text('SGST (2.5%):', rightX, currentY);
                doc.fillColor('#0f172a').text(`₹${data.sgst_amount || 0}`, 460, currentY, { align: 'right' });
                currentY += 15;

                if (data.discount_applied > 0) {
                    doc.fillColor('#dc2626').text('Discount:', rightX, currentY);
                    doc.text(`- ₹${data.discount_applied}`, 460, currentY, { align: 'right' });
                    currentY += 15;
                }

                doc.strokeColor('#cbd5e1').lineWidth(1).moveTo(rightX, currentY).lineTo(545, currentY).stroke();
                currentY += 5;

                doc.fillColor('#1e3a8a').fontSize(12).text('Net Payable:', rightX, currentY, { bold: true });
                doc.text(`₹${data.net_payable || 0}`, 460, currentY, { align: 'right', bold: true });

                // --- FOOTER NOTE ---
                doc.fillColor('#94a3b8').fontSize(8).text(
                    'Note: This is a system-generated invoice copy prepared for WhatsApp ERP assistant query. Subject to terms & conditions of Digify Garments Solutions.',
                    50, 750, { align: 'center' }
                );

                doc.end();

                stream.on('finish', () => {
                    resolve(outputPath);
                });
                stream.on('error', (err) => {
                    reject(err);
                });
            } catch (err) {
                reject(err);
            }
        });
    }

    /**
     * Generates a beautifully styled, premium PDF account ledger statement.
     */
    static generateLedgerPDF(data, outputPath) {
        return new Promise((resolve, reject) => {
            try {
                const dir = path.dirname(outputPath);
                if (!fs.existsSync(dir)) {
                    fs.mkdirSync(dir, { recursive: true });
                }

                const doc = new PDFDocument({ margin: 50, size: 'A4' });
                const stream = fs.createWriteStream(outputPath);
                doc.pipe(stream);

                // --- HEADER SECTION ---
                doc.fillColor('#0f172a').fontSize(20).text('DIGIFY GARMENTS SOLUTIONS', 50, 50, { align: 'left', bold: true });
                doc.fillColor('#64748b').fontSize(10).text('Statement of Accounts & Running Ledgers\nJaipur Depot, India', 50, 75);

                doc.fillColor('#0f172a').fontSize(16).text('ACCOUNT STATEMENT', 400, 50, { align: 'right' });
                doc.fillColor('#475569').fontSize(10).text(`Generated: ${new Date().toLocaleDateString('en-GB')}`, 400, 70, { align: 'right' });

                // Draw header line
                doc.strokeColor('#cbd5e1').lineWidth(1).moveTo(50, 115).lineTo(545, 115).stroke();

                // Outstanding Card Box
                const latestBalance = data.length > 0 ? data[data.length - 1].running_balance : '0.00';
                doc.rect(50, 130, 495, 45).fill('#f1f5f9');
                doc.fillColor('#475569').fontSize(10).text('RUNNING OUTSTANDING BALANCE DUE:', 65, 140);
                doc.fillColor('#1e3a8a').fontSize(18).text(`₹${latestBalance}`, 65, 152, { bold: true });

                // --- TABLE OF LEDGER TRANSACTIONS ---
                let currentY = 195;

                // Table Header
                doc.rect(50, currentY, 495, 20).fill('#334155');
                doc.fillColor('#ffffff').fontSize(9).text('Date', 60, currentY + 5);
                doc.text('Description', 140, currentY + 5);
                doc.text('Debit (+)', 320, currentY + 5, { width: 65, align: 'right' });
                doc.text('Credit (-)', 395, currentY + 5, { width: 65, align: 'right' });
                doc.text('Balance', 470, currentY + 5, { width: 65, align: 'right' });

                currentY += 20;

                // Ledger records list
                data.forEach((l, index) => {
                    // Alternate background colors
                    if (index % 2 === 0) {
                        doc.rect(50, currentY, 495, 18).fill('#f8fafc');
                    }
                    doc.fillColor('#475569').fontSize(9).text(l.date || 'N/A', 60, currentY + 4);
                    doc.fillColor('#0f172a').text(l.description || 'Transaction', 140, currentY + 4, { width: 175, height: 12, ellipsis: true });
                    doc.fillColor('#dc2626').text(l.debit > 0 ? `₹${l.debit}` : '-', 320, currentY + 4, { width: 65, align: 'right' });
                    doc.fillColor('#16a34a').text(l.credit > 0 ? `₹${l.credit}` : '-', 395, currentY + 4, { width: 65, align: 'right' });
                    doc.fillColor('#1e3a8a').text(`₹${l.running_balance || 0}`, 470, currentY + 4, { width: 65, align: 'right', bold: true });
                    currentY += 18;
                });

                doc.strokeColor('#cbd5e1').lineWidth(1).moveTo(50, currentY).lineTo(545, currentY).stroke();

                // --- FOOTER NOTE ---
                doc.fillColor('#94a3b8').fontSize(8).text(
                    'This document is a certified snapshot of ledger balances retrieved directly from the ERP core. For any discrepancy, contact support.',
                    50, 750, { align: 'center' }
                );

                doc.end();

                stream.on('finish', () => {
                    resolve(outputPath);
                });
                stream.on('error', (err) => {
                    reject(err);
                });
            } catch (err) {
                reject(err);
            }
        });
    }
}

module.exports = PDFGeneratorService;
