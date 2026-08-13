// JS/Node.js Verification Runner for Stock-Query & Direct Gateway Checkout (No Credit, No Wallet)
// This mirrors the logic inside services/checkout.php to verify the B2B2C chatbot backend.

const COLOR_GREEN = "\x1b[32m";
const COLOR_RED = "\x1b[31m";
const COLOR_CYAN = "\x1b[36m";
const COLOR_RESET = "\x1b[0m";

function logMessage(color, msg) {
    console.log(color + msg + COLOR_RESET);
}

function assertEquals(expected, actual, message = "") {
    if (expected !== actual) {
        throw new Error(`Assertion Failed: ${message}. Expected: ${expected}, Got: ${actual}`);
    }
}

// Mock Database Tables
const db = {
    categories: [
        { category_id: 1, name: "Ethnic Wear" }
    ],
    sub_categories: [
        { sub_category_id: 1, category_id: 1, name: "Kurtis" }
    ],
    styles: [
        { style_id: 1, style_code: "KURTI-FESTIVE-01", name: "Festive Kurti", description: "Embroidered Festive Kurti", sub_category_id: 1, base_price: 500.00 }
    ],
    skus: [
        { sku_id: 1, style_id: 1, sku_code: "KURTI-FES-01-BLU-L", color: "Blue", size: "L", barcode: "8901234567890" }
    ],
    inventory: [
        { sku_id: 1, physical_qty: 50, reserved_qty: 0 } // Stock set to 50
    ],
    customer_tiers: [
        { tier_id: 1, tier_name: "VIP" }
    ],
    customers: [
        { customer_id: 1, name: "Aarav Wholesalers", phone: "919876543210", tier_id: 1 }
    ],
    tier_prices: [
        { style_id: 1, tier_id: 1, custom_price: 450.00 }
    ],
    schemes: [
        { 
            scheme_id: 1, 
            name: "Festive 10%", 
            scheme_type: "Percentage_Discount", 
            min_order_amount: 800.00, 
            min_order_qty: 0, 
            discount_value: 10.00, 
            start_date: "2026-08-01", 
            end_date: "2026-08-30", 
            is_active: 1 
        }
    ],
    sales_orders: [],
    order_items: [],
    online_payment_logs: []
};

// Checkout Service Class (JS equivalent of services/checkout.php)
class CheckoutService {
    
    // Simulates what the Bot does when answering stock inquiries
    queryStockAvailability(skuCode) {
        const sku = db.skus.find(s => s.sku_code === skuCode);
        if (!sku) return { available: false, qty: 0 };

        const inv = db.inventory.find(i => i.sku_id === sku.sku_id);
        const availableQty = inv.physical_qty - inv.reserved_qty;

        return {
            available: availableQty > 0,
            qty: availableQty,
            sku_id: sku.sku_id,
            sku_code: sku.sku_code,
            color: sku.color,
            size: sku.size
        };
    }

    processCheckout(customerId, items) {
        // 1. Fetch Customer details
        const customer = db.customers.find(c => c.customer_id === customerId);
        if (!customer) throw new Error("Customer not found");

        // 2. Fetch Pricing & Calculate Subtotal
        let subtotal = 0.00;
        let totalQty = 0;
        let validatedItems = [];

        for (const item of items) {
            const sku = db.skus.find(s => s.sku_id === item.sku_id);
            if (!sku) throw new Error("SKU not found");

            const inv = db.inventory.find(i => i.sku_id === item.sku_id);
            const availableQty = inv.physical_qty - inv.reserved_qty;
            if (availableQty < item.qty) {
                throw new Error(`Insufficient stock for SKU ${sku.sku_code}. Requested: ${item.qty}, Available: ${availableQty}`);
            }

            // Get Tier price
            const tierPrice = db.tier_prices.find(tp => tp.style_id === sku.style_id && tp.tier_id === customer.tier_id);
            const style = db.styles.find(st => st.style_id === sku.style_id);
            const price = tierPrice ? tierPrice.custom_price : style.base_price;

            subtotal += price * item.qty;
            totalQty += item.qty;

            validatedItems.push({
                sku_id: item.sku_id,
                qty: item.qty,
                price_per_item: price
            });
        }

        // 3. Apply active scheme
        let discount = 0.00;
        let appliedScheme = "None";
        const today = new Date().toISOString().split('T')[0];

        const scheme = db.schemes.find(s => s.is_active && s.start_date <= today && s.end_date >= today);
        if (scheme) {
            if (subtotal >= scheme.min_order_amount && totalQty >= scheme.min_order_qty) {
                if (scheme.scheme_type === "Percentage_Discount") {
                    discount = (subtotal * scheme.discount_value) / 100.00;
                } else if (scheme.scheme_type === "Flat_Discount") {
                    discount = scheme.discount_value;
                }
                appliedScheme = scheme.name;
            }
        }

        const finalTotal = Math.max(0.00, subtotal - discount);

        // 4. Calculate Payment Splits (100% Online)
        const splits = {
            total_to_pay: finalTotal,
            online: finalTotal
        };

        // 5. Update DB State
        const orderId = db.sales_orders.length + 1;
        const orderStatus = finalTotal > 0 ? "Pending_Payment" : "Pending_Approval";

        db.sales_orders.push({
            order_id: orderId,
            customer_id: customerId,
            order_status: orderStatus,
            total_amount: finalTotal
        });

        for (const item of validatedItems) {
            db.order_items.push({
                order_item_id: db.order_items.length + 1,
                order_id: orderId,
                sku_id: item.sku_id,
                qty: item.qty,
                price_per_item: item.price_per_item
            });

            // Reserve stock
            const inv = db.inventory.find(i => i.sku_id === item.sku_id);
            inv.reserved_qty += item.qty;
        }

        let onlinePaymentInfo = null;
        if (finalTotal > 0) {
            const gatewayOrderId = "order_gate_" + Math.random().toString(36).substring(7);
            db.online_payment_logs.push({
                payment_id: db.online_payment_logs.length + 1,
                order_id: orderId,
                gateway_name: "Razorpay",
                gateway_order_id: gatewayOrderId,
                amount: finalTotal,
                status: "Initiated"
            });

            onlinePaymentInfo = {
                gateway_order_id: gatewayOrderId,
                amount: finalTotal,
                checkout_url: `https://checkout.automatex.in/pay?order_id=${orderId}&gateway_id=${gatewayOrderId}&amount=${finalTotal}`
            };
        }

        return {
            success: true,
            order_id: orderId,
            customer_name: customer.name,
            subtotal: subtotal,
            discount: discount,
            final_total: finalTotal,
            scheme_applied: appliedScheme,
            splits: splits,
            order_status: orderStatus,
            online_payment: onlinePaymentInfo
        };
    }
}

