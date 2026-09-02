const fs = require('fs');
const path = require('path');
const axios = require('axios');

/**
 * Query Parser Service
 * Parses Hinglish/English queries into structured intents and arguments.
 * Implements local rule-based regex parsing for local development and offline validation.
 */
class QueryParserService {
    /**
     * Dynamically retrieves all active categories from categories.json (or products.json fallback).
     */
    static getCategories() {
        try {
            const categoriesPath = path.join(__dirname, '..', 'mock_data', 'categories.json');
            if (fs.existsSync(categoriesPath)) {
                let raw = fs.readFileSync(categoriesPath, 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, '');
                const categoriesData = JSON.parse(raw);
                if (Array.isArray(categoriesData) && categoriesData.length > 0) {
                    return categoriesData.map(c => ({
                        id: c.category_id,
                        name: c.name.trim()
                    }));
                }
            }
        } catch (e) {}

        try {
            const productsPath = path.join(__dirname, '..', 'mock_data', 'products.json');
            if (fs.existsSync(productsPath)) {
                let raw = fs.readFileSync(productsPath, 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, '');
                const productsData = JSON.parse(raw);
                if (Array.isArray(productsData) && productsData.length > 0) {
                    const set = new Set();
                    const list = [];
                    productsData.forEach(p => {
                        if (p.category && !set.has(p.category.toLowerCase().trim())) {
                            set.add(p.category.toLowerCase().trim());
                            list.push({ id: list.length + 1, name: p.category.trim() });
                        }
                    });
                    if (list.length > 0) return list;
                }
            }
        } catch (e) {}

        return [
            { id: 1, name: 'Kurti' },
            { id: 2, name: 'Shirt' },
            { id: 3, name: 'Pant' },
            { id: 4, name: 'Saree' }
        ];
    }

    /**
     * Ensures row titles do not exceed Meta WhatsApp API max 24 character limit.
     */
    static formatRowTitle(title, maxLen = 24) {
        if (!title) return '';
        const str = String(title).trim();
        return str.length > maxLen ? str.slice(0, maxLen - 1) + '…' : str;
    }

    /**
     * Ensures row descriptions do not exceed Meta WhatsApp API max 72 character limit.
     */
    static formatRowDesc(desc, maxLen = 72) {
        if (!desc) return '';
        const str = String(desc).trim();
        return str.length > maxLen ? str.slice(0, maxLen - 1) + '…' : str;
    }

    /**
     * Returns a relevant emoji for a given category name.
     */
    static getCategoryEmoji(categoryName) {
        const name = (categoryName || '').toLowerCase();
        if (name.includes('kurti') || name.includes('kurta') || name.includes('dress')) return '👗';
        if (name.includes('shirt') || name.includes('top')) return '👔';
        if (name.includes('pant') || name.includes('trouser') || name.includes('denim') || name.includes('jeans')) return '👖';
        if (name.includes('saree')) return '🥻';
        if (name.includes('under') || name.includes('inner') || name.includes('brief') || name.includes('bra')) return '🩲';
        if (name.includes('kid') || name.includes('child')) return '🧒';
        if (name.includes('shoe') || name.includes('footwear')) return '👟';
        return '🛍️';
    }

