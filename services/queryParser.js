const path = require('path');

/**
 * Query Parser Service
 * Parses Hinglish/English queries into structured intents and arguments.
 * Implements local rule-based regex parsing for local development and offline validation.
 */
class QueryParserService {
    /**
     * Parse incoming message text into structured intent and parameters.
     */
    static async parseMessage(messageText) {
        const text = messageText.toLowerCase().trim();

        // 1. Detect interactive button/list clicks or quick commands (Aligned with Customer Journey Step 1)
        if (text === 'btn_catalogue' || text.includes('new catalogue') || text === '1') {
            return { intent: 'NEW_ARRIVALS', args: {} };
        }
        if (text === 'btn_stock' || text.includes('check stock') || text === '2') {
            return { intent: 'GUIDE_STOCK', args: {} };
        }
        if (text === 'btn_price' || text.includes('check price') || text.includes('wholesale rates') || text.includes('rate list') || text === '3') {
            return { intent: 'PRICE_LOOKUP', args: { skuCode: 'KURTI-FES-01-BLU-L' } };
        }
        if (text === 'btn_order' || text.includes('place order') || text.includes('book order') || text === '4') {
            return { intent: 'GUIDE_ORDER', args: {} };
        }
        if (text === 'btn_balance' || text.includes('outstanding') || text.includes('check balance') || text === '5') {
            return { intent: 'OUTSTANDING_LOOKUP', args: {} };
        }
        if (text === 'btn_track' || text.includes('dispatch status') || text.includes('track order') || text === '6') {
            return { intent: 'ORDER_TRACKING', args: { orderId: 1 } };
        }

        // 2. Detect Owner Reports
        if (text.includes('today\'s sales') || text.includes('todays sales') || text.includes('sales today') || text.includes('today sales')) {
            return { intent: 'OWNER_REPORT', args: { reportType: 'SALES' } };
        }
        if (text.includes('today\'s collection') || text.includes('todays collection') || text.includes('collection today') || text.includes('collection today')) {
            return { intent: 'OWNER_REPORT', args: { reportType: 'COLLECTION' } };
        }
        if (text.includes('low stock') || text.includes('reorder level')) {
            return { intent: 'OWNER_REPORT', args: { reportType: 'LOW_STOCK' } };
        }
        if (text.includes('dead stock')) {
            return { intent: 'OWNER_REPORT', args: { reportType: 'DEAD_STOCK' } };
        }
        if (text.includes('top selling') || text.includes('top-selling') || text.includes('best selling')) {
            return { intent: 'OWNER_REPORT', args: { reportType: 'TOP_SELLING' } };
        }
        if (text.includes('credit limit') && (text.includes('cross') || text.includes('breach') || text.includes('exceed'))) {
            return { intent: 'OWNER_REPORT', args: { reportType: 'CREDIT_BREACH' } };
        }
        if (text.includes('outstanding above') || text.includes('outstanding more than')) {
            return { intent: 'OWNER_REPORT', args: { reportType: 'HIGH_OUTSTANDING' } };
        }
        if (text.includes('profit today') || text.includes('today\'s profit') || text.includes('todays profit')) {
            return { intent: 'OWNER_REPORT', args: { reportType: 'PROFIT' } };
        }
        if (text.includes('who didn\'t order') || text.includes('who didnt order') || text.includes('inactive customers')) {
            return { intent: 'OWNER_REPORT', args: { reportType: 'INACTIVE_CUSTOMERS' } };
        }

        // 3. Repeat Order / Reorder
        if (text.includes('repeat my last order') || text.includes('repeat previous order') || text.includes('dobara bhejo') || text.includes('same as last time') || text.includes('repeat order')) {
            return { intent: 'REPEAT_ORDER', args: {} };
        }

        // 4. New Arrivals
        if (text.includes('new arrivals') || text.includes('new design') || text.includes('new collection') || text.includes('arrivals')) {
            return { intent: 'NEW_ARRIVALS', args: {} };
        }

        // 5. Top-selling / Fastest selling (Customer-facing)
        if (text.includes('fastest-selling') || text.includes('fastest selling') || text.includes('best-selling')) {
            return { intent: 'TOP_SELLING', args: {} };
        }

        // 6. Greetings
        const greetingWords = ['hi', 'hello', 'hey', 'hie', 'hiee', 'namaste', 'namaskar', 'good morning', 'good evening', 'kaise ho', 'help', 'menu'];
        const erpKeywords = ['kurti', 'shirt', 'pant', 'saree', 'dress', 'stock', 'balance', 'ledger', 'order', 'rate', 'price', 'bhao', 'dispatch', 'lr', 'baki', 'available', 'maal', 'milega'];
        const hasErpKeyword = erpKeywords.some(kw => text.includes(kw));

        if (!hasErpKeyword && greetingWords.some(word => text === word || text === word + '!' || text === word + '.')) {
            return { intent: 'GREETING', args: {} };
        }

        // 7. Outstanding Balance queries
        if (text.includes('outstanding') || text.includes('balance') || text.includes('baki kitna') || text.includes('hisab') || text.includes('baki hai')) {
            return { intent: 'OUTSTANDING_LOOKUP', args: {} };
        }

        // 8. Ledger/Invoice file requests
        if (text.includes('send ledger') || text.includes('ledger pdf') || text.includes('statement') || text.includes('invoice')) {
            return { intent: 'LEDGER_REQUEST', args: {} };
        }

        // 9. Dispatch / Shipment status
        if (text.includes('ship') || text.includes('dispatch') || text.includes('lr') || text.includes('track') || text.includes('delivery') || text.includes('niklega')) {
            const orderIdMatch = text.match(/(?:order|id|no)\s*#?\s*(\d+)/);
            return {
                intent: 'ORDER_TRACKING',
                args: { orderId: orderIdMatch ? parseInt(orderIdMatch[1]) : 1 }
            };
        }

        // 10. Pricing Rate queries
        if (text.includes('rate') || text.includes('price') || text.includes('bhao') || text.includes('price list')) {
            return {
                intent: 'PRICE_LOOKUP',
                args: { skuCode: 'KURTI-FES-01-BLU-L' }
            };
        }

        // Maps and tools for entity extraction
        const colorMap = {
            'red': 'RED', 'blue': 'BLU', 'green': 'GRN', 'white': 'WHT',
            'black': 'BLK', 'yellow': 'YLW', 'pink': 'PNK', 'orange': 'ORG',
            'purple': 'PRP', 'grey': 'GRY', 'gray': 'GRY', 'lal': 'RED',
            'neela': 'BLU', 'neeli': 'BLU', 'hara': 'GRN', 'hari': 'GRN',
            'safed': 'WHT', 'kala': 'BLK', 'peela': 'YLW', 'gulabi': 'PNK'
        };
        const sizeMap = {
            'small': 'S', 'medium': 'M', 'large': 'L', 'xl': 'XL',
            'xxl': 'XXL', 'xs': 'XS'
        };
        const garmentMap = {
            'kurti': 'KURTI', 'kurtis': 'KURTI', 'shirt': 'SHIRT',
            'pant': 'PANT', 'pants': 'PANT', 'saree': 'SAREE',
            'dress': 'DRESS', 'top': 'TOP', 'lehenga': 'LEHENGA'
        };
        const colorWordToEnglish = {
            'lal': 'red', 'neela': 'blue', 'neeli': 'blue', 'hara': 'green',
            'hari': 'green', 'safed': 'white', 'kala': 'black', 'peela': 'yellow', 'gulabi': 'pink'
        };

        const skuMapping = [
            { id: 1, color: 'BLU', size: 'L', garment: 'KURTI' },
            { id: 2, color: 'RED', size: 'M', garment: 'KURTI' },
            { id: 3, color: 'GRN', size: 'S', garment: 'KURTI' },
            { id: 4, color: 'RED', size: 'FS', garment: 'SAREE' },
            { id: 5, color: 'WHT', size: 'L', garment: 'SHIRT' },
            { id: 6, color: 'BLK', size: 'XL', garment: 'SHIRT' },
            { id: 7, color: 'BLU', size: 'L', garment: 'PANT' }
        ];

        // 11. Order Booking
        if (text.includes('book') || text.includes('order karo') || text.includes('order book') || text.includes('send me') || text.includes('piece bhejo')) {
            const segments = text.split(/,|and|\+/);
            const items = [];
            for (const segment of segments) {
                const qtyMatch = segment.match(/(\d+)/);
                if (qtyMatch) {
                    const qty = parseInt(qtyMatch[1]);
                    let matchedColor = null;
                    let matchedSize = null;
                    let matchedGarment = 'KURTI'; // default
                    
                    // Detect color
                    for (const [word, code] of Object.entries(colorMap)) {
                        if (segment.includes(word)) { matchedColor = code; break; }
                    }
                    // Detect size
                    for (const [word, code] of Object.entries(sizeMap)) {
                        if (segment.includes(word)) { matchedSize = code; break; }
                    }
                    const sizeLetterMatch = segment.match(/(?<![a-z])(xxl|xl|xs|[sml])(?![a-z])/i);
                    if (sizeLetterMatch && !matchedSize) matchedSize = sizeLetterMatch[1].toUpperCase();
                    
                    // Detect garment
                    for (const [word, code] of Object.entries(garmentMap)) {
                        if (segment.includes(word)) { matchedGarment = code; break; }
                    }

                    // Find SKU ID
                    let bestSku = skuMapping.find(s => 
                        (!matchedColor || s.color === matchedColor) && 
                        (!matchedSize || s.size === matchedSize) &&
                        (matchedGarment === s.garment)
                    );
                    if (!bestSku) {
                        bestSku = skuMapping.find(s => 
                            (!matchedColor || s.color === matchedColor) && 
                            (!matchedSize || s.size === matchedSize)
                        );
                    }
                    items.push({
                        sku_id: bestSku ? bestSku.id : 1,
                        qty: qty
                    });
                }
            }

            return {
                intent: 'ORDER_BOOKING',
                args: {
                    items: items.length > 0 ? items : [{ sku_id: 1, qty: 2 }]
                }
            };
        }

        // 12. Default to Catalog / Inventory check
        let detectedColor = null;
        let detectedColorWord = null;
        let detectedSize = null;
        let detectedGarment = null;

        for (const [word, code] of Object.entries(colorMap)) {
            if (text.includes(word)) {
                detectedColor = code;
                detectedColorWord = colorWordToEnglish[word] || word;
                break;
            }
        }
        for (const [word, code] of Object.entries(sizeMap)) {
            if (text.includes(word.trim())) { detectedSize = code; break; }
        }
        const sizeLetterMatch = text.match(/(?<![a-z])(xxl|xl|xs|[sml])(?![a-z])/i);
        if (sizeLetterMatch && !detectedSize) detectedSize = sizeLetterMatch[1].toUpperCase();
        for (const [word, code] of Object.entries(garmentMap)) {
            if (text.includes(word)) { detectedGarment = code; break; }
        }

        // Extract numbers for style lookup
        const styleMatch = text.match(/(?:style|sku|code|design|product)\s*#?\s*(\d+)/i) || text.match(/(?<!\d)(\d{3,4})(?!\d)/);
        const skuSearch = styleMatch ? styleMatch[1] : ( [detectedGarment, detectedColor, detectedSize].filter(Boolean).join('-') || null );

        return {
            intent: 'INVENTORY_LOOKUP',
            args: {
                skuCode: skuSearch,
                color: detectedColor,
                originalColor: detectedColorWord,
                size: detectedSize,
                garmentType: detectedGarment
            }
        };
    }

    /**
     * Generates natural language responses from ERP JSON outputs.
     */
    static formatResponse(intent, data, context = {}) {
        const role = context.role || 'Customer';
        
        switch (intent) {
            case 'GREETING':
                return {
                    type: 'interactive',
                    interactive: {
                        type: 'list',
                        header: {
                            type: 'text',
                            text: context.companyName || 'Aarav Creations Wholesale'
                        },
                        body: {
                            text: `👋 Welcome to *${context.companyName || 'Aarav Creations'}* Wholesale Garments! 🙏\n\nHow may I help you today? Please select an option:`
                        },
                        footer: {
                            text: 'AutomateX ERP Gateway'
                        },
                        action: {
                            button: 'View Options 📋',
                            sections: [
                                {
                                    title: '📋 Business Assistant Menu',
                                    rows: [
                                        { id: 'btn_catalogue', title: '1️⃣ New Catalogue ✨', description: 'Show new arrivals & collections' },
                                        { id: 'btn_stock', title: '2️⃣ Check Stock 📦', description: 'Check color & size availability' },
                                        { id: 'btn_price', title: '3️⃣ Check Price 🏷️', description: 'Get wholesale tier rates' },
                                        { id: 'btn_order', title: '4️⃣ Place Order 🛒', description: 'Place a wholesale booking' },
                                        { id: 'btn_balance', title: '5️⃣ Outstanding 💳', description: 'Check balance & credit limit' },
                                        { id: 'btn_track', title: '6️⃣ Dispatch Status 🚚', description: 'Track transport LR & delivery' }
                                    ]
                                }
                            ]
                        }
                    }
                };

            case 'GUIDE_STOCK':
                return `📦 *Stock Availability Check*\n\nPlease specify the item, color & size you are looking for!\n\n*Examples*:\n• "Blue L Kurti available hai?"\n• "Red Medium Shirt in stock?"\n• "Black XL Pant rate & stock"`;

            case 'GUIDE_ORDER':
                return `🛒 *Book Wholesale Order*\n\nPlease specify the item & quantity you wish to order!\n\n*Examples*:\n• "Book 5 pieces Blue L Kurti"\n• "Order 10 pcs Red Medium Shirt"`;

            case 'INVENTORY_LOOKUP':
                if (data && data.available_qty > 0) {
                    return `📦 *Stock Availability Status*\n\n👗 *Product*: Festive Designer Kurti\n🎨 *Color*: ${data.color || 'Blue'}\n📏 *Size*: ${data.size || 'L'}\n🆔 *SKU*: ${data.sku_code || 'KURTI-FES-01-BLU-L'}\n\n✅ *Current Ready Stock*: *${data.available_qty} Pieces*\n🚚 *Dispatch Status*: Ready for Immediate Dispatch (1-2 Days)\n🏬 *Warehouse*: Central Depot (Jaipur)\n\n💬 Reply *"Book 10 pcs"* to reserve stock now!`;
                }
                return `❌ *Stock Availability Status*\n\n👗 *Item*: ${data ? data.sku_code || 'Kurti' : 'Requested Combination'}\n⚠️ *Status*: Currently Out of Stock!\n\n💡 *Recommendation*: Similar styles in Red & Green are available in stock. Reply *"Check Stock Red L"* to view alternatives.`;

            case 'PRICE_LOOKUP':
                const rate = typeof data === 'number' || typeof data === 'string' ? data : (data && data.price ? data.price : 480);
                return `🏷️ *Wholesale Rate Card - ${context.companyName || 'Aarav Creations'}*\n\n📌 *Item*: Kurti Festive Collection\n🆔 *SKU*: KURTI-FES-01-BLU-L\n\n💰 *Wholesale Price*: *₹${rate}* / piece\n📊 *Your Customer Tier*: *${role}*\n📦 *Minimum Order Qty (MOQ)*: 12 pieces\n\n🔥 *Volume Tier Schemes*:\n• 50+ pcs: *5% Flat Discount* (₹${Math.round(rate * 0.95)}/pc)\n• 100+ pcs: *10% Festive Offer* (₹${Math.round(rate * 0.90)}/pc)\n\n💬 Reply *"Book 12 pcs"* to place your wholesale order!`;

            case 'OUTSTANDING_LOOKUP':
                if (data) {
                    const availCredit = data.credit_limit ? (data.credit_limit - data.used_credit) : 140000;
                    return `💳 *Account Outstanding Summary*\n\n👤 *Customer*: ${data.name || 'Aarav Wholesalers'}\n🏢 *Business*: Aarav Creations (Co_102)\n\n🔴 *Current Outstanding Balance*: *₹${(data.outstanding_balance || 128450).toLocaleString('en-IN')}* (Rs. ${data.outstanding_balance || 128450})\n🟢 *Available Credit Limit*: *₹${availCredit.toLocaleString('en-IN')}*\n🛡️ *Total Authorized Credit*: ₹${(data.credit_limit || 500000).toLocaleString('en-IN')}\n\n📌 *Payment Status*: Account Active & Clear\n🔗 *Quick Pay Link*: https://checkout.automatex.in/pay?customer=${data.customer_id || 1}`;
                }
                return `💳 *Account Summary*\n\nNo balance record found. Please contact support.`;

            case 'LEDGER_REQUEST':
                return `📄 *Account Statement & Ledger Statement*\n\n👤 *Customer*: Aarav Wholesalers\n📅 *Statement Period*: Current Financial Year (2026-27)\n\n✅ *PDF Ledger generated successfully!*\n📎 *Please find the attached PDF document below:*`;

            case 'ORDER_TRACKING':
                if (data) {
                    return `🚚 *Shipment & Transport Tracking*\n\n📦 *Order ID*: #${data.order_id || 1}\n🟢 *Status*: *${data.status || 'Packed & Ready'}*\n\n🚛 *Transporter*: ${data.transporter_name || 'Jaipur Golden Transport'}\n🎫 *LR Number*: *${data.lr_number || 'LR-987654'}*\n📅 *Dispatch Date*: ${data.dispatch_date || '08-Aug-2026'}\n⏱️ *Estimated Delivery*: ${data.estimated_delivery || '11-Aug-2026 (Today)'}\n\n📞 *Transporter Helpline*: +91 98290 12345`;
                }
                return `🚚 *Order Tracking*: Could not find dispatch details for the requested order ID.`;

            case 'ORDER_BOOKING':
                if (data.success) {
                    if (data.order_status === 'Pending_Approval') {
                        return `⏳ *Order Booking Submitted (Pending Approval)*\n\n🧾 *Order ID*: #${data.order_id}\n👤 *Customer*: ${data.customer_name}\n⚠️ *Status*: Order exceeds daily credit limit — pending owner approval.\n\nWe will notify you on WhatsApp once approved by owner!`;
                    }
                    return `🎉 *Order Successfully Booked!* (Order #${data.order_id} booked successfully)\n\n🧾 *Order ID*: #${data.order_id}\n👤 *Customer*: ${data.customer_name}\n\n💵 *Subtotal*: ₹${data.subtotal || 2250}\n🏷️ *Scheme Applied*: ${data.scheme_applied || 'Festive 10% Off'}\n💳 *Net Payable Amount*: *₹${data.final_total || 2025}*\n\n📌 *Order Status*: Pending Payment / Dispatch\n🔗 *Pay Now Online*: https://checkout.automatex.in/pay?order_id=${data.order_id}`;
                }
                return `❌ *Order Booking Failed*: Please check items & stock availability.`;

            case 'REPEAT_ORDER':
                if (!data) return `⚠️ *Repeat Order*: You do not have any previous orders to repeat.`;
                const itemsList = data.items.map(item => `• ${item.sku_code} (${item.color} | ${item.size}): ${item.qty} pcs`).join('\n');
                return `🔄 *Repeat Previous Order #${data.order_id}*\n\nYour last order contained:\n${itemsList}\n\n💵 *Total Value*: ₹${data.total_amount}\n\n💬 Reply *"Book ${data.items.reduce((acc, i) => acc + i.qty, 0)} pcs"* to place this order again!`;

            case 'NEW_ARRIVALS':
                if (!data || data.length === 0) return `✨ No new arrivals available at the moment.`;
                const newArrivalsList = data.map(item => `• *${item.sku_code}* (${item.color} | ${item.size}) - ₹${item.base_price}/pc (Stock: ${item.available_qty} pcs)`).join('\n');
                return `✨ *New Arrivals Collection* ✨\n\nHere are our latest additions:\n${newArrivalsList}\n\n💬 Reply with the product name or code to book!`;

            case 'TOP_SELLING':
                if (!data || data.length === 0) return `🔥 Top-selling metrics are currently updating.`;
                const topList = data.map((item, idx) => `${idx + 1}️⃣ *${item.sku_code}* (${item.color} | ${item.size}) - ₹${item.base_price}/pc`).join('\n');
                return `🔥 *Fastest Selling Wholesales* 🔥\n\nThese designs are moving fast today:\n${topList}\n\n💬 Reply with the size and qty to order yours!`;

            case 'OWNER_REPORT': {
                if (!data) return `📊 *Owner Dashboard Report*: No data returned.`;
                if (data.type === 'SALES') {
                    return `📊 *Owner Report: Today's Sales*\n\n💰 Total Sales booked today: *₹${data.value.toLocaleString('en-IN')}*`;
                }
                if (data.type === 'COLLECTION') {
                    return `📊 *Owner Report: Today's Collections*\n\n💳 Total Payments received today: *₹${data.value.toLocaleString('en-IN')}*`;
                }
                if (data.type === 'LOW_STOCK') {
                    if (data.list.length === 0) return `📊 *Owner Report: Low Stock Check*\n\n✅ Excellent! All products are well above reorder levels.`;
                    const list = data.list.map(item => `• *${item.sku_code}*: Stock is *${item.available_qty}* (Reorder level: ${item.reorder_level})`).join('\n');
                    return `📊 *Owner Report: Low Stock Alerts* ⚠️\n\nFollowing items have breached reorder thresholds:\n${list}`;
                }
                if (data.type === 'DEAD_STOCK') {
                    if (data.list.length === 0) return `📊 *Owner Report: Dead Stock Check*\n\n✅ No dead stock found. All products have active sales!`;
                    const list = data.list.map(item => `• *${item.sku_code}* (Qty: ${item.available_qty} pcs)`).join('\n');
                    return `📊 *Owner Report: Dead Stock (Zero Sales)* 📦\n\nFollowing items have active inventory but no sales history:\n${list}`;
                }
                if (data.type === 'TOP_SELLING') {
                    const list = data.list.map((item, idx) => `${idx + 1}️⃣ *${item.sku_code}*: Sold *${item.total_qty}* pieces`).join('\n');
                    return `📊 *Owner Report: Top Selling Styles* 🔥\n\nBest-moving products ordered by volume:\n${list}`;
                }
                if (data.type === 'CREDIT_BREACH') {
                    if (data.list.length === 0) return `📊 *Owner Report: Credit Limit Breaches*\n\n✅ All active customers are within their credit limits.`;
                    const list = data.list.map(item => `• *${item.name}*: Outstanding is *₹${item.outstanding_balance.toLocaleString('en-IN')}* (Limit: ₹${item.credit_limit.toLocaleString('en-IN')})`).join('\n');
                    return `📊 *Owner Report: Credit Breach Alerts* 🚨\n\nFollowing customers have exceeded their credit limits:\n${list}`;
                }
                if (data.type === 'HIGH_OUTSTANDING') {
                    if (data.list.length === 0) return `📊 *Owner Report: High Outstanding Check*\n\nNo customer exceeds the specified threshold.`;
                    const list = data.list.map(item => `• *${item.name}*: *₹${item.outstanding_balance.toLocaleString('en-IN')}*`).join('\n');
                    return `📊 *Owner Report: High Outstanding Accounts*\n\nOutstanding balance above ₹500,000:\n${list}`;
                }
                if (data.type === 'PROFIT') {
                    return `📊 *Owner Report: Today's Estimated Profit*\n\n📈 Net Profit (gross estimate): *₹${data.value.toLocaleString('en-IN')}*`;
                }
                if (data.type === 'INACTIVE_CUSTOMERS') {
                    if (data.list.length === 0) return `📊 *Owner Report: Customer Follow Up*\n\nAll customers have ordered this month.`;
                    const list = data.list.map(item => `• *${item.name}* (Phone: ${item.phone || 'N/A'})`).join('\n');
                    return `📊 *Owner Report: Inactive Customers (No Orders This Month)* 💤\n\nPlease follow up with:\n${list}`;
                }
                return `📊 *Owner Dashboard Report*`;
            }

            default:
                return `Welcome to Aarav Creations support. How may I help you today?\n1. Check Stock\n2. Outstanding Balance\n3. Order Dispatch Status\n4. Request Ledger Statement`;
        }
    }
}

module.exports = QueryParserService;
