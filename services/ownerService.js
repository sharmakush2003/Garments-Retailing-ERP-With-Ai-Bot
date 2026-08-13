class OwnerService {
    /**
     * Get today's sales sum.
     */
    static async getTodaySales(db) {
        const today = new Date().toISOString().split('T')[0];
        const query = `
            SELECT COALESCE(SUM(total_amount), 0) AS total 
            FROM sales_orders 
            WHERE DATE(created_at) = DATE(?) AND order_status != 'Cancelled'
        `;
        const result = await db.get(query, [today]);
        return result ? result.total : 0;
    }

    /**
     * Get today's payments collection sum.
     */
    static async getTodayCollection(db) {
        const today = new Date().toISOString().split('T')[0];
        const query = `
            SELECT COALESCE(SUM(amount), 0) AS total 
            FROM financial_transactions 
            WHERE DATE(created_at) = DATE(?) AND txn_type = 'Payment'
        `;
        const result = await db.get(query, [today]);
        return result ? result.total : 0;
    }

    /**
     * Get top selling products.
     */
    static async getTopSellingProducts(db, limit = 5) {
        const query = `
            SELECT s.sku_code, SUM(oi.qty) AS total_qty
            FROM order_items oi
            JOIN skus s ON oi.sku_id = s.sku_id
            GROUP BY s.sku_id
            ORDER BY total_qty DESC
            LIMIT ?
        `;
        return await db.all(query, [limit]);
    }

    /**
     * Get low stock products (below or at reorder level).
     */
    static async getLowStock(db) {
        const query = `
            SELECT s.sku_code, (i.physical_qty - i.reserved_qty) AS available_qty, i.reorder_level
            FROM inventory i
            JOIN skus s ON i.sku_id = s.sku_id
            WHERE (i.physical_qty - i.reserved_qty) <= i.reorder_level
        `;
        return await db.all(query);
    }

    /**
     * Get dead stock (stock with no sales in past 30 days, or just low movement).
     */
    static async getDeadStock(db) {
        // Find SKUs with positive stock but no order_items records
        const query = `
            SELECT s.sku_code, (i.physical_qty - i.reserved_qty) AS available_qty
            FROM inventory i
            JOIN skus s ON i.sku_id = s.sku_id
            WHERE (i.physical_qty - i.reserved_qty) > 0 
              AND s.sku_id NOT IN (SELECT DISTINCT sku_id FROM order_items)
        `;
        return await db.all(query);
    }

    /**
     * Get customers with outstanding balance above threshold.
     */
    static async getHighOutstanding(db, threshold = 500000) {
        const query = `
            SELECT name, outstanding_balance 
            FROM customers 
            WHERE outstanding_balance >= ?
        `;
        return await db.all(query, [threshold]);
    }

    /**
     * Get customers who crossed their credit limit.
     */
    static async getCreditBreachers(db) {
        const query = `
            SELECT name, outstanding_balance, credit_limit 
            FROM customers 
            WHERE outstanding_balance > credit_limit
        `;
        return await db.all(query);
    }

    /**
     * Get profit today (estimate: e.g., 20% markup, or calculated if cost price is available).
     * Since cost price is not in DB schemas, we use a standard 25% gross margin of sales.
     */
    static async getTodayProfit(db) {
        const sales = await this.getTodaySales(db);
        return Math.round(sales * 0.25);
    }

    /**
     * Get inactive customers who didn't order this month.
     */
    static async getInactiveCustomersThisMonth(db) {
        const startOfMonth = new Date();
        startOfMonth.setDate(1);
        const startStr = startOfMonth.toISOString().split('T')[0];

        const query = `
            SELECT name, phone 
            FROM customers 
            WHERE customer_id NOT IN (
                SELECT DISTINCT customer_id 
                FROM sales_orders 
                WHERE DATE(created_at) >= DATE(?)
            )
        `;
        return await db.all(query, [startStr]);
    }
}

module.exports = OwnerService;
