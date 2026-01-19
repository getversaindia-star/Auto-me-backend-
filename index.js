require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const { db, auth, admin } = require('./firestore');
const graph = require('./graph');

const app = express();
app.use(cors());
app.use(bodyParser.json());

// --- MIDDLEWARE: AUTH CHECK ---
// Decodes Firebase ID Token attached to requests
const authenticate = async (req, res, next) => {
    const header = req.headers.authorization;
    if (!header || !header.startsWith('Bearer ')) {
        return res.status(401).send('Unauthorized');
    }
    const token = header.split('Bearer ')[1];
    try {
        const decodedToken = await admin.auth().verifyIdToken(token);
        req.user = decodedToken;
        next();
    } catch (error) {
        console.error("Auth Error:", error);
        res.status(401).send('Invalid Token');
    }
};

// --- ROUTES: AUTHENTICATION (OAUTH) ---

// 1. Initiate Login
app.get('/auth/instagram', (req, res) => {
    const redirectUri = `${process.env.BACKEND_URL}/auth/callback`;
    const appId = process.env.META_APP_ID;
    
    // Scopes needed:
    // instagram_basic: get profile
    // instagram_manage_messages: send DMs
    // instagram_manage_comments: reply to comments
    // pages_show_list: find linked page
    // pages_read_engagement: read comments
    
    const scope = 'instagram_basic,instagram_manage_messages,instagram_manage_comments,pages_show_list,pages_read_engagement,business_management';
    
    const url = `https://www.facebook.com/v18.0/dialog/oauth?client_id=${appId}&redirect_uri=${redirectUri}&scope=${scope}&response_type=code`;
    
    res.redirect(url);
});

// 2. Callback from Meta
app.get('/auth/callback', async (req, res) => {
    const code = req.query.code;
    if (!code) return res.status(400).send("No code provided");

    try {
        // Exchange code for Long-Lived Access Token
        const tokenData = await graph.getAccessToken(code);
        const accessToken = tokenData.access_token;

        // Get User Info & Linked Pages
        const userData = await graph.getUserData(accessToken); // FB User ID
        const pages = await graph.getPages(accessToken);
        
        // Find the page with an Instagram Business Account connected
        const validPage = pages.data.find(p => p.instagram_business_account);
        
        if (!validPage) {
            return res.send("Error: No Instagram Business Account linked to your Facebook Page.");
        }

        const igUserId = validPage.instagram_business_account.id;
        const pageId = validPage.id;

        // Get IG Username
        const igProfile = await graph.getIgProfile(igUserId, accessToken);

        // Check if user exists in Firebase, or create
        // We use the IG User ID as the key or a combination
        const firebaseUid = `ig_${igUserId}`;
        
        try {
            await admin.auth().getUser(firebaseUid);
        } catch(e) {
            await admin.auth().createUser({
                uid: firebaseUid,
                displayName: igProfile.username,
                photoURL: igProfile.profile_picture_url
            });
        }

        // Store secure tokens in Firestore (Private)
        await db.collection('users').doc(firebaseUid).set({
            instagramId: igUserId,
            username: igProfile.username,
            pageId: pageId,
            accessToken: accessToken, // In prod, encrypt this!
            email: `${igProfile.username}@autome.com`,
            updatedAt: new Date()
        }, { merge: true });

        // Generate Custom Token for Frontend Login
        const customToken = await admin.auth().createCustomToken(firebaseUid);

        // Redirect to Frontend with Token
        // NOTE: In production, consider a safer handoff (e.g., temporary code exchange)
        res.redirect(`${process.env.FRONTEND_URL}?token=${customToken}&uid=${firebaseUid}`);

    } catch (error) {
        console.error(error);
        res.status(500).send("Auth Failed: " + error.message);
    }
});

// --- ROUTES: DASHBOARD DATA ---

app.get('/reels', authenticate, async (req, res) => {
    try {
        const doc = await db.collection('users').doc(req.user.uid).get();
        if (!doc.exists) return res.status(404).send('User not found');
        
        const userData = doc.data();
        const reels = await graph.getReels(userData.instagramId, userData.accessToken);
        
        res.json({ data: reels });
    } catch (error) {
        res.status(500).send(error.message);
    }
});

