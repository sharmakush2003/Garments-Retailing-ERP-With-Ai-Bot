const InventoryService = require('./inventoryService');

class SalesService {
    /**
     * Create a Sales Order for a customer.
     * Implements stock checks, tier pricing, scheme logic, and credit-limit guardrails.
     */
    static async createSalesOrder(db, customerId, items, role = 'Customer') {
        try {
            await db.run('BEGIN TRANSACTION');

            // 1. Fetch Customer Details
            const customer = await db.get(
                'SELECT customer_id, name, tier_id, credit_limit, outstanding_balance, used_credit FROM customers WHERE customer_id = ?',
                [customerId]
            );
            if (!customer) throw new Error(`Customer with ID ${customerId} not found.`);

            let subtotal = 0.00;
            let totalQty = 0;
            const validatedItems = [];

            // 2. Validate Stock and Prices for each SKU
            for (const item of items) {
                const stockInfo = await InventoryService.getStockAvailability(db, item.sku_id);
                if (!stockInfo || stockInfo.available_qty < item.qty) {
                    throw new Error(
                        `Insufficient stock for SKU: ${stockInfo ? stockInfo.sku_code : item.sku_id}. Available: ${stockInfo ? stockInfo.available_qty : 0}`
                    );
                }

                // Resolve price based on Customer Tier
                const price = await InventoryService.getItemPrice(db, item.sku_id, customer.tier_id);
                const itemTotal = price * item.qty;

                subtotal += itemTotal;
                totalQty += item.qty;

                validatedItems.push({
                    sku_id: item.sku_id,
                    qty: item.qty,
                    price_per_item: price
                });
            }

            // 3. Apply active schemes
            const activeScheme = await InventoryService.getActiveScheme(db, subtotal, totalQty);
            const discountAmount = activeScheme ? activeScheme.discountAmount : 0.00;
            const finalTotal = Math.max(0.00, subtotal - discountAmount);

            // 4. Credit Limit Check
            const projectedBalance = customer.outstanding_balance + finalTotal;
            let orderStatus = 'Pending_Payment'; // default for online checkout

            if (projectedBalance > customer.credit_limit) {
                // If it breaches credit limit and role is not Owner/Sales, flag it as Pending_Approval
                orderStatus = 'Pending_Approval';
            }

            // 5. Insert Sales Order
            const result = await db.run(
                'INSERT INTO sales_orders (customer_id, order_status, total_amount) VALUES (?, ?, ?)',
                [customerId, orderStatus, finalTotal]
            );
            const orderId = result.lastID;

            // 6. Insert Order Items and Update Inventory
            for (const item of validatedItems) {
                await db.run(
                    'INSERT INTO order_items (order_id, sku_id, qty, price_per_item) VALUES (?, ?, ?, ?)',
                    [orderId, item.sku_id, item.qty, item.price_per_item]
                );

                // Reserve quantity
                await db.run(
                    'UPDATE inventory SET reserved_qty = reserved_qty + ? WHERE sku_id = ?',
                    [item.qty, item.sku_id]
                );
            }

            // 7. Update Customer used credit
            await db.run(
                'UPDATE customers SET used_credit = used_credit + ? WHERE customer_id = ?',
                [finalTotal, customerId]
            );

            await db.run('COMMIT');

            return {
                success: true,
                order_id: orderId,
                customer_name: customer.name,
                subtotal,
                discount: discountAmount,
                final_total: finalTotal,
                scheme_applied: activeScheme ? activeScheme.name : 'None',
                order_status: orderStatus
            };
        } catch (err) {
            await db.run('ROLLBACK');
            throw err;
        }
    }

    /**
     * Get the dispatch tracking information for an order.
     */
    static async getDispatchTracking(db, orderId) {
        const query = `
            SELECT d.dispatch_id, d.order_id, d.transporter_name, d.lr_number, d.dispatch_date, d.estimated_delivery, d.status 
            FROM order_dispatches d
            WHERE d.order_id = ?
        `;
        return await db.get(query, [orderId]);
    }

    /**
     * Get the last order placed by a customer.
     */
    static async getLastOrder(db, customerId) {
        const orderQuery = `
            SELECT order_id, total_amount, order_status, created_at
            FROM sales_orders
            WHERE customer_id = ? AND order_status != 'Cancelled'
            ORDER BY created_at DESC
            LIMIT 1
        `;
        const order = await db.get(orderQuery, [customerId]);
        if (!order) return null;

        const itemsQuery = `
            SELECT oi.sku_id, s.sku_code, s.color, s.size, oi.qty, oi.price_per_item
            FROM order_items oi
            JOIN skus s ON oi.sku_id = s.sku_id
            WHERE oi.order_id = ?
        `;
        const items = await db.all(itemsQuery, [order.order_id]);
        order.items = items;
        return order;
    }
}

module.exports = SalesService;
