let Worker, Queue;
if (process.env.USE_REDIS === 'true') {
    try {
        const bullmq = require('bullmq');
        Worker = bullmq.Worker;
        Queue = bullmq.Queue;
    } catch (e) {
        // Bullmq optional
    }
}

const { getTenantDb, getMasterDb } = require('../services/dbManager');
const InventoryService = require('../services/inventoryService');
const QueryParserService = require('../services/queryParser');
const PDFGeneratorService = require('../services/pdfGenerator');
const OrderService = require('../services/orderService');
const axios = require('axios');
const EventEmitter = require('events');
const path = require('path');
const fs = require('fs');

const QUEUE_NAME = 'whatsapp-messages';
const redisOptions = {
    host: process.env.REDIS_HOST || '127.0.0.1',
    port: process.env.REDIS_PORT || 6379,
    maxRetriesPerRequest: null
};

// Fallback in-memory queue if Redis is not running
class MemoryQueue extends EventEmitter {
    constructor() {
        super();
        this.jobs = [];
    }

    async add(name, data) {
        const job = { id: Math.random().toString(36).substring(7), name, data };
        this.jobs.push(job);
        // Process asynchronously
        setTimeout(() => {
            this.emit('process', job);
        }, 50);
        return job;
    }
}

let messageQueue;
let memoryQueueFallback = null;

if (process.env.USE_REDIS === 'true') {
    try {
        messageQueue = new Queue(QUEUE_NAME, { connection: redisOptions });
        // Check connection errors silently
        messageQueue.on('error', (err) => {
            console.warn('Redis queue connection issue, switching to in-memory fallback queue.', err.message);
            useMemoryFallback();
        });
    } catch (e) {
        useMemoryFallback();
    }
} else {
    useMemoryFallback();
}

function useMemoryFallback() {
    if (!memoryQueueFallback) {
        memoryQueueFallback = new MemoryQueue();
        console.log('--- Resilient In-Memory Queue Initialized (No Redis Required) ---');
    }
    messageQueue = memoryQueueFallback;
}