    /**
     * Parses Hinglish/English/Vernacular text queries using Gemini or OpenAI API.
     */
    static async parseMessageWithLLM(messageText) {
        if (!messageText || typeof messageText !== 'string' || messageText.trim() === '') {
            return null;
        }

        const geminiKey = process.env.GEMINI_API_KEY;
        const openaiKey = process.env.OPENAI_API_KEY;
        const groqKey = process.env.GROQ_API_KEY;

        if (!geminiKey && !openaiKey && !groqKey) {
            return null;
        }

        const activeCategoriesList = QueryParserService.getCategories().map(c => c.name.toUpperCase()).join(', ');

        const systemInstruction = `
You are an expert NLP parser for a Wholesale Garments Retailing ERP chatbot.
Your job is to parse Hinglish/English/Vernacular text queries from retailers and salespersons into a structured JSON representation of intents and arguments.

Available Intents:
- 'GREETING': Welcoming messages, "hi", "hello", "namaste", "help", "menu".
- 'GUIDE_CATALOGUE': Asking for general catalog or collection.
- 'GUIDE_STOCK': Asking to check stock or inventory in general.
- 'GUIDE_PRICE': Asking to check price or rate list in general.
- 'INVENTORY_LOOKUP': Looking up stock availability for a specific style/SKU, color, size, or category.
- 'COLOURS_LOOKUP': Querying what colors are available for an item or generally.
- 'SIZES_LOOKUP': Querying what sizes are available for an item or generally.
- 'DESIGN_AVAILABILITY': Asking about design/collection availability.
- 'PRODUCT_FILTERED': Searching for garments filtered by price, fabric (e.g. cotton, silk, denim), and/or garment type (${activeCategoriesList}).
- 'PRICE_LOOKUP': Looking up the price for a specific SKU/style.
- 'OLD_SHIPMENT_INQUIRY': Asking about past shipment history or historical dispatches.
- 'OLD_LEDGER_STATUS': Asking for statement of account, ledger, or balance sheet.
- 'LAST_INVOICE_COPY': Asking for a copy of the latest or last invoice.
- 'SHIPMENT_TRACKING': Tracking active shipments ("where has it reached", "status of order").
- 'OUTSTANDING_LOOKUP': Querying credit limit, due balance, or outstanding amount.
- 'ORDER_FLOW_TRIGGER': User wants to start or open a new order booking form (e.g., "book order", "place order", "order form"). Note: If the user query specifies style, quantity, size, or color to order (e.g. "Book 12 pieces of red kurta"), classify it as INVENTORY_LOOKUP instead so we can check stock.
- 'PLACE_ORDER': Booking/placing an order in chat (e.g., "Book 100 white shirts XL", "Book 12 pieces of red kurta", "order 10 pcs of style 101"). Extract items into the 'args.items' array.
- 'REORDER': User wants to repeat a previous order or reorder (e.g., "reorder order #1001", "reorder my last shipment"). Extract order ID into 'args.orderId'.

Parameters to extract in 'args' object (use null if not mentioned):
- 'skuCode': Standardized style code (e.g. "KURTI-FES-BLU-L") or numeric style/design code (e.g. "102", "110").
- 'color': Standardized color code, map Hinglish/Hindi words to English codes: RED (lal), BLU (neela/neeli), GRN (hara/hari), WHT (safed), BLK (kala), YLW (peela), PNK (gulabi), or direct English color.
- 'size': Standardized size code: XS, S, M, L, XL, XXL.
- 'garmentType': Category name matching one of: ${activeCategoriesList}.
- 'requestedQty': Integer number of pieces/quantity requested (e.g. "Book 12 pcs" -> 12).
- 'maxPrice': Numeric maximum price filter (e.g. "under 500" -> 500).
- 'fabric': Material name (e.g. "cotton", "silk", "denim").
- 'orderId': Numeric ID of a past order to reorder.
- 'items': An array of objects representing items to order (for PLACE_ORDER intent). Each item object contains:
  - 'skuCode': string or null
  - 'color': string or null
  - 'size': string or null
  - 'garmentType': string or null
  - 'requestedQty': number or null

Return ONLY a valid JSON object matching this schema:
{
  "intent": "INTENT_NAME",
  "args": {
    "skuCode": string or null,
    "color": string or null,
    "size": string or null,
    "garmentType": string or null,
    "requestedQty": number or null,
    "maxPrice": number or null,
    "fabric": string or null,
    "orderId": number or null,
    "items": array or null
  },
  "chatReply": string or null
}
In "chatReply", if the user query is a greeting, casual chat, or general question, provide a warm, conversational, human-like response in the same language/dialect/tone as the user (e.g. Hinglish, Hindi, or English). Keep it concise, friendly, and guide them to use ERP features (like catalog, stock, price, ledger) if appropriate.
Do not include any markdown formatting, comments, or extra text in your output. Just return the raw JSON object.
`;

        try {
            if (geminiKey && geminiKey !== 'your_gemini_api_key_here') {
                const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${geminiKey}`;
                const prompt = `${systemInstruction}\n\nUser Query: "${messageText}"`;
                const response = await axios.post(url, {
                    contents: [{ parts: [{ text: prompt }] }],
                    generationConfig: {
                        responseMimeType: "application/json"
                    }
                }, { timeout: 8000 });

                if (response.data && response.data.candidates && response.data.candidates[0].content.parts[0].text) {
                    const cleanText = response.data.candidates[0].content.parts[0].text.trim();
                    return JSON.parse(cleanText);
                }
            } else if (openaiKey && openaiKey !== 'your_openai_api_key_here') {
                const url = 'https://api.openai.com/v1/chat/completions';
                const response = await axios.post(url, {
                    model: 'gpt-4o-mini',
                    messages: [
                        { role: 'system', content: systemInstruction },
                        { role: 'user', content: messageText }
                    ],
                    response_format: { type: "json_object" }
                }, {
                    headers: {
                        Authorization: `Bearer ${openaiKey}`
                    },
                    timeout: 8000
                });

                if (response.data && response.data.choices && response.data.choices[0].message.content) {
                    return JSON.parse(response.data.choices[0].message.content.trim());
                }
            } else if (groqKey && groqKey !== 'your_groq_api_key_here') {
                const url = 'https://api.groq.com/openai/v1/chat/completions';
                const response = await axios.post(url, {
                    model: 'llama-3.3-70b-versatile',
                    messages: [
                        { role: 'system', content: systemInstruction },
                        { role: 'user', content: messageText }
                    ],
                    response_format: { type: "json_object" }
                }, {
                    headers: {
                        Authorization: `Bearer ${groqKey}`
                    },
                    timeout: 8000
                });

                if (response.data && response.data.choices && response.data.choices[0].message.content) {
                    return JSON.parse(response.data.choices[0].message.content.trim());
                }
            }
        } catch (error) {
            console.error('[LLM NLU Parser] LLM NLU parser failed, falling back to Regex:', error.message);
        }

        return null;
    }

    /**
     * Parses incoming WhatsApp voice/audio base64 data using Gemini API multimodal capabilities.
     */
    static async parseAudioMessage(base64AudioData, mimeType = 'audio/ogg') {
        const geminiKey = process.env.GEMINI_API_KEY;
        if (!geminiKey || geminiKey === 'your_gemini_api_key_here') {
            console.warn('[LLM NLU Parser] Gemini key not configured for voice parsing.');
            return null;
        }

        const systemInstruction = `
You are an expert NLP parser for a Wholesale Garments Retailing ERP chatbot.
Listen to this audio query and parse it into a structured JSON representation of intents and arguments.

Available Intents:
- 'GREETING': Welcoming messages, "hi", "hello", "namaste", "help", "menu".
- 'GUIDE_CATALOGUE': Asking for general catalog or collection.
- 'GUIDE_STOCK': Asking to check stock or inventory in general.
- 'GUIDE_PRICE': Asking to check price or rate list in general.
- 'INVENTORY_LOOKUP': Looking up stock availability for a specific style/SKU, color, size, or category.
- 'COLOURS_LOOKUP': Querying what colors are available for an item or generally.
- 'SIZES_LOOKUP': Querying what sizes are available for an item or generally.
- 'DESIGN_AVAILABILITY': Asking about design/collection availability.
- 'PRODUCT_FILTERED': Searching for garments filtered by price, fabric (e.g. cotton, silk, denim), and/or garment type (kurti, shirt, pant, saree).
- 'PRICE_LOOKUP': Looking up the price for a specific SKU/style.
- 'OLD_SHIPMENT_INQUIRY': Asking about past shipment history or historical dispatches.
- 'OLD_LEDGER_STATUS': Asking for statement of account, ledger, or balance sheet.
- 'LAST_INVOICE_COPY': Asking for a copy of the latest or last invoice.
- 'SHIPMENT_TRACKING': Tracking active shipments ("where has it reached", "status of order").
- 'OUTSTANDING_LOOKUP': Querying credit limit, due balance, or outstanding amount.
- 'ORDER_FLOW_TRIGGER': User wants to start or open a new order booking form (e.g., "book order", "place order", "order form"). Note: If the user query specifies style, quantity, size, or color to order (e.g. "Book 12 pieces of red kurta"), classify it as INVENTORY_LOOKUP instead so we can check stock.
- 'PLACE_ORDER': Booking/placing an order in chat (e.g., "Book 100 white shirts XL", "Book 12 pieces of red kurta", "order 10 pcs of style 101"). Extract items into the 'args.items' array.
- 'REORDER': User wants to repeat a previous order or reorder (e.g., "reorder order #1001", "reorder my last shipment"). Extract order ID into 'args.orderId'.

Parameters to extract in 'args' object (use null if not mentioned):
- 'skuCode': Standardized style code (e.g. "KURTI-FES-BLU-L") or numeric style/design code (e.g. "102", "110").
- 'color': Standardized color code, map Hinglish/Hindi words to English codes: RED (lal), BLU (neela/neeli), GRN (hara/hari), WHT (safed), BLK (kala), YLW (peela), PNK (gulabi), or direct English color.
- 'size': Standardized size code: XS, S, M, L, XL, XXL.
- 'garmentType': KURTI, SHIRT, PANT, SAREE, or DRESS.
- 'requestedQty': Integer number of pieces/quantity requested (e.g. "Book 12 pcs" -> 12).
- 'maxPrice': Numeric maximum price filter (e.g. "under 500" -> 500).
- 'fabric': Material name (e.g. "cotton", "silk", "denim").
- 'orderId': Numeric ID of a past order to reorder.
- 'items': An array of objects representing items to order (for PLACE_ORDER intent). Each item object contains:
  - 'skuCode': string or null
  - 'color': string or null
  - 'size': string or null
  - 'garmentType': string or null
  - 'requestedQty': number or null

Return ONLY a valid JSON object matching this schema:
{
  "intent": "INTENT_NAME",
  "args": {
    "skuCode": string or null,
    "color": string or null,
    "size": string or null,
    "garmentType": string or null,
    "requestedQty": number or null,
    "maxPrice": number or null,
    "fabric": string or null,
    "orderId": number or null,
    "items": array or null
  },
  "chatReply": string or null
}
In "chatReply", if the user query is a greeting, casual chat, or general question, provide a warm, conversational, human-like response in the same language/dialect/tone as the user (e.g. Hinglish, Hindi, or English). Keep it concise, friendly, and guide them to use ERP features (like catalog, stock, price, ledger) if appropriate.
Do not include any markdown formatting, comments, or extra text in your output. Just return the raw JSON object.
`;

        try {
            const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${geminiKey}`;
            const response = await axios.post(url, {
                contents: [
                    {
                        parts: [
                            { text: systemInstruction },
                            {
                                inlineData: {
                                    mimeType: mimeType,
                                    data: base64AudioData
                                }
                            }
                        ]
                    }
                ],
                generationConfig: {
                    responseMimeType: "application/json"
                }
            }, { timeout: 15000 });

            if (response.data && response.data.candidates && response.data.candidates[0].content.parts[0].text) {
                const cleanText = response.data.candidates[0].content.parts[0].text.trim();
                return JSON.parse(cleanText);
            }
        } catch (error) {
            console.error('[LLM NLU Parser] Gemini voice note parsing failed:', error.message);
        }

        return null;
    }

    /**
     * Transcribes WhatsApp voice notes to text using Groq's Whisper model (whisper-large-v3).
     */
    static async transcribeAudioWithGroq(audioBuffer, apiKey) {
        if (!apiKey || apiKey === 'your_groq_api_key_here') {
            console.warn('[Groq Speech-to-Text] Groq key not configured for audio transcription.');
            return null;
        }

        try {
            const boundary = '----WebKitFormBoundary7MA4YWxkTrZu0gW';
            const body = Buffer.concat([
                Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="audio.ogg"\r\nContent-Type: audio/ogg\r\n\r\n`),
                audioBuffer,
                Buffer.from(`\r\n--${boundary}\r\nContent-Disposition: form-data; name="model"\r\n\r\nwhisper-large-v3\r\n--${boundary}--\r\n`)
            ]);

            const response = await axios.post('https://api.groq.com/openai/v1/audio/transcriptions', body, {
                headers: {
                    Authorization: `Bearer ${apiKey}`,
                    'Content-Type': `multipart/form-data; boundary=${boundary}`
                },
                timeout: 12000
            });

            if (response.data && response.data.text) {
                return response.data.text.trim();
            }
        } catch (error) {
            console.error('[Groq Speech-to-Text] Whisper transcription failed:', error.message);
        }
        return null;
    }


    /**
     * Parse incoming message text into structured intent and parameters.
     */
    static async parseMessage(messageText) {
        const text = (messageText || '').toString().toLowerCase().trim();

        // PRE-LLM INTERCEPT: Button IDs and list-click patterns should NEVER go to LLM.
        // AutobotChat sends the list item's id (e.g. cat_pant, stock_saree, btn_stock) or
        // the Title+Description combined (e.g. "2️⃣ Check Stock 📦\nCheck color & size availability", "Pant Stock\nCheck availability for Pants").
        // We detect these deterministically here before LLM is even called.
        const isButtonId = text.startsWith('btn_') || text.startsWith('cat_') ||
                           text.startsWith('stock_') || text.startsWith('price_') ||
                           text.includes('btn_') || text.includes('stock_') || text.includes('cat_');

        const isNumberedMenuItem = /^[1-8]️⃣/.test(text) || /^btn_[a-z_]+/.test(text);

        // General stock inquiry check
        const isStockInquiry = text.includes('check stock') || text.includes('check_stock') ||
                              text.includes('stock check') || text.includes('stock status') ||
                              text.includes('stock list') || text.includes('stock dekhna') ||
                              text.includes('stock batao') || text.includes('kya stock') ||
                              text.includes('check inventory') || text.includes('inventory check') ||
                              text.includes('available stock') || text.includes('stock availability') ||
                              text === 'stock' || text === 'inventory' || text === '2';

        // Category stock click check (e.g. "👖 Pant Stock\nCheck availability for Pants", "👗 Kurti Stock", etc.)
        const isCategoryStockClick = (text.includes('kurti') || text.includes('shirt') ||
                                      text.includes('pant') || text.includes('trouser') ||
                                      text.includes('saree')) &&
                                     (text.includes('stock') || text.includes('availability') || text.includes('available'));

        const isKnownMenuClick = isButtonId || isNumberedMenuItem || isStockInquiry || isCategoryStockClick;

        let parsed;
        if (isKnownMenuClick) {
            // Bypass LLM entirely — use regex for deterministic button/click handling
            parsed = await this.parseMessageWithRegex(messageText);
        } else {
            const llmResult = await this.parseMessageWithLLM(messageText);
            parsed = llmResult;

            if (parsed && parsed.intent) {
                console.log('[QueryParserService] Successfully parsed query using LLM:', parsed);
            } else {
                parsed = await this.parseMessageWithRegex(messageText);
            }
        }

        return this.postProcessParsedMessage(messageText, parsed);
    }

    /**
     * Post-processes parsed message to inject name-matching and verification flows.
     */
    static postProcessParsedMessage(messageText, parsed) {
        if (!parsed) {
            parsed = { intent: 'UNKNOWN', args: {} };
        }

        const text = (messageText || '').toString().toLowerCase().trim();
        let users;
        try {
            users = require('../mock_data/users.json');
        } catch (e) {
            users = [];
        }

        // Check if the query contains a phone number from users.json
        const cleanDigits = text.replace(/[^0-9]/g, '');
        const matchedUser = users.find(u => {
            if (!u.phone_number) return false;
            const uPhoneClean = u.phone_number.replace(/[^0-9]/g, '');
            return (cleanDigits && uPhoneClean.includes(cleanDigits) && cleanDigits.length >= 10) || 
                   (cleanDigits && cleanDigits.includes(uPhoneClean) && cleanDigits.length >= 10);
        });

        // 1. Direct button clicks override
        if (text.includes('btn_user_outstanding_') || (text.includes('1️⃣') && text.includes('outstanding'))) {
            const phoneMatch = text.match(/btn_user_outstanding_(\d+)/);
            return { intent: 'OUTSTANDING_LOOKUP', args: { overridePhone: phoneMatch ? phoneMatch[1] : null } };
        }
        if (text.includes('btn_user_ledger_') || (text.includes('2️⃣') && (text.includes('ledger') || text.includes('account')))) {
            const phoneMatch = text.match(/btn_user_ledger_(\d+)/);
            return { intent: 'OLD_LEDGER_STATUS', args: { overridePhone: phoneMatch ? phoneMatch[1] : null } };
        }
        if (text.includes('btn_user_invoice_') || (text.includes('3️⃣') && text.includes('invoice'))) {
            const phoneMatch = text.match(/btn_user_invoice_(\d+)/);
            return { intent: 'LAST_INVOICE_COPY', args: { overridePhone: phoneMatch ? phoneMatch[1] : null } };
        }
        if (text.includes('btn_user_shipments_') || (text.includes('4️⃣') && text.includes('shipment')) || text.includes('past shipment')) {
            const phoneMatch = text.match(/btn_user_shipments_(\d+)/);
            return { intent: 'OLD_SHIPMENT_INQUIRY', args: { overridePhone: phoneMatch ? phoneMatch[1] : null } };
        }

        // 2. If a customer phone number and an ERP action are both present in the query
        if (matchedUser) {
            let mappedIntent = null;
            if (text.includes('outstanding') || text.includes('credit') || text.includes('due') || text.includes('baki')) {
                mappedIntent = 'OUTSTANDING_LOOKUP';
            } else if (text.includes('ledger') || text.includes('statement') || text.includes('khata')) {
                mappedIntent = 'OLD_LEDGER_STATUS';
            } else if (text.includes('invoice') || text.includes('bill') || text.includes('copy')) {
                mappedIntent = 'LAST_INVOICE_COPY';
            } else if (text.includes('shipment') || text.includes('dispatch') || text.includes('delivery')) {
                mappedIntent = 'OLD_SHIPMENT_INQUIRY';
            }

            if (mappedIntent) {
                return { intent: mappedIntent, args: { overridePhone: matchedUser.phone_number } };
            }
        }

        // 3. If the query contains a matched phone number and does not match any other transactional intents
        const transactionalIntents = [
            'INVENTORY_LOOKUP', 'PRICE_LOOKUP', 'PRODUCT_FILTERED', 'COLOURS_LOOKUP', 'SIZES_LOOKUP',
            'OLD_LEDGER_STATUS', 'OUTSTANDING_LOOKUP', 'LAST_INVOICE_COPY', 'OLD_SHIPMENT_INQUIRY',
            'PLACE_ORDER', 'REORDER'
        ];
        
        const isRealInventoryQuery = parsed.intent === 'INVENTORY_LOOKUP' && 
            (parsed.args && (parsed.args.skuCode || parsed.args.color || parsed.args.size || parsed.args.garmentType));

        let shouldResolveIdentity = !!matchedUser;
        if (shouldResolveIdentity) {
            if (transactionalIntents.includes(parsed.intent)) {
                if (parsed.intent === 'INVENTORY_LOOKUP' && !isRealInventoryQuery) {
                    shouldResolveIdentity = true;
                } else {
                    shouldResolveIdentity = false;
                }
            }
        }

        if (shouldResolveIdentity) {
            return { intent: 'IDENTITY_RESOLVED', args: { user: matchedUser } };
        }

        // --- NEW LOGIC: Unregistered phone number lookup ---
        const isPhoneNumberOnly = /^\d{10,12}$/.test(cleanDigits) && text.length <= 15;
        if (isPhoneNumberOnly && !matchedUser) {
            return { intent: 'IDENTITY_NOT_FOUND', args: { phone: cleanDigits } };
        }

        // Safety Fallback: If INVENTORY_LOOKUP has no specific SKU, color, size, or garment type, convert to GUIDE_STOCK
        if (parsed && parsed.intent === 'INVENTORY_LOOKUP' &&
            (!parsed.args || (!parsed.args.skuCode && !parsed.args.color && !parsed.args.size && !parsed.args.garmentType))) {
            parsed = { intent: 'GUIDE_STOCK', args: {} };
        }

        return parsed;
    }

    /**
     * Fallback Regex parser.
     */
    static async parseMessageWithRegex(messageText) {
        const text = (messageText || '').toString().toLowerCase().trim();

        // Detect REORDER intent
        if (text.includes('reorder') || text.includes('repeat')) {
            const orderIdMatch = text.match(/(?:order|id|#)\s*#?(\d+)/i) || text.match(/(?<!\d)(\d+)(?!\d)/);
            return {
                intent: 'REORDER',
                args: {
                    orderId: orderIdMatch ? parseInt(orderIdMatch[1]) : null
                }
            };
        }

        // 1. Detect interactive button/list clicks or category selections.
        // NOTE: AutobotChat sends the list item's Title + Description as plain text.
        // So "3️⃣ Pant 👖" click arrives as "3️⃣ Pant 👖\nCotton & Denim Pants".
        // Stock clicks arrive as e.g. "Pant Stock\nCheck availability for Pants".
        // Category rules MUST come before the generic GUIDE_CATALOGUE/GUIDE_STOCK rules.

        const activeCategories = this.getCategories();

        const hasSpecificColorOrSize = text.includes('red') || text.includes('blue') || text.includes('green') ||
                                       text.includes('white') || text.includes('black') || text.includes('yellow') ||
                                       text.includes('pink') || text.includes('lal') || text.includes('neela') ||
                                       text.includes('hara') || text.includes('safed') || text.includes('kala') ||
                                       text.includes('size') || /(?<![a-z])(xxl|xl|xs|[sml])(?![a-z])/i.test(text);

        // Dynamic button prefix resolution (e.g. stock_saree2, cat_underwear, price_cat_shirt)
        const sortedCategories = [...activeCategories].sort((a, b) => b.name.length - a.name.length);

        if (text.startsWith('stock_')) {
            const rawCat = text.replace('stock_', '').trim();
            const matched = activeCategories.find(c => c.name.toLowerCase() === rawCat.toLowerCase()) ||
                            sortedCategories.find(c => rawCat.toLowerCase().includes(c.name.toLowerCase()) || c.name.toLowerCase().includes(rawCat.toLowerCase()));
            const garmentType = matched ? matched.name.toUpperCase() : rawCat.toUpperCase();
            return { intent: 'DESIGN_AVAILABILITY', args: { garmentType: garmentType } };
        }

        if (text.startsWith('cat_')) {
            const rawCat = text.replace('cat_', '').trim();
            const matched = activeCategories.find(c => c.name.toLowerCase() === rawCat.toLowerCase()) ||
                            sortedCategories.find(c => rawCat.toLowerCase().includes(c.name.toLowerCase()) || c.name.toLowerCase().includes(rawCat.toLowerCase()));
            const garmentType = matched ? matched.name.toUpperCase() : rawCat.toUpperCase();
            return { intent: 'PRODUCT_FILTERED', args: { garmentType: garmentType } };
        }

        if (text.startsWith('price_cat_')) {
            const rawCat = text.replace('price_cat_', '').trim();
            const matched = activeCategories.find(c => c.name.toLowerCase() === rawCat.toLowerCase()) ||
                            sortedCategories.find(c => rawCat.toLowerCase().includes(c.name.toLowerCase()) || c.name.toLowerCase().includes(rawCat.toLowerCase()));
            const garmentType = matched ? matched.name : rawCat;
            return { intent: 'GUIDE_PRICE_CATEGORY', args: { garmentType: garmentType } };
        }

        // --- DESIGN_AVAILABILITY (Stock checks for specific categories when no specific color/size is requested) ---
        let matchedCategoryInText = null;
        for (const c of sortedCategories) {
            const cLower = c.name.toLowerCase();
            if (text.includes(cLower) || text.includes(cLower + 's') || text.includes(cLower + 'es')) {
                matchedCategoryInText = c.name.toUpperCase();
                break;
            }
        }
        if (!matchedCategoryInText) {
            if (text.includes('trouser')) matchedCategoryInText = 'PANT';
        }

        if (!hasSpecificColorOrSize && matchedCategoryInText && (text.includes('stock') || text.includes('availability') || text.includes('available') || text.includes('maal'))) {
            return { intent: 'DESIGN_AVAILABILITY', args: { garmentType: matchedCategoryInText } };
        }

        // --- PRODUCT_FILTERED (Catalog category selections + natural language product filter queries) ---
        const garmentInText = matchedCategoryInText;

        if (garmentInText) {
            const isCategoryMenuClick = activeCategories.some(c => {
                const cLower = c.name.toLowerCase();
                return text === cLower || text === cLower + 's' || text === cLower + 'es' || text.includes(`cat_${cLower}`);
            });

            const hasInventoryKeywords = text.includes('available') || text.includes('kitna') ||
                                         text.includes('size') || text.includes('blue') ||
                                         text.includes('red') || text.includes('green') ||
                                         text.includes('white') || text.includes('black') ||
                                         text.includes('pink') || text.includes('yellow') ||
                                         text.includes('lal') || text.includes('neela') ||
                                         text.match(/\d+\s*(pcs|pieces|pc)/i);
            const isListClick = !hasInventoryKeywords &&
                                 !text.includes('under') && !text.includes('below') && !text.includes('above') &&
                                 !text.includes('show me') && !text.includes('want') &&
                                 text.length <= 80;

            const priceMatch = text.match(/(?:under|below|less than|max|upto|up to|se kam)\s*[₹]?\s*(\d+)/i) ||
                               text.match(/[₹]?\s*(\d+)\s*(?:se kam|tak|max)/i);
            const maxPrice = priceMatch ? parseInt(priceMatch[1]) : null;

            const fabrics = ['cotton', 'silk', 'denim', 'georgette', 'chiffon', 'linen', 'synthetic', 'rayon', 'polyester'];
            const fabric = fabrics.find(f => text.includes(f)) || null;

            if (isCategoryMenuClick || isListClick || maxPrice !== null || fabric !== null || text.includes('show') || text.includes('filter')) {
                const hasSKUCode = /[A-Z]{3,}-[A-Z0-9]{2,}-/.test(messageText.toUpperCase());
                if (!hasSKUCode) {
                    return { intent: 'PRODUCT_FILTERED', args: { garmentType: garmentInText, maxPrice, fabric } };
                }
            }
        }

        // --- GUIDE_CATALOGUE: Only match when user explicitly asks for catalog (not a category click) ---
        const isExplicitCatalog = text === 'btn_catalogue' || text === 'product catalog' || text === 'catalogue' || text === '1' ||
                                  text.includes('1️⃣ product catalog') || (text.includes('1️⃣') && text.includes('catalog')) ||
                                  (text.includes('catalog') && !activeCategories.some(c => text.includes(c.name.toLowerCase())));
        if (isExplicitCatalog) {
            return { intent: 'GUIDE_CATALOGUE', args: {} };
        }

        // --- GUIDE_STOCK: Check general stock queries ---
        const isGenericStock = text === 'btn_stock' || text === '2' || text.includes('2️⃣ check stock') ||
                               (text.includes('2️⃣') && text.includes('stock')) ||
                               text.includes('check stock') || text.includes('check_stock') ||
                               text.includes('stock check') || text.includes('stock status') ||
                               text.includes('stock list') || text.includes('stock dekhna') ||
                               text.includes('stock batao') || text.includes('kya stock') ||
                               text.includes('check inventory') || text.includes('inventory check') ||
                               text.includes('available stock') || text.includes('stock availability') ||
                               text.includes('maal kitna') || text.includes('kitna maal') ||
                               text === 'stock' || text === 'inventory';
        if (isGenericStock && !garmentInText) {
            return { intent: 'GUIDE_STOCK', args: {} };
        }

        // Category price list selection queries
        if (garmentInText && text.includes('price') && !text.includes('check') && !text.includes('-')) {
            return { intent: 'GUIDE_PRICE_CATEGORY', args: { garmentType: garmentInText } };
        }

        if (text.startsWith('price_sku_')) {
            const skuCode = text.replace('price_sku_', '').toUpperCase();
            return { intent: 'PRICE_LOOKUP', args: { skuCode: skuCode } };
        }

        if (text === 'btn_price' || text.includes('check price') || text.includes('wholesale rates') || text.includes('rate list') || text === '3' || text.includes('3️⃣ check price')) {
            return { intent: 'GUIDE_PRICE', args: {} };
        }
        if (text === 'btn_ledger' || text === '4' || text.includes('4️⃣ ledger status') || text.includes('4️⃣ account ledger') || (text.includes('ledger') && !text.includes('shipment'))) {
            return { intent: 'OLD_LEDGER_STATUS', args: {} };
        }
        if (text === 'btn_tracking' || text === '5' || text.includes('5️⃣ shipment tracking') || text.includes('5️⃣ track')) {
            return { intent: 'SHIPMENT_TRACKING', args: {} };
        }
        if (text === 'btn_outstanding' || text === '6' || text.includes('6️⃣ outstanding credit') || text.includes('1️⃣ outstanding credit')) {
            return { intent: 'OUTSTANDING_LOOKUP', args: {} };
        }
        if (text === 'btn_invoice' || text === '7' || text.includes('7️⃣ last invoice') || text.includes('3️⃣ last invoice')) {
            return { intent: 'LAST_INVOICE_COPY', args: {} };
        }
        if (text === 'btn_past_shipments' || text === '8' || text.includes('8️⃣ past shipments') || text.includes('4️⃣ past shipments') || text.includes('past shipment')) {
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
            const hasSpecificSku = text.includes('kurti-') || text.includes('shirt-') || text.includes('pant-') || text.includes('saree-') || text.match(/(?:style|sku|code|design|product)\s*#?\s*(\d+)/i) || text.match(/(?<!\d)(\d{3,4})(?!\d)/);
            if (hasSpecificSku) {
                let detectedSku = 'KURTI-FES-BLU-L'; // default fallback
                const matches = text.match(/\b([a-z0-9]+(?:-[a-z0-9]+)+)\b/i);
                if (matches) detectedSku = matches[1].toUpperCase();
                return {
                    intent: 'PRICE_LOOKUP',
                    args: { skuCode: detectedSku }
                };
            }
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
        const standaloneOrder = text.match(/^#?(\d{4})$/);
        const orderPrefixMatch = text.match(/(?:order\s*#?|#)\s*(\d{4,})/i);
        const explicitOrderMatch = orderPrefixMatch || (standaloneOrder && !text.match(/^20\d{2}$/) ? standaloneOrder : null);

        const standaloneDispatch = text.match(/^(?:dispatch\s*#?|lr\s*#?)?(\d{3})$/);
        const dispatchPrefixMatch = text.match(/(?:dispatch|lr|tracking)\s*#?\s*([a-z0-9]+)/i) || text.match(/\b(trk[a-z0-9]+|dlv[a-z0-9]+|sfx[a-z0-9]+|bd[a-z0-9]+)\b/i);
        const explicitDispatchMatch = dispatchPrefixMatch || standaloneDispatch;

        const isTrackingKeyword = text.startsWith('btn_tracking') || text.includes('5️⃣') ||
                                  text.includes('track') || text.includes('where') ||
                                  text.includes('reach') || text.includes('tracking') ||
                                  text.includes('kahan pahuncha') || text.includes('shipment status') ||
                                  text.includes('delivery status') || text.includes('lr status') ||
                                  text.includes('dispatch status') || text === '5';

        if (isTrackingKeyword || explicitDispatchMatch || explicitOrderMatch) {
            let orderId = null;
            if (explicitOrderMatch) {
                const raw = explicitOrderMatch[1] || explicitOrderMatch[0].replace('#', '').replace(/\D/g, '');
                orderId = raw ? parseInt(raw) : null;
            }
            let dispatchId = null;
            if (explicitDispatchMatch) {
                dispatchId = (explicitDispatchMatch[1] || explicitDispatchMatch[0]).replace(/^dispatch\s*#?/i, '').replace(/^lr\s*#?/i, '').trim();
            }
            const phoneMatch = text.match(/\b(91\d{10}|\d{10})\b/);
            const phone = phoneMatch ? phoneMatch[1] : null;

            return {
                intent: 'SHIPMENT_TRACKING',
                args: {
                    orderId: orderId,
                    dispatchId: dispatchId,
                    phone: phone
                }
            };
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
            'kurti': 'KURTI', 'kurtis': 'KURTI', 'kurta': 'KURTI', 'kurtas': 'KURTI', 'shirt': 'SHIRT',
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

        const isPurchaseIntent = text.includes('book') || text.includes('order') || text.includes('place order') || text.includes('buy');
        if (isPurchaseIntent && requestedQty) {
            return {
                intent: 'PLACE_ORDER',
                args: {
                    items: [{
                        skuCode: skuSearch,
                        color: detectedColor,
                        size: detectedSize,
                        garmentType: detectedGarment,
                        requestedQty: requestedQty
                    }],
                    skuCode: skuSearch,
                    color: detectedColor,
                    originalColor: detectedColorWord,
                    size: detectedSize,
                    garmentType: detectedGarment,
                    requestedQty: requestedQty
                }
            };
        }

        if (!skuSearch && !detectedGarment && !detectedColor && !detectedSize) {
            if (text.includes('stock') || text.includes('inventory') || text.includes('maal') || text.includes('available')) {
                return { intent: 'GUIDE_STOCK', args: {} };
            }
            return { intent: 'GREETING', args: {} };
        }

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
                            text: context.chatReply || `Welcome to Kaira wholesale garments retailing platform. How can I help you today? Need to check our catalog, stock, or prices?`
                        },
                        footer: {
                            text: 'Digify Soft Solutions Kaira 💁‍♀️ Chatbot'
                        },
                        action: {
                            button: 'View Options 📋',
                            sections: [
                                {
                                    title: 'Menu Options 📋',
                                    rows: [
                                        { id: 'btn_catalogue', title: '1️⃣ Product Catalog 📖', description: 'View full wholesale catalog' },
                                        { id: 'btn_stock', title: '2️⃣ Check Stock 📦', description: 'Check color & size availability' },
                                        { id: 'btn_price', title: '3️⃣ Check Price 🏷️', description: 'Get wholesale rate card' },
                                        { id: 'btn_ledger', title: '4️⃣ Ledger Status 📒', description: 'Statement of accounts/ledger' },
                                        { id: 'btn_tracking', title: '5️⃣ Shipment Tracking 📍', description: 'Track active shipment status' },
                                        { id: 'btn_outstanding', title: '6️⃣ Outstanding Credit 💰', description: 'Check outstanding/credit limit' },
                                        { id: 'btn_invoice', title: '7️⃣ Last Invoice Copy 📄', description: 'Get copy of latest invoice' },
                                        { id: 'btn_past_shipments', title: '8️⃣ Past Shipments 🚚', description: 'View past shipment history' }
                                    ]
                                }
                            ]
                        }
                    }
                };

            case 'ORDER_FLOW_TRIGGER':
                const flowCatRows = QueryParserService.getCategories().slice(0, 10).map((c, index) => {
                    const emoji = QueryParserService.getCategoryEmoji(c.name);
                    return {
                        id: `cat_${c.name.toLowerCase()}`,
                        title: QueryParserService.formatRowTitle(`${index + 1}️⃣ ${c.name} ${emoji}`),
                        description: QueryParserService.formatRowDesc(`Browse latest ${c.name} designs`)
                    };
                });
                if (!process.env.META_FLOW_ID || process.env.META_FLOW_ID === '1234567890') {
                    // Fallback to Guide Catalogue interactive list if Flow is not configured
                    return {
                        type: 'interactive',
                        interactive: {
                            type: 'list',
                            header: {
                                type: 'text',
                                text: 'Products Catalog 📖'
                            },
                            body: {
                                text: 'Dear customer, please select a category below to see our latest designs and place your order directly! 🌸✨'
                            },
                            footer: {
                                text: 'Digify Soft Solutions Kaira 💁‍♀️ Chatbot'
                            },
                            action: {
                                button: 'Select Category 📂',
                                sections: [
                                    {
                                        title: 'Categories 🏷️',
                                        rows: flowCatRows
                                    }
                                ]
                            }
                        }
                    };
                }
                return {
                    type: 'interactive',
                    interactive: {
                        type: 'flow',
                        header: {
                            type: 'text',
                            text: 'Book Wholesale Order'
                        },
                        body: {
                            text: 'Tap the button below to choose items, sizes, and submit your order instantly! 📋👗'
                        },
                        footer: {
                            text: 'Digify Soft Solutions Order Flow'
                        },
                        action: {
                            name: 'flow',
                            parameters: {
                                flow_message_version: '3',
                                flow_token: `order_token_${Date.now()}`,
                                flow_id: process.env.META_FLOW_ID,
                                flow_cta: 'Open Order Form 📋',
                                flow_action: 'navigate',
                                flow_action_payload: {
                                    screen: 'ORDER_SCREEN',
                                    data: {
                                        company: context.companyName || 'Kaira'
                                    }
                                }
                            }
                        }
                    }
                };

            case 'GUIDE_CATALOGUE':
                if (context.args && context.args.garmentType && data && data.length > 0) {
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

                    const cat = context.args.garmentType;
                    const title = `📖 *${cat.charAt(0).toUpperCase() + cat.slice(1).toLowerCase()} Catalog* 👗✨`;
                    return `${title}\n_________________________\n\nHere is our catalog for you, dear! 🌸:\n\n${sections}`;
                }
                const catMenuRows = QueryParserService.getCategories().slice(0, 10).map((c, index) => {
                    const emoji = QueryParserService.getCategoryEmoji(c.name);
                    return {
                        id: `cat_${c.name.toLowerCase()}`,
                        title: QueryParserService.formatRowTitle(`${index + 1}️⃣ ${c.name} ${emoji}`),
                        description: QueryParserService.formatRowDesc(`View ${c.name} wholesale collection`)
                    };
                });
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
                                    rows: catMenuRows
                                }
                            ]
                        }
                    }
                };

            case 'GUIDE_STOCK':
                const stockCategoriesList = QueryParserService.getCategories().slice(0, 10).map(c => {
                    const emoji = QueryParserService.getCategoryEmoji(c.name);
                    return {
                        id: `stock_${c.name.toLowerCase()}`,
                        title: QueryParserService.formatRowTitle(`${emoji} ${c.name} Stock`),
                        description: QueryParserService.formatRowDesc(`Check availability for ${c.name}`)
                    };
                });
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
                                    rows: stockCategoriesList
                                }
                            ]
                        }
                    }
                };

            case 'GUIDE_PRICE':
                const priceCategoriesList = QueryParserService.getCategories().slice(0, 10).map(c => {
                    const emoji = QueryParserService.getCategoryEmoji(c.name);
                    return {
                        id: `price_cat_${c.name.toLowerCase()}`,
                        title: QueryParserService.formatRowTitle(`${emoji} ${c.name} Price Card`),
                        description: QueryParserService.formatRowDesc(`Wholesale rates for ${c.name}`)
                    };
                });
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
                                    rows: priceCategoriesList
                                }
                            ]
                        }
                    }
                };

            case 'GUIDE_PRICE_CATEGORY':
            case 'GUIDE_PRICE_KURTI':
            case 'GUIDE_PRICE_SHIRT':
            case 'GUIDE_PRICE_PANT':
            case 'GUIDE_PRICE_SAREE':
                const selectedCatName = (context.args && context.args.garmentType) || 
                                         intent.replace('GUIDE_PRICE_', '');
                const catEmoji = QueryParserService.getCategoryEmoji(selectedCatName);
                
                let designItems = Array.isArray(data) ? data : [];
                if (designItems.length === 0) {
                    try {
                        const allProds = require('../mock_data/products.json');
                        const targetLower = selectedCatName.toLowerCase();
                        designItems = allProds.filter(p => 
                            p.category && (
                                p.category.toLowerCase() === targetLower ||
                                p.category.toLowerCase().includes(targetLower) ||
                                targetLower.includes(p.category.toLowerCase())
                            )
                        );
                    } catch (e) {
                        designItems = [];
                    }
                }

                const priceRows = designItems.slice(0, 10).map(item => ({
                    id: `price_sku_${item.sku_code}`,
                    title: `${item.name.length > 24 ? item.name.substring(0, 21) + '...' : item.name}`,
                    description: `SKU: ${item.sku_code} | ₹${item.price || item.base_price}`
                }));

                if (priceRows.length === 0) {
                    return `🏷️ *Wholesale Price List for ${selectedCatName}* ${catEmoji}\n_________________________\n\nSo sorry dear, no designs currently active under *${selectedCatName}*! 🌸`;
                }

                return {
                    type: 'interactive',
                    interactive: {
                        type: 'list',
                        header: { type: 'text', text: `${selectedCatName} Wholesale Prices ${catEmoji}` },
                        body: { text: `Please select which ${selectedCatName} design's wholesale price you want to check, dear! 💖👇` },
                        footer: { text: 'Digify Soft Solutions Kaira 💁‍♀️ Chatbot' },
                        action: {
                            button: `Select ${selectedCatName} ${catEmoji}`,
                            sections: [
                                {
                                    title: `${selectedCatName} Designs ${catEmoji}`,
                                    rows: priceRows
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
                if (!data && (!context.args || (!context.args.skuCode && !context.args.color && !context.args.size && !context.args.garmentType))) {
                    return this.formatResponse('GUIDE_STOCK', null, context);
                }
                return `❌ *Stock Status for You!* ✨\n\n👗 *Item*: ${data ? data.sku_code || 'Garment' : 'Requested Combination'}\n⚠️ *Status*: Currently out of stock, so sorry! 🥺\n\n💡 *Recommendation*: Similar gorgeous styles are available. Reply *"Check Stock"* to see them! 🌸`;

            case 'PLACE_ORDER':
                if (data && data.orderId) {
                    const itemsText = data.items.map(item => `  • ${item.name} (${item.size}, ${item.color}) x *${item.qty} pcs* @ ₹${item.pricePerItem}/pc = *₹${item.total}*`).join('\n');
                    const schemeText = data.schemeName ? `\n🎁 *Scheme Applied*: ${data.schemeName} (-₹${data.discount})` : '';
                    return `🛒 *Order Booked Successfully!* 🎉\n_________________________\n\n📌 *Order ID*: #${data.orderId}\n👤 *Customer*: ${data.customerName}\n\n🛍️ *Items Ordered*:\n${itemsText}\n${schemeText}\n💰 *Net Payable Amount*: *₹${data.netPayable}* 💳\n📝 *Order Status*: *${data.status}* (Awaiting verification)\n\n💖 Thank you for ordering with us, dear! Anything else I can do for you? 🌸`;
                }
                return `❌ *Order Booking Failed* 🥺\n_________________________\n\nOh, sorry! We couldn't book your order. Please make sure items are in stock and try again, dear!`;

            case 'REORDER':
                if (data && data.orderId) {
                    const itemsText = data.items.map(item => `  • ${item.name} (${item.size}, ${item.color}) x *${item.qty} pcs* @ ₹${item.pricePerItem}/pc = *₹${item.total}*`).join('\n');
                    const schemeText = data.schemeName ? `\n🎁 *Scheme Applied*: ${data.schemeName} (-₹${data.discount})` : '';
                    return `🚚 *Reorder Placed Successfully!* 🔄\n_________________________\n\n📌 *New Order ID*: #${data.orderId}\n👤 *Customer*: ${data.customerName}\n\n🛍️ *Reordered Items*:\n${itemsText}\n${schemeText}\n💰 *Net Payable Amount*: *₹${data.netPayable}* 💳\n📝 *Order Status*: *${data.status}* (Awaiting verification)\n\n💖 Past items have been successfully rebooked for you, dear!`;
                }
                return `❌ *Reorder Failed* 🥺\n_________________________\n\nOh, sorry! We couldn't process the reorder for you. Please check if the past order was valid and items are still in stock, dear!`;

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
                const attemptedQuery = (context.args && (context.args.orderId || context.args.dispatchId || context.args.phone || context.args.overridePhone));
                if (attemptedQuery) {
                    return `❌ *Shipment Not Found* 🚚\n_________________________\n\nOh, sorry! We couldn't find any active shipment matching *${attemptedQuery}* in our system.\n\n💡 *Action*: Please check and reply with your valid Order ID (e.g. *#1015*), Dispatch ID (e.g. *104*), or registered Phone Number! 🌸`;
                }
                return `📍 *Track Your Shipment* 🚚\n_________________________\n\nDear customer, please reply with any of the following to track your active shipment:\n\n1️⃣ *Order ID* (e.g. *#1015* or *#1016*)\n2️⃣ *Dispatch ID / LR / Tracking No.* (e.g. *104* or *TRK998541200*)\n3️⃣ *Registered Phone Number* (e.g. *917425016636*)\n\nWe'll find your live delivery status instantly! ✨`;

            case 'OUTSTANDING_LOOKUP':
                if (data) {
                    return `💰 *Credit & Outstanding Status Summary* 📊\n_________________________\n\n👤 *Customer*: ${data.customer_name}\n📞 *Registered Phone*: ${data.phone}\n\n💸 *Total Outstanding*: *₹${data.outstanding_balance}* 💳\n🛡️ *Credit Limit*: ₹${data.credit_limit}\n✅ *Available Credit*: ₹${data.available_credit}\n⏳ *Payment Terms*: ${data.payment_terms}\n\n📅 *Aging Summary (Overdue status)*:\n• Not Due Yet: ₹${data.due_date_summary.not_due_yet}\n• 0-30 Days Overdue: *₹${data.due_date_summary.overdue_0_30_days}* ⚠️\n• 31-60 Days Overdue: ₹${data.due_date_summary.overdue_30_60_days}\n• 60+ Days Overdue: ₹${data.due_date_summary.overdue_60_plus_days}\n\n💬 Please clear overdue bills at your earliest convenience, dear! 🌸`;
                }
                return `💰 *Outstanding Status*: No outstanding profile found for your account, dear! 🥺`;

            case 'ASK_USER_PHONE':
                return `Sure, dear! 🌸 Please enter your registered WhatsApp phone number (e.g. *917425016636*) so I can verify your account and check your details!`;

            case 'IDENTITY_RESOLVED':
                const matchedUser = context.args ? context.args.user : null;
                if (!matchedUser) {
                    return `I couldn't verify your profile, dear! 🥺 Please reply with your registered phone number so I can try again.`;
                }
                const uName = matchedUser.name;
                const company = matchedUser.company_name;
                
                return {
                    type: 'interactive',
                    interactive: {
                        type: 'list',
                        header: {
                            type: 'text',
                            text: `Welcome, ${uName}! 🌸`
                        },
                        body: {
                            text: `I have found your account for *${company}*. Please select which detail you would like to check today, dear: 👇`
                        },
                        footer: {
                            text: 'Kaira Support Assistant'
                        },
                        action: {
                            button: 'Select Action 📋',
                            sections: [
                                {
                                    title: 'Account Actions 📋',
                                    rows: [
                                        { id: `btn_user_outstanding_${matchedUser.phone_number}`, title: '1️⃣ Outstanding Credit 💰', description: `Check credit status of ${company}` },
                                        { id: `btn_user_ledger_${matchedUser.phone_number}`, title: '2️⃣ Account Ledger 📒', description: `Statement of accounts for ${company}` },
                                        { id: `btn_user_invoice_${matchedUser.phone_number}`, title: '3️⃣ Last Invoice Copy 📄', description: `Get latest invoice for ${company}` },
                                        { id: `btn_user_shipments_${matchedUser.phone_number}`, title: '4️⃣ Past Shipments 🚚', description: `View dispatch history of ${company}` }
                                    ]
                                }
                            ]
                        }
                    }
                };

            case 'IDENTITY_NOT_FOUND':
                const phoneNum = context.args ? context.args.phone : '';
                return `❌ *Account Not Found* 🥺\n_________________________\n\nOh, sorry! I couldn't find any registered account with the number *${phoneNum}* in our system.\n\n💡 *Action*: Please check the number and reply again (e.g. *917425016636*), or contact our Support Team to register your number! 🌸`;

            case 'SECURITY_VIOLATION':
                return `❌ *Security Verification Failed* 🔒\n_________________________\n\nOh, sorry! You are not authorized to view account details for another number.\n\n💡 *Note*: Customers can only access information linked to their own registered WhatsApp phone number. If you need assistance, please contact our Support Team! 🌸`;

            default:
                return {
                    type: 'interactive',
                    interactive: {
                        type: 'list',
                        header: {
                            type: 'text',
                            text: `${context.companyName || 'Kaira'} 💁‍♀️`
                        },
                        body: {
                            text: context.chatReply || `Welcome to Kaira wholesale garments retailing platform. How can I help you today? Need to check our catalog, stock, or prices?`
                        },
                        footer: {
                            text: 'Digify Soft Solutions Kaira 💁‍♀️ Chatbot'
                        },
                        action: {
                            button: 'View Options 📋',
                            sections: [
                                {
                                    title: 'Menu Options 📋',
                                    rows: [
                                        { id: 'btn_catalogue', title: '1️⃣ Product Catalog 📖', description: 'View full wholesale catalog' },
                                        { id: 'btn_stock', title: '2️⃣ Check Stock 📦', description: 'Check color & size availability' },
                                        { id: 'btn_price', title: '3️⃣ Check Price 🏷️', description: 'Get wholesale rate card' },
                                        { id: 'btn_ledger', title: '4️⃣ Ledger Status 📒', description: 'Statement of accounts/ledger' },
                                        { id: 'btn_tracking', title: '5️⃣ Shipment Tracking 📍', description: 'Track active shipment status' },
                                        { id: 'btn_outstanding', title: '6️⃣ Outstanding Credit 💰', description: 'Check outstanding/credit limit' },
                                        { id: 'btn_invoice', title: '7️⃣ Last Invoice Copy 📄', description: 'Get copy of latest invoice' },
                                        { id: 'btn_past_shipments', title: '8️⃣ Past Shipments 🚚', description: 'View past shipment history' }
                                    ]
                                }
                            ]
                        }
                    }
                };
        }
    }
}

module.exports = QueryParserService;
