const axios = require('axios');

const API_VERSION = 'v18.0';
const BASE_URL = `https://graph.facebook.com/${API_VERSION}`;

module.exports = {
    // 1. Auth Handlers
    getAccessToken: async (code) => {
        const params = {
            client_id: process.env.META_APP_ID,
            client_secret: process.env.META_APP_SECRET,
            redirect_uri: `${process.env.BACKEND_URL}/auth/callback`,
            code: code
        };
        const res = await axios.get(`${BASE_URL}/oauth/access_token`, { params });
        return res.data;
    },

    getUserData: async (accessToken) => {
        const res = await axios.get(`${BASE_URL}/me`, {
            params: { access_token: accessToken }
        });
        return res.data;
    },

    getPages: async (accessToken) => {
        // Fetch pages and their linked instagram accounts
        const res = await axios.get(`${BASE_URL}/me/accounts`, {
            params: {
                access_token: accessToken,
                fields: 'id,name,instagram_business_account',
                limit: 100
            }
        });
        return res.data;
    },

    getIgProfile: async (igUserId, accessToken) => {
        const res = await axios.get(`${BASE_URL}/${igUserId}`, {
            params: {
                access_token: accessToken,
                fields: 'username,profile_picture_url,followers_count'
            }
        });
        return res.data;
    },

    // 2. Media Handlers
    getReels: async (igUserId, accessToken) => {
        const res = await axios.get(`${BASE_URL}/${igUserId}/media`, {
            params: {
                access_token: accessToken,
                fields: 'id,caption,media_type,media_url,thumbnail_url,permalink,timestamp,like_count,comments_count,view_count',
                limit: 20
            }
        });
        // Filter mainly for Reels (VIDEO)
        return res.data.data.filter(item => item.media_type === 'VIDEO' || item.media_type === 'IMAGE');
    },

    // 3. Interaction Handlers
    sendDM: async (recipientId, text, btnTitle, btnUrl, accessToken) => {
        // Structure payload based on whether a button is present
        let messagePayload = { text: text };

        // Note: Generic Templates for buttons are deprecated in some regions for IG,
        // but this is the standard way if available. 
        // If buttons fail, fall back to text with link.
        if (btnTitle && btnUrl) {
           // Simplified for standard text messages which is safer globally
           messagePayload = {
               text: `${text}\n\n${btnTitle}: ${btnUrl}`
           }
        }

        const res = await axios.post(`${BASE_URL}/me/messages`, {
            recipient: { id: recipientId },
            message: messagePayload,
            access_token: accessToken
        });
        return res.data;
    },

    replyToComment: async (commentId, text, accessToken) => {
        const res = await axios.post(`${BASE_URL}/${commentId}/replies`, {
            message: text,
            access_token: accessToken
        });
        return res.data;
    }
};
