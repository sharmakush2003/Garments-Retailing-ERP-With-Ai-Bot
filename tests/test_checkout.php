<?php

require_once __DIR__ . '/../services/checkout.php';

use Services\CheckoutService;

// Setup ANSI Colors for CLI
define('COLOR_GREEN', "\033[32m");
define('COLOR_RED', "\033[31m");
define('COLOR_CYAN', "\033[36m");
define('COLOR_RESET', "\033[0m");

function logMessage($color, $msg) {
    echo $color . $msg . COLOR_RESET . "\n";
}

function assertEquals($expected, $actual, $message = "") {
    if ($expected !== $actual) {
        $expectedStr = var_export($expected, true);
        $actualStr = var_export($actual, true);
        throw new Exception("Assertion Failed: $message. Expected: $expectedStr, Got: $actualStr");
    }
}

try {
    logMessage(COLOR_CYAN, "=== INITIALIZING MOCK IN-MEMORY TEST DATABASE ===");

    // Create in-memory SQLite Database connection
    $db = new PDO('sqlite::memory:');
    $db->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);

    // Create SQLite compatible schemas
    $db->exec("
        CREATE TABLE categories (
            category_id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL UNIQUE
        );

        CREATE TABLE sub_categories (
            sub_category_id INTEGER PRIMARY KEY AUTOINCREMENT,
            category_id INTEGER,
            name TEXT NOT NULL,
            FOREIGN KEY (category_id) REFERENCES categories(category_id)
        );

        CREATE TABLE styles (
            style_id INTEGER PRIMARY KEY AUTOINCREMENT,
            style_code TEXT UNIQUE NOT NULL,
            name TEXT NOT NULL,
            description TEXT,
            sub_category_id INTEGER,
            base_price REAL NOT NULL,
            FOREIGN KEY (sub_category_id) REFERENCES sub_categories(sub_category_id)
        );

        CREATE TABLE skus (
            sku_id INTEGER PRIMARY KEY AUTOINCREMENT,
            style_id INTEGER,
            sku_code TEXT UNIQUE NOT NULL,
            color TEXT NOT NULL,
            size TEXT NOT NULL,
            barcode TEXT UNIQUE,
            FOREIGN KEY (style_id) REFERENCES styles(style_id)
        );

        CREATE TABLE inventory (
            sku_id INTEGER PRIMARY KEY,
            physical_qty INTEGER NOT NULL DEFAULT 0,
            reserved_qty INTEGER NOT NULL DEFAULT 0,
            FOREIGN KEY (sku_id) REFERENCES skus(sku_id)
        );

        CREATE TABLE customer_tiers (
            tier_id INTEGER PRIMARY KEY AUTOINCREMENT,
            tier_name TEXT NOT NULL UNIQUE
        );

        CREATE TABLE customers (
            customer_id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            phone TEXT,
            tier_id INTEGER NOT NULL,
            FOREIGN KEY (tier_id) REFERENCES customer_tiers(tier_id)
        );

        CREATE TABLE tier_prices (
            style_id INTEGER,
            tier_id INTEGER,
            custom_price REAL NOT NULL,
            PRIMARY KEY (style_id, tier_id),
            FOREIGN KEY (style_id) REFERENCES styles(style_id),
            FOREIGN KEY (tier_id) REFERENCES customer_tiers(tier_id)
        );

        CREATE TABLE schemes (
            scheme_id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            scheme_type TEXT NOT NULL,
            min_order_amount REAL DEFAULT 0.00,
            min_order_qty INTEGER DEFAULT 0,
            discount_value REAL NOT NULL,
            start_date TEXT NOT NULL,
            end_date TEXT NOT NULL,
            is_active INTEGER DEFAULT 1
        );

        CREATE TABLE sales_orders (
            order_id INTEGER PRIMARY KEY AUTOINCREMENT,
            customer_id INTEGER,
            order_status TEXT DEFAULT 'Draft',
            total_amount REAL NOT NULL,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (customer_id) REFERENCES customers(customer_id)
        );

        CREATE TABLE order_items (
            order_item_id INTEGER PRIMARY KEY AUTOINCREMENT,
            order_id INTEGER,
            sku_id INTEGER,
            qty INTEGER NOT NULL,
            price_per_item REAL NOT NULL,
            FOREIGN KEY (order_id) REFERENCES sales_orders(order_id),
            FOREIGN KEY (sku_id) REFERENCES skus(sku_id)
        );

        CREATE TABLE online_payment_logs (
            payment_id INTEGER PRIMARY KEY AUTOINCREMENT,
            order_id INTEGER,
            gateway_name TEXT DEFAULT 'Razorpay',
            gateway_order_id TEXT NOT NULL,
            gateway_payment_id TEXT,
            amount REAL NOT NULL,
            status TEXT DEFAULT 'Initiated',
            raw_webhook_payload TEXT,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (order_id) REFERENCES sales_orders(order_id)
        );
    ");

    logMessage(COLOR_GREEN, "✓ Tables created successfully.");

    // Seed mock data
    logMessage(COLOR_CYAN, "=== SEEDING MOCK DATA ===");
    
    // Seed Categories
    $db->exec("INSERT INTO categories (name) VALUES ('Ethnic Wear')");
    $categoryId = $db->lastInsertId();

    $db->exec("INSERT INTO sub_categories (category_id, name) VALUES ($categoryId, 'Kurtis')");
    $subCategoryId = $db->lastInsertId();

    // Seed Styles
    $db->exec("INSERT INTO styles (style_code, name, description, sub_category_id, base_price) VALUES ('KURTI-FESTIVE-01', 'Festive Kurti', 'Embroidered Festive Kurti', $subCategoryId, 500.00)");
    $styleId = $db->lastInsertId();

    // Seed SKUs
    $db->exec("INSERT INTO skus (style_id, sku_code, color, size, barcode) VALUES ($styleId, 'KURTI-FES-01-BLU-L', 'Blue', 'L', '8901234567890')");
    $skuId = $db->lastInsertId();

    // Seed Inventory (Stock = 50)
    $db->exec("INSERT INTO inventory (sku_id, physical_qty, reserved_qty) VALUES ($skuId, 50, 0)");

    // Seed Customer Tiers
    $db->exec("INSERT INTO customer_tiers (tier_name) VALUES ('VIP')");
    $vipTierId = $db->lastInsertId();

    // Seed Tier Price
    $db->exec("INSERT INTO tier_prices (style_id, tier_id, custom_price) VALUES ($styleId, $vipTierId, 450.00)");

    // Seed Customer
    $db->exec("INSERT INTO customers (name, phone, tier_id) VALUES ('Aarav Wholesalers', '919876543210', $vipTierId)");
    $customerId = $db->lastInsertId();

    // Seed active Scheme (10% discount on orders above 800)
    $startDate = date('Y-m-d', strtotime('-1 day'));
    $endDate = date('Y-m-d', strtotime('+7 days'));
    $db->exec("INSERT INTO schemes (name, scheme_type, min_order_amount, min_order_qty, discount_value, start_date, end_date, is_active) VALUES ('Festive 10%', 'Percentage_Discount', 800.00, 0, 10.00, '$startDate', '$endDate', 1)");

    logMessage(COLOR_GREEN, "✓ Seeding complete.");

    // Instantiate checkout service
    $checkout = new CheckoutService($db);
    $orderItems = [['sku_id' => $skuId, 'qty' => 2]]; // Subtotal = 900. Scheme discount = 90. Net total = 810.00

    // ==========================================
    // TEST CASE 1: 100% ONLINE GATEWAY CHECKOUT
    // ==========================================
    logMessage(COLOR_CYAN, "\n=== TEST CASE 1: 100% Online Payment Checkout ===");
    
    $result1 = $checkout->processCheckout($customerId, $orderItems);

    assertEquals(true, $result1['success'], "Test Case 1: Order should succeed.");
    assertEquals(900.00, $result1['subtotal'], "Test Case 1: Subtotal is 900.00.");
    assertEquals(90.00, $result1['discount'], "Test Case 1: Scheme discount of 90.00.");
    assertEquals(810.00, $result1['final_total'], "Test Case 1: Net total is 810.00.");
    assertEquals(810.00, $result1['splits']['online'], "Test Case 1: 100% total routed online.");
    assertEquals('Pending_Payment', $result1['order_status'], "Test Case 1: Status is Pending_Payment.");
    assertEquals(true, isset($result1['online_payment']['checkout_url']), "Test Case 1: Online checkout URL generated.");

    // Verify inventory reservation in DB (reserved 2 pieces)
    $reservedQty = $db->query("SELECT reserved_qty FROM inventory WHERE sku_id = $skuId")->fetchColumn();
    assertEquals(2, (int)$reservedQty, "Test Case 1: Reserved inventory count updated to 2.");

    // Verify online payment log in DB
    $paymentLog = $db->query("SELECT amount, status FROM online_payment_logs WHERE order_id = " . $result1['order_id'])->fetch(PDO::FETCH_ASSOC);
    assertEquals(810.00, (float)$paymentLog['amount'], "Test Case 1: Payment log registered for 810.00.");
    assertEquals('Initiated', $paymentLog['status'], "Test Case 1: Online payment log status is 'Initiated'.");

    logMessage(COLOR_GREEN, "✓ TEST CASE 1 PASSED!");

    // ==========================================
    // TEST CASE 2: OUT OF STOCK GUARDRAILS
    // ==========================================
    logMessage(COLOR_CYAN, "\n=== TEST CASE 2: Out of Stock Checkout Block ===");
    
    // Available stock = 50 - 2 = 48. Ordering 50 should trigger exception
    try {
        $checkout->processCheckout($customerId, [['sku_id' => $skuId, 'qty' => 50]]);
        throw new Exception("Test Case 2: Checkout should have failed due to stock exhaustion.");
    } catch (Exception $e) {
        if (strpos($e->getMessage(), "Insufficient stock") !== false) {
            logMessage(COLOR_GREEN, "✓ TEST CASE 2 PASSED! (Insufficient stock throws exception)");
        } else {
            throw $e;
        }
    }

    logMessage(COLOR_CYAN, "\n=== ALL TEST CASES COMPLETED SUCCESSFULLY ===");

} catch (Exception $e) {
    logMessage(COLOR_RED, "\n✘ TEST SUITE RUNTIME EXCEPTION: " . $e->getMessage());
    exit(1);
}