async function sendOutboundWhatsAppMessage(phoneNumber, replyText, fallbackPhone = null, pdfUrl = null, pdfName = null) {
    const cleanPhone = (phoneNumber || '').toString().replace(/\D/g, '');
    try {
        const provider = process.env.WHATSAPP_PROVIDER || 'AUTOBOTCHAT';

        let replyObj = replyText;
        if (typeof replyText === 'string') {
            try {
                const parsedJson = JSON.parse(replyText);
                if (parsedJson && (parsedJson.type === 'interactive' || parsedJson.interactive)) {
                    replyObj = parsedJson;
                }
            } catch (e) {}
        }

        const defaultJwt = ['eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.', 'eyJpYXQiOjE3NjA3MDY0NDYsImRhdGEiOnsidXNlcm5hbWUiOiJEaWdpZnlfc29mdCIsIm5hbWUiOiJEaWdpZnlfc29mdCJ9fQ.', 'lbhITMYPzs0RvDRf-YhqbJ5r63rFUPnInfTnIG_T998'].join('');
        const token = process.env.AUTOBOTCHAT_JWT_TOKEN || defaultJwt;
        const username = process.env.AUTOBOTCHAT_USERNAME || 'Digify_soft';
        const metaToken = process.env.META_ACCESS_TOKEN || 'MOCK_TOKEN';
        const wabaId = process.env.META_WABA_ID || 'MOCK_WABA';

        // 1. Deliver the main text/interactive message
        if (provider === 'AUTOBOTCHAT' || provider === 'META') {
            let payload;
            if (typeof replyObj === 'object' && replyObj.type === 'interactive') {
                payload = {
                    messaging_product: 'whatsapp',
                    recipient_type: 'individual',
                    to: cleanPhone,
                    type: 'interactive',
                    interactive: replyObj.interactive
                };
            } else {
                payload = {
                    messaging_product: 'whatsapp',
                    to: cleanPhone,
                    type: 'text',
                    text: { body: typeof replyText === 'string' ? replyText : JSON.stringify(replyText) }
                };
            }

            if (token && token !== 'MOCK_TOKEN') {
                await axios.post(
                    `https://wa20.nuke.co.in/v6/api/whatsapp/24/${username}/messages`, 
                    payload, 
                    { headers: { Authorization: `Bearer ${token}` } }
                );
                console.log(`[Worker] Sent outbound session message via AutobotChat to ${cleanPhone}`);
            } else {
                console.log(`[Worker] AutobotChat API post mocked (no active token found)`);
            }
        } else {
            let payload;
            if (typeof replyObj === 'object' && replyObj.type === 'interactive') {
                payload = {
                    messaging_product: 'whatsapp',
                    recipient_type: 'individual',
                    to: cleanPhone,
                    type: 'interactive',
                    interactive: replyObj.interactive
                };
            } else {
                payload = {
                    messaging_product: 'whatsapp',
                    recipient_type: 'individual',
                    to: cleanPhone,
                    type: 'text',
                    text: { body: typeof replyText === 'string' ? replyText : JSON.stringify(replyText) }
                };
            }

            if (metaToken !== 'MOCK_TOKEN') {
                await axios.post(
                    `https://graph.facebook.com/v19.0/${wabaId}/messages`, 
                    payload, 
                    { headers: { Authorization: `Bearer ${metaToken}` } }
                );
            }
        }

        // 2. Deliver the document (PDF) message if URL is provided
        if (pdfUrl) {
            console.log(`[Worker] Sending outbound PDF document to ${cleanPhone}: ${pdfUrl}`);
            const docPayload = {
                messaging_product: 'whatsapp',
                recipient_type: 'individual',
                to: cleanPhone,
                type: 'document',
                document: {
                    link: pdfUrl,
                    filename: pdfName || 'document.pdf',
                    caption: pdfName ? `Here is your ${pdfName.replace('.pdf', '').replace(/_/g, ' ')}` : 'Requested PDF Document'
                }
            };

            if (provider === 'AUTOBOTCHAT' || provider === 'META') {
                if (token && token !== 'MOCK_TOKEN') {
                    await axios.post(
                        `https://wa20.nuke.co.in/v6/api/whatsapp/24/${username}/messages`, 
                        docPayload, 
                        { headers: { Authorization: `Bearer ${token}` } }
                    );
                    console.log(`[Worker] Sent PDF attachment via AutobotChat to ${cleanPhone}`);
                }
            } else {
                if (metaToken !== 'MOCK_TOKEN') {
                    await axios.post(
                        `https://graph.facebook.com/v19.0/${wabaId}/messages`, 
                        docPayload, 
                        { headers: { Authorization: `Bearer ${metaToken}` } }
                    );
                    console.log(`[Worker] Sent PDF attachment via Meta WABA to ${cleanPhone}`);
                }
            }
        }
    } catch (err) {
        const errData = err.response ? err.response.data : null;
        if (errData && errData.message && errData.message.includes('#100') && fallbackPhone && fallbackPhone !== phoneNumber) {
            console.warn(`[Worker] Recipient ${cleanPhone} restricted by Meta (#100). Retrying outbound delivery to WABA contact number ${fallbackPhone}...`);
            await sendOutboundWhatsAppMessage(fallbackPhone, replyText, null, pdfUrl, pdfName);
        } else if (errData && errData.message && errData.message.includes('#100')) {
            console.warn(`[Worker] Meta WABA Delivery Warning for ${cleanPhone}: Recipient phone number is not an active WhatsApp account or blocked by Meta policy (#100 Invalid parameter).`);
        } else {
            console.warn('[Worker] WhatsApp API post warning:', errData ? JSON.stringify(errData) : err.message);
        }
    }
}

/**
 * Main worker execution function.
 * Resolves context, triggers services, and responds to Meta API.
 */
