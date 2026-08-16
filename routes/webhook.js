const express = require('express');
const router = express.Router();
const { injectTenantContext } = require('../middleware/auth');
const { messageQueue, processMessageJob } = require('../workers/messageWorker');

// Verification token (for Meta setup)
const VERIFY_TOKEN = process.env.META_VERIFY_TOKEN || 'automatex_copilot_token';

/**
 * GET Webhook Verification endpoint.
 * Facebook sends a GET request to verify the webhook URL.
 */
router.get('/', (req, res) => {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    if (mode && token) {
        if (mode === 'subscribe' && token === VERIFY_TOKEN) {
            console.log('Webhook verified successfully.');
            return res.status(200).send(challenge);
        }
        return res.sendStatus(403);
    }
    res.sendStatus(400);
});

// Track recently processed message IDs to prevent duplicate webhook processing
const processedMessageIds = new Set();

function isDuplicateMessage(msgId) {
    if (!msgId) return false;
    if (processedMessageIds.has(msgId)) {
        return true;
    }
    processedMessageIds.add(msgId);
    // Expire message ID after 60 seconds
    setTimeout(() => {
        processedMessageIds.delete(msgId);
    }, 60000);
    return false;
}

/**
 * POST Webhook message receiver endpoint.
 * Handles incoming messages from WhatsApp.
 */
