const API = {
  async getUser() {
    const res = await fetch('/.auth/me');
    const data = await res.json();
    if (data.clientPrincipal) {
      const claims = data.clientPrincipal.claims || [];
      const email =
        claims.find((c) => c.typ === 'preferred_username')?.val ||
        claims.find((c) => c.typ === 'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress')?.val ||
        data.clientPrincipal.userDetails;
      const name =
        claims.find((c) => c.typ === 'name')?.val ||
        data.clientPrincipal.userDetails;
      return {
        userId: data.clientPrincipal.userId,
        email,
        name,
      };
    }
    return null;
  },

  async getBookings(date) {
    const res = await fetch(`/api/bookings?date=${encodeURIComponent(date)}`);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Failed to fetch bookings');
    }
    return res.json();
  },

  async createBooking(date, deskId) {
    const res = await fetch('/api/bookings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ date, deskId }),
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'Failed to create booking');
    }
    return data;
  },

  async deleteBooking(date, deskId) {
    const res = await fetch(`/api/bookings?date=${encodeURIComponent(date)}&deskId=${encodeURIComponent(deskId)}`, {
      method: 'DELETE',
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'Failed to delete booking');
    }
    return data;
  },

  getPhotoUrl(email) {
    return `/api/user-photo?email=${encodeURIComponent(email)}`;
  },
};

export default API;
