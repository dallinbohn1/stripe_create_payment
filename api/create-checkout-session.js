const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { DateTime } = require('luxon');

const PRICE_ID_MAP = process.env.STRIPE_LIVE_MODE === "true"
    ? {  
        "30 Minute Lessons - $150 / Month": "price_1QweXFIaMu5TUCAvMfkFUcnp",
        "45 Minute Lessons - $225 / Month": "price_1QweYQIaMu5TUCAv3z4AGnAv",
        "60 Minute Lessons - $300 / Month": "price_1QweZcIaMu5TUCAv76jQaoON"
      }
    : {  
        "30 Minute Lessons - $150 / Month": "price_1QxCAgIaMu5TUCAvAYJ1hCm0",
        "45 Minute Lessons - $225 / Month": "price_1QxDDOIaMu5TUCAv38VEqyFU",
        "60 Minute Lessons - $300 / Month": "price_1QxDDfIaMu5TUCAvHi6jUXYu"
      };

module.exports = async (req, res) => {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: "Method Not Allowed" });
    }

    if (!process.env.STRIPE_SECRET_KEY || !process.env.CLIENT_URL) {
        return res.status(500).json({ error: "Server misconfiguration: Missing environment variables." });
    }

    const requiredFields = ["studentName", "customerName", "customerEmail", "customerPhone", "lessonType"];
    for (const field of requiredFields) {
        if (!req.body[field]) {
            return res.status(400).json({ error: `Missing required field: ${field}` });
        }
    }

    const { studentName, customerName, customerEmail, customerPhone, lessonType } = req.body;
    const priceId = PRICE_ID_MAP[lessonType];

    if (!priceId) {
        return res.status(400).json({ error: "Invalid lesson type selected." });
    }

    try {
        // Always create a NEW customer for each student
        const customer = await stripe.customers.create({
            name: customerName,
            email: customerEmail,
            phone: customerPhone,
            metadata: { 
                student_name: studentName, 
                lesson_type: lessonType 
            }
        });

        // Set billing cycle to start on the first of next month
        const nextMonthStart = DateTime.now()
            .setZone('America/Phoenix')
            .plus({ months: 1 })
            .startOf('month')
            .toSeconds();

        // Create a subscription for this student
        const subscription = await stripe.subscriptions.create({
            customer: customer.id,
            items: [{ price: priceId }],
            billing_cycle_anchor: nextMonthStart,
            proration_behavior: 'create_prorations',
            payment_behavior: 'default_incomplete',
            expand: ['latest_invoice.payment_intent'],
        });

        // Generate a Stripe Checkout Session
        const session = await stripe.checkout.sessions.create({
            payment_method_types: ['card'],
            mode: 'subscription',
            customer: customer.id,
            line_items: [{ price: priceId, quantity: 1 }],
            subscription_data: { trial_end: nextMonthStart },
            success_url: `${process.env.CLIENT_URL}/success?session_id={CHECKOUT_SESSION_ID}`,
            cancel_url: `${process.env.CLIENT_URL}/cancel`
        });

        res.status(200).json({ checkoutUrl: session.url });

    } catch (error) {
        console.error('Stripe API Error:', error);
        res.status(500).json({
            error: "Stripe API Error",
            message: error.message,
            type: error.type,
            code: error.code || "N/A",
            param: error.param || "N/A"
        });
    }
};
