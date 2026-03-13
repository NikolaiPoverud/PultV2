import { app } from '@azure/functions';
import { BlobServiceClient } from '@azure/storage-blob';

function parseClientPrincipal(req) {
  const header = req.headers.get('x-ms-client-principal');
  if (!header) return null;
  const decoded = JSON.parse(Buffer.from(header, 'base64').toString('utf-8'));
  return {
    userId: decoded.userId,
    userDetails: decoded.userDetails,
    claims: decoded.claims || [],
  };
}

function isValidDate(dateStr) {
  return /^\d{4}-\d{2}-\d{2}$/.test(dateStr) && !isNaN(Date.parse(dateStr));
}

function isWeekday(dateStr) {
  const day = new Date(dateStr + 'T00:00:00Z').getUTCDay();
  return day !== 0 && day !== 6;
}

function isWithinRange(dateStr) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(dateStr + 'T00:00:00Z');
  const maxDate = new Date(today);
  maxDate.setDate(maxDate.getDate() + 14);
  return target >= today && target <= maxDate;
}

app.http('getBookings', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'bookings',
  handler: async (req, context) => {
    const principal = parseClientPrincipal(req);
    if (!principal) {
      return { status: 401, jsonBody: { error: 'Unauthorized' } };
    }

    const url = new URL(req.url);
    const date = url.searchParams.get('date');

    if (!date || !isValidDate(date)) {
      return { status: 400, jsonBody: { error: 'Invalid date format. Use YYYY-MM-DD.' } };
    }

    if (!isWeekday(date)) {
      return { status: 400, jsonBody: { error: 'Only weekdays are allowed.' } };
    }

    if (!isWithinRange(date)) {
      return { status: 400, jsonBody: { error: 'Date must be within the next 2 weeks.' } };
    }

    try {
      const connectionString = process.env.STORAGE_CONNECTION_STRING;
      const blobService = BlobServiceClient.fromConnectionString(connectionString);
      const container = blobService.getContainerClient('bookings');
      const blob = container.getBlockBlobClient(`${date}.json`);

      const exists = await blob.exists();
      if (!exists) {
        return { jsonBody: { date, bookings: [] } };
      }

      const downloaded = await blob.download(0);
      const body = await streamToString(downloaded.readableStreamBody);
      const data = JSON.parse(body);

      return { jsonBody: data };
    } catch (err) {
      context.log('Error reading bookings:', err.message);
      return { status: 500, jsonBody: { error: 'Failed to read bookings.' } };
    }
  },
});

async function streamToString(stream) {
  const chunks = [];
  for await (const chunk of stream) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks).toString('utf-8');
}
