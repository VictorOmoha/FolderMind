import * as functions from 'firebase-functions'
import * as admin from 'firebase-admin'
import Stripe from 'stripe'
import * as cors from 'cors'

admin.initializeApp()
const db = admin.firestore()

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || '', {
  apiVersion: '2024-04-10',
})

const corsHandler = cors({ origin: true })

// ── Create Stripe Checkout Session ────────────────────────────────────────
export const createCheckoutSession = functions.https.onRequest((req, res) => {
  corsHandler(req, res, async () => {
    if (req.method !== 'POST') { res.status(405).send('Method not allowed'); return }

    const { uid, email, plan } = req.body as { uid: string; email: string; plan: 'pro' | 'business' }

    const priceId = plan === 'business'
      ? process.env.STRIPE_PRICE_BUSINESS
      : process.env.STRIPE_PRICE_PRO

    try {
      const session = await stripe.checkout.sessions.create({
        mode: 'subscription',
        customer_email: email,
        line_items: [{ price: priceId, quantity: 1 }],
        success_url: `https://foldermind-b15ea.firebaseapp.com/success?uid=${uid}`,
        cancel_url: `https://foldermind-b15ea.firebaseapp.com/cancel`,
        metadata: { uid },
      })
      res.json({ url: session.url })
    } catch (err) {
      console.error(err)
      res.status(500).json({ error: 'Failed to create checkout session' })
    }
  })
})

// ── Stripe Webhook — update plan in Firestore ─────────────────────────────
export const stripeWebhook = functions.https.onRequest(async (req, res) => {
  const sig = req.headers['stripe-signature'] as string
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET || ''

  let event: Stripe.Event
  try {
    event = stripe.webhooks.constructEvent(req.rawBody, sig, webhookSecret)
  } catch (err) {
    console.error('Webhook signature failed:', err)
    res.status(400).send('Webhook Error')
    return
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object as Stripe.Checkout.Session
    const uid = session.metadata?.uid
    if (uid) {
      await db.doc(`users/${uid}/meta/usage`).set({
        planTier: 'pro', // upgrade to pro on checkout complete
        stripeCustomerId: session.customer,
        subscriptionId: session.subscription,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true })
    }
  }

  if (event.type === 'customer.subscription.deleted') {
    const sub = event.data.object as Stripe.Subscription
    // Find user by customerId and downgrade
    const snap = await db.collectionGroup('meta')
      .where('stripeCustomerId', '==', sub.customer)
      .limit(1)
      .get()
    if (!snap.empty) {
      await snap.docs[0].ref.set({ planTier: 'free' }, { merge: true })
    }
  }

  res.json({ received: true })
})
