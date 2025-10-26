import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { Pool } from "pg";

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

// Start server
app.listen(PORT, () => {
  console.log(`✅ Server listening on port ${PORT}`);
});

import axios from "axios";
import querystring from "querystring";

const CLIENT_ID = process.env.SPOTIFY_CLIENT_ID!;
const CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET!;
const REDIRECT_URI = process.env.SPOTIFY_REDIRECT_URI!;

// Step 1: Redirect user to Spotify's login/authorization page
app.get("/auth/spotify", (req, res) => {
  const scope = [
    "user-read-private",
    "user-read-email",
    "user-top-read",
  ].join(" ");

  const queryParams = querystring.stringify({
    response_type: "code",
    client_id: CLIENT_ID,
    scope,
    redirect_uri: REDIRECT_URI,
  });

  res.redirect(`https://accounts.spotify.com/authorize?${queryParams}`);
});

// Step 2: Spotify redirects back here with ?code=...
app.get("/auth/spotify/callback", async (req, res) => {
  const code = req.query.code as string;

  try {
    // Exchange authorization code for access + refresh tokens
    const tokenResponse = await axios.post(
      "https://accounts.spotify.com/api/token",
      querystring.stringify({
        grant_type: "authorization_code",
        code,
        redirect_uri: REDIRECT_URI,
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

    const { access_token } = tokenResponse.data;

    // Use access token to get the user's Spotify profile
    const userResponse = await axios.get("https://api.spotify.com/v1/me", {
      headers: { Authorization: `Bearer ${access_token}` },
    });

    const user = userResponse.data;

    // TODO: save user in Supabase here (later step)
    console.log("Spotify user:", user);

    // Send user info (and maybe tokens) back to client
    res.json({
      success: true,
      user,
    });
  } catch (error: any) {
    console.error("Spotify Auth Error:", error.response?.data || error.message);
    res.status(500).json({ success: false, error: "Authentication failed" });
  }
});