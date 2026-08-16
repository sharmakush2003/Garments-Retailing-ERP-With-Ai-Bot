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

        // 1. Detect interactive button/list clicks or category selections
        if (text.includes('cat_kurti') || text.includes('1️⃣ kurti') || text.includes('kurti 👗') || text === 'kurti' || text === 'kurtis') {
            return { intent: 'PRODUCT_FILTERED', args: { garmentType: 'KURTI' } };
        }
        if (text.includes('cat_shirt') || text.includes('2️⃣ shirt') || text.includes('shirt 👔') || text === 'shirt' || text === 'shirts') {
            return { intent: 'PRODUCT_FILTERED', args: { garmentType: 'SHIRT' } };
        }
        if (text.includes('cat_pant') || text.includes('3️⃣ pant') || text.includes('pant 👖') || text === 'pant' || text === 'pants') {
            return { intent: 'PRODUCT_FILTERED', args: { garmentType: 'PANT' } };
        }
        if (text.includes('cat_saree') || text.includes('4️⃣ saree') || text.includes('saree 🥻') || text === 'saree' || text === 'sarees') {
            return { intent: 'PRODUCT_FILTERED', args: { garmentType: 'SAREE' } };
        }

        if (text.includes('stock_kurti') || (text.includes('kurti') && text.includes('stock') && !text.includes('check'))) {
            return { intent: 'DESIGN_AVAILABILITY', args: { garmentType: 'KURTI' } };
        }
        if (text.includes('stock_shirt') || (text.includes('shirt') && text.includes('stock') && !text.includes('check'))) {
            return { intent: 'DESIGN_AVAILABILITY', args: { garmentType: 'SHIRT' } };
        }
        if (text.includes('stock_pant') || (text.includes('pant') && text.includes('stock') && !text.includes('check'))) {
            return { intent: 'DESIGN_AVAILABILITY', args: { garmentType: 'PANT' } };
        }
        if (text.includes('stock_saree') || (text.includes('saree') && text.includes('stock') && !text.includes('check'))) {
            return { intent: 'DESIGN_AVAILABILITY', args: { garmentType: 'SAREE' } };
        }

        if (text === 'btn_catalogue' || text.includes('catalogue') || text.includes('catalog') || text === '1' || text.includes('1️⃣')) {
            return { intent: 'GUIDE_CATALOGUE', args: {} };
        }
        if (text === 'btn_stock' || text.includes('check stock') || text === '2') {
            return { intent: 'GUIDE_STOCK', args: {} };
        }
        // Specific category price list selections
        if (text.includes('price_kurti') || (text.includes('kurti') && text.includes('price') && !text.includes('check'))) {
            return { intent: 'PRICE_LOOKUP', args: { garmentType: 'KURTI', skuCode: 'KURTI-FES-BLU-L' } };
        }
        if (text.includes('price_shirt') || (text.includes('shirt') && text.includes('price') && !text.includes('check'))) {
            return { intent: 'PRICE_LOOKUP', args: { garmentType: 'SHIRT', skuCode: 'SHIRT-COT-WHT-L' } };
        }
        if (text.includes('price_pant') || (text.includes('pant') && text.includes('price') && !text.includes('check'))) {
            return { intent: 'PRICE_LOOKUP', args: { garmentType: 'PANT', skuCode: 'PANT-DEN-BLU-L' } };
        }
        if (text.includes('price_saree') || (text.includes('saree') && text.includes('price') && !text.includes('check'))) {
            return { intent: 'PRICE_LOOKUP', args: { garmentType: 'SAREE', skuCode: 'SAREE-SIL-RED-FS' } };
        }

        if (text === 'btn_price' || text.includes('check price') || text.includes('wholesale rates') || text.includes('rate list') || text === '3') {
            return { intent: 'GUIDE_PRICE', args: {} };
        }
        if (text === 'btn_ledger' || text === '4' || text.includes('4️⃣')) {
            return { intent: 'OLD_LEDGER_STATUS', args: {} };
        }
        if (text === 'btn_tracking' || text === '5' || text.includes('5️⃣')) {
            return { intent: 'SHIPMENT_TRACKING', args: {} };
        }
        if (text === 'btn_outstanding' || text === '6' || text.includes('6️⃣')) {
            return { intent: 'OUTSTANDING_LOOKUP', args: {} };
        }
        if (text === 'btn_invoice' || text === '7' || text.includes('7️⃣')) {
            return { intent: 'LAST_INVOICE_COPY', args: {} };
        }
        if (text === 'btn_past_shipments' || text === '8' || text.includes('8️⃣')) {
            return { intent: 'OLD_SHIPMENT_INQUIRY', args: {} };
        }

        // Colors lookup (general questions about colors)
        if ((text.includes('colour') || text.includes('color') || text.includes('rang')) && !text.includes('book') && !text.includes('order')) {
            const specificColor = ['red', 'blue', 'green', 'white', 'black', 'yellow', 'pink', 'lal', 'neela', 'hara', 'safed', 'kala', 'peela', 'gulabi', 'grey', 'gray', 'purple'].some(word => text.includes(word));
            if (!specificColor) {
                return { intent: 'COLOURS_LOOKUP', args: {} };
            }
        }

        // Sizes lookup (general questions about sizes)
        if ((text.includes('size') || text.includes('sizes') || text.includes('মাপ')) && !text.includes('book') && !text.includes('order')) {
            const specificSize = ['small', 'medium', 'large', 'xl', 'xxl', 'xs'].some(word => text.includes(word));
            const sizeLetterMatch = text.match(/(?<![a-z])(xxl|xl|xs|[sml])(?![a-z])/i);
            if (!specificSize && !sizeLetterMatch) {
                return { intent: 'SIZES_LOOKUP', args: {} };
            }
        }

        // Design/Product/Collection availability (general)
        if ((text.includes('design available') || text.includes('product available') || text.includes('collection available') || (text.includes('available') && text.includes('design')) || (text.includes('available') && text.includes('product')))) {
            return { intent: 'DESIGN_AVAILABILITY', args: {} };
        }

        // Filtered products lookup (price / fabric / category)
        const maxPriceMatch = text.match(/(?:under|below|less than|se kam|ke andar)\s*₹?\s*(\d+)/i) || text.match(/₹?\s*(\d+)\s*(?:under|below|se kam|ke andar)/i);
        const fabricMatch = text.match(/(cotton|silk|denim)/i);
        if (maxPriceMatch || fabricMatch) {
            let garmentType = null;
            if (text.includes('shirt')) garmentType = 'SHIRT';
            else if (text.includes('pant')) garmentType = 'PANT';
            else if (text.includes('kurti')) garmentType = 'KURTI';
            else if (text.includes('saree')) garmentType = 'SAREE';

            return {
                intent: 'PRODUCT_FILTERED',
                args: {
                    maxPrice: maxPriceMatch ? parseFloat(maxPriceMatch[1]) : null,
                    fabric: fabricMatch ? fabricMatch[1] : null,
                    garmentType: garmentType
                }
            };
        }

        // Greetings
        const greetingWords = ['hi', 'hello', 'hey', 'hie', 'hiee', 'namaste', 'namaskar', 'good morning', 'good evening', 'kaise ho', 'help', 'menu'];
        const erpKeywords = ['kurti', 'shirt', 'pant', 'saree', 'dress', 'stock', 'rate', 'price', 'bhao', 'available', 'maal', 'milega'];
        const hasErpKeyword = erpKeywords.some(kw => text.includes(kw));

        if (!hasErpKeyword && greetingWords.some(word => text === word || text === word + '!' || text === word + '.')) {
            return { intent: 'GREETING', args: {} };
        }

        // Pricing Rate queries
        if (text.includes('rate') || text.includes('price') || text.includes('bhao') || text.includes('price list')) {
            return {
                intent: 'GUIDE_PRICE',
                args: {}
            };
        }

        // Old Shipment Inquiry queries
        if (text.includes('old shipment') || text.includes('past shipment') || text.includes('delivery history') || text.includes('completed delivery') || text.includes('dispatch history') || text.includes('pichli delivery') || text.includes('purana dispatch')) {
            return { intent: 'OLD_SHIPMENT_INQUIRY', args: {} };
        }

        // Old Ledger Status queries
        if (text.includes('ledger') || text.includes('statement of account') || text.includes('khata book') || text.includes('khata status') || text.includes('account statement')) {
            return { intent: 'OLD_LEDGER_STATUS', args: {} };
        }

        // Last Invoice Copy queries
        if (text.includes('last invoice') || text.includes('invoice copy') || text.includes('pichla invoice') || text.includes('latest invoice') || text.includes('invoice detail')) {
            return { intent: 'LAST_INVOICE_COPY', args: {} };
        }

        // Shipment tracking / where has it reached queries
        if (text.includes('track') || text.includes('where') || text.includes('reach') || text.includes('tracking') || text.includes('kahan pahuncha') || text.includes('shipment status') || text.includes('delivery status') || text.includes('lr status')) {
            return { intent: 'SHIPMENT_TRACKING', args: {} };
        }

        // Outstanding balance queries
        if (text.includes('outstanding') || text.includes('baki payment') || text.includes('baki paisa') || text.includes('due balance') || text.includes('due amount') || text.includes('kitna baki') || text.includes('credit limit')) {
            return { intent: 'OUTSTANDING_LOOKUP', args: {} };
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

        // Extract requested quantity if user asks "Do you have 50 pieces?"
        const qtyMatch = text.match(/(\d+)\s*(?:piece|pieces|pcs|pc)/i) || text.match(/(?:have|get|want)\s*(\d+)/i);
        const requestedQty = qtyMatch ? parseInt(qtyMatch[1]) : null;

        return {
            intent: 'INVENTORY_LOOKUP',
            args: {
                skuCode: skuSearch,
                color: detectedColor,
                originalColor: detectedColorWord,
                size: detectedSize,
                garmentType: detectedGarment,
                requestedQty: requestedQty
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
                            text: `${context.companyName || 'Kaira'} 💁‍♀️`
                        },
                        body: {
                            text: `👋 Welcome to *Digifys Soft Solutions Garments*! 🙏\n\nI am *Kaira* 💁‍♀️, your helper today. How can I help you, dear? Please select an option below: ✨\n\n⚠️ *Note:* I am Kaira, your AI chatbot helper 🤖, so I can sometimes make little mistakes. If you are taking any final or financial decisions, please verify them manually once! 🌸💖`
                        },
                        footer: {
                            text: 'Digify Soft Solutions Kaira 💁‍♀️ Chatbot'
                        },
                        action: {
                            button: 'View Options 📋',
                            sections: [
                                {
                                    title: 'Assistant Menu 📋',
                                    rows: [
                                        { id: 'btn_catalogue', title: '1️⃣ Products Catalog ✨', description: 'Show all available products' },
                                        { id: 'btn_stock', title: '2️⃣ Check Stock 📦', description: 'Check color & size availability' },
                                        { id: 'btn_price', title: '3️⃣ Check Price 🏷️', description: 'Get wholesale tier rates' },
                                        { id: 'btn_ledger', title: '4️⃣ Ledger Status 📒', description: 'Statement of accounts/ledger' },
                                        { id: 'btn_tracking', title: '5️⃣ Shipment Tracking 📍', description: 'Track active shipment location' },
                                        { id: 'btn_outstanding', title: '6️⃣ Outstanding Credit 💰', description: 'Check credit limits & due balances' },
                                        { id: 'btn_invoice', title: '7️⃣ Last Invoice Copy 📄', description: 'Get copy of your latest invoice' },
                                        { id: 'btn_past_shipments', title: '8️⃣ Past Shipments 🚚', description: 'View historical completed dispatches' }
                                    ]
                                }
                            ]
                        }
                    }
                };

            case 'GUIDE_CATALOGUE':
                return {
                    type: 'interactive',
                    interactive: {
                        type: 'list',
                        header: {
                            type: 'text',
                            text: 'Products Catalog 📖'
                        },
                        body: {
                            text: 'Please select a category to see our latest beautiful designs and collections, dear! 🌸✨'
                        },
                        footer: {
                            text: 'Digify Soft Solutions Kaira 💁‍♀️ Chatbot'
                        },
                        action: {
                            button: 'Select Category 📂',
                            sections: [
                                {
                                    title: 'Categories 🏷️',
                                    rows: [
                                        { id: 'cat_kurti', title: '1️⃣ Kurti 👗', description: 'Festive & Casual Kurtis' },
                                        { id: 'cat_shirt', title: '2️⃣ Shirt 👔', description: 'Casual & Cotton Shirts' },
                                        { id: 'cat_pant', title: '3️⃣ Pant 👖', description: 'Cotton & Denim Pants' },
                                        { id: 'cat_saree', title: '4️⃣ Saree 🥻', description: 'Silk & Designer Sarees' }
                                    ]
                                }
                            ]
                        }
                    }
                };

            case 'GUIDE_STOCK':
                return {
                    type: 'interactive',
                    interactive: {
                        type: 'list',
                        header: {
                            type: 'text',
                            text: 'Check Stock 📦'
                        },
                        body: {
                            text: "Please select which category's stock details you want to see, dear! 💖👇"
                        },
                        footer: {
                            text: 'Digify Soft Solutions Kaira 💁‍♀️ Chatbot'
                        },
                        action: {
                            button: 'Select Category 📂',
                            sections: [
                                {
                                    title: 'Stock Categories 📦',
                                    rows: [
                                        { id: 'stock_kurti', title: '👗 Kurti Stock', description: 'Check availability for Kurtis' },
                                        { id: 'stock_shirt', title: '👔 Shirt Stock', description: 'Check availability for Shirts' },
                                        { id: 'stock_pant', title: '👖 Pant Stock', description: 'Check availability for Pants' },
                                        { id: 'stock_saree', title: '🥻 Saree Stock', description: 'Check availability for Sarees' }
                                    ]
                                }
                            ]
                        }
                    }
                };

            case 'GUIDE_PRICE':
                return {
                    type: 'interactive',
                    interactive: {
                        type: 'list',
                        header: {
                            type: 'text',
                            text: 'Check Prices 🏷️'
                        },
                        body: {
                            text: 'Please select which category\'s wholesale rates you want to see, dear! 💖👇'
                        },
                        footer: {
                            text: 'Digify Soft Solutions Kaira 💁‍♀️ Chatbot'
                        },
                        action: {
                            button: 'Select Category 📂',
                            sections: [
                                {
                                    title: 'Price Categories 🏷️',
                                    rows: [
                                        { id: 'price_kurti', title: '👗 Kurti Price Card', description: 'Wholesale rates for Kurtis' },
                                        { id: 'price_shirt', title: '👔 Shirt Price Card', description: 'Wholesale rates for Shirts' },
                                        { id: 'price_pant', title: '👖 Pant Price Card', description: 'Wholesale rates for Pants' },
                                        { id: 'price_saree', title: '🥻 Saree Price Card', description: 'Wholesale rates for Sarees' }
                                    ]
                                }
                            ]
                        }
                    }
                };
 
             case 'INVENTORY_LOOKUP':
                if (data && data.available_qty > 0) {
                    const reqQty = context.args && context.args.requestedQty;
                    if (reqQty) {
                        if (data.available_qty >= reqQty) {
                            return `📦 *Stock Status for You!* ✨\n\n👗 *Product*: ${data.name}\n✅ *Status*: Available, dear! 💖\n\nYes, we have *${reqQty} Pieces* in stock of *${data.sku_code}* (Ready Stock: ${data.available_qty} pcs). 🌸\n🚚 *Dispatch*: Ready for immediate dispatch in 1-2 days! ✨`;
                        } else {
                            const shortfall = reqQty - data.available_qty;
                            return `📦 *Stock Status for You!* ✨\n\n👗 *Product*: ${data.name}\n⚠️ *Status*: Oh, partial stock available!\n\nWe have *${data.available_qty} Pieces* ready (shortfall of *${shortfall} Pieces*). 🌸\n🔄 *Replenishment*: Fresh new batch will be ready in 3-4 days! 💖`;
                        }
                    }
                    return `📦 *Stock Status for You!* ✨\n\n👗 *Product*: ${data.name}\n🎨 *Color*: ${data.color}\n📏 *Size*: ${data.size}\n🆔 *SKU*: ${data.sku_code}\n\n✅ *Current Ready Stock*: *${data.available_qty} Pieces* 🌸\n🚚 *Dispatch Status*: Ready for immediate dispatch in 1-2 days! ✨\n🏬 *Warehouse*: Central Depot (Jaipur)\n\n💬 Reply *"Book 10 pcs"* to reserve this stock for you! 💖`;
                }
                return `❌ *Stock Status for You!* ✨\n\n👗 *Item*: ${data ? data.sku_code || 'Garment' : 'Requested Combination'}\n⚠️ *Status*: Currently out of stock, so sorry! 🥺\n\n💡 *Recommendation*: Similar gorgeous styles are available. Reply *"Check Stock"* to see them! 🌸`;

            case 'COLOURS_LOOKUP':
                if (data && data.length > 0) {
                    const colors = [...new Set(data.map(i => i.color))].join(', ');
                    const matrix = data.map(i => `• *${i.color}*: ${i.available_qty} pcs ready (Size: ${i.size})`).join('\n');
                    return `🎨 *Available Colours Matrix* 🌸\n\nHere are the lovely colours we have in stock:\n${matrix}\n\nTotal unique colors: ${colors} ✨`;
                }
                return `🎨 *Available Colours*: No color variations found, sorry dear! 🥺`;

            case 'SIZES_LOOKUP':
                if (data && data.length > 0) {
                    const sizes = [...new Set(data.map(i => i.size))].join(', ');
                    const matrix = data.map(i => `• *Size ${i.size}*: ${i.available_qty} pcs ready (Color: ${i.color})`).join('\n');
                    return `📏 *Available Sizes Matrix* ✨\n\nHere are the sizes we have in stock for you:\n${matrix}\n\nTotal unique sizes: ${sizes} 🌸`;
                }
                return `📏 *Available Sizes*: No size variations found, sorry dear! 🥺`;

            case 'DESIGN_AVAILABILITY':
                if (data && data.length > 0) {
                    const grouped = {};
                    data.forEach(i => {
                        const baseSku = i.sku_code.replace(/-[smlx]+$/i, '').replace(/-fs$/i, '').replace(/-freesize$/i, '');
                        // Strip trailing size from name
                        const baseName = (i.name || i.sku_code).replace(/\s+([sml]|xl|xxl|freesize|free size)$/i, '');
                        if (!grouped[baseSku]) {
                            grouped[baseSku] = {
                                name: baseName,
                                variants: []
                            };
                        }
                        grouped[baseSku].variants.push(i);
                    });

                    const sections = Object.keys(grouped).map(baseSku => {
                        const style = grouped[baseSku];
                        const variantsList = style.variants.map(v => {
                            const stock = v.available_qty !== undefined ? v.available_qty : 0;
                            return `  • Size *${v.size}* (${v.color}) — *${stock} pcs* ready`;
                        }).join('\n');
                        return `🛍️ *${style.name}*\n🆔 SKU: \`${baseSku}\`\n${variantsList}`;
                    }).join('\n\n');

                    return `📦 *Stock Availability Matrix* 👗✨\n_________________________\n\nHere is our stock, dear:\n\n${sections}`;
                }
                return `👗 *Design Availability*: Oh, that design is out of stock right now! 🥺`;

            case 'PRODUCT_FILTERED':
                if (data && data.length > 0) {
                    const grouped = {};
                    data.forEach(i => {
                        const baseSku = i.sku_code.replace(/-[smlx]+$/i, '').replace(/-fs$/i, '').replace(/-freesize$/i, '');
                        const baseName = (i.name || i.sku_code).replace(/\s+([sml]|xl|xxl|freesize|free size)$/i, '');
                        if (!grouped[baseSku]) {
                            grouped[baseSku] = {
                                name: baseName,
                                subcategory: i.subcategory || 'Cotton',
                                variants: []
                            };
                        }
                        grouped[baseSku].variants.push(i);
                    });

                    const sections = Object.keys(grouped).map(baseSku => {
                        const style = grouped[baseSku];
                        const variantsList = style.variants.map(v => {
                            const price = v.price !== undefined ? v.price : v.base_price;
                            const stock = v.available_qty !== undefined ? v.available_qty : 0;
                            return `  • Size *${v.size}* (${v.color}) — *₹${price}/pc* (Stock: *${stock}*)`;
                        }).join('\n');
                        return `🛍️ *${style.name}*\n🆔 SKU: \`${baseSku}\`\n🧵 Fabric: ${style.subcategory}\n${variantsList}`;
                    }).join('\n\n');

                    const isCatalog = !context.args || (!context.args.maxPrice && !context.args.fabric);
                    let title = `🔍 *Garments Search Results* 🌸`;
                    if (isCatalog) {
                        const cat = context.args && context.args.garmentType;
                        title = cat ? `📖 *${cat.charAt(0).toUpperCase() + cat.slice(1).toLowerCase()} Catalog* 👗✨` : `📖 *Wholesale Product Catalog* 🛍️✨`;
                    }
                    return `${title}\n_________________________\n\nHere is our catalog for you, dear! 🌸:\n\n${sections}`;
                }
                return `🔍 *Garments Search Results* 🌸\n\n⚠️ So sorry, no matching products found for the requested criteria! 🥺`;

            case 'PRICE_LOOKUP':
                const rate = typeof data === 'number' || typeof data === 'string' ? data : (data && data.price !== undefined ? data.price : 480);
                const itemName = data && data.name ? data.name : 'Kurti Festive Collection';
                const skuCode = data && data.sku_code ? data.sku_code : 'KURTI-FES-BLU-L';
                return `🏷️ *Wholesale Rate Card - ${context.companyName || 'Kaira'}* 💁‍♀️✨\n\n📌 *Item*: ${itemName}\n🆔 *SKU*: ${skuCode}\n\n💰 *Wholesale Price*: *₹${rate}* / piece\n📊 *Your Customer Tier*: *${role}* 🌸\n📦 *Minimum Order Qty (MOQ)*: 12 pieces\n\n🔥 *Volume Tier Schemes*:\n• 50+ pcs: *5% Flat Discount* (₹${Math.round(rate * 0.95)}/pc)\n• 100+ pcs: *10% Festive Offer* (₹${Math.round(rate * 0.90)}/pc)\n\n💬 Reply *"Book 12 pcs"* to place your order with me! 💖`;

            case 'OLD_SHIPMENT_INQUIRY':
                if (data && data.length > 0) {
                    const list = data.map(s => `• *Order #${s.order_id}* Dispatched via *${s.transporter_name}* (LR: \`${s.lr_number}\`) on *${s.dispatch_date}* to *${s.destination}* — Status: *${s.status}* on ${s.delivered_date || s.estimated_delivery} (${s.total_qty} pcs)`).join('\n');
                    return `🚚 *Old Shipment History Summary* 📦\n_________________________\n\nHere is your past shipment dispatch history, dear! 🌸:\n\n${list}\n\n💬 Need details on any order? Reply with order number!`;
                }
                return `🚚 *Old Shipment History*: No past shipments found in database for you, dear! 🥺`;

            case 'OLD_LEDGER_STATUS':
                if (data && data.length > 0) {
                    const list = data.map(l => `• *${l.date}*: ${l.description} | Debit: *₹${l.debit}* | Credit: *₹${l.credit}* | Bal: *₹${l.running_balance}*`).join('\n');
                    const latest = data[data.length - 1];
                    return `📒 *Account Ledger Status Statement* 📊\n_________________________\n\nHere is the transaction ledger list, dear! 🌸:\n\n${list}\n\n📌 *Current Outstanding Balance*: *₹${latest ? latest.running_balance : 0.00}* 💰\n💬 Reply *"Invoice"* for the invoice copy of latest transaction!`;
                }
                return `📒 *Ledger Status*: No transaction history found, dear! 🥺`;

            case 'LAST_INVOICE_COPY':
                if (data) {
                    const itemsList = data.items.map(i => `  - ${i.name} (Qty: *${i.qty}* @ ₹${i.price_per_item}/pc) = *₹${i.total_amount}*`).join('\n');
                    return `📄 *Latest Invoice Details* 🧾\n_________________________\n\n📌 *Invoice No*: *${data.invoice_number}*\n📅 *Date*: ${data.invoice_date}\n📦 *Order ID*: #${data.order_id}\n👤 *Customer*: ${data.customer_name}\n\n🛍️ *Items*:\n${itemsList}\n\n💵 *Taxable Value*: ₹${data.taxable_value}\n➕ *CGST (2.5%)*: ₹${data.cgst_amount}\n➕ *SGST (2.5%)*: ₹${data.sgst_amount}\n➖ *Discount*: ₹${data.discount_applied}\n💰 *Net Payable*: *₹${data.net_payable}*\n📝 *Status*: *${data.payment_status}* 🌸`;
                }
                return `📄 *Invoice details*: No invoice record found for you, dear! 🥺`;

            case 'SHIPMENT_TRACKING':
                if (data && data.status) {
                    const history = data.tracking_history ? data.tracking_history.map(h => `  • _${h.timestamp}_ [${h.location}]: ${h.details}`).join('\n') : '';
                    return `📍 *Active Shipment Tracking Status* 🚚\n_________________________\n\n📦 *Order ID*: #${data.order_id}\n🔢 *Tracking/LR No*: \`${data.tracking_number || data.lr_number}\`\n🚛 *Transporter*: ${data.transporter_name}\n📅 *Dispatch Date*: ${data.dispatch_date}\n\n⚡ *Current Location*: *${data.current_location}*\n🟢 *Status*: *${data.status}* ✨\n🕒 *Last Updated*: ${data.last_updated}\n📅 *Est. Delivery*: *${data.estimated_delivery_date}*\n\n📊 *Tracking Timeline*:\n${history}\n\n💖 Maal jaldi pahunch jayega, dear!`;
                }
                return `📍 *Shipment Tracking*: Oh, no active shipment tracking data found! 🥺\n💬 Try replying with your order number.`;

            case 'OUTSTANDING_LOOKUP':
                if (data) {
                    return `💰 *Credit & Outstanding Status Summary* 📊\n_________________________\n\n👤 *Customer*: ${data.customer_name}\n📞 *Registered Phone*: ${data.phone}\n\n💸 *Total Outstanding*: *₹${data.outstanding_balance}* 💳\n🛡️ *Credit Limit*: ₹${data.credit_limit}\n✅ *Available Credit*: ₹${data.available_credit}\n⏳ *Payment Terms*: ${data.payment_terms}\n\n📅 *Aging Summary (Overdue status)*:\n• Not Due Yet: ₹${data.due_date_summary.not_due_yet}\n• 0-30 Days Overdue: *₹${data.due_date_summary.overdue_0_30_days}* ⚠️\n• 31-60 Days Overdue: ₹${data.due_date_summary.overdue_30_60_days}\n• 60+ Days Overdue: ₹${data.due_date_summary.overdue_60_plus_days}\n\n💬 Please clear overdue bills at your earliest convenience, dear! 🌸`;
                }
                return `💰 *Outstanding Status*: No outstanding profile found for your account, dear! 🥺`;

            default:
                return `Welcome to Kaira support! 💁‍♀️ How may I help you today, dear? 🌸\n1. Check Stock 📦\n2. Check Price 🏷️\n3. View Catalogue 📖`;
        }
    }
}

module.exports = QueryParserService;
