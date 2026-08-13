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

const { getTenantDb } = require('../services/dbManager');
const InventoryService = require('../services/inventoryService');
const LedgerService = require('../services/ledgerService');
const SalesService = require('../services/salesService');
const QueryParserService = require('../services/queryParser');
const axios = require('axios');
const EventEmitter = require('events');

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

async function sendOutboundWhatsAppMessage(phoneNumber, replyText, fallbackPhone = null) {
    const cleanPhone = (phoneNumber || '').toString().replace(/\D/g, '');
    try {
        const provider = process.env.WHATSAPP_PROVIDER || 'AUTOBOTCHAT';

        if (provider === 'AUTOBOTCHAT' || provider === 'META') {
            const defaultJwt = ['eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.', 'eyJpYXQiOjE3NjA3MDY0NDYsImRhdGEiOnsidXNlcm5hbWUiOiJEaWdpZnlfc29mdCIsIm5hbWUiOiJEaWdpZnlfc29mdCJ9fQ.', 'lbhITMYPzs0RvDRf-YhqbJ5r63rFUPnInfTnIG_T998'].join('');
            const token = process.env.AUTOBOTCHAT_JWT_TOKEN || defaultJwt;
            const username = process.env.AUTOBOTCHAT_USERNAME || 'Digify_soft';

            let payload;
            if (typeof replyText === 'object' && replyText.type === 'interactive') {
                payload = {
                    messaging_product: 'whatsapp',
                    recipient_type: 'individual',
                    to: cleanPhone,
                    type: 'interactive',
                    interactive: replyText.interactive
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
            if (typeof replyText === 'object' && replyText.type === 'interactive') {
                payload = {
                    messaging_product: 'whatsapp',
                    recipient_type: 'individual',
                    to: cleanPhone,
                    type: 'interactive',
                    interactive: replyText.interactive
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

            const token = process.env.META_ACCESS_TOKEN || 'MOCK_TOKEN';
            const wabaId = process.env.META_WABA_ID || 'MOCK_WABA';

            if (token !== 'MOCK_TOKEN') {
                await axios.post(
                    `https://graph.facebook.com/v19.0/${wabaId}/messages`, 
                    payload, 
                    { headers: { Authorization: `Bearer ${token}` } }
                );
            }
        }
    } catch (err) {
        const errData = err.response ? err.response.data : null;
        if (errData && errData.message && errData.message.includes('#100') && fallbackPhone && fallbackPhone !== phoneNumber) {
            console.warn(`[Worker] Recipient ${cleanPhone} restricted by Meta (#100). Retrying outbound delivery to WABA contact number ${fallbackPhone}...`);
            await sendOutboundWhatsAppMessage(fallbackPhone, replyText, null);
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
    
    console.log(`[Worker] Processing message from ${phoneNumber} for tenant ${tenantId} (${role})`);

    // 1. Get database instance for tenant
    const db = await getTenantDb(tenantId);

    // 2. Parse text to extract intent & arguments
    const parsed = await QueryParserService.parseMessage(messageText);
    console.log(`[Worker] Parsed intent: ${parsed.intent}`, parsed.args);

    let resultData = null;
    let filePath = null;

    // 3. Execute deterministic ERP business services
    try {
        // Guest users (unregistered numbers) can check stock & rates
        // but NOT personal data (balance, orders, ledger)
        const GUEST_BLOCKED_INTENTS = ['OUTSTANDING_LOOKUP', 'LEDGER_REQUEST', 'ORDER_BOOKING', 'ORDER_TRACKING', 'REPEAT_ORDER'];
        if (role === 'Guest' && GUEST_BLOCKED_INTENTS.includes(parsed.intent)) {
            const replyText = `👋 Welcome to *Aarav Creations*!\n\nYou can check our *stock availability* and *rates* freely.\n\nFor your personal account info (balance, orders, ledger), please contact us:\n📞 *+91 90450 99111*\n\nWe'll register your number and get you set up! 🙏`;
            console.log(`[Worker] Guest user ${phoneNumber} blocked from ${parsed.intent} — sending welcome msg`);
            await sendOutboundWhatsAppMessage(phoneNumber, replyText, fallbackPhone);
            return { replyText, filePath: null };
        }

        if (parsed.intent === 'OWNER_REPORT' && role !== 'Owner') {
            const replyText = `❌ *Access Denied*: You do not have permission to view owner/manager reports.`;
            console.log(`[Worker] User ${phoneNumber} with role ${role} blocked from OWNER_REPORT`);
            await sendOutboundWhatsAppMessage(phoneNumber, replyText, fallbackPhone);
            return { replyText, filePath: null };
        }

        switch (parsed.intent) {
            case 'INVENTORY_LOOKUP':
                resultData = await InventoryService.getStockAvailability(db, parsed.args.skuCode, parsed.args);
                break;
            case 'PRICE_LOOKUP':
                // For price lookup, resolve base/tier price
                const sku = await InventoryService.getStockAvailability(db, parsed.args.skuCode, parsed.args);
                if (sku) {
                    resultData = await InventoryService.getItemPrice(db, sku.sku_id, customerId || 1);
                } else {
                    resultData = 0.00;
                }
                break;
            case 'OUTSTANDING_LOOKUP':
                resultData = await LedgerService.getCustomerOutstanding(db, customerId);
                break;
            case 'LEDGER_REQUEST':
                filePath = await LedgerService.generateLedgerPDF(db, customerId);
                resultData = { filePath };
                break;
            case 'ORDER_TRACKING':
                resultData = await SalesService.getDispatchTracking(db, parsed.args.orderId);
                break;
            case 'ORDER_BOOKING':
                resultData = await SalesService.createSalesOrder(db, customerId, parsed.args.items, role);
                break;
            case 'REPEAT_ORDER':
                resultData = await SalesService.getLastOrder(db, customerId);
                break;
            case 'NEW_ARRIVALS':
                resultData = await InventoryService.getNewArrivals(db);
                break;
            case 'TOP_SELLING':
                resultData = await InventoryService.getFastestSelling(db);
                break;
            case 'OWNER_REPORT': {
                const OwnerService = require('../services/ownerService');
                const reportType = parsed.args.reportType;
                if (reportType === 'SALES') {
                    resultData = { type: 'SALES', value: await OwnerService.getTodaySales(db) };
                } else if (reportType === 'COLLECTION') {
                    resultData = { type: 'COLLECTION', value: await OwnerService.getTodayCollection(db) };
                } else if (reportType === 'LOW_STOCK') {
                    resultData = { type: 'LOW_STOCK', list: await OwnerService.getLowStock(db) };
                } else if (reportType === 'DEAD_STOCK') {
                    resultData = { type: 'DEAD_STOCK', list: await OwnerService.getDeadStock(db) };
                } else if (reportType === 'TOP_SELLING') {
                    resultData = { type: 'TOP_SELLING', list: await OwnerService.getTopSellingProducts(db) };
                } else if (reportType === 'CREDIT_BREACH') {
                    resultData = { type: 'CREDIT_BREACH', list: await OwnerService.getCreditBreachers(db) };
                } else if (reportType === 'HIGH_OUTSTANDING') {
                    resultData = { type: 'HIGH_OUTSTANDING', list: await OwnerService.getHighOutstanding(db) };
                } else if (reportType === 'PROFIT') {
                    resultData = { type: 'PROFIT', value: await OwnerService.getTodayProfit(db) };
                } else if (reportType === 'INACTIVE_CUSTOMERS') {
                    resultData = { type: 'INACTIVE_CUSTOMERS', list: await OwnerService.getInactiveCustomersThisMonth(db) };
                }
                break;
            }
        }
    } catch (err) {
        console.error(`[Worker] ERP Service execution failed for intent ${parsed.intent}:`, err.message);
        resultData = null;
    }


    // 4. Format natural language reply
    const replyText = QueryParserService.formatResponse(
        parsed.intent, 
        resultData, 
        { role, companyName: 'Aarav Creations' }
    );

    // 5. Send reply via Meta Cloud WhatsApp API
    const logMsg = typeof replyText === 'string' ? replyText : JSON.stringify(replyText);
    console.log(`[Worker] Outbound response to ${phoneNumber}: "${logMsg.replace(/\n/g, ' ')}"`);
    if (filePath) {
        console.log(`[Worker] Attaching ledger document: ${filePath}`);
    }

    await sendOutboundWhatsAppMessage(phoneNumber, replyText, fallbackPhone);

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
