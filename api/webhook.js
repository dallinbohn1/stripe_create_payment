const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { buffer } = require('micro');
const { DateTime } = require('luxon');

const TIME_ZONE = "America/Phoenix";

// Stripe price IDs
const PRICE_ID_MAP = process.env.STRIPE_LIVE_MODE === "true"
  ? {  // Live Mode Price IDs
      "30 Minute Lessons - $150 / Month": 'price_1QweXFIaMu5TUCAvMfkFUcnp',
      "45 Minute Lessons - $225 / Month": 'price_1QweYQIaMu5TUCAv3z4AGnAv',
      "60 Minute Lessons - $300 / Month": 'price_1QweZcIaMu5TUCAv76jQaoON'
    }
  : {  // Test Mode Price IDs
      "30 Minute Lessons - $150 / Month": 'price_1QxCAgIaMu5TUCAvAYJ1hCm0',
      "45 Minute Lessons - $225 / Month": 'price_1QxDDOIaMu5TUCAv38VEqyFU',
      "60 Minute Lessons - $300 / Month": 'price_1QxDDfIaMu5TUCAvHi6jUXYu'
    };

export const config = { api: { bodyParser: false } }; // Required for Stripe webhook signature verification

export default async function handler(req, res) {
    if (req.method !== "POST") {
      return res.status(405).send("Method Not Allowed");
    }
  
    const sig = req.headers["stripe-signature"];
    const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;
  
    let event;
    try {
      const rawBody = await buffer(req);
      event = stripe.webhooks.constructEvent(rawBody, sig, endpointSecret);
    } catch (err) {
      console.error("Webhook signature verification failed:", err.message);
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }
  
    // Handle checkout success
    if (event.type === "checkout.session.completed") {
      const session = event.data.object;
      const customerId = session.customer;
      const lessonType = session.metadata.lessonType;
  
      console.log("Lesson Type from session:", lessonType);
  
      if (!customerId || !lessonType || !PRICE_ID_MAP[lessonType]) {
        console.error("Missing required data from checkout session.");
        return res.status(400).json({ error: "Missing required data." });
      }
  
      try {
        // Get the first of next month
        const firstOfNextMonth = DateTime.now().setZone(TIME_ZONE).plus({ months: 1 }).startOf('month').set({ hour: 0, minute: 0, second: 0, millisecond: 0 });
  
        console.log("Billing cycle anchor:", firstOfNextMonth.toSeconds());
  
        // Retrieve payment method
        const paymentIntent = await stripe.paymentIntents.retrieve(session.payment_intent);
        console.log("Payment Intent:", paymentIntent);
  
        const paymentMethodId = paymentIntent.payment_method;
  
        // Attach the payment method to the customer
        await stripe.paymentMethods.attach(paymentMethodId, { customer: customerId });
  
        // Create the subscription
        console.log("Creating subscription for lessonType:", lessonType, "with price ID:", PRICE_ID_MAP[lessonType]);
        const subscription = await stripe.subscriptions.create({
          customer: customerId,
          items: [{ price: PRICE_ID_MAP[lessonType] }],
          default_payment_method: paymentMethodId,
          billing_cycle_anchor: firstOfNextMonth.toSeconds(),
          proration_behavior: "none",
          payment_behavior: "default_incomplete"
        });
  
        console.log("Subscription created:", subscription.id);
        return res.status(200).json({ subscriptionId: subscription.id });
  
      } catch (error) {
        console.error("Error creating subscription:", error);
        return res.status(500).json({ error: error.message, stack: error.stack });
      }
    }
  
    res.status(200).send("Webhook received.");
  }
  
