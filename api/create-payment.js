const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { DateTime } = require('luxon');

module.exports = async (req, res) => {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: "Method Not Allowed" });
    }

    const requiredFields = ["studentName", "customerName", "customerEmail", "customerPhone", "lessonType", "priceId", "paymentMethodId"];
    for (const field of requiredFields) {
        if (!req.body[field]) {
            return res.status(400).json({ error: `Missing required field: ${field}` });
        }
    }

    const { studentName, customerName, customerEmail, customerPhone, lessonType, priceId, paymentMethodId } = req.body;

    try {
        // 1. Create Customer with Payment Method
        const customer = await stripe.customers.create({
            name: customerName,
            email: customerEmail,
            phone: customerPhone,
            payment_method: paymentMethodId,
            invoice_settings: { default_payment_method: paymentMethodId },
            metadata: { student_name: studentName, lesson_type: lessonType }
        });

        // 2. Attach the payment method to the customer
        await stripe.paymentMethods.attach(paymentMethodId, { customer: customer.id });

        // 3. Create Subscription with Proration & Auto-Billing
        const nextMonthStart = DateTime.now()
            .setZone('America/Phoenix') // Set Arizona timezone
            .plus({ months: 1 }) // Go to the next month
            .startOf('month') // Set to the start of the month
            .set({ hour: 0, minute: 0, second: 0, millisecond: 0 }) // Set to midnight
            .toSeconds(); // Convert to Unix timestamp

        const subscription = await stripe.subscriptions.create({
            customer: customer.id,
            items: [{ price: priceId }],
            proration_behavior: 'create_prorations',
            billing_cycle_anchor: nextMonthStart,
            payment_behavior: 'default_incomplete', // Ensures payment intent is created
            expand: ['latest_invoice.payment_intent'],
        });

        console.log(`Subscription Created! ID: ${subscription.id}`);
        res.status(200).json({ message: "Subscription Created!", subscriptionId: subscription.id });

    } catch (error) {
        console.error('Stripe API Error:', error);
        res.status(400).json({
            error: error.message,
            type: error.type,
            code: error.code || "N/A",
            param: error.param || "N/A"
        });
    }
};
