class SpotifyApi {
  constructor() {
    this.clientId = process.env.SPOTIFY_CLIENT_ID;
    this.clientSecret = process.env.SPOTIFY_CLIENT_SECRET;
    this.token = null;
    this.tokenExpiration = null;
  }

  async getAccessToken() {
    // Refresh token if necessary
    if (this.token && this.tokenExpiration > Date.now()) {
      return this.token;
    }

    if (!this.clientId || !this.clientSecret) {
      throw new Error('Spotify credentials not configured in .env file on the server');
    }

    const auth = Buffer.from(`${this.clientId}:${this.clientSecret}`).toString('base64');
    
    try {
      const response = await fetch('https://accounts.spotify.com/api/token', {
        method: 'POST',
        headers: {
          'Authorization': `Basic ${auth}`,
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: 'grant_type=client_credentials'
      });

      if (!response.ok) {
        throw new Error(`Failed to get Spotify token: ${response.statusText}`);
      }

      const data = await response.json();
      this.token = data.access_token;
      this.tokenExpiration = Date.now() + (data.expires_in - 60) * 1000;
      
      return this.token;
    } catch (error) {
      console.error('Error fetching Spotify token:', error);
      throw new Error('Failed to authenticate with Spotify');
    }
  }

  // --- NEW: User Authorization Code Flow for Web Playback SDK ---
  getAuthorizationUrl() {
    const scope = 'streaming user-read-email user-read-private user-modify-playback-state';
    // Use the redirect URI configured in your Spotify Developer Dashboard. 
    // We assume http://localhost:5173/presenter/callback for the client to capture the token.
    const redirectUri = encodeURIComponent('http://localhost:5173/presenter/dashboard');
    const authUrl = `https://accounts.spotify.com/authorize?response_type=token&client_id=${this.clientId}&scope=${encodeURIComponent(scope)}&redirect_uri=${redirectUri}`;
    return authUrl;
  }
  
  // Note: For simplicity in a single-page app, we can use the Implicit Grant flow (response_type=token) 
  // which returns the token directly to the frontend URL hash, avoiding the need for a backend callback endpoint 
  // just for the player token if we only need it on the client. 
  // We'll let the client handle the token extraction from the hash.

  async getPlaylist(playlistId) {
    const token = await this.getAccessToken();
    
    // Fetch playlist details including nested track data
    const url = `https://api.spotify.com/v1/playlists/${playlistId}?fields=name,description,images,tracks.items(track(id,name,artists,preview_url,album(images),uri))`;
    
    try {
      const response = await fetch(url, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch playlist: ${response.statusText}`);
      }

      const data = await response.json();
      
      // Map the tracks to a clean object for the game
      const tracks = data.tracks.items
        .map(item => item.track)
        .filter(track => track && track.id) // Ensure valid track
        .map(track => ({
          id: track.id,
          name: track.name,
          artist: track.artists.map(a => a.name).join(', '),
          previewUrl: track.preview_url, // For Free users (30s)
          uri: track.uri,               // For Premium users (Full playback SDK)
          imageUrl: track.album?.images?.[0]?.url || null
        }));

      return {
        name: data.name,
        images: data.images,
        tracks: tracks
      };
    } catch (error) {
      console.error('Error fetching playlist:', error);
      throw new Error('Failed to fetch playlist from Spotify');
    }
  }
}

module.exports = new SpotifyApi();
