const sqlite3 = require('sqlite3').verbose();
const { open } = require('sqlite');
const mysql = require('mysql2/promise');

let masterDb = null;
const tenantDbs = {};

/**
 * MySQL Wrapper class to adapt mysql2 execution output
 * to match SQLite's helper API formats (.get, .all, .run).
 */
class MySQLWrapper {
    constructor(pool) {
        this.pool = pool;
    }

    /**
     * Executes query and returns the first row.
     */
    async get(sql, params = []) {
        const [rows] = await this.pool.execute(sql, params);
        return rows.length > 0 ? rows[0] : undefined;
    }

    /**
     * Executes query and returns all matching rows.
     */
    async all(sql, params = []) {
        const [rows] = await this.pool.execute(sql, params);
        return rows;
    }

    /**
     * Executes non-query statements and returns standard SQLite outcome.
     */
    async run(sql, params = []) {
        let cleanSql = sql;
        // Support SQLite-to-MySQL translation for transaction syntax
        if (sql.toUpperCase().includes('BEGIN TRANSACTION')) {
            cleanSql = 'START TRANSACTION';
        }
        const [result] = await this.pool.execute(cleanSql, params);
        return {
            lastID: result ? result.insertId : null,
            changes: result ? result.affectedRows : 0
        };
    }
}

/**
 * Returns connection to the master database.
 * Connects to MySQL if configured, otherwise falls back to a mocked SQLite instance.
 */
async function getMasterDb() {
    if (masterDb) return masterDb;
    
    const isMySQLConfigured = process.env.DB_HOST && process.env.DB_USER && process.env.DB_NAME;

    if (isMySQLConfigured) {
        console.log(`--- Connecting to Master MySQL Database on ${process.env.DB_HOST} ---`);
        const pool = mysql.createPool({
            host: process.env.DB_HOST,
            port: parseInt(process.env.DB_PORT || '3306'),
            user: process.env.DB_USER,
            password: process.env.DB_PASSWORD,
            database: process.env.DB_NAME,
            waitForConnections: true,
            connectionLimit: 10,
            queueLimit: 0
        });
        masterDb = new MySQLWrapper(pool);
        return masterDb;
    }

    // Local in-memory SQLite fallback
    masterDb = await open({
        filename: ':memory:',
        driver: sqlite3.Database
    });

    await masterDb.exec(`
        CREATE TABLE IF NOT EXISTS tenants (
            tenant_id VARCHAR(50) PRIMARY KEY,
            company_name VARCHAR(100) NOT NULL,
            db_host VARCHAR(100) NOT NULL,
            db_name VARCHAR(100) NOT NULL,
            db_user VARCHAR(100) NOT NULL,
            db_password_hash VARCHAR(255) NOT NULL,
            is_active BOOLEAN DEFAULT TRUE,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS tenant_whatsapp_users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            tenant_id VARCHAR(50),
            phone_number VARCHAR(15) UNIQUE,
            erp_customer_id INT,
            role TEXT CHECK(role IN ('Owner', 'Sales', 'Customer', 'Vendor')) NOT NULL,
            FOREIGN KEY (tenant_id) REFERENCES tenants(tenant_id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS whatsapp_sessions (
            sender_phone VARCHAR(20) PRIMARY KEY,
            verified_phone VARCHAR(20) NOT NULL,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
    `);

    // Seed master tenant mock records
    await masterDb.run(`
        INSERT OR IGNORE INTO tenants (tenant_id, company_name, db_host, db_name, db_user, db_password_hash)
        VALUES ('Co_102', 'Kaira', 'localhost', 'tenant_102', 'root', 'password')
    `);

    // Retailer customers registered on WhatsApp
    await masterDb.run(`
        INSERT OR IGNORE INTO tenant_whatsapp_users (tenant_id, phone_number, erp_customer_id, role)
        VALUES ('Co_102', '919045099111', 1, 'Customer')
    `);

    await masterDb.run(`
        INSERT OR IGNORE INTO tenant_whatsapp_users (tenant_id, phone_number, erp_customer_id, role)
        VALUES ('Co_102', '918233816674', 2, 'Customer')
    `);

    await masterDb.run(`
        INSERT OR IGNORE INTO tenant_whatsapp_users (tenant_id, phone_number, erp_customer_id, role)
        VALUES ('Co_102', '917425016636', null, 'Sales')
    `);

    // Owner registered on WhatsApp
    await masterDb.run(`
        INSERT OR IGNORE INTO tenant_whatsapp_users (tenant_id, phone_number, erp_customer_id, role)
        VALUES ('Co_102', '919876543210', null, 'Owner')
    `);

    return masterDb;
}

