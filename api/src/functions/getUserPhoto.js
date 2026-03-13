import { app } from '@azure/functions';
import { BlobServiceClient } from '@azure/storage-blob';

function parseClientPrincipal(req) {
  const header = req.headers.get('x-ms-client-principal');
  if (!header) return null;
  const decoded = JSON.parse(Buffer.from(header, 'base64').toString('utf-8'));
  return { userId: decoded.userId };
}

async function getAccessToken(tenantId, clientId, clientSecret) {
  const url = `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`;
  const params = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: clientId,
    client_secret: clientSecret,
    scope: 'https://graph.microsoft.com/.default',
  });

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });

  if (!res.ok) {
    throw new Error(`Token request failed: ${res.status}`);
  }

  const data = await res.json();
  return data.access_token;
}

app.http('getUserPhoto', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'user-photo',
  handler: async (req, context) => {
    const principal = parseClientPrincipal(req);
    if (!principal) {
      return { status: 401, jsonBody: { error: 'Unauthorized' } };
    }

    const url = new URL(req.url);
    const email = url.searchParams.get('email');

    if (!email) {
      return { status: 400, jsonBody: { error: 'email parameter is required.' } };
    }

    try {
      const connectionString = process.env.STORAGE_CONNECTION_STRING;
      const blobService = BlobServiceClient.fromConnectionString(connectionString);
      const container = blobService.getContainerClient('photos');
      await container.createIfNotExists();

      const safeEmail = email.toLowerCase().replace(/[^a-z0-9@._-]/g, '_');
      const blob = container.getBlockBlobClient(`${safeEmail}.jpg`);

      // Check cache first
      const exists = await blob.exists();
      if (exists) {
        const downloaded = await blob.download(0);
        const chunks = [];
        for await (const chunk of downloaded.readableStreamBody) {
          chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
        }
        const photoBuffer = Buffer.concat(chunks);
        return {
          status: 200,
          headers: {
            'Content-Type': 'image/jpeg',
            'Cache-Control': 'public, max-age=86400',
          },
          body: photoBuffer,
        };
      }

      // Fetch from Microsoft Graph
      const tenantId = process.env.AAD_TENANT_ID;
      const clientId = process.env.AAD_CLIENT_ID;
      const clientSecret = process.env.AAD_CLIENT_SECRET;

      if (!tenantId || !clientId || !clientSecret) {
        return { status: 500, jsonBody: { error: 'Graph API credentials not configured.' } };
      }

      const token = await getAccessToken(tenantId, clientId, clientSecret);

      const graphRes = await fetch(
        `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(email)}/photo/$value`,
        { headers: { Authorization: `Bearer ${token}` } }
      );

      if (!graphRes.ok) {
        return { status: 404, jsonBody: { error: 'Photo not found.' } };
      }

      const photoArrayBuffer = await graphRes.arrayBuffer();
      const photoBuffer = Buffer.from(photoArrayBuffer);

      // Cache in Blob Storage
      await blob.upload(photoBuffer, photoBuffer.length, {
        blobHTTPHeaders: { blobContentType: 'image/jpeg' },
      });

      return {
        status: 200,
        headers: {
          'Content-Type': 'image/jpeg',
          'Cache-Control': 'public, max-age=86400',
        },
        body: photoBuffer,
      };
    } catch (err) {
      context.log('Error fetching user photo:', err.message);
      return { status: 500, jsonBody: { error: 'Failed to fetch photo.' } };
    }
  },
});