router.post('/', injectTenantContext, async (req, res) => {
    try {
        let number = null;
        let messageText = null;

        // Deduplicate incoming Goshort/Meta webhooks using message ID
        const msgId = req.body.id || req.body.whts_ref_id || (req.body.context ? req.body.context.id : null);
        if (msgId && isDuplicateMessage(msgId)) {
            console.log(`[Webhook] Skipped duplicate webhook payload for Message ID: ${msgId}`);
            return res.status(200).json({ status: 'Ignored duplicate webhook' });
        }

        // Handle Delivery Status / Report Webhooks (e.g. status reports from AutobotChat)
        if (req.body.delivery_time || req.body.template_id || (req.body.status && !req.body.text && !req.body.message && !req.body.entry)) {
            console.log('[Webhook] Delivery/Status report received:', req.body.id || req.body.request_id);
            return res.status(200).json({ status: 'Report received' });
        }

        let isAudio = false;
        let audioUrl = null;
        let mediaId = null;

        // Structure check for Meta Cloud message payload
        if (req.body.entry && req.body.entry[0].changes && req.body.entry[0].changes[0].value.messages) {
            const message = req.body.entry[0].changes[0].value.messages[0];
            number = message.from;
            if (message.type === 'audio' || message.type === 'voice') {
                isAudio = true;
                mediaId = (message.audio || message.voice).id;
            } else if (message.type === 'interactive' && message.interactive && message.interactive.type === 'nfm_reply') {
                const responseJsonStr = message.interactive.nfm_reply.response_json;
                try {
                    const parsedFlow = JSON.parse(responseJsonStr);
                    const vals = parsedFlow.values || {};
                    messageText = `Book ${vals.qty || 12} pieces of ${vals.color || 'RED'} ${vals.garment_type || 'KURTI'} in size ${vals.size || 'L'}`;
                    if (vals.notes) {
                        messageText += ` (Notes: ${vals.notes})`;
                    }
                    console.log(`[Webhook] Synthesized message from WhatsApp Flow: "${messageText}"`);
                } catch (e) {
                    console.error('[Webhook] Failed to parse Flow response_json:', e.message);
                    messageText = 'Order Flow Submitted';
                }
            } else {
                messageText = message.text ? message.text.body : '';
            }
        } else if (req.body.sender_id) {
            // AutobotChat webhook format:
            // sender_id = customer's phone number
            number = req.body.sender_id;
            if (req.body.media_type === 'audio' || req.body.media_type === 'voice' || req.body.audio) {
                isAudio = true;
                audioUrl = req.body.media_url || req.body.audio;
            } else if (req.body.type === 'interactive' && req.body.interactive && req.body.interactive.type === 'nfm_reply') {
                const responseJsonStr = req.body.interactive.nfm_reply.response_json;
                try {
                    const parsedFlow = JSON.parse(responseJsonStr);
                    const vals = parsedFlow.values || {};
                    messageText = `Book ${vals.qty || 12} pieces of ${vals.color || 'RED'} ${vals.garment_type || 'KURTI'} in size ${vals.size || 'L'}`;
                    if (vals.notes) {
                        messageText += ` (Notes: ${vals.notes})`;
                    }
                    console.log(`[Webhook] Synthesized message from AutobotChat Flow: "${messageText}"`);
                } catch (e) {
                    messageText = 'Order Flow Submitted';
                }
            }
            if (!isAudio && !messageText) {
                if (typeof req.body.text === 'object' && req.body.text !== null) {
                    messageText = req.body.text.body || '';
                } else if (typeof req.body.text === 'string') {
                    messageText = req.body.text;
                } else {
                    messageText = req.body.message || '';
                }
            }
        } else if (req.body.from) {
            number = req.body.from;
            if (req.body.type === 'audio' || req.body.type === 'voice') {
                isAudio = true;
                mediaId = req.body.audio ? req.body.audio.id : (req.body.voice ? req.body.voice.id : null);
            } else if (req.body.type === 'interactive' && req.body.interactive && req.body.interactive.type === 'nfm_reply') {
                const responseJsonStr = req.body.interactive.nfm_reply.response_json;
                try {
                    const parsedFlow = JSON.parse(responseJsonStr);
                    const vals = parsedFlow.values || {};
                    messageText = `Book ${vals.qty || 12} pieces of ${vals.color || 'RED'} ${vals.garment_type || 'KURTI'} in size ${vals.size || 'L'}`;
                    if (vals.notes) {
                        messageText += ` (Notes: ${vals.notes})`;
                    }
                    console.log(`[Webhook] Synthesized message from Flow: "${messageText}"`);
                } catch (e) {
                    messageText = 'Order Flow Submitted';
                }
            } else if (req.body.text && req.body.text.body) {
                messageText = req.body.text.body;
            }
        } else if (req.body.number) {
            number = req.body.number;
            if (req.body.audio || req.body.voice || req.body.message_type === 'audio') {
                isAudio = true;
                audioUrl = req.body.audio || req.body.voice || req.body.message;
            } else if (req.body.message_type === 'interactive' && req.body.interactive && req.body.interactive.type === 'nfm_reply') {
                const responseJsonStr = req.body.interactive.nfm_reply.response_json;
                try {
                    const parsedFlow = JSON.parse(responseJsonStr);
                    const vals = parsedFlow.values || {};
                    messageText = `Book ${vals.qty || 12} pieces of ${vals.color || 'RED'} ${vals.garment_type || 'KURTI'} in size ${vals.size || 'L'}`;
                    if (vals.notes) {
                        messageText += ` (Notes: ${vals.notes})`;
                    }
                    console.log(`[Webhook] Synthesized message from Flow: "${messageText}"`);
                } catch (e) {
                    messageText = 'Order Flow Submitted';
                }
            } else {
                messageText = req.body.message;
            }
        }

        // DEBUG: Print full incoming payload to understand AutobotChat format
        console.log('[Webhook] RAW PAYLOAD:', JSON.stringify(req.body, null, 2));

        if (!number || (!messageText && !isAudio)) {
            console.log('[Webhook] Could not parse number/message or audio from payload above');
            return res.status(400).json({ error: 'Missing phone number or message content' });
        }


        const fallbackPhone = req.body.receiver || req.body.wabaNumber || null;

        const jobData = {
            phoneNumber: number,
            fallbackPhone,
            messageText,
            isAudio,
            audioUrl,
            mediaId,
            tenantContext: {
                tenantId: req.tenantContext.tenantId,
                role: req.tenantContext.role,
                customerId: req.tenantContext.customerId
            }
        };

        // Immediately process the message job to guarantee instant automated reply delivery
        processMessageJob(jobData).catch(err => {
            console.error('[Webhook] Message processing execution error:', err);
        });

        // Return instant success status back to WhatsApp API
        res.status(200).json({
            status: 'Accepted',
            message: 'Queued for processing'
        });

    } catch (err) {
        console.error('Error handling webhook payload:', err);
        res.status(500).json({ error: 'Failed to process message' });
    }
});

module.exports = router;
