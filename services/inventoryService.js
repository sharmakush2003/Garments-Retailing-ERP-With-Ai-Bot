/**
 * Inventory Service Layer
 * Handle inventory counts, reserved quantities, and custom tier pricing.
 */
class InventoryService {
    /**
     * Queries stock availability for a specific SKU code.
     */
    static async getStockAvailability(db, skuIdOrCode, filters = {}) {
        // Primary search: by exact sku_id, sku_code, or barcode
        if (skuIdOrCode) {
            const query = `
                SELECT s.sku_id, s.sku_code, s.color, s.size, i.physical_qty, i.reserved_qty, 
                       (i.physical_qty - i.reserved_qty) AS available_qty 
                FROM skus s
                JOIN inventory i ON s.sku_id = i.sku_id
                WHERE s.sku_id = ? OR s.sku_code LIKE ? OR s.barcode = ?
            `;
            const likeCode = `%${skuIdOrCode}%`;
            const result = await db.get(query, [skuIdOrCode, likeCode, skuIdOrCode]);
            if (result) return result;
        }

        // Secondary search: by color and/or size extracted from natural language
        const { color, size, garmentType, originalColor } = filters;
        if (color || size || garmentType) {
            let whereClauses = [];
            let params = [];
            // DB stores full color names like "Blue", "Green" — use originalColor if available
            const colorSearch = originalColor || color;
            if (colorSearch) { whereClauses.push('UPPER(s.color) LIKE ?'); params.push(`%${colorSearch}%`); }
            if (size)        { whereClauses.push('UPPER(s.size) = ?');    params.push(size.toUpperCase()); }
            if (garmentType) { whereClauses.push('UPPER(s.sku_code) LIKE ?'); params.push(`%${garmentType}%`); }

            const fallbackQuery = `
                SELECT s.sku_id, s.sku_code, s.color, s.size, i.physical_qty, i.reserved_qty, 
                       (i.physical_qty - i.reserved_qty) AS available_qty 
                FROM skus s
                JOIN inventory i ON s.sku_id = i.sku_id
                WHERE ${whereClauses.join(' AND ')}
                LIMIT 1
            `;
            return await db.get(fallbackQuery, params);
        }

        return null;
    }


    /**
     * Resolves the wholesale price matching style and client pricing tier.
     */
    static async getItemPrice(db, skuId, tierId) {
        const query = `
            SELECT COALESCE(tp.custom_price, st.base_price) AS price
            FROM skus sk
            JOIN styles st ON sk.style_id = st.style_id
            LEFT JOIN tier_prices tp ON tp.style_id = st.style_id AND tp.tier_id = ?
            WHERE sk.sku_id = ?
        `;
        const row = await db.get(query, [tierId, skuId]);
        return row ? parseFloat(row.price) : 0.00;
    }

    /**
     * Retrieves active pricing and discount schemes.
     */
    static async getActiveScheme(db, subtotal, totalQty) {
        const today = new Date().toISOString().split('T')[0];
        const query = `
            SELECT scheme_id, name, scheme_type, min_order_amount, min_order_qty, discount_value 
            FROM schemes 
            WHERE is_active = 1 AND start_date <= ? AND end_date >= ?
        `;
        const schemes = await db.all(query, [today, today]);

        let bestScheme = null;
        let maxDiscount = 0.00;

        for (const scheme of schemes) {
            if (subtotal < parseFloat(scheme.min_order_amount) || totalQty < parseInt(scheme.min_order_qty)) {
                continue;
            }

            let currentDiscount = 0.00;
            if (scheme.scheme_type === 'Percentage_Discount') {
                currentDiscount = (subtotal * parseFloat(scheme.discount_value)) / 100.00;
            } else if (scheme.scheme_type === 'Flat_Discount') {
                currentDiscount = parseFloat(scheme.discount_value);
            } else if (scheme.scheme_type === 'Buy_X_Get_Y') {
                const factor = Math.floor(totalQty / Math.max(1, parseInt(scheme.min_order_qty)));
                currentDiscount = factor * parseFloat(scheme.discount_value);
            }

            if (currentDiscount > maxDiscount) {
                maxDiscount = currentDiscount;
                bestScheme = {
                    schemeId: scheme.scheme_id,
                    name: scheme.name,
                    discountAmount: maxDiscount
                };
            }
        }
        return bestScheme;
    }

    /**
     * Get recently added products/styles.
     */
    static async getNewArrivals(db, limit = 5) {
        const query = `
            SELECT s.sku_id, s.sku_code, s.color, s.size, st.base_price, (i.physical_qty - i.reserved_qty) AS available_qty
            FROM skus s
            JOIN styles st ON s.style_id = st.style_id
            JOIN inventory i ON s.sku_id = i.sku_id
            ORDER BY st.style_id DESC
            LIMIT ?
        `;
        return await db.all(query, [limit]);
    }

    /**
     * Get fastest selling/top selling products.
     */
    static async getFastestSelling(db, limit = 5) {
        const query = `
            SELECT s.sku_id, s.sku_code, s.color, s.size, st.base_price, COALESCE(SUM(oi.qty), 0) AS total_sold
            FROM skus s
            JOIN styles st ON s.style_id = st.style_id
            JOIN inventory i ON s.sku_id = i.sku_id
            LEFT JOIN order_items oi ON s.sku_id = oi.sku_id
            GROUP BY s.sku_id
            ORDER BY total_sold DESC
            LIMIT ?
        `;
        return await db.all(query, [limit]);
    }

    /**
     * Get products by filters like price bounds, categories, garments, colors, sizes.
     */
    static async getProductsByFilters(db, filters = {}) {
        let whereClauses = [];
        let params = [];

        const { color, size, garmentType, originalColor, maxPrice, minPrice, categoryName } = filters;
        const colorSearch = originalColor || color;
        if (colorSearch) {
            whereClauses.push('UPPER(s.color) LIKE ?');
            params.push(`%${colorSearch.toUpperCase()}%`);
        }
        if (size) {
            whereClauses.push('UPPER(s.size) = ?');
            params.push(size.toUpperCase());
        }
        if (garmentType) {
            whereClauses.push('(UPPER(s.sku_code) LIKE ? OR UPPER(st.name) LIKE ?)');
            params.push(`%${garmentType.toUpperCase()}%`, `%${garmentType.toUpperCase()}%`);
        }
        if (maxPrice !== undefined && maxPrice !== null) {
            whereClauses.push('st.base_price <= ?');
            params.push(maxPrice);
        }
        if (minPrice !== undefined && minPrice !== null) {
            whereClauses.push('st.base_price >= ?');
            params.push(minPrice);
        }
        if (categoryName) {
            whereClauses.push('UPPER(c.name) LIKE ?');
            params.push(`%${categoryName.toUpperCase()}%`);
        }

        const whereClauseStr = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';
        const query = `
            SELECT s.sku_id, s.sku_code, s.color, s.size, st.base_price, (i.physical_qty - i.reserved_qty) AS available_qty
            FROM skus s
            JOIN styles st ON s.style_id = st.style_id
            JOIN inventory i ON s.sku_id = i.sku_id
            LEFT JOIN sub_categories sc ON st.sub_category_id = sc.sub_category_id
            LEFT JOIN categories c ON sc.category_id = c.category_id
            ${whereClauseStr}
            LIMIT 10
        `;
        return await db.all(query, params);
    }
}

module.exports = InventoryService;
