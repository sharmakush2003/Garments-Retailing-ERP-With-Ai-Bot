/**
 * Order Service Layer
 * Handles order booking, stock reservation, and reorder flows.
 */
const InventoryService = require('./inventoryService');

class OrderService {
    /**
     * Creates a new draft sales order in the database.
     * Verifies stock availability, fetches custom tier pricing, applies schemes, and reserves inventory.
     */
    static async createOrder(db, customerId, items) {
        if (!items || items.length === 0) {
            throw new Error('No items specified for the order.');
        }

        // 1. Resolve customer and their pricing tier
        const customer = await db.get('SELECT * FROM customers WHERE customer_id = ?', [customerId]);
        if (!customer) {
            throw new Error(`Customer with ID ${customerId} not found.`);
        }
        const tierId = customer.tier_id;

        // 2. Start transaction
        await db.run('BEGIN TRANSACTION');
        try {
            let totalAmount = 0;
            let totalQty = 0;
            const processedItems = [];

            for (const item of items) {
                let sku = null;
                const requestedQty = parseInt(item.requestedQty || item.qty || 12);

                // Look up matching SKU in database (sequential fallback)
                if (item.skuId) {
                    sku = await db.get(
                        `SELECT s.sku_id, s.sku_code, s.style_id, st.name, s.color, s.size 
                         FROM skus s 
                         JOIN styles st ON s.style_id = st.style_id 
                         WHERE s.sku_id = ?`,
                        [item.skuId]
                    );
                }

                if (!sku && item.skuCode) {
                    sku = await db.get(
                        `SELECT s.sku_id, s.sku_code, s.style_id, st.name, s.color, s.size 
                         FROM skus s 
                         JOIN styles st ON s.style_id = st.style_id 
                         WHERE s.sku_code = ? OR s.sku_code LIKE ?`,
                        [item.skuCode, `%${item.skuCode}%`]
                    );
                }

                if (!sku) {
                    // Match by color, size, garmentType
                    let query = `
                        SELECT s.sku_id, s.sku_code, s.style_id, st.name, s.color, s.size 
                        FROM skus s 
                        JOIN styles st ON s.style_id = st.style_id
                        WHERE 1=1
                    `;
                    const params = [];
                    if (item.color) {
                        query += ' AND UPPER(s.color) LIKE UPPER(?)';
                        params.push(`%${item.color}%`);
                    }
                    if (item.size) {
                        query += ' AND UPPER(s.size) = UPPER(?)';
                        params.push(item.size);
                    }
                    if (item.garmentType) {
                        query += ' AND (UPPER(s.sku_code) LIKE ? OR UPPER(st.name) LIKE ?)';
                        params.push(`%${item.garmentType.toUpperCase()}%`, `%${item.garmentType.toUpperCase()}%`);
                    }
                    sku = await db.get(query + ' LIMIT 1', params);
                }

                if (!sku) {
                    throw new Error(`SKU matching item details not found.`);
                }

                // Check stock availability
                const stock = await db.get('SELECT physical_qty, reserved_qty FROM inventory WHERE sku_id = ?', [sku.sku_id]);
                const availableQty = stock ? (stock.physical_qty - stock.reserved_qty) : 0;

                if (availableQty < requestedQty) {
                    throw new Error(`Insufficient stock for ${sku.sku_code}. Available: ${availableQty}, Requested: ${requestedQty}`);
                }

                // Get custom tier price
                const price = await InventoryService.getItemPrice(db, sku.sku_id, tierId);
                const itemTotal = price * requestedQty;
                totalAmount += itemTotal;
                totalQty += requestedQty;

                processedItems.push({
                    skuId: sku.sku_id,
                    skuCode: sku.sku_code,
                    name: sku.name,
                    color: sku.color,
                    size: sku.size,
                    qty: requestedQty,
                    pricePerItem: price,
                    total: itemTotal
                });
            }

            // Apply active pricing schemes & discount rules
            let discountApplied = 0;
            let schemeName = null;
            const scheme = await InventoryService.getActiveScheme(db, totalAmount, totalQty);
            if (scheme) {
                discountApplied = scheme.discountAmount;
                schemeName = scheme.name;
            }

            const netPayable = totalAmount - discountApplied;

            // Create Sales Order record
            const orderRes = await db.run(
                'INSERT INTO sales_orders (customer_id, order_status, total_amount) VALUES (?, ?, ?)',
                [customerId, 'Draft', netPayable]
            );
            const orderId = orderRes.lastID;

            // Insert Order Items and Update Inventory reservations
            for (const pItem of processedItems) {
                await db.run(
                    'INSERT INTO order_items (order_id, sku_id, qty, price_per_item) VALUES (?, ?, ?, ?)',
                    [orderId, pItem.skuId, pItem.qty, pItem.pricePerItem]
                );

                await db.run(
                    'UPDATE inventory SET reserved_qty = reserved_qty + ? WHERE sku_id = ?',
                    [pItem.qty, pItem.skuId]
                );
            }

            // Record transaction in accounts (outstanding)
            await db.run(
                'INSERT INTO financial_transactions (customer_id, txn_type, amount, reference_id) VALUES (?, ?, ?, ?)',
                [customerId, 'Invoice', netPayable, `ORD-${orderId}`]
            );

            // Update customer's outstanding balance and used credit limit
            await db.run(
                'UPDATE customers SET outstanding_balance = outstanding_balance + ?, used_credit = used_credit + ? WHERE customer_id = ?',
                [netPayable, netPayable, customerId]
            );

            await db.run('COMMIT');

            return {
                orderId,
                customerId,
                customerName: customer.name,
                items: processedItems,
                subtotal: totalAmount,
                discount: discountApplied,
                schemeName,
                netPayable,
                status: 'Draft'
            };
        } catch (err) {
            await db.run('ROLLBACK');
            throw err;
        }
    }

    /**
     * Retrieves sales order details and its associated item rows.
     */
    static async getOrder(db, orderId) {
        const order = await db.get('SELECT * FROM sales_orders WHERE order_id = ?', [orderId]);
        if (!order) return null;

        const items = await db.all(
            `SELECT oi.*, s.sku_code, st.name, s.color, s.size 
             FROM order_items oi
             JOIN skus s ON oi.sku_id = s.sku_id
             JOIN styles st ON s.style_id = st.style_id
             WHERE oi.order_id = ?`,
            [orderId]
        );

        return {
            ...order,
            items
        };
    }

    /**
     * Reorders items from a past completed/dispatched order.
     */
    static async reorder(db, oldOrderId) {
        const oldOrder = await OrderService.getOrder(db, oldOrderId);
        if (!oldOrder) {
            throw new Error(`Order #${oldOrderId} not found.`);
        }

        const items = oldOrder.items.map(item => ({
            skuId: item.sku_id,
            requestedQty: item.qty
        }));

        return await OrderService.createOrder(db, oldOrder.customer_id, items);
    }
}

module.exports = OrderService;
