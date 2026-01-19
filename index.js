const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');

// 1. Initialize App
const app = express();
const PORT = process.env.PORT || 3000;

// 2. Middleware (CRITICAL for fixing CORS and Data errors)
app.use(cors({
    origin: '*', // Allow your GitHub Pages or Localhost to connect
    methods: ['GET', 'POST']
}));
app.use(bodyParser.json());

// 3. Fake Database (Replace with real logic later)
const MOCK_DB = {
    users: []
};

// 4. ROUTE: Manual Login (This matches the HTML I gave you)
app.post('/connect-manual', async (req, res) => {
    const { username, password } = req.body;

    console.log(`Attempting login for: ${username}`);

    // --- REAL INSTAGRAM LOGIC WOULD GO HERE ---
    // You would typically use a library like 'instagram-private-api'
    // or Puppeteer to verify the credentials.
    // For now, we will simulate a successful connection.
    // ------------------------------------------

    if (!username || !password) {
        return res.status(400).json({ error: 'Missing username or password' });
    }

    // SIMULATE SUCCESS
    const mockToken = 'mock_token_' + Date.now();
    
    // Return the token to the frontend
    res.json({ 
        success: true, 
        token: mockToken, 
        username: username,
        message: 'Connected successfully (Simulation)' 
    });
});

// 5. ROUTE: Fetch Reels
app.get('/reels', (req, res) => {
    // Check if user has the token we gave them
    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(401).json({ error: 'Unauthorized' });

    // Return Fake Reels (since we aren't really connected to Insta API yet)
    res.json([
        {
            id: '123',
            caption: 'My first viral reel! #marketing',
            media_url: 'https://assets.mixkit.co/videos/preview/mixkit-tree-with-yellow-flowers-1173-large.mp4',
            thumbnail_url: 'https://images.unsplash.com/photo-1516035069371-29a1b244cc32?w=400',
            view_count: 12500,
            like_count: 500
        },
        {
            id: '456',
            caption: 'Dm me for the link',
            media_url: 'https://assets.mixkit.co/videos/preview/mixkit-mother-with-her-little-daughter-eating-a-marshmallow-in-nature-39764-large.mp4',
            thumbnail_url: 'https://images.unsplash.com/photo-1536240478700-b869070f9279?w=400',
            view_count: 8200,
            like_count: 320
        }
    ]);
});

// 6. ROUTE: Save Automation
app.post('/save-automation', (req, res) => {
    console.log('Automation Saved:', req.body);
    res.json({ success: true });
});

// Start Server
app.listen(PORT, () => {
    console.log(`Backend running on port ${PORT}`);
});
