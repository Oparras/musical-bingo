class SpotifyApi {
  constructor() {
    this.clientId = process.env.SPOTIFY_CLIENT_ID;
    this.clientSecret = process.env.SPOTIFY_CLIENT_SECRET;
    this.token = null;
    this.tokenExpiration = null;
    this.playlistCache = new Map();
  }

  mapTrack(track) {
    return {
      id: track.id,
      name: track.name,
      artist: track.artists.map((artist) => artist.name).join(', '),
      previewUrl: track.preview_url,
      uri: track.uri,
      imageUrl: track.album?.images?.[0]?.url || null
    };
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

  async fetchPlaylistTracks(playlistId, token) {
    const tracks = [];
    let nextUrl = `https://api.spotify.com/v1/playlists/${playlistId}/tracks?limit=100&fields=items(track(id,name,artists,preview_url,album(images),uri)),next`;

    while (nextUrl) {
      const response = await fetch(nextUrl, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch playlist tracks: ${response.statusText}`);
      }

      const data = await response.json();
      const pageTracks = (data.items || [])
        .map((item) => item.track)
        .filter((track) => track && track.id)
        .map((track) => this.mapTrack(track));

      tracks.push(...pageTracks);
      nextUrl = data.next;
    }

    return tracks;
  }

  async getPlaylist(playlistId) {
    const cachedEntry = this.playlistCache.get(playlistId);
    if (cachedEntry && cachedEntry.expiresAt > Date.now()) {
      return cachedEntry.data;
    }

    const token = await this.getAccessToken();
    
    // Fetch playlist metadata first, then paginate all tracks separately.
    const url = `https://api.spotify.com/v1/playlists/${playlistId}?fields=name,description,images`;
    
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
      const tracks = await this.fetchPlaylistTracks(playlistId, token);

      const playlistData = {
        name: data.name,
        images: data.images,
        tracks: tracks
      };

      this.playlistCache.set(playlistId, {
        data: playlistData,
        expiresAt: Date.now() + 10 * 60 * 1000
      });

      return playlistData;
    } catch (error) {
      console.error('Error fetching playlist:', error);
      throw new Error('Failed to fetch playlist from Spotify');
    }
  }
}

module.exports = new SpotifyApi();
