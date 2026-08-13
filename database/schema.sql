-- Digify Soft ERP - Comprehensive Database Schema (No Wallets, No Credit)
-- Includes Master configurations and Tenant databases

-- ==========================================
-- 1. MASTER DATABASE CONFIGURATION
-- ==========================================
CREATE DATABASE IF NOT EXISTS digify_master;
USE digify_master;

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
    id INT AUTO_INCREMENT PRIMARY KEY,
    tenant_id VARCHAR(50),
    phone_number VARCHAR(15) UNIQUE,
    erp_customer_id INT, -- Maps to customer_id inside the tenant's db
    role ENUM('Owner', 'Sales', 'Customer', 'Vendor') NOT NULL,
    FOREIGN KEY (tenant_id) REFERENCES tenants(tenant_id) ON DELETE CASCADE
);

-- ==========================================
-- 2. TENANT DATABASE TEMPLATE
-- ==========================================
-- NOTE: For production, this runs inside each tenant's isolated DB (e.g., tenant_xxxx)
-- We include it in a single script for reference and local environment setup.

CREATE DATABASE IF NOT EXISTS tenant_default;
USE tenant_default;

-- A. Catalog Hierarchy & Style Management
CREATE TABLE IF NOT EXISTS categories (
    category_id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL UNIQUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS sub_categories (
    sub_category_id INT AUTO_INCREMENT PRIMARY KEY,
    category_id INT NOT NULL,
    name VARCHAR(100) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (category_id) REFERENCES categories(category_id) ON DELETE CASCADE,
    UNIQUE KEY uq_cat_sub (category_id, name)
);

CREATE TABLE IF NOT EXISTS styles (
    style_id INT AUTO_INCREMENT PRIMARY KEY,
    style_code VARCHAR(50) UNIQUE NOT NULL, -- e.g., 'SHIRT-COTTON-02'
    name VARCHAR(100) NOT NULL,
    description TEXT,
    sub_category_id INT NOT NULL,
    base_price DECIMAL(10,2) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (sub_category_id) REFERENCES sub_categories(sub_category_id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS skus (
    sku_id INT AUTO_INCREMENT PRIMARY KEY,
    style_id INT NOT NULL,
    sku_code VARCHAR(100) UNIQUE NOT NULL, -- e.g., 'SHIRT-COT-02-WHT-XL'
    color VARCHAR(30) NOT NULL,
    size VARCHAR(10) NOT NULL,
    barcode VARCHAR(50) UNIQUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (style_id) REFERENCES styles(style_id) ON DELETE CASCADE
);

-- B. Inventory Control
CREATE TABLE IF NOT EXISTS inventory (
    sku_id INT PRIMARY KEY,
    physical_qty INT NOT NULL DEFAULT 0,
    reserved_qty INT NOT NULL DEFAULT 0,
    available_qty INT GENERATED ALWAYS AS (physical_qty - reserved_qty) STORED,
    reorder_level INT DEFAULT 10,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (sku_id) REFERENCES skus(sku_id) ON DELETE CASCADE
);

-- C. Customer & Pricing Tier Management
CREATE TABLE IF NOT EXISTS customer_tiers (
    tier_id INT AUTO_INCREMENT PRIMARY KEY,
    tier_name ENUM('Dealer', 'Distributor', 'Retailer', 'VIP') NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS customers (
    customer_id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    phone VARCHAR(15),
    tier_id INT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (tier_id) REFERENCES customer_tiers(tier_id)
);

CREATE TABLE IF NOT EXISTS tier_prices (
    style_id INT NOT NULL,
    tier_id INT NOT NULL,
    custom_price DECIMAL(10,2) NOT NULL,
    PRIMARY KEY (style_id, tier_id),
    FOREIGN KEY (style_id) REFERENCES styles(style_id) ON DELETE CASCADE,
    FOREIGN KEY (tier_id) REFERENCES customer_tiers(tier_id) ON DELETE CASCADE
);

-- D. Schemes Engine
CREATE TABLE IF NOT EXISTS schemes (
    scheme_id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(150) NOT NULL,
    scheme_type ENUM('Percentage_Discount', 'Flat_Discount', 'Buy_X_Get_Y') NOT NULL,
    min_order_amount DECIMAL(10,2) DEFAULT 0.00,
    min_order_qty INT DEFAULT 0,
    discount_value DECIMAL(10,2) NOT NULL, -- Percentage (e.g. 10.00 for 10%) or Flat (e.g. 500.00)
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- E. Order Management & Invoicing
CREATE TABLE IF NOT EXISTS sales_orders (
    order_id INT AUTO_INCREMENT PRIMARY KEY,
    customer_id INT NOT NULL,
    order_status ENUM('Draft', 'Pending_Payment', 'Pending_Approval', 'Approved', 'Packed', 'Dispatched', 'Cancelled') DEFAULT 'Draft',
    total_amount DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (customer_id) REFERENCES customers(customer_id)
);

CREATE TABLE IF NOT EXISTS order_items (
    order_item_id INT AUTO_INCREMENT PRIMARY KEY,
    order_id INT NOT NULL,
    sku_id INT NOT NULL,
    qty INT NOT NULL,
    price_per_item DECIMAL(10,2) NOT NULL,
    FOREIGN KEY (order_id) REFERENCES sales_orders(order_id) ON DELETE CASCADE,
    FOREIGN KEY (sku_id) REFERENCES skus(sku_id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS order_dispatches (
    dispatch_id INT AUTO_INCREMENT PRIMARY KEY,
    order_id INT NOT NULL,
    transporter_name VARCHAR(150) NOT NULL,
    lr_number VARCHAR(100) NOT NULL, -- Lorry Receipt (LR) Number
    dispatch_date DATE NOT NULL,
    estimated_delivery DATE,
    status ENUM('Packed', 'Dispatched', 'Delivered') DEFAULT 'Packed',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (order_id) REFERENCES sales_orders(order_id) ON DELETE CASCADE
);


-- F. Customer Financial System (General Ledger)
CREATE TABLE IF NOT EXISTS financial_transactions (
    txn_id INT AUTO_INCREMENT PRIMARY KEY,
    customer_id INT NOT NULL,
    txn_type ENUM('Invoice', 'Payment', 'Return_Credit') NOT NULL,
    amount DECIMAL(10,2) NOT NULL,
    reference_id VARCHAR(50), -- Invoice ID or Receipt Number
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (customer_id) REFERENCES customers(customer_id)
);

-- G. Online Payments Tracking
CREATE TABLE IF NOT EXISTS online_payment_logs (
    payment_id INT AUTO_INCREMENT PRIMARY KEY,
    order_id INT NOT NULL,
    gateway_name VARCHAR(50) DEFAULT 'Razorpay',
    gateway_order_id VARCHAR(100) NOT NULL,
    gateway_payment_id VARCHAR(100) NULL,
    amount DECIMAL(10,2) NOT NULL,
    status ENUM('Initiated', 'Success', 'Failed', 'Refunded') DEFAULT 'Initiated',
    raw_webhook_payload JSON NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (order_id) REFERENCES sales_orders(order_id) ON DELETE CASCADE
);

-- H. Purchase & Vendor Management
CREATE TABLE IF NOT EXISTS vendors (
    vendor_id INT AUTO_INCREMENT PRIMARY KEY,
    company_name VARCHAR(150) NOT NULL,
    contact_name VARCHAR(100),
    phone VARCHAR(15),
    gstin VARCHAR(15),
    outstanding_payable DECIMAL(10,2) DEFAULT 0.00,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS purchase_orders (
    purchase_order_id INT AUTO_INCREMENT PRIMARY KEY,
    vendor_id INT NOT NULL,
    status ENUM('Draft', 'Ordered', 'Received', 'Cancelled') DEFAULT 'Draft',
    total_amount DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (vendor_id) REFERENCES vendors(vendor_id)
);

CREATE TABLE IF NOT EXISTS purchase_order_items (
    po_item_id INT AUTO_INCREMENT PRIMARY KEY,
    purchase_order_id INT NOT NULL,
    sku_id INT NOT NULL,
    qty INT NOT NULL,
    price_per_item DECIMAL(10,2) NOT NULL,
    FOREIGN KEY (purchase_order_id) REFERENCES purchase_orders(purchase_order_id) ON DELETE CASCADE,
    FOREIGN KEY (sku_id) REFERENCES skus(sku_id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS vendor_ledger (
    txn_id INT AUTO_INCREMENT PRIMARY KEY,
    vendor_id INT NOT NULL,
    txn_type ENUM('Purchase_Invoice', 'Payment_Made', 'Purchase_Return') NOT NULL,
    amount DECIMAL(10,2) NOT NULL,
    reference_no VARCHAR(100), -- Bill/PO number or transaction reference
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (vendor_id) REFERENCES vendors(vendor_id) ON DELETE CASCADE
);
