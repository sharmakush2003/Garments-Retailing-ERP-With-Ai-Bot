const { processMessageJob, userBotMode, getMainSelectionMenu, getGarmentsWelcomeMenu } = require('../workers/messageWorker');
const axios = require('axios');

// Mock axios.post to intercept outbound WhatsApp messages for testing
const capturedMessages = [];
const originalPost = axios.post;

axios.post = async function (url, payload, config) {
    if (url.includes('messages')) {
        const bodyText = payload.text ? payload.text.body : (payload.interactive ? JSON.stringify(payload.interactive) : '');
        capturedMessages.push({
            to: payload.to,
            type: payload.type,
            body: bodyText,
            doc: payload.document
        });
        return { data: { status: 'sent', message_id: 'test_msg_123' } };
    }
    return originalPost(url, payload, config);
};

async function runTests() {
    console.log('========================================================');
    console.log('🧪 RUNNING DUAL-BOT ROUTER INTEGRATION TESTS');
    console.log('========================================================\n');

    const testPhone = '919876543299';
    const tenantContext = { tenantId: 'Co_102', role: 'Customer', customerId: 1 };

    function getLastMessage() {
        return capturedMessages[capturedMessages.length - 1];
    }

    async function sendMsg(text) {
        console.log(`\n💬 [User -> Bot]: "${text}"`);
        await processMessageJob({
            phoneNumber: testPhone,
            fallbackPhone: null,
            messageText: text,
            isAudio: false,
            tenantContext
        });
        const last = getLastMessage();
        console.log(`🤖 [Bot -> User Reply]:\n${last ? last.body : '[No message sent]'}\n`);
        return last;
    }

    let passCount = 0;
    let totalCount = 0;

    function assert(condition, message) {
        totalCount++;
        if (condition) {
            console.log(`✅ PASS: ${message}`);
            passCount++;
        } else {
            console.error(`❌ FAIL: ${message}`);
        }
    }

    // 1. Send "Hi" -> Expect Main Selection Menu
    console.log('--- TEST 1: Greeting triggers Main Selection Menu ---');
    let res = await sendMsg('Hi');
    assert(res && res.body.includes('Welcome to Digify Multi-Service Assistant') && res.body.includes('Healthcare & Medical') && res.body.includes('Garments Retailing ERP'), 'Main Menu returned on Hi');

    // 2. Select Option 1 (Healthcare) -> Expect Healthcare Service Menu
    console.log('\n--- TEST 2: Select Option 1 (Healthcare) ---');
    res = await sendMsg('1');
    assert(userBotMode[testPhone] === 'HEALTHCARE', 'User session mode set to HEALTHCARE');
    assert(res && res.body.includes('Health Saathi') && res.body.includes('Nursing at Home') && res.body.includes('Physiotherapy'), 'Healthcare menu displayed');

    // 3. Healthcare Flow: Select Service 1 (Nursing at Home)
    console.log('\n--- TEST 3: Healthcare Flow - Step 1 Select Nursing ---');
    res = await sendMsg('1');
    assert(res && res.body.includes('SELECTED SERVICE') && res.body.includes('Nursing at Home') && res.body.includes('Pincode'), 'Prompt for Pincode');

    // 4. Healthcare Flow: Provide Pincode
    console.log('\n--- TEST 4: Healthcare Flow - Step 2 Provide Pincode ---');
    res = await sendMsg('302012');
    assert(res && res.body.includes('Location Recorded') && res.body.includes('302012') && res.body.includes('PREFERRED DATE'), 'Prompt for Date');

    // 5. Healthcare Flow: Provide Date
    console.log('\n--- TEST 5: Healthcare Flow - Step 3 Provide Date ---');
    res = await sendMsg('1');
    assert(res && res.body.includes('Date Reserved') && res.body.includes('Today') && res.body.toLowerCase().includes('time slot'), 'Prompt for Slot');

    // 6. Healthcare Flow: Select Slot
    console.log('\n--- TEST 6: Healthcare Flow - Step 4 Select Slot ---');
    res = await sendMsg('1');
    assert(res && res.body.includes('Time Slot Reserved') && res.body.includes('09:00 AM') && res.body.toLowerCase().includes('patient details'), 'Prompt for Patient Name & Age');

    // 7. Healthcare Flow: Patient Details
    console.log('\n--- TEST 7: Healthcare Flow - Step 5 Patient Details ---');
    res = await sendMsg('Rajesh Sharma, 58 yrs');
    assert(res && res.body.includes('BOOKING QUOTATION') && res.body.includes('Rajesh Sharma, 58 yrs') && res.body.includes('Confirm & Book Now'), 'Quotation displayed');

    // 8. Healthcare Flow: Confirm Booking
    console.log('\n--- TEST 8: Healthcare Flow - Step 6 Confirm Booking ---');
    res = await sendMsg('1');
    assert(res && res.body.includes('BOOKING RECEIVED & PENDING ALLOCATION') && res.body.includes('Booking ID'), 'Booking confirmed with ID');

    // 9. Switch back using "0" or "menu"
    console.log('\n--- TEST 9: Reset / Switch to Main Menu via "menu" ---');
    res = await sendMsg('menu');
    assert(userBotMode[testPhone] === null, 'Session reset to null');
    assert(res && res.body.includes('Welcome to Digify Multi-Service Assistant'), 'Main Menu shown again');

    // 10. Select Option 2 (Garments Retailing ERP)
    console.log('\n--- TEST 10: Select Option 2 (Garments ERP) ---');
    res = await sendMsg('2');
    assert(userBotMode[testPhone] === 'GARMENTS', 'User session mode set to GARMENTS');
    assert(res && res.body.includes('Garments Retailing ERP Assistant') && res.body.includes('Check Stock Availability'), 'Garments ERP menu displayed');

    // 11. In Garments mode: Check stock for Kurti
    console.log('\n--- TEST 11: In Garments mode - Check stock ---');
    res = await sendMsg('Check stock for blue kurti size L');
    assert(res && (res.body.includes('Stock Status') || res.body.includes('SKU') || res.body.includes('Available') || res.body.includes('Kurti') || res.body.includes('Blue')), 'Stock availability result returned');

    // 12. In Garments mode: Track shipment without identifier -> prompts for order/dispatch ID
    console.log('\n--- TEST 12: In Garments mode - Shipment tracking prompt ---');
    res = await sendMsg('Track my shipment');
    assert(res && (res.body.includes('Order ID') || res.body.includes('Dispatch ID') || res.body.includes('Tracking')), 'Prompt for Order/Dispatch ID returned');

    // 13. Switch from Garments mode using "switch"
    console.log('\n--- TEST 13: Switch back to Main Menu using "switch" ---');
    res = await sendMsg('switch');
    assert(userBotMode[testPhone] === null, 'Session reset to null on switch');
    assert(res && res.body.includes('Welcome to Digify Multi-Service Assistant'), 'Main Menu shown');

    console.log('\n========================================================');
    console.log(`🏁 TEST RESULTS: ${passCount} / ${totalCount} PASSED`);
    console.log('========================================================\n');

    process.exit(passCount === totalCount ? 0 : 1);
}

runTests().catch(err => {
    console.error('Test execution failed:', err);
    process.exit(1);
});
