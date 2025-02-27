require('dotenv').config();
const express = require('express');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const bodyParser = require('body-parser');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(bodyParser.json());

// 🕐 Function to get the first day of next month
function getNextMonthTimestamp() {
    const now = new Date();
    return Math.floor(new Date(now.getFullYear(), now.getMonth() + 1, 1).getTime() / 1000);
}

// ✅ Middleware to validate request body
function validateRequestBody(req, res, next) {
    const requiredFields = ["studentName", "customerName", "customerEmail", "customerPhone", "lessonType", "priceId", "paymentMethodId"];
    for (const field of requiredFields) {
        if (!req.body[field]) {
            return res.status(400).json({ error: `Missing required field: ${field}` });
        }
    }
    next();
}

// 🚀 Create a Subscription Route
app.post('/create-subscription', validateRequestBody, async (req, res) => {
    const { studentName, customerName, customerEmail, customerPhone, lessonType, priceId, paymentMethodId } = req.body;

    try {
        // ✅ 1. Create Customer with Payment Method
        const customer = await stripe.customers.create({
            name: customerName,
            email: customerEmail,
            phone: customerPhone,
            payment_method: paymentMethodId,
            invoice_settings: { default_payment_method: paymentMethodId },
            metadata: { student_name: studentName, lesson_type: lessonType }
        });

        // ✅ 2. Attach the payment method to the customer
        await stripe.paymentMethods.attach(paymentMethodId, { customer: customer.id });

        // ✅ 3. Create Subscription with Proration & Auto-Billing
        const subscription = await stripe.subscriptions.create({
            customer: customer.id,
            items: [{ price: priceId }],
            proration_behavior: 'create_prorations',
            billing_cycle_anchor: getNextMonthTimestamp(),
            payment_behavior: 'default_incomplete', // Ensures payment intent is created
            expand: ['latest_invoice.payment_intent'],
        });

        console.log(`✅ Subscription Created! ID: ${subscription.id}`);
        res.status(200).json({ message: "Subscription Created!", subscriptionId: subscription.id });

    } catch (error) {
        console.error(`❌ Stripe API Error:`, error);
        res.status(400).json({
            error: error.message,
            type: error.type,
            code: error.code || "N/A",
            param: error.param || "N/A"
        });
    }
});

// 🌐 Start the Express Server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));

/*
    curl -X POST http://localhost:3000/create-subscription \
-H "Content-Type: application/json" \
-d '{
  "studentName": "Little Johnny",
  "customerName": "John Smith",
  "customerEmail": "janedoe@example.com",
  "customerPhone": "+123456789",
  "lessonType": "30min",
  "priceId": "price_1QxDDOIaMu5TUCAv38VEqyFU",
  "paymentMethodId": "pm_1QxDwDIaMu5TUCAvrv1R2icI"
}'

    createSubscription
    - studentName
    - customerName
    - customerEmail
    - customerPhone
    - customerLessonType
    - paymentMethodId
    - priceId

//createSubscription("Dallin-Bohn", "Dallin-Bohn", "dallinbohn1@gmail.com", "9514667554", "30-minute", "", lessonPlans["30min"]);
//stripe payment_methods create -d type=card -d "card[token]=tok_visa"

'30min': 'prod_RqLDMbGVwWadJk',
'45min': 'prod_RqLEG3yfQCJ6J4',
'60min': 'prod_RqLGEXo5sze7VD'

*/
