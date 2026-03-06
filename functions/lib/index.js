"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.stripeWebhook = exports.createCheckoutSession = void 0;
const admin = __importStar(require("firebase-admin"));
const https_1 = require("firebase-functions/v2/https");
const stripe_1 = __importDefault(require("stripe"));
const cors_1 = __importDefault(require("cors"));
admin.initializeApp();
const db = admin.firestore();
// Lazy init Stripe
let _stripe = null;
const getStripe = () => {
    if (!_stripe)
        _stripe = new stripe_1.default(process.env.STRIPE_SECRET_KEY || '');
    return _stripe;
};
const corsHandler = (0, cors_1.default)({ origin: true });
// ── Create Stripe Checkout Session ────────────────────────────────────────
exports.createCheckoutSession = (0, https_1.onRequest)((req, res) => {
    corsHandler(req, res, async () => {
        if (req.method !== 'POST') {
            res.status(405).send('Method not allowed');
            return;
        }
        const { uid, email, plan } = req.body;
        const priceId = plan === 'business'
            ? process.env.STRIPE_PRICE_BUSINESS
            : process.env.STRIPE_PRICE_PRO;
        try {
            const session = await getStripe().checkout.sessions.create({
                mode: 'subscription',
                customer_email: email,
                line_items: [{ price: priceId, quantity: 1 }],
                success_url: `https://foldermind-b15ea.web.app/success?uid=${uid}`,
                cancel_url: `https://foldermind-b15ea.web.app/cancel`,
                metadata: { uid },
            });
            res.json({ url: session.url });
        }
        catch (err) {
            console.error(err);
            res.status(500).json({ error: 'Failed to create checkout session' });
        }
    });
});
// ── Stripe Webhook ─────────────────────────────────────────────────────────
exports.stripeWebhook = (0, https_1.onRequest)(async (req, res) => {
    var _a;
    const sig = req.headers['stripe-signature'];
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET || '';
    let event;
    try {
        event = getStripe().webhooks.constructEvent(req.rawBody, sig, webhookSecret);
    }
    catch (err) {
        console.error('Webhook signature failed:', err);
        res.status(400).send('Webhook Error');
        return;
    }
    if (event.type === 'checkout.session.completed') {
        const session = event.data.object;
        const uid = (_a = session.metadata) === null || _a === void 0 ? void 0 : _a.uid;
        if (uid) {
            await db.doc(`users/${uid}/meta/usage`).set({
                planTier: 'pro',
                stripeCustomerId: session.customer,
                subscriptionId: session.subscription,
                updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            }, { merge: true });
        }
    }
    if (event.type === 'customer.subscription.deleted') {
        const sub = event.data.object;
        const snap = await db.collectionGroup('meta')
            .where('stripeCustomerId', '==', sub.customer)
            .limit(1).get();
        if (!snap.empty) {
            await snap.docs[0].ref.set({ planTier: 'free' }, { merge: true });
        }
    }
    res.json({ received: true });
});
//# sourceMappingURL=index.js.map