/**
 * Returns connection to a specific tenant's database.
 * Connects to MySQL if configured, otherwise falls back to a mocked SQLite instance.
 */
async function getTenantDb(tenantId) {
    if (tenantDbs[tenantId]) return tenantDbs[tenantId];

    const isMySQLConfigured = process.env.DB_HOST && process.env.DB_USER && process.env.DB_NAME;

    if (isMySQLConfigured) {
        console.log(`--- Resolving Tenant ${tenantId} via MySQL ---`);
        const master = await getMasterDb();
        const tenantConfig = await master.get(
            'SELECT tenant_id, db_host, db_name, db_user, db_password_hash FROM tenants WHERE tenant_id = ? AND is_active = 1',
            [tenantId]
        );

        if (!tenantConfig) {
            throw new Error(`Active tenant ${tenantId} not found in master records.`);
        }

        const pool = mysql.createPool({
            host: tenantConfig.db_host || process.env.DB_HOST,
            port: parseInt(process.env.DB_PORT || '3306'),
            user: tenantConfig.db_user || process.env.DB_USER,
            password: tenantConfig.db_password_hash || process.env.DB_PASSWORD,
            database: tenantConfig.db_name,
            waitForConnections: true,
            connectionLimit: 10,
            queueLimit: 0
        });

        const db = new MySQLWrapper(pool);
        tenantDbs[tenantId] = db;
        return db;
    }

    // Local in-memory SQLite fallback
    const db = await open({
        filename: ':memory:',
        driver: sqlite3.Database
    });

    await db.exec(`
        CREATE TABLE IF NOT EXISTS categories (
            category_id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL UNIQUE
        );

        CREATE TABLE IF NOT EXISTS sub_categories (
            sub_category_id INTEGER PRIMARY KEY AUTOINCREMENT,
            category_id INTEGER,
            name TEXT NOT NULL,
            FOREIGN KEY (category_id) REFERENCES categories(category_id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS styles (
            style_id INTEGER PRIMARY KEY AUTOINCREMENT,
            style_code TEXT UNIQUE NOT NULL,
            name TEXT NOT NULL,
            description TEXT,
            sub_category_id INTEGER,
            base_price REAL NOT NULL,
            FOREIGN KEY (sub_category_id) REFERENCES sub_categories(sub_category_id)
        );

        CREATE TABLE IF NOT EXISTS skus (
            sku_id INTEGER PRIMARY KEY AUTOINCREMENT,
            style_id INTEGER,
            sku_code TEXT UNIQUE NOT NULL,
            color TEXT NOT NULL,
            size TEXT NOT NULL,
            barcode TEXT UNIQUE,
            FOREIGN KEY (style_id) REFERENCES styles(style_id)
        );

        CREATE TABLE IF NOT EXISTS inventory (
            sku_id INTEGER PRIMARY KEY,
            physical_qty INTEGER NOT NULL DEFAULT 0,
            reserved_qty INTEGER NOT NULL DEFAULT 0,
            reorder_level INTEGER DEFAULT 10,
            FOREIGN KEY (sku_id) REFERENCES skus(sku_id)
        );

        CREATE TABLE IF NOT EXISTS customer_tiers (
            tier_id INTEGER PRIMARY KEY AUTOINCREMENT,
            tier_name TEXT CHECK(tier_name IN ('Dealer', 'Distributor', 'Retailer', 'VIP')) NOT NULL UNIQUE
        );

        CREATE TABLE IF NOT EXISTS customers (
            customer_id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            phone TEXT,
            tier_id INTEGER NOT NULL,
            credit_limit REAL DEFAULT 500000.00,
            used_credit REAL DEFAULT 0.00,
            outstanding_balance REAL DEFAULT 0.00,
            FOREIGN KEY (tier_id) REFERENCES customer_tiers(tier_id)
        );

        CREATE TABLE IF NOT EXISTS tier_prices (
            style_id INTEGER,
            tier_id INTEGER,
            custom_price REAL NOT NULL,
            PRIMARY KEY (style_id, tier_id),
            FOREIGN KEY (style_id) REFERENCES styles(style_id) ON DELETE CASCADE,
            FOREIGN KEY (tier_id) REFERENCES customer_tiers(tier_id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS schemes (
            scheme_id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            scheme_type TEXT CHECK(scheme_type IN ('Percentage_Discount', 'Flat_Discount', 'Buy_X_Get_Y')) NOT NULL,
            min_order_amount REAL DEFAULT 0.00,
            min_order_qty INTEGER DEFAULT 0,
            discount_value REAL NOT NULL,
            start_date TEXT NOT NULL,
            end_date TEXT NOT NULL,
            is_active INTEGER DEFAULT 1
        );

        CREATE TABLE IF NOT EXISTS sales_orders (
            order_id INTEGER PRIMARY KEY AUTOINCREMENT,
            customer_id INTEGER NOT NULL,
            order_status TEXT CHECK(order_status IN ('Draft', 'Pending_Payment', 'Pending_Approval', 'Approved', 'Packed', 'Dispatched', 'Cancelled')) DEFAULT 'Draft',
            total_amount REAL NOT NULL DEFAULT 0.00,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (customer_id) REFERENCES customers(customer_id)
        );

        CREATE TABLE IF NOT EXISTS order_items (
            order_item_id INTEGER PRIMARY KEY AUTOINCREMENT,
            order_id INTEGER NOT NULL,
            sku_id INTEGER NOT NULL,
            qty INTEGER NOT NULL,
            price_per_item REAL NOT NULL,
            FOREIGN KEY (order_id) REFERENCES sales_orders(order_id) ON DELETE CASCADE,
            FOREIGN KEY (sku_id) REFERENCES skus(sku_id) ON DELETE RESTRICT
        );

        CREATE TABLE IF NOT EXISTS order_dispatches (
            dispatch_id INTEGER PRIMARY KEY AUTOINCREMENT,
            order_id INTEGER NOT NULL,
            transporter_name TEXT NOT NULL,
            lr_number TEXT NOT NULL,
            dispatch_date TEXT NOT NULL,
            estimated_delivery TEXT,
            status TEXT CHECK(status IN ('Packed', 'Dispatched', 'Delivered')) DEFAULT 'Packed',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (order_id) REFERENCES sales_orders(order_id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS financial_transactions (
            txn_id INTEGER PRIMARY KEY AUTOINCREMENT,
            customer_id INTEGER NOT NULL,
            txn_type TEXT CHECK(txn_type IN ('Invoice', 'Payment', 'Return_Credit')) NOT NULL,
            amount REAL NOT NULL,
            reference_id TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (customer_id) REFERENCES customers(customer_id)
        );

        CREATE TABLE IF NOT EXISTS online_payment_logs (
            payment_id INTEGER PRIMARY KEY AUTOINCREMENT,
            order_id INTEGER NOT NULL,
            gateway_name TEXT DEFAULT 'Razorpay',
            gateway_order_id TEXT NOT NULL,
            gateway_payment_id TEXT,
            amount REAL NOT NULL,
            status TEXT CHECK(status IN ('Initiated', 'Success', 'Failed', 'Refunded')) DEFAULT 'Initiated',
            raw_webhook_payload TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (order_id) REFERENCES sales_orders(order_id) ON DELETE CASCADE
        );
    `);

    // Seed mock data for tenant database
    await db.exec(`
        -- Categories & Sub-categories
        INSERT OR IGNORE INTO categories (category_id, name) VALUES (1, 'Ethnic Wear');
        INSERT OR IGNORE INTO categories (category_id, name) VALUES (2, 'Western Wear');
        INSERT OR IGNORE INTO sub_categories (sub_category_id, category_id, name) VALUES (1, 1, 'Kurtis');
        INSERT OR IGNORE INTO sub_categories (sub_category_id, category_id, name) VALUES (2, 1, 'Sarees');
        INSERT OR IGNORE INTO sub_categories (sub_category_id, category_id, name) VALUES (3, 2, 'Shirts');
        INSERT OR IGNORE INTO sub_categories (sub_category_id, category_id, name) VALUES (4, 2, 'Pants');

        -- Styles
        INSERT OR IGNORE INTO styles (style_id, style_code, name, description, sub_category_id, base_price) 
        VALUES (1, 'KURTI-FESTIVE-01', 'Festive Kurti', 'Embroidered Festive Designer Kurti', 1, 500.00);
        INSERT OR IGNORE INTO styles (style_id, style_code, name, description, sub_category_id, base_price) 
        VALUES (2, 'SAREE-SILK-02', 'Silk Saree', 'Traditional Pure Silk Saree', 2, 1200.00);
        INSERT OR IGNORE INTO styles (style_id, style_code, name, description, sub_category_id, base_price) 
        VALUES (3, 'SHIRT-COTTON-01', 'Formal Cotton Shirt', '100% Premium Cotton Slim Fit Shirt', 3, 450.00);
        INSERT OR IGNORE INTO styles (style_id, style_code, name, description, sub_category_id, base_price) 
        VALUES (4, 'PANT-DENIM-01', 'Denim Trousers', 'Stretchable Slim Fit Denim Jeans', 4, 750.00);

        -- SKUs & Inventory
        INSERT OR IGNORE INTO skus (sku_id, style_id, sku_code, color, size, barcode) 
        VALUES (1, 1, 'KURTI-FES-01-BLU-L', 'Blue', 'L', '8901234567890');
        INSERT OR IGNORE INTO inventory (sku_id, physical_qty, reserved_qty, reorder_level) VALUES (1, 50, 0, 5);

        INSERT OR IGNORE INTO skus (sku_id, style_id, sku_code, color, size, barcode) 
        VALUES (2, 1, 'KURTI-FES-01-RED-M', 'Red', 'M', '8901234567891');
        INSERT OR IGNORE INTO inventory (sku_id, physical_qty, reserved_qty, reorder_level) VALUES (2, 35, 0, 5);

        INSERT OR IGNORE INTO skus (sku_id, style_id, sku_code, color, size, barcode) 
        VALUES (3, 1, 'KURTI-FES-01-GRN-S', 'Green', 'S', '8901234567892');
        INSERT OR IGNORE INTO inventory (sku_id, physical_qty, reserved_qty, reorder_level) VALUES (3, 20, 0, 5);

        INSERT OR IGNORE INTO skus (sku_id, style_id, sku_code, color, size, barcode) 
        VALUES (4, 2, 'SAREE-SIL-02-RED-FS', 'Red', 'Free Size', '8901234567893');
        INSERT OR IGNORE INTO inventory (sku_id, physical_qty, reserved_qty, reorder_level) VALUES (4, 15, 0, 3);

        INSERT OR IGNORE INTO skus (sku_id, style_id, sku_code, color, size, barcode) 
        VALUES (5, 3, 'SHIRT-COT-01-WHT-L', 'White', 'L', '8901234567894');
        INSERT OR IGNORE INTO inventory (sku_id, physical_qty, reserved_qty, reorder_level) VALUES (5, 40, 0, 5);

        INSERT OR IGNORE INTO skus (sku_id, style_id, sku_code, color, size, barcode) 
        VALUES (6, 3, 'SHIRT-COT-01-BLK-XL', 'Black', 'XL', '8901234567895');
        INSERT OR IGNORE INTO inventory (sku_id, physical_qty, reserved_qty, reorder_level) VALUES (6, 25, 0, 5);

        INSERT OR IGNORE INTO skus (sku_id, style_id, sku_code, color, size, barcode) 
        VALUES (7, 4, 'PANT-DEN-01-BLU-L', 'Blue', 'L', '8901234567896');
        INSERT OR IGNORE INTO inventory (sku_id, physical_qty, reserved_qty, reorder_level) VALUES (7, 30, 0, 5);

        -- Customer Tiers & Customers
        INSERT OR IGNORE INTO customer_tiers (tier_id, tier_name) VALUES (1, 'VIP');
        INSERT OR IGNORE INTO customer_tiers (tier_id, tier_name) VALUES (2, 'Retailer');

        INSERT OR IGNORE INTO customers (customer_id, name, phone, tier_id, credit_limit, used_credit, outstanding_balance) 
        VALUES (1, 'Aarav Wholesalers', '919045099111', 1, 500000.00, 360000.00, 128450.00);

        INSERT OR IGNORE INTO customers (customer_id, name, phone, tier_id, credit_limit, used_credit, outstanding_balance) 
        VALUES (2, 'Kush Sharma Retailers', '917425016636', 2, 250000.00, 110000.00, 45600.00);

        -- Tier Pricing
        INSERT OR IGNORE INTO tier_prices (style_id, tier_id, custom_price) VALUES (1, 1, 450.00);
        INSERT OR IGNORE INTO tier_prices (style_id, tier_id, custom_price) VALUES (1, 2, 480.00);
        INSERT OR IGNORE INTO tier_prices (style_id, tier_id, custom_price) VALUES (3, 1, 400.00);
        INSERT OR IGNORE INTO tier_prices (style_id, tier_id, custom_price) VALUES (3, 2, 420.00);
        
        -- Active Schemes
        INSERT OR IGNORE INTO schemes (scheme_id, name, scheme_type, min_order_amount, min_order_qty, discount_value, start_date, end_date, is_active)
        VALUES (1, 'Festive 10%', 'Percentage_Discount', 800.00, 0, 10.00, '2026-08-01', '2026-08-30', 1);
    `);

    tenantDbs[tenantId] = db;
    return db;
}

module.exports = {
    getMasterDb,
    getTenantDb
};
