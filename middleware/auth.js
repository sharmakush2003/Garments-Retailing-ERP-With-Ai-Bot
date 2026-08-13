const { getMasterDb, getTenantDb } = require('../services/dbManager');

/**
 * Middleware to inject Tenant Context into the request object.
 * Resolves context via Bearer/headers or incoming WhatsApp phone numbers.
 */
async function injectTenantContext(req, res, next) {
    try {
        let tenantId = req.headers['x-tenant-id'] || 'Co_102'; // default fallback for testing
        let role = 'Owner';
        let customerId = null;
        let phoneNumber = null;

        // If WhatsApp Webhook or message request
        if (req.body && req.body.sender_id) {
            // AutobotChat format: sender_id is the customer's phone number
            phoneNumber = req.body.sender_id;
        } else if (req.body && req.body.number) {
            phoneNumber = req.body.number;
        } else if (req.body && req.body.from) {
            phoneNumber = req.body.from;
        } else if (req.body && req.body.entry && req.body.entry[0].changes && req.body.entry[0].changes[0].value.messages) {
            // Standard Meta Cloud API webhook structure
            const message = req.body.entry[0].changes[0].value.messages[0];
            phoneNumber = message.from;
        }

        if (phoneNumber) {
            const masterDb = await getMasterDb();
            // Lookup tenant matching this phone number
            const userContext = await masterDb.get(
                'SELECT tenant_id, role, erp_customer_id FROM tenant_whatsapp_users WHERE phone_number = ?',
                [phoneNumber]
            );

            if (userContext) {
                tenantId = userContext.tenant_id;
                role = userContext.role;
                customerId = userContext.erp_customer_id;
            } else {
                // New / unknown number — treat as unregistered guest
                // They can check stock & rates, but not personal data (balance, orders)
                tenantId = 'Co_102';
                role = 'Guest';
                customerId = null;
                console.log(`[Auth] New visitor: ${phoneNumber} — guest access granted`);
            }
        }

        // Get tenant database pool/connection
        const db = await getTenantDb(tenantId);

        // Bind context to request
        req.tenantContext = {
            tenantId,
            role,
            customerId,
            phoneNumber,
            db
        };

        next();
    } catch (err) {
        console.error('Error in tenant context middleware:', err);
        res.status(500).json({ error: 'Failed to initialize tenant database context' });
    }
}

module.exports = {
    injectTenantContext
};
