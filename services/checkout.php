<?php

namespace Services;

use PDO;
use Exception;

class CheckoutService {
    private $db;

    public function __construct(PDO $db) {
        $this->db = $db;
    }

    /**
     * Fetch products details, customer pricing tiers, apply active schemes, 
     * and calculate payment splits (100% Online Payment via Gateway).
     */
    public function processCheckout(int $customerId, array $items) {
        try {
            $this->db->beginTransaction();

            // 1. Fetch Customer details & Tier info
            $customer = $this->getCustomerDetails($customerId);
            if (!$customer) {
                throw new Exception("Customer with ID $customerId not found.");
            }

            $customerTierId = $customer['tier_id'];
            $customerName = $customer['name'];

            // 2. Fetch Item Pricing and calculate Subtotal
            $subtotal = 0.00;
            $totalQty = 0;
            $validatedItems = [];

            foreach ($items as $item) {
                $skuId = $item['sku_id'];
                $qty = $item['qty'];

                if ($qty <= 0) {
                    throw new Exception("Invalid quantity for SKU ID $skuId.");
                }

                // Check stock availability
                $stockInfo = $this->getSKUStock($skuId);
                if (!$stockInfo || $stockInfo['available_qty'] < $qty) {
                    throw new Exception("Insufficient stock for SKU: " . ($stockInfo['sku_code'] ?? $skuId) . ". Available: " . ($stockInfo['available_qty'] ?? 0));
                }

                // Get Custom Tier Price or Base Price
                $price = $this->getItemPrice($skuId, $customerTierId);
                $itemTotal = $price * $qty;
                
                $subtotal += $itemTotal;
                $totalQty += $qty;

                $validatedItems[] = [
                    'sku_id' => $skuId,
                    'qty' => $qty,
                    'price_per_item' => $price,
                    'available_qty' => $stockInfo['available_qty']
                ];
            }

            // 3. Find and apply the best active Scheme
            $schemeApplied = $this->applyActiveSchemes($customerId, $subtotal, $totalQty, $validatedItems);
            $discountAmount = $schemeApplied ? $schemeApplied['discount_amount'] : 0.00;
            $finalTotal = max(0.00, $subtotal - $discountAmount);

            // 4. Calculate Payment Splits (100% Online Payment)
            $paymentSplits = $this->calculatePaymentSplits($customerId, $finalTotal);

            // 5. Create the Sales Order record
            // Since it is 100% Online payment, order starts as Pending_Payment
            $orderStatus = 'Pending_Payment';
            $orderId = $this->insertSalesOrder($customerId, $orderStatus, $finalTotal);

            // 6. Insert Order Items and Reserve Stock (reserved_qty += qty)
            foreach ($validatedItems as $item) {
                $this->insertOrderItem($orderId, $item['sku_id'], $item['qty'], $item['price_per_item']);
                $this->reserveInventoryStock($item['sku_id'], $item['qty']);
            }

            // 7. Generate Online Payment Session
            $onlineGatewayInfo = null;
            if ($paymentSplits['online'] > 0) {
                $onlineGatewayInfo = $this->initializeOnlinePayment($orderId, $paymentSplits['online']);
            } else {
                // If the order total is ₹0 (e.g. 100% discount), bypass payment gateway
                $orderStatus = 'Pending_Approval';
                $this->updateOrderStatus($orderId, $orderStatus);
            }

            $this->db->commit();

            return [
                'success' => true,
                'order_id' => $orderId,
                'customer_name' => $customerName,
                'subtotal' => $subtotal,
                'discount' => $discountAmount,
                'final_total' => $finalTotal,
                'scheme_applied' => $schemeApplied ? $schemeApplied['name'] : 'None',
                'splits' => $paymentSplits,
                'order_status' => $orderStatus,
                'online_payment' => $onlineGatewayInfo
            ];

        } catch (Exception $e) {
            $this->db->rollBack();
            return [
                'success' => false,
                'error' => $e->getMessage()
            ];
        }
    }

    /**
     * Get Customer details and their tier.
     */
    private function getCustomerDetails(int $customerId) {
        $stmt = $this->db->prepare("SELECT customer_id, name, phone, tier_id FROM customers WHERE customer_id = ?");
        $stmt->execute([$customerId]);
        return $stmt->fetch(PDO::FETCH_ASSOC);
    }

