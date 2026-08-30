const fs = require('fs');
const path = require('path');

const DB_FILE = path.join(__dirname, '..', 'mock_data', 'healthcare_db.json');

const SERVICES = [
    {
        id: '1',
        name: 'Nursing at Home',
        category: 'nursing',
        code: 'NURSE',
        icon: 'Stethoscope',
        basePrice: 800,
        priceDescription: '₹800 per visit / ₹1,500 for 12-hour shift',
        slots: ['09:00 AM', '11:00 AM', '02:00 PM', '05:00 PM', '08:00 PM'],
        description: 'Dressing, Injections, IV Infusion, Wound Care, Post-surgery Nursing.'
    },
    {
        id: '2',
        name: 'Caretaker at Home',
        category: 'caretaker',
        code: 'CARE',
        icon: 'UserCheck',
        basePrice: 1200,
        priceDescription: '₹1,200 / day (12 Hours) / ₹2,000 (24 Hours)',
        slots: ['08:00 AM Start', '08:00 PM Start (Night)', '24 Hours Shift'],
        description: 'Elderly assistance, Hygiene care, Feeding support, Mobility aid.'
    },
    {
        id: '3',
        name: 'Physiotherapy at Home',
        category: 'physio',
        code: 'PHYSIO',
        icon: 'Activity',
        basePrice: 900,
        priceDescription: '₹900 per 45-min session',
        slots: ['09:00 AM', '11:00 AM', '03:00 PM', '06:00 PM'],
        description: 'Stroke rehab, Joint pain, Post-fracture therapy, Back pain relief.'
    },
    {
        id: '4',
        name: 'Lab Test / Sample Collection',
        category: 'lab',
        code: 'LAB',
        icon: 'FlaskConical',
        basePrice: 500,
        priceDescription: 'Starting from ₹500 (Free home collection above ₹800)',
        slots: ['07:00 AM (Fasting)', '08:30 AM', '10:00 AM', '04:00 PM'],
        description: 'CBC, Diabetes Profile, Thyroid, Lipid, Blood Sugar, Full Body Checkup.'
    },
    {
        id: '5',
        name: 'ECG at Home',
        category: 'ecg',
        code: 'ECG',
        icon: 'HeartPulse',
        basePrice: 1100,
        priceDescription: '₹1,100 per test with instant report',
        slots: ['08:00 AM', '10:30 AM', '02:00 PM', '05:30 PM'],
        description: '12-Lead Digital ECG conducted at your doorstep by trained technician.'
    }
];

const STAFF_POOL = [
    { id: 'STF-101', name: 'Sister Anitha Sharma', role: 'Senior Staff Nurse', category: 'nursing', phone: '+91 98765 43210', rating: 4.9, available: true, location: '302001' },
    { id: 'STF-102', name: 'Dr. Rahul Verma (PT)', role: 'Senior Physiotherapist', category: 'physio', phone: '+91 98765 43211', rating: 4.8, available: true, location: '302012' },
    { id: 'STF-103', name: 'Ramesh Choudhary', role: 'Certified Caretaker', category: 'caretaker', phone: '+91 98765 43212', rating: 4.7, available: true, location: '302015' },
    { id: 'STF-104', name: 'Suresh Kumar', role: 'Lab Phlebotomist', category: 'lab', phone: '+91 98765 43213', rating: 4.9, available: true, location: '302004' },
    { id: 'STF-105', name: 'Priya Nair', role: 'ECG Specialist', category: 'ecg', phone: '+91 98765 43214', rating: 4.8, available: true, location: '302018' },
];

function loadDB() {
    try {
        if (fs.existsSync(DB_FILE)) {
            const raw = fs.readFileSync(DB_FILE, 'utf8');
            const data = JSON.parse(raw);
            return {
                bookings: Array.isArray(data.bookings) ? data.bookings : [],
                emergencyAlerts: Array.isArray(data.emergencyAlerts) ? data.emergencyAlerts : [],
                liveMessages: Array.isArray(data.liveMessages) ? data.liveMessages : []
            };
        }
    } catch (e) {
        console.error('[Healthcare DB Load Error]:', e.message);
    }
    return { bookings: [], emergencyAlerts: [], liveMessages: [] };
}