// Run Test cases
try {
    const checkout = new CheckoutService();

    // Test Case 1: Bot Stock Inquiry
    logMessage(COLOR_CYAN, "=== TEST CASE 1: WhatsApp Bot Stock Inquiry ===");
    const stockQuery = checkout.queryStockAvailability("KURTI-FES-01-BLU-L");
    
    assertEquals(true, stockQuery.available, "Stock is available");
    assertEquals(50, stockQuery.qty, "Available quantity matches initial stock (50)");
    assertEquals("Blue", stockQuery.color, "Color matches");
    assertEquals("L", stockQuery.size, "Size matches");
    logMessage(COLOR_GREEN, "✓ TEST CASE 1 PASSED! (Stock counts returned correctly)\n");

    // Test Case 2: 100% Online Checkout
    logMessage(COLOR_CYAN, "=== TEST CASE 2: 100% Online Gateway Checkout ===");
    // Order 2 pieces. Cost = 2 * 450 = 900. Discount = 90. Total = 810.00.
    const orderItems = [{ sku_id: 1, qty: 2 }];
    const res2 = checkout.processCheckout(1, orderItems);

    assertEquals(true, res2.success, "Checkout succeeds");
    assertEquals(810.00, res2.final_total, "Net total is 810.00");
    assertEquals(810.00, res2.splits.online, "100% allocated to Online Payment");
    assertEquals("Pending_Payment", res2.order_status, "Order status initialized to Pending_Payment");
    assertEquals(true, !!res2.online_payment.checkout_url, "Checkout redirect link exists");
    
    // Verify inventory reservation (2 pieces reserved, available = 48)
    const stockAfterCheckout = checkout.queryStockAvailability("KURTI-FES-01-BLU-L");
    assertEquals(48, stockAfterCheckout.qty, "Available stock reduced to 48");

    // Verify payment logs
    const paymentLog = db.online_payment_logs.find(p => p.order_id === res2.order_id);
    assertEquals(810.00, paymentLog.amount, "Payment log registered for ₹810.00");
    assertEquals("Initiated", paymentLog.status, "Payment log status set to Initiated");
    logMessage(COLOR_GREEN, "✓ TEST CASE 2 PASSED! (Payment split and log success)\n");

    // Test Case 3: Out-of-Stock Guardrail
    logMessage(COLOR_CYAN, "=== TEST CASE 3: Out of Stock Guardrail ===");
    // Attempt to order 50 pieces (only 48 available now)
    try {
        checkout.processCheckout(1, [{ sku_id: 1, qty: 50 }]);
        throw new Error("Checkout should have failed due to stock exhaustion.");
    } catch (err) {
        if (err.message.includes("Insufficient stock")) {
            logMessage(COLOR_GREEN, "✓ TEST CASE 3 PASSED! (Engine blocked checkout due to insufficient stock)");
        } else {
            throw err;
        }
    }

    logMessage(COLOR_GREEN, "\n★ ALL JS CHECKOUT & CHATBOT ALGORITHM TESTS PASSED ★");

} catch (e) {
    logMessage(COLOR_RED, "✘ TEST SUITE RUNTIME ERROR: " + e.message);
    process.exit(1);
}
