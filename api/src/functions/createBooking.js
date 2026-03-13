import { app } from '@azure/functions';
import { BlobServiceClient } from '@azure/storage-blob';

function parseClientPrincipal(req) {
  const header = req.headers.get('x-ms-client-principal');
  if (!header) return null;
  const decoded = JSON.parse(Buffer.from(header, 'base64').toString('utf-8'));
  const emailClaim = (decoded.claims || []).find(
    (c) => c.typ === 'preferred_username' || c.typ === 'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress'
  );
  const nameClaim = (decoded.claims || []).find(
    (c) => c.typ === 'name' || c.typ === 'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name'
  );
  return {
    userId: decoded.userId,
    userEmail: emailClaim?.val || decoded.userDetails,
    userName: nameClaim?.val || decoded.userDetails,
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

app.http('createBooking', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'bookings',
  handler: async (req, context) => {
    const principal = parseClientPrincipal(req);
    if (!principal) {
      return { status: 401, jsonBody: { error: 'Unauthorized' } };
    }

    let body;
    try {
      body = await req.json();
    } catch {
      return { status: 400, jsonBody: { error: 'Invalid JSON body.' } };
    }

    const { date, deskId } = body;

    if (!date || !isValidDate(date)) {
      return { status: 400, jsonBody: { error: 'Invalid date format. Use YYYY-MM-DD.' } };
    }

    if (!isWeekday(date)) {
      return { status: 400, jsonBody: { error: 'Only weekdays are allowed.' } };
    }

    if (!isWithinRange(date)) {
      return { status: 400, jsonBody: { error: 'Date must be within the next 2 weeks.' } };
    }

    if (!deskId || typeof deskId !== 'string') {
      return { status: 400, jsonBody: { error: 'deskId is required.' } };
    }

    try {
      const connectionString = process.env.STORAGE_CONNECTION_STRING;
      const blobService = BlobServiceClient.fromConnectionString(connectionString);
      const container = blobService.getContainerClient('bookings');
      await container.createIfNotExists();

      const blob = container.getBlockBlobClient(`${date}.json`);

      let data = { date, bookings: [] };
      const exists = await blob.exists();
      if (exists) {
        const downloaded = await blob.download(0);
        const content = await streamToString(downloaded.readableStreamBody);
        data = JSON.parse(content);
      }

      // Check: one desk per day per user
      const existingUserBooking = data.bookings.find((b) => b.userId === principal.userId);
      if (existingUserBooking) {
        return {
          status: 409,
          jsonBody: { error: 'You already have a booking on this date.', existingDeskId: existingUserBooking.deskId },
        };
      }

      // Check: desk not already booked
      const existingDeskBooking = data.bookings.find((b) => b.deskId === deskId);
      if (existingDeskBooking) {
        return { status: 409, jsonBody: { error: 'This desk is already booked.' } };
      }

      data.bookings.push({
        deskId,
        userId: principal.userId,
        userEmail: principal.userEmail,
        userName: principal.userName,
        bookedAt: new Date().toISOString(),
      });

      await blob.upload(JSON.stringify(data, null, 2), Buffer.byteLength(JSON.stringify(data, null, 2)), {
        blobHTTPHeaders: { blobContentType: 'application/json' },
      });

      return { status: 201, jsonBody: { message: 'Booking created.', deskId, date } };
    } catch (err) {
      context.log('Error creating booking:', err.message);
      return { status: 500, jsonBody: { error: 'Failed to create booking.' } };
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
