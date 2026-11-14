import { db, audit } from '../db.js';
import { requireAuth } from '../auth.js';

/**
 * Extensible import adapter architecture.
 *
 * Each adapter declares its platform, URL patterns, and the authorization it
 * requires. An adapter is only "active" when its required credentials are
 * configured server-side. Adapters NEVER bypass platform restrictions,
 * authentication, DRM, or access controls: they only process media the
 * creator is authorized to use through official APIs.
 */
const ADAPTERS = [
  {
    id: 'youtube',
    platform: 'YouTube',
    patterns: [/^https?:\/\/(www\.|m\.)?(youtube\.com\/watch\?|youtube\.com\/shorts\/|youtu\.be\/)/i],
    authRequired: 'YOUTUBE_API_KEY + OAuth creator consent (YouTube Data API v3)',
    envKeys: ['YOUTUBE_API_KEY'],
    docs: 'https://developers.google.com/youtube/v3/guides/uploading',
  },
  {
    id: 'instagram',
    platform: 'Instagram',
    patterns: [/^https?:\/\/(www\.)?instagram\.com\/(reel|p|tv)\//i],
    authRequired: 'Instagram Graph API app review + creator account authorization',
    envKeys: ['INSTAGRAM_ACCESS_TOKEN'],
    docs: 'https://developers.facebook.com/docs/instagram-api',
  },
  {
    id: 'tiktok',
    platform: 'TikTok',
    patterns: [/^https?:\/\/(www\.)?tiktok\.com\/@[\w.\-]+\/video\/\d+/i],
    authRequired: 'TikTok Content Posting API / Display API approval',
    envKeys: ['TIKTOK_ACCESS_TOKEN'],
    docs: 'https://developers.tiktok.com/doc/content-posting-api-get-started',
  },
  {
    id: 'x',
    platform: 'X (Twitter)',
    patterns: [/^https?:\/\/(www\.)?(x\.com|twitter\.com)\/\w+\/status\/\d+/i],
    authRequired: 'X API v2 access with media library scope',
    envKeys: ['X_API_BEARER_TOKEN'],
    docs: 'https://developer.x.com/en/docs/x-api',
  },
  {
    id: 'facebook',
    platform: 'Facebook',
    patterns: [/^https?:\/\/(www\.|m\.)?facebook\.com\/.+\/videos\/|fb\.watch\//i],
    authRequired: 'Facebook Graph API + page/video permissions',
    envKeys: ['FACEBOOK_ACCESS_TOKEN'],
    docs: 'https://developers.facebook.com/docs/video-api',
  },
  {
    id: 'twitch',
    platform: 'Twitch',
    patterns: [/^https?:\/\/(www\.)?twitch\.tv\/\w+|clips\.twitch\.tv\//i],
    authRequired: 'Twitch API (Helix) client credentials + broadcaster consent',
    envKeys: ['TWITCH_CLIENT_ID', 'TWITCH_CLIENT_SECRET'],
    docs: 'https://dev.twitch.tv/docs/api',
  },
];

function adapterStatus(a) {
  const configured = a.envKeys.every((k) => Boolean(process.env[k]));
  return {
    id: a.id,
    platform: a.platform,
    active: configured,
    authRequired: a.authRequired,
    docs: a.docs,
    message: configured
      ? null
      : `Importing from ${a.platform} requires official API authorization that is not configured on this server. Upload the video file directly instead — that always works.`,
  };
}

export function registerImportRoutes(app) {
  app.get('/api/imports/adapters', { preHandler: requireAuth }, async () => {
    return { adapters: ADAPTERS.map(adapterStatus) };
  });

  app.post('/api/imports/resolve', { preHandler: requireAuth }, async (req, reply) => {
    const { url } = req.body || {};
    if (!url || typeof url !== 'string') {
      return reply.code(422).send({ error: 'A video URL is required.' });
    }
    const adapter = ADAPTERS.find((a) => a.patterns.some((p) => p.test(url)));
    if (!adapter) {
      return reply.code(422).send({
        error: 'This link is not from a supported platform. Supported platforms: YouTube, Instagram, TikTok, X, Facebook, Twitch. You can always upload the video file directly.',
        adapters: ADAPTERS.map(adapterStatus),
      });
    }
    const status = adapterStatus(adapter);
    if (!status.active) {
      return reply.code(409).send({
        error: status.message,
        platform: adapter.platform,
        authRequired: adapter.authRequired,
        alternative: 'upload',
        adapters: ADAPTERS.map(adapterStatus),
      });
    }
    // Active adapters would perform an authorized API fetch here. None are
    // activated by default; when credentials exist the adapter implementation
    // is plugged in below this line.
    return reply.code(501).send({
      error: `${adapter.platform} import is authorized on this server but the download worker is not deployed in this environment. Upload the file directly.`,
      platform: adapter.platform,
      alternative: 'upload',
    });
  });
}
