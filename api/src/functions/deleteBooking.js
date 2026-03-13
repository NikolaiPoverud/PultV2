import { app } from '@azure/functions';
import { BlobServiceClient } from '@azure/storage-blob';

function parseClientPrincipal(req) {
  const header = req.headers.get('x-ms-client-principal');
  if (!header) return null;
  const decoded = JSON.parse(Buffer.from(header, 'base64').toString('utf-8'));
  return {
    userId: decoded.userId,
    userDetails: decoded.userDetails,
  };
}

function isValidDate(dateStr) {
  return /^\d{4}-\d{2}-\d{2}$/.test(dateStr) && !isNaN(Date.parse(dateStr));
}

app.http('deleteBooking', {
  methods: ['DELETE'],
  authLevel: 'anonymous',
  route: 'bookings',
  handler: async (req, context) => {
    const principal = parseClientPrincipal(req);
    if (!principal) {
      return { status: 401, jsonBody: { error: 'Unauthorized' } };
    }

    const url = new URL(req.url);
    const date = url.searchParams.get('date');
    const deskId = url.searchParams.get('deskId');

    if (!date || !isValidDate(date)) {
      return { status: 400, jsonBody: { error: 'Invalid date format. Use YYYY-MM-DD.' } };
    }

    if (!deskId) {
      return { status: 400, jsonBody: { error: 'deskId is required.' } };
    }

    try {
      const connectionString = process.env.STORAGE_CONNECTION_STRING;
      const blobService = BlobServiceClient.fromConnectionString(connectionString);
      const container = blobService.getContainerClient('bookings');
      const blob = container.getBlockBlobClient(`${date}.json`);

      const exists = await blob.exists();
      if (!exists) {
        return { status: 404, jsonBody: { error: 'No bookings found for this date.' } };
      }

      const downloaded = await blob.download(0);
      const content = await streamToString(downloaded.readableStreamBody);
      const data = JSON.parse(content);

      const bookingIndex = data.bookings.findIndex((b) => b.deskId === deskId);
      if (bookingIndex === -1) {
        return { status: 404, jsonBody: { error: 'Booking not found.' } };
      }

      // Only allow cancelling own bookings
      if (data.bookings[bookingIndex].userId !== principal.userId) {
        return { status: 403, jsonBody: { error: 'You can only cancel your own bookings.' } };
      }

      data.bookings.splice(bookingIndex, 1);

      await blob.upload(JSON.stringify(data, null, 2), Buffer.byteLength(JSON.stringify(data, null, 2)), {
        blobHTTPHeaders: { blobContentType: 'application/json' },
      });

      return { jsonBody: { message: 'Booking cancelled.', deskId, date } };
    } catch (err) {
      context.log('Error deleting booking:', err.message);
      return { status: 500, jsonBody: { error: 'Failed to delete booking.' } };
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