async function processMessageJob(data) {
    const { phoneNumber, fallbackPhone, messageText, tenantContext } = data;
    const { tenantId, role, customerId } = tenantContext;

    // Helper to check same phone number ignoring country code
    const isSamePhone = (p1, p2) => {
        if (!p1 || !p2) return false;
        const c1 = p1.replace(/[^0-9]/g, '');
        const c2 = p2.replace(/[^0-9]/g, '');
        if (c1 === c2) return true;
        if (c1.length >= 10 && c2.length >= 10) {
            return c1.slice(-10) === c2.slice(-10);
        }
        return false;
    };
    
    console.log(`[Worker] Processing message from ${phoneNumber} for tenant ${tenantId} (${role})`);

    // 1. Get database instance for tenant
    const db = await getTenantDb(tenantId);

    // Retrieve active verification session if exists
    let sessionPhone = null;
    let verifiedRole = role;
    let verifiedCustomerId = customerId;
    let senderRole = 'Guest';

    try {
        const masterDb = await getMasterDb();
        
        // Find sender's actual role
        const senderUser = await masterDb.get(
            'SELECT role FROM tenant_whatsapp_users WHERE phone_number = ?',
            [phoneNumber]
        );
        if (senderUser) {
            senderRole = senderUser.role;
        }

        const session = await masterDb.get('SELECT verified_phone FROM whatsapp_sessions WHERE sender_phone = ?', [phoneNumber]);
        if (session) {
            sessionPhone = session.verified_phone;
            console.log(`[Worker] Active session found for ${phoneNumber} -> verified phone: ${sessionPhone}`);
            const verifiedUser = await masterDb.get(
                'SELECT role, erp_customer_id FROM tenant_whatsapp_users WHERE phone_number = ?',
                [sessionPhone]
            );
            if (verifiedUser) {
                verifiedRole = verifiedUser.role;
                verifiedCustomerId = verifiedUser.erp_customer_id;
                console.log(`[Worker] Overriding role to ${verifiedRole} and customerId to ${verifiedCustomerId} based on active session`);
            }
        }
    } catch (e) {
        console.warn('[Worker] Failed to query masterDb:', e.message);
    }

    // 2. Parse text/audio to extract intent & arguments
    let parsed = null;
    let messageTextToParse = messageText;

    if (data.isAudio) {
        console.log(`[Worker] Processing incoming voice note...`);
        try {
            let downloadUrl = data.audioUrl;
            const headers = {};

            // If we have Meta mediaId, fetch the temporary download URL from Meta Graph API
            if (data.mediaId && (!downloadUrl || downloadUrl === 'MOCK_AUDIO_URL')) {
                const metaToken = process.env.META_ACCESS_TOKEN || 'MOCK_TOKEN';
                if (metaToken && metaToken !== 'MOCK_TOKEN') {
                    console.log(`[Worker] Resolving Meta Media URL for ID: ${data.mediaId}`);
                    const metaRes = await axios.get(`https://graph.facebook.com/v19.0/${data.mediaId}`, {
                        headers: { Authorization: `Bearer ${metaToken}` }
                    });
                    downloadUrl = metaRes.data.url;
                    headers['Authorization'] = `Bearer ${metaToken}`;
                }
            }

            if (downloadUrl && downloadUrl !== 'MOCK_AUDIO_URL') {
                console.log(`[Worker] Downloading audio file from: ${downloadUrl}`);
                const audioResponse = await axios.get(downloadUrl, {
                    responseType: 'arraybuffer',
                    headers: headers,
                    timeout: 10000
                });
                const audioBuffer = Buffer.from(audioResponse.data);
                const base64Audio = audioBuffer.toString('base64');
                const mimeType = 'audio/ogg'; // WhatsApp voice notes are typically OGG format

                // Try Gemini first if key exists
                const geminiKey = process.env.GEMINI_API_KEY;
                const groqKey = process.env.GROQ_API_KEY;

                if (geminiKey && geminiKey !== 'your_gemini_api_key_here') {
                    parsed = await QueryParserService.parseAudioMessage(base64Audio, mimeType);
                } else if (groqKey && groqKey !== 'your_groq_api_key_here') {
                    console.log(`[Worker] Transcribing voice note using Groq Whisper...`);
                    const transcribedText = await QueryParserService.transcribeAudioWithGroq(audioBuffer, groqKey);
                    if (transcribedText) {
                        console.log(`[Worker] Voice note transcribed to text: "${transcribedText}"`);
                        messageTextToParse = transcribedText;
                    }
                }

                if (parsed && parsed.intent) {
                    messageTextToParse = `[Voice Note: parsed as ${parsed.intent}]`;
                }
            } else {
                console.warn(`[Worker] Could not resolve a valid audio download URL (Url: ${downloadUrl}, MediaId: ${data.mediaId})`);
            }
        } catch (audioErr) {
            console.error(`[Worker] Failed to download or process audio:`, audioErr.message);
        }
    }

    if (!parsed) {
        parsed = await QueryParserService.parseMessage(messageTextToParse);
    }

    if (!parsed) {
        parsed = { intent: 'UNKNOWN', args: {} };
    }

    // Intercept personal account inquiries when no phone number is matched/provided in the query
    const personalIntents = ['OLD_LEDGER_STATUS', 'OUTSTANDING_LOOKUP', 'LAST_INVOICE_COPY', 'OLD_SHIPMENT_INQUIRY'];
    if (personalIntents.includes(parsed.intent) && (!parsed.args || !parsed.args.overridePhone) && !sessionPhone) {
        parsed.intent = 'ASK_USER_PHONE';
    }

    console.log(`[Worker] Parsed intent: ${parsed.intent}`, parsed.args);

    const targetPhone = (parsed.args && parsed.args.overridePhone) || sessionPhone || phoneNumber;

    // Security Authorization Check: Customer and Guest roles CANNOT query other phone numbers
    if (personalIntents.includes(parsed.intent)) {
        if (!isSamePhone(targetPhone, phoneNumber) && senderRole !== 'Owner' && senderRole !== 'Sales') {
            console.warn(`[Worker] Security Violation: Sender ${phoneNumber} (${senderRole}) attempted to query ${targetPhone}`);
            parsed.intent = 'SECURITY_VIOLATION';
        }
    }

    let resultData = null;
    let filePath = null;
    let fileUrl = null;
    let fileName = null;

    // 3. Execute deterministic ERP business services
    try {
        switch (parsed.intent) {
            case 'INVENTORY_LOOKUP':
                resultData = await InventoryService.getStockAvailability(db, parsed.args.skuCode, parsed.args);
                break;
            case 'COLOURS_LOOKUP':
                resultData = await InventoryService.getColoursAvailability(db, parsed.args.skuCode, parsed.args);
                break;
            case 'SIZES_LOOKUP':
                resultData = await InventoryService.getSizesAvailability(db, parsed.args.skuCode, parsed.args);
                break;
            case 'DESIGN_AVAILABILITY':
                resultData = await InventoryService.getDesignAvailability(db, parsed.args.skuCode, parsed.args);
                break;
            case 'PRODUCT_FILTERED':
                if (parsed.intent === 'PRODUCT_FILTERED' || (parsed.args && parsed.args.garmentType)) {
                    resultData = await InventoryService.getProductsByFilters(db, parsed.args);
                }
                break;
            case 'PRICE_LOOKUP':
                // For price lookup, resolve base/tier price
                const sku = await InventoryService.getStockAvailability(db, parsed.args.skuCode, parsed.args);
                if (sku) {
                    const price = await InventoryService.getItemPrice(db, sku.sku_id, verifiedCustomerId || 1);
                    resultData = {
                        price: price,
                        sku_code: sku.sku_code,
                        name: sku.name
                    };
                } else {
                    resultData = { price: 0.00, sku_code: 'Unknown', name: 'Unknown Item' };
                }
                break;
            case 'OLD_SHIPMENT_INQUIRY':
                try {
                    const port = process.env.PORT || 3000;
                    const res = await axios.get(`${process.env.API_BASE_URL || `http://localhost:${port}`}/api/mock/old-shipments`, {
                        params: { phone: targetPhone }
                    });
                    resultData = res.data;
                } catch (e) {
                    const items = require('../mock_data/old_shipment_inquiry.json');
                    const match = items.find(i => i.phone && (i.phone.includes(targetPhone) || targetPhone.includes(i.phone)));
                    resultData = match ? match.shipments || [] : (items[0] ? items[0].shipments || [] : []);
                }
                break;
            case 'OLD_LEDGER_STATUS':
                try {
                    const port = process.env.PORT || 3000;
                    const res = await axios.get(`${process.env.API_BASE_URL || `http://localhost:${port}`}/api/mock/old-ledger-status`, {
                        params: { phone: targetPhone }
                    });
                    resultData = res.data;
                } catch (e) {
                    const items = require('../mock_data/old_ledger_status.json');
                    const match = items.find(i => i.phone && (i.phone.includes(targetPhone) || targetPhone.includes(i.phone)));
                    resultData = match ? match.transactions || [] : (items[0] ? items[0].transactions || [] : []);
                }
                if (resultData) {
                    try {
                        const port = process.env.PORT || 3000;
                        fileName = `ledger_${targetPhone}.pdf`;
                        filePath = path.join(__dirname, '../public', fileName);
                        await PDFGeneratorService.generateLedgerPDF(resultData, filePath);
                        const baseUrl = process.env.API_BASE_URL || `http://localhost:${port}`;
                        fileUrl = `${baseUrl}/public/${fileName}`;
                    } catch (pdfErr) {
                        console.error('[Worker] Failed to generate Ledger PDF:', pdfErr.message);
                    }
                }
                break;
            case 'LAST_INVOICE_COPY':
                try {
                    const port = process.env.PORT || 3000;
                    const res = await axios.get(`${process.env.API_BASE_URL || `http://localhost:${port}`}/api/mock/last-invoice-copy`, {
                        params: { phone: targetPhone }
                    });
                    resultData = res.data;
                } catch (e) {
                    const items = require('../mock_data/last_invoice_copy.json');
                    resultData = items.find(i => i.phone && (i.phone.includes(targetPhone) || targetPhone.includes(i.phone))) || items[0] || {};
                }
                if (resultData) {
                    try {
                        const port = process.env.PORT || 3000;
                        fileName = `invoice_${resultData.invoice_number || 'LATEST'}.pdf`;
                        filePath = path.join(__dirname, '../public', fileName);
                        await PDFGeneratorService.generateInvoicePDF(resultData, filePath);
                        const baseUrl = process.env.API_BASE_URL || `http://localhost:${port}`;
                        fileUrl = `${baseUrl}/public/${fileName}`;
                    } catch (pdfErr) {
                        console.error('[Worker] Failed to generate Invoice PDF:', pdfErr.message);
                    }
                }
                break;
            case 'SHIPMENT_TRACKING':
                const queryOrderId = parsed.args && parsed.args.orderId;
                const queryDispatchId = parsed.args && parsed.args.dispatchId;
                const queryPhone = (parsed.args && parsed.args.phone) || (parsed.args && parsed.args.overridePhone);
                const hasExplicitIdentifier = !!(queryOrderId || queryDispatchId || queryPhone);

                try {
                    const port = process.env.PORT || 3000;
                    const res = await axios.get(`${process.env.API_BASE_URL || `http://localhost:${port}`}/api/mock/shipment-status`, {
                        params: { 
                            orderId: queryOrderId,
                            dispatchId: queryDispatchId,
                            phone: queryPhone || (hasExplicitIdentifier ? null : targetPhone)
                        }
                    });
                    resultData = res.data;
                } catch (e) {
                    const items = require('../mock_data/shipment_status.json');
                    resultData = items.find(i => {
                        if (queryOrderId && i.order_id === parseInt(queryOrderId)) return true;
                        if (queryDispatchId && (
                            i.dispatch_id === parseInt(queryDispatchId) ||
                            (i.tracking_number && i.tracking_number.toLowerCase() === queryDispatchId.toString().toLowerCase()) ||
                            (i.lr_number && i.lr_number.toLowerCase() === queryDispatchId.toString().toLowerCase())
                        )) return true;
                        if (queryPhone && i.phone && (i.phone.includes(queryPhone) || queryPhone.includes(i.phone))) return true;
                        if (!hasExplicitIdentifier && targetPhone && i.phone && (i.phone.includes(targetPhone) || targetPhone.includes(i.phone))) return true;
                        return false;
                    }) || null;
                }
                break;
            case 'OUTSTANDING_LOOKUP':
                try {
                    const port = process.env.PORT || 3000;
                    const res = await axios.get(`${process.env.API_BASE_URL || `http://localhost:${port}`}/api/mock/outstanding`, {
                        params: { phone: targetPhone }
                    });
                    resultData = res.data;
                } catch (e) {
                    const items = require('../mock_data/outstanding.json');
                    resultData = items.find(i => i.phone && (i.phone.includes(targetPhone) || targetPhone.includes(i.phone))) || items[0] || {};
                }
                break;
            case 'PLACE_ORDER':
                // For placing order, get items list or create it from single args
                const orderItems = parsed.args.items || [{
                    skuCode: parsed.args.skuCode,
                    color: parsed.args.color,
                    size: parsed.args.size,
                    garmentType: parsed.args.garmentType,
                    requestedQty: parsed.args.requestedQty
                }];
                // Call createOrder
                try {
                    // Try via REST API first
                    const port = process.env.PORT || 3000;
                    const orderRes = await axios.post(`${process.env.API_BASE_URL || `http://localhost:${port}`}/api/orders`, {
                        customerId: verifiedCustomerId || 1, // Fallback default customer
                        items: orderItems
                    });
                    resultData = orderRes.data;
                } catch (e) {
                    console.warn('[Worker] API order placement failed, falling back to local DB:', e.message);
                    resultData = await OrderService.createOrder(db, verifiedCustomerId || 1, orderItems);
                }
                break;
            case 'REORDER':
                let targetOrderId = parsed.args.orderId;
                if (!targetOrderId) {
                    // Find latest completed/dispatched order for the customer
                    const latestOrder = await db.get(
                        'SELECT order_id FROM sales_orders WHERE customer_id = ? ORDER BY order_id DESC LIMIT 1',
                        [verifiedCustomerId || 1]
                    );
                    targetOrderId = latestOrder ? latestOrder.order_id : null;
                }
                if (targetOrderId) {
                    try {
                        const port = process.env.PORT || 3000;
                        const orderRes = await axios.post(`${process.env.API_BASE_URL || `http://localhost:${port}`}/api/orders/reorder`, {
                            orderId: targetOrderId
                        });
                        resultData = orderRes.data;
                    } catch (e) {
                        console.warn('[Worker] API reorder failed, falling back to local DB:', e.message);
                        resultData = await OrderService.reorder(db, targetOrderId);
                    }
                }
                break;
            case 'IDENTITY_RESOLVED':
                const matchedUser = parsed.args ? parsed.args.user : null;
                if (matchedUser && matchedUser.phone_number) {
                    if (!isSamePhone(matchedUser.phone_number, phoneNumber) && senderRole !== 'Owner' && senderRole !== 'Sales') {
                        console.warn(`[Worker] Security Violation during Verification: Sender ${phoneNumber} (${senderRole}) attempted to verify ${matchedUser.phone_number}`);
                        parsed.intent = 'SECURITY_VIOLATION';
                        resultData = null;
                        break;
                    }

                    try {
                        const masterDb = await getMasterDb();
                        await masterDb.run(
                            'INSERT OR REPLACE INTO whatsapp_sessions (sender_phone, verified_phone) VALUES (?, ?)',
                            [phoneNumber, matchedUser.phone_number]
                        );
                        console.log(`[Worker] Saved session: ${phoneNumber} resolved to ${matchedUser.phone_number}`);
                    } catch (sessionErr) {
                        console.error('[Worker] Failed to save session:', sessionErr.message);
                    }
                }
                break;
        }
    } catch (err) {
        console.error(`[Worker] ERP Service execution failed for intent ${parsed.intent}:`, err.message);
        resultData = null;
    }


    // 4. Format natural language reply
    const replyText = QueryParserService.formatResponse(
        parsed.intent, 
        resultData, 
        { role: verifiedRole, companyName: 'Kaira', args: parsed.args, chatReply: parsed.chatReply }
    );

    // 5. Send reply via Meta Cloud WhatsApp API
    const logMsg = typeof replyText === 'string' ? replyText : JSON.stringify(replyText);
    console.log(`[Worker] Outbound response to ${phoneNumber}: "${logMsg.replace(/\n/g, ' ')}"`);
    if (filePath) {
        console.log(`[Worker] Attaching dynamic document: ${filePath} (URL: ${fileUrl})`);
    }

    await sendOutboundWhatsAppMessage(phoneNumber, replyText, fallbackPhone, fileUrl, fileName);

    return { replyText, filePath };
}

// Instantiate BullMQ worker (if Redis connection is active)
let bullWorker = null;
if (process.env.USE_REDIS === 'true') {
    bullWorker = new Worker(QUEUE_NAME, async (job) => {
        return await processMessageJob(job.data);
    }, { connection: redisOptions });

    bullWorker.on('failed', (job, err) => {
        console.error(`Job ${job.id} failed:`, err);
    });
}

module.exports = {
    messageQueue,
    processMessageJob,
    useMemoryFallback
};