    /**
     * Fetch SKU details and current stock.
     */
    private function getSKUStock(int $skuId) {
        $stmt = $this->db->prepare("
            SELECT s.sku_id, s.sku_code, i.physical_qty, i.reserved_qty, 
                   (i.physical_qty - i.reserved_qty) AS available_qty 
            FROM skus s
            JOIN inventory i ON s.sku_id = i.sku_id
            WHERE s.sku_id = ?
        ");
        $stmt->execute([$skuId]);
        return $stmt->fetch(PDO::FETCH_ASSOC);
    }

    /**
     * Get pricing based on customer tier. Fallback to base style price if custom tier price not set.
     */
    private function getItemPrice(int $skuId, int $tierId) {
        $stmt = $this->db->prepare("
            SELECT COALESCE(tp.custom_price, st.base_price) AS price
            FROM skus sk
            JOIN styles st ON sk.style_id = st.style_id
            LEFT JOIN tier_prices tp ON tp.style_id = st.style_id AND tp.tier_id = ?
            WHERE sk.sku_id = ?
        ");
        $stmt->execute([$tierId, $skuId]);
        $row = $stmt->fetch(PDO::FETCH_ASSOC);
        return $row ? (float)$row['price'] : 0.00;
    }

    /**
     * Determine best applicable marketing scheme for this checkout session.
     */
    private function applyActiveSchemes(int $customerId, float $subtotal, int $totalQty, array $items) {
        // Fetch all active schemes
        $today = date('Y-m-d');
        $stmt = $this->db->prepare("
            SELECT scheme_id, name, scheme_type, min_order_amount, min_order_qty, discount_value 
            FROM schemes 
            WHERE is_active = 1 AND start_date <= ? AND end_date >= ?
        ");
        $stmt->execute([$today, $today]);
        $schemes = $stmt->fetchAll(PDO::FETCH_ASSOC);

        $bestScheme = null;
        $maxDiscount = 0.00;

        foreach ($schemes as $scheme) {
            // Check threshold requirements
            if ($subtotal < (float)$scheme['min_order_amount'] || $totalQty < (int)$scheme['min_order_qty']) {
                continue;
            }

            $currentDiscount = 0.00;

            if ($scheme['scheme_type'] === 'Percentage_Discount') {
                $currentDiscount = ($subtotal * (float)$scheme['discount_value']) / 100.00;
            } elseif ($scheme['scheme_type'] === 'Flat_Discount') {
                $currentDiscount = (float)$scheme['discount_value'];
            } elseif ($scheme['scheme_type'] === 'Buy_X_Get_Y') {
                // Buy X get Y logic
                $factor = floor($totalQty / max(1, (int)$scheme['min_order_qty']));
                $currentDiscount = $factor * (float)$scheme['discount_value'];
            }

            if ($currentDiscount > $maxDiscount) {
                $maxDiscount = $currentDiscount;
                $bestScheme = [
                    'scheme_id' => $scheme['scheme_id'],
                    'name' => $scheme['name'],
                    'discount_amount' => $maxDiscount
                ];
            }
        }

        return $bestScheme;
    }

    /**
     * Calculate payment splits (100% online payment).
     */
    public function calculatePaymentSplits(int $customerId, float $finalTotal) {
        return [
            'total_to_pay' => $finalTotal,
            'online' => $finalTotal
        ];
    }

    /**
     * Database writing functions
     */
    private function insertSalesOrder(int $customerId, string $status, float $total) {
        $stmt = $this->db->prepare("INSERT INTO sales_orders (customer_id, order_status, total_amount) VALUES (?, ?, ?)");
        $stmt->execute([$customerId, $status, $total]);
        return (int)$this->db->lastInsertId();
    }

    private function updateOrderStatus(int $orderId, string $status) {
        $stmt = $this->db->prepare("UPDATE sales_orders SET order_status = ? WHERE order_id = ?");
        $stmt->execute([$status, $orderId]);
    }

    private function insertOrderItem(int $orderId, int $skuId, int $qty, float $price) {
        $stmt = $this->db->prepare("INSERT INTO order_items (order_id, sku_id, qty, price_per_item) VALUES (?, ?, ?, ?)");
        $stmt->execute([$orderId, $skuId, $qty, $price]);
    }

    private function reserveInventoryStock(int $skuId, int $qty) {
        $stmt = $this->db->prepare("UPDATE inventory SET reserved_qty = reserved_qty + ? WHERE sku_id = ?");
        $stmt->execute([$qty, $skuId]);
    }

    private function initializeOnlinePayment(int $orderId, float $amount) {
        $gatewayOrderId = "order_gate_" . bin2hex(random_bytes(6));
        
        $stmt = $this->db->prepare("
            INSERT INTO online_payment_logs (order_id, gateway_name, gateway_order_id, amount, status) 
            VALUES (?, 'Razorpay', ?, ?, 'Initiated')
        ");
        $stmt->execute([$orderId, $gatewayOrderId, $amount]);
        
        $paymentLogId = (int)$this->db->lastInsertId();

        // Generate payment checkout URL (mocked)
        return [
            'payment_log_id' => $paymentLogId,
            'gateway_order_id' => $gatewayOrderId,
            'amount' => $amount,
            'checkout_url' => "https://checkout.automatex.in/pay?order_id=$orderId&gateway_id=$gatewayOrderId&amount=$amount"
        ];
    }
}