const initialDB = loadDB();
let BOOKINGS = initialDB.bookings;
let EMERGENCY_ALERTS = initialDB.emergencyAlerts;
let LIVE_WHATSAPP_MESSAGES = initialDB.liveMessages;

const CONVERSATION_STATES = {};

function saveDB() {
    try {
        const data = {
            bookings: BOOKINGS,
            emergencyAlerts: EMERGENCY_ALERTS,
            liveMessages: LIVE_WHATSAPP_MESSAGES
        };
        fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2), 'utf8');
    } catch (e) {
        console.error('[Healthcare DB Save Error]:', e.message);
    }
}

function getBookings() {
    return BOOKINGS;
}

function getLiveMessages() {
    return LIVE_WHATSAPP_MESSAGES;
}

function getEmergencyAlerts() {
    return EMERGENCY_ALERTS;
}

function addLiveWhatsAppMessage(phone, userMessage, botReplyText, displayName = null) {
    const cleanPhone = (phone || '').toString();
    const formattedName = displayName ? `${displayName} (${cleanPhone})` : `Patient (${cleanPhone || 'WhatsApp User'})`;
    const newMsg = {
        id: `MSG-${Math.floor(1000 + Math.random() * 9000)}`,
        phone: cleanPhone || '+91 WhatsApp Patient',
        senderName: formattedName,
        userMessage: userMessage || 'Message received',
        botReplyText: typeof botReplyText === 'string' ? botReplyText : (botReplyText ? botReplyText.text : 'Automated Reply Sent'),
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        status: 'Auto Replied'
    };

    LIVE_WHATSAPP_MESSAGES.unshift(newMsg);
    if (LIVE_WHATSAPP_MESSAGES.length > 100) {
        LIVE_WHATSAPP_MESSAGES.pop();
    }
    saveDB();
    return newMsg;
}

function addBooking(bookingData) {
    const prefixMap = { '1': 'NS', '2': 'CT', '3': 'PH', '4': 'LB', '5': 'EC' };
    const prefix = prefixMap[bookingData.serviceId] || 'BK';
    const randomId = `${prefix}-${Math.floor(10000 + Math.random() * 90000)}`;

    const newBooking = {
        id: randomId,
        ...bookingData,
        amount: bookingData.amount || 900,
        paymentStatus: bookingData.paymentStatus || 'Pending',
        status: 'Pending Assignment',
        assignedStaff: null,
        createdAt: new Date().toISOString()
    };

    BOOKINGS.unshift(newBooking);
    saveDB();
    return newBooking;
}

function updateBookingStatus(id, newStatus, staffId = null) {
    const booking = BOOKINGS.find(b => b.id === id);
    if (booking) {
        booking.status = newStatus;
        if (staffId) {
            const staff = STAFF_POOL.find(s => s.id === staffId);
            if (staff) {
                booking.assignedStaff = { id: staff.id, name: staff.name, phone: staff.phone };
            }
        }
        saveDB();
        return booking;
    }
    return null;
}

function addEmergencyAlert(alert) {
    const newAlert = {
        id: `EMG-${Math.floor(100 + Math.random() * 900)}`,
        timestamp: new Date().toISOString(),
        status: 'Urgent Clinical Escalation',
        ...alert
    };
    EMERGENCY_ALERTS.unshift(newAlert);
    saveDB();
    return newAlert;
}

module.exports = {
    SERVICES,
    STAFF_POOL,
    CONVERSATION_STATES,
    getBookings,
    getLiveMessages,
    getEmergencyAlerts,
    addLiveWhatsAppMessage,
    addBooking,
    updateBookingStatus,
    addEmergencyAlert
};