app.get('/automations', authenticate, async (req, res) => {
    const snapshot = await db.collection('automations')
        .where('userId', '==', req.user.uid)
        .orderBy('createdAt', 'desc')
        .get();
        
    const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    res.json(data);
});

// --- ROUTES: AUTOMATION BUILDER ---

app.post('/save-automation', authenticate, async (req, res) => {
    const data = req.body;
    
    // Basic validation
    if (!data.reelId || !data.dmMessage) return res.status(400).send('Missing fields');

    try {
        await db.collection('automations').add({
            userId: req.user.uid,
            ...data,
            active: true,
            createdAt: new Date()
        });
        res.json({ success: true });
    } catch (e) {
        res.status(500).send(e.message);
    }
});

app.post('/toggle-automation', authenticate, async (req, res) => {
    const { id, active } = req.body;
    await db.collection('automations').doc(id).update({ active });
    res.json({ success: true });
});

// --- ROUTES: WEBHOOKS (The Core Engine) ---

// Verify Webhook (Meta requirement)
app.get('/webhook', (req, res) => {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];
    
    if (mode && token) {
        if (mode === 'subscribe' && token === process.env.WEBHOOK_VERIFY_TOKEN) {
            console.log('WEBHOOK_VERIFIED');
            res.status(200).send(challenge);
        } else {
            res.sendStatus(403);
        }
    }
});

// Handle Events
app.post('/webhook', async (req, res) => {
    try {
        const body = req.body;

        if (body.object === 'instagram') {
            for (const entry of body.entry) {
                // Determine if this is a comment or message
                // Usually comments are in 'changes', messages in 'messaging'
                
                // HANDLE COMMENTS
                if (entry.changes) {
                    for (const change of entry.changes) {
                        if (change.field === 'comments') {
                            await handleComment(change.value);
                        }
                    }
                }
            }
        }
        res.status(200).send('EVENT_RECEIVED');
    } catch (error) {
        console.error(error);
        res.sendStatus(500);
    }
});

// LOGIC: Process Comment
async function handleComment(event) {
    // Event structure: { id, text, media: { id, id_product_id }, from: { id, username } }
    const mediaId = event.media.id;
    const commentId = event.id;
    const commentText = event.text.toUpperCase();
    const userId = event.from.id; // The commenter's IG ID (scoped)
    const ownerIgId = event.media.owner.id; // The business account ID

    // 1. Find the User (Business) who owns this media
    // We query our 'users' collection where instagramId matches ownerIgId
    const userSnapshot = await db.collection('users').where('instagramId', '==', ownerIgId).limit(1).get();
    if (userSnapshot.empty) return; // We don't manage this user
    
    const businessUser = userSnapshot.docs[0].data();
    const businessUid = userSnapshot.docs[0].id;

    // 2. Find Automations for this Media
    const autosSnapshot = await db.collection('automations')
        .where('userId', '==', businessUid)
        .where('reelId', '==', mediaId)
        .where('active', '==', true)
        .get();

    if (autosSnapshot.empty) return;

    // 3. Process each matching automation
    for (const doc of autosSnapshot.docs) {
        const auto = doc.data();
        
        // CHECK TRIGGER
        if (auto.triggerType === 'keyword') {
            if (!commentText.includes(auto.keyword.toUpperCase())) continue;
        }

        // CHECK FOLLOWERS (Optional - requires extra API call)
        // Ignoring for speed in this demo, but logic: call graph.checkFollower(userId)

        // EXECUTE ACTIONS
        
        // A. Send DM
        try {
            await graph.sendDM(
                userId, 
                auto.dmMessage, 
                auto.buttonText, 
                auto.buttonUrl, 
                businessUser.accessToken
            );
        } catch (e) {
            console.error("Failed to send DM", e.response?.data || e);
        }

        // B. Reply to Comment
        if (auto.autoReplyComment) {
            try {
                await graph.replyToComment(
                    commentId, 
                    auto.autoReplyComment, 
                    businessUser.accessToken
                );
            } catch (e) {
                console.error("Failed to reply", e);
            }
        }
    }
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
