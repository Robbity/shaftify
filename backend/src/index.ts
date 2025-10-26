import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { Pool } from "pg";
import axios from "axios";
import querystring from "querystring";
import crypto from "crypto";

// Load environment variables
dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json());

// Database setup
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

// Spotify credentials
const CLIENT_ID = process.env.SPOTIFY_CLIENT_ID!;
const CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET!;
const REDIRECT_URI = process.env.SPOTIFY_REDIRECT_URI!;

// Temporary storage for session codes (in production, use Redis or database)
const sessionStore = new Map<string, { 
  access_token: string; 
  refresh_token: string; 
  user: any;
  expires_at: number;
}>();

// Clean up expired sessions every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [code, data] of sessionStore.entries()) {
    if (data.expires_at < now) {
      sessionStore.delete(code);
    }
  }
}, 5 * 60 * 1000);

// Helper function to generate random session code
function generateSessionCode(): string {
  return crypto.randomBytes(32).toString("hex");
}

// Root route
app.get("/", (req, res) => {
  res.send("Server running ✅");
});

// Simple test route for DB connection
app.get("/db-test", async (req, res) => {
  try {
    const result = await pool.query("SELECT NOW()");
    res.json({ success: true, time: result.rows[0].now });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: "Database connection failed" });
  }
});

// Step 1: Redirect user to Spotify's login/authorization page
app.get("/auth/spotify", (req, res) => {
  const scope = [
    "user-read-private",
    "user-read-email",
    "user-top-read",
  ].join(" ");

  // Get the app redirect URI from query params
  const appRedirectUri = req.query.redirect_uri as string;

  if (!appRedirectUri) {
    return res.status(400).json({ 
      success: false, 
      error: "redirect_uri parameter is required" 
    });
  }

  const queryParams = querystring.stringify({
    response_type: "code",
    client_id: CLIENT_ID,
    scope,
    redirect_uri: REDIRECT_URI, // This is your server's callback URL
    state: appRedirectUri, // Pass the app's redirect URI in state
  });

  res.redirect(`https://accounts.spotify.com/authorize?${queryParams}`);
});

// Step 2: Spotify redirects back here with ?code=...
app.get("/auth/spotify/callback", async (req, res) => {
  const code = req.query.code as string;
  const appRedirectUri = req.query.state as string; // Get the app redirect URI from state

  if (!code) {
    const errorUrl = appRedirectUri 
      ? `${appRedirectUri}?error=no_code`
      : `exp://127.0.0.1:19000/--/?error=no_code`;
    return res.redirect(errorUrl);
  }

  try {
    // Exchange authorization code for access + refresh tokens
    const tokenResponse = await axios.post(
      "https://accounts.spotify.com/api/token",
      querystring.stringify({
        grant_type: "authorization_code",
        code,
        redirect_uri: REDIRECT_URI, // Must match what was sent to /authorize
      }),
      {
        headers: {
          Authorization:
            "Basic " +
            Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString("base64"),
          "Content-Type": "application/x-www-form-urlencoded",
        },
      }
    );

    const { access_token, refresh_token } = tokenResponse.data;

    // Use access token to get the user's Spotify profile
    const userResponse = await axios.get("https://api.spotify.com/v1/me", {
      headers: { Authorization: `Bearer ${access_token}` },
    });

    const user = userResponse.data;

    console.log("Spotify user:", user);

    // TODO: Save user and tokens in your database here (later step)

    // Generate a temporary session code
    const sessionCode = generateSessionCode();
    
    // Store the tokens and user data temporarily (expires in 5 minutes)
    sessionStore.set(sessionCode, {
      access_token,
      refresh_token,
      user,
      expires_at: Date.now() + (5 * 60 * 1000), // 5 minutes from now
    });

    // Redirect back to the app with the session code
    const successUrl = appRedirectUri 
      ? `${appRedirectUri}?code=${sessionCode}`
      : `exp://127.0.0.1:19000/--/?code=${sessionCode}`;
    
    res.redirect(successUrl);

  } catch (error: any) {
    console.error("Spotify Auth Error:", error.response?.data || error.message);
    
    const errorUrl = appRedirectUri 
      ? `${appRedirectUri}?error=authentication_failed`
      : `exp://127.0.0.1:19000/--/?error=authentication_failed`;
    
    res.redirect(errorUrl);
  }
});

// Step 3: Exchange session code for tokens (called by the app)
app.get("/auth/exchange", (req, res) => {
  const sessionCode = req.query.code as string;

  if (!sessionCode) {
    return res.status(400).json({ 
      success: false, 
      error: "code parameter is required" 
    });
  }

  const sessionData = sessionStore.get(sessionCode);

  if (!sessionData) {
    return res.status(404).json({ 
      success: false, 
      error: "Invalid or expired session code" 
    });
  }

  // Delete the session code after use (one-time use)
  sessionStore.delete(sessionCode);

  // Return the tokens and user data
  res.json({
    success: true,
    access_token: sessionData.access_token,
    refresh_token: sessionData.refresh_token,
    user: sessionData.user,
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`✅ Server listening on port ${PORT}`);
});