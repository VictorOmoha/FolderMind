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
exports.stripeWebhook = exports.createCheckoutSession = exports.chatGateway = void 0;
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
const PLAN_LIMITS = { free: 50, pro: 1000, business: Number.POSITIVE_INFINITY };
const monthKey = () => new Date().toISOString().slice(0, 7); // "2026-07"
exports.chatGateway = (0, https_1.onRequest)({ cors: false, timeoutSeconds: 300 }, async (req, res) => {
    if (req.method === 'OPTIONS') {
        res.set('Access-Control-Allow-Origin', '*').set('Access-Control-Allow-Headers', 'Content-Type, X-Firebase-Token, Authorization').status(204).send('');
        return;
    }
    if (req.method !== 'POST') {
        res.status(405).json({ error: { message: 'Method not allowed' } });
        return;
    }
    // 1) Authenticate the caller from the Firebase ID token.
    const token = req.headers['x-firebase-token'] || '';
    if (!token) {
        res.status(401).json({ error: { message: 'Missing X-Firebase-Token' } });
        return;
    }
    let uid;
    try {
        uid = (await admin.auth().verifyIdToken(token)).uid;
    }
    catch (_a) {
        res.status(401).json({ error: { message: 'Invalid or expired token' } });
        return;
    }
    // 2) Load plan + usage, enforce the monthly quota.
    const usageRef = db.doc(`users/${uid}/meta/usage`);
    const snap = await usageRef.get();
    const data = (snap.exists ? snap.data() : {});
    const plan = data.planTier === 'pro' || data.planTier === 'business' ? data.planTier : 'free';
    const month = monthKey();
    const usedThisMonth = data.aiCallsResetAt === month ? (data.aiCallsThisMonth || 0) : 0;
    if (usedThisMonth >= PLAN_LIMITS[plan]) {
        res.status(429).json({ error: { message: `Monthly AI limit reached on the ${plan} plan. Upgrade to continue.`, code: 'quota_exceeded' } });
        return;
    }
    // 3) Forward to OpenAI with the SERVER key.
    const serverKey = process.env.OPENAI_API_KEY;
    if (!serverKey) {
        res.status(500).json({ error: { message: 'Gateway OpenAI key not configured' } });
        return;
    }
    const body = req.body || {};
    const wantsStream = Boolean(body.stream);
    let upstream;
    try {
        upstream = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${serverKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });
    }
    catch (e) {
        res.status(502).json({ error: { message: `Upstream request failed: ${e.message}` } });
        return;
    }
    if (!upstream.ok || !upstream.body) {
        const text = await upstream.text().catch(() => '');
        res.status(upstream.status || 502).send(text || JSON.stringify({ error: { message: 'Upstream error' } }));
        return;
    }
    // 4) Meter this call (best-effort; per-request, not per-token).
    const meter = async () => {
        if (data.aiCallsResetAt === month)
            await usageRef.set({ aiCallsThisMonth: admin.firestore.FieldValue.increment(1) }, { merge: true });
        else
            await usageRef.set({ aiCallsThisMonth: 1, aiCallsResetAt: month, planTier: plan }, { merge: true });
    };
    // 5) Pipe the response back.
    if (wantsStream) {
        res.set('Content-Type', 'text/event-stream').set('Cache-Control', 'no-cache').set('Connection', 'keep-alive');
        const reader = upstream.body.getReader();
        const decoder = new TextDecoder();
        for (;;) {
            const { done, value } = await reader.read();
            if (done)
                break;
            res.write(decoder.decode(value, { stream: true }));
        }
        await meter();
        res.end();
    }
    else {
        const json = await upstream.json();
        await meter();
        res.json(json);
    }
});
// ── Create Stripe Checkout Session ────────────────────────────────────────
exports.createCheckoutSession = (0, https_1.onRequest)((req, res) => {
    corsHandler(req, res, async () => {
        if (req.method !== 'POST') {
            res.status(405).send('Method not allowed');
            return;
        }
        // Authenticate the caller: the uid must come from a verified Firebase ID token,
        // NOT the request body. Otherwise anyone could bind a subscription to another user.
        const authHeader = req.headers.authorization || '';
        const idToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
        if (!idToken) {
            res.status(401).json({ error: 'Missing Authorization bearer token' });
            return;
        }
        let uid;
        let email;
        try {
            const decoded = await admin.auth().verifyIdToken(idToken);
            uid = decoded.uid;
            email = decoded.email;
        }
        catch (_a) {
            res.status(401).json({ error: 'Invalid or expired ID token' });
            return;
        }
        const plan = req.body.plan === 'business' ? 'business' : 'pro';
        const priceId = plan === 'business'
            ? process.env.STRIPE_PRICE_BUSINESS
            : process.env.STRIPE_PRICE_PRO;
        if (!priceId) {
            res.status(500).json({ error: `Price not configured for plan "${plan}"` });
            return;
        }
        try {
            const session = await getStripe().checkout.sessions.create({
                mode: 'subscription',
                customer_email: email,
                line_items: [{ price: priceId, quantity: 1 }],
                success_url: `https://foldermind-b15ea.web.app/success?uid=${uid}`,
                cancel_url: `https://foldermind-b15ea.web.app/cancel`,
                // Persist the purchased plan so the webhook can grant the correct tier.
                metadata: { uid, plan },
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
    var _a, _b;
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
        // Grant the tier that was actually purchased, not a hardcoded 'pro'.
        const planTier = ((_b = session.metadata) === null || _b === void 0 ? void 0 : _b.plan) === 'business' ? 'business' : 'pro';
        if (uid) {
            await db.doc(`users/${uid}/meta/usage`).set({
                planTier,
                stripeCustomerId: session.customer,
                subscriptionId: session.subscription,
                updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            }, { merge: true });
        }
    }
    // Downgrade/cancel on deletion; both `deleted` and lapsed `updated` events fall back to free.
    if (event.type === 'customer.subscription.deleted') {
        const sub = event.data.object;
        const snap = await db.collectionGroup('meta')
            .where('stripeCustomerId', '==', sub.customer)
            .limit(1).get();
        if (!snap.empty) {
            await snap.docs[0].ref.set({ planTier: 'free' }, { merge: true });
        }
    }
    if (event.type === 'customer.subscription.updated') {
        const sub = event.data.object;
        if (sub.status === 'canceled' || sub.status === 'unpaid' || sub.status === 'incomplete_expired') {
            const snap = await db.collectionGroup('meta')
                .where('stripeCustomerId', '==', sub.customer)
                .limit(1).get();
            if (!snap.empty) {
                await snap.docs[0].ref.set({ planTier: 'free' }, { merge: true });
            }
        }
    }
    res.json({ received: true });
});
//# sourceMappingURL=index.js.map