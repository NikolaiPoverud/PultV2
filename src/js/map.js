import API from './api.js';

let currentUser = null;
let currentDate = null;
let currentBookings = [];
let tooltip = null;

export function init(user) {
  currentUser = user;
  createTooltip();
  loadSvgMap();
}

export async function loadBookingsForDate(date) {
  currentDate = date;
  try {
    const data = await API.getBookings(date);
    currentBookings = data.bookings || [];
    renderBookingState();
  } catch (err) {
    showNotification(err.message, 'error');
  }
}

function createTooltip() {
  tooltip = document.createElement('div');
  tooltip.className = 'desk-tooltip';
  tooltip.style.display = 'none';
  document.body.appendChild(tooltip);
}

async function loadSvgMap() {
  const container = document.getElementById('map-container');
  try {
    const res = await fetch('/assets/office-map.svg');
    const svgText = await res.text();
    container.innerHTML = svgText;
    attachDeskHandlers();
  } catch {
    container.innerHTML = '<p class="error">Failed to load office map.</p>';
  }
}

function attachDeskHandlers() {
  const desks = document.querySelectorAll('.desk');
  desks.forEach((desk) => {
    desk.addEventListener('click', () => handleDeskClick(desk.id));
    desk.addEventListener('mouseenter', (e) => handleDeskHover(e, desk.id));
    desk.addEventListener('mouseleave', () => hideTooltip());
  });
}

async function handleDeskClick(deskId) {
  if (!currentDate) return;

  const booking = currentBookings.find((b) => b.deskId === deskId);

  if (booking) {
    if (booking.userId === currentUser.userId) {
      // Cancel own booking
      if (!confirm('Cancel your booking for this desk?')) return;
      try {
        await API.deleteBooking(currentDate, deskId);
        showNotification('Booking cancelled.', 'success');
        await loadBookingsForDate(currentDate);
      } catch (err) {
        showNotification(err.message, 'error');
      }
    }
    // Clicking someone else's desk does nothing
    return;
  }

  // Book available desk
  try {
    await API.createBooking(currentDate, deskId);
    showNotification(`Booked desk ${deskId.replace('D-', '')}.`, 'success');
    await loadBookingsForDate(currentDate);
  } catch (err) {
    showNotification(err.message, 'error');
  }
}

function handleDeskHover(event, deskId) {
  const booking = currentBookings.find((b) => b.deskId === deskId);
  if (!booking) {
    tooltip.style.display = 'none';
    return;
  }

  const isOwn = booking.userId === currentUser.userId;
  tooltip.textContent = isOwn ? `${booking.userName} (you) — click to cancel` : booking.userName;
  tooltip.style.display = 'block';

  const rect = event.target.closest('.desk').getBoundingClientRect();
  tooltip.style.left = `${rect.left + rect.width / 2 - tooltip.offsetWidth / 2}px`;
  tooltip.style.top = `${rect.top - tooltip.offsetHeight - 8}px`;
}

function hideTooltip() {
  if (tooltip) tooltip.style.display = 'none';
}

function renderBookingState() {
  const desks = document.querySelectorAll('.desk');
  desks.forEach((desk) => {
    const deskId = desk.id;
    const rect = desk.querySelector('.desk-rect');
    const booking = currentBookings.find((b) => b.deskId === deskId);

    // Remove previous state
    desk.classList.remove('booked-mine', 'booked-other');
    const existingPhoto = desk.querySelector('.desk-photo');
    if (existingPhoto) existingPhoto.remove();
    const existingInitials = desk.querySelector('.desk-initials');
    if (existingInitials) existingInitials.remove();

    if (!booking) {
      // Available
      rect.setAttribute('fill', '#e8f5e9');
      rect.setAttribute('stroke', '#66bb6a');
      desk.style.cursor = 'pointer';
      return;
    }

    const isOwn = booking.userId === currentUser.userId;

    if (isOwn) {
      desk.classList.add('booked-mine');
      rect.setAttribute('fill', '#fff3e0');
      rect.setAttribute('stroke', '#F15A22');
      desk.style.cursor = 'pointer';
    } else {
      desk.classList.add('booked-other');
      rect.setAttribute('fill', '#f5f5f5');
      rect.setAttribute('stroke', '#bdbdbd');
      desk.style.cursor = 'default';
    }

    // Add profile photo or initials
    const rectEl = rect;
    const x = parseFloat(rectEl.getAttribute('x'));
    const y = parseFloat(rectEl.getAttribute('y'));
    const w = parseFloat(rectEl.getAttribute('width'));
    const h = parseFloat(rectEl.getAttribute('height'));

    const photoSize = 28;
    const cx = x + w - photoSize - 4;
    const cy = y + 4;

    // Create initials as fallback
    const initials = getInitials(booking.userName);
    const initialsEl = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    initialsEl.classList.add('desk-initials');

    const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    circle.setAttribute('cx', cx + photoSize / 2);
    circle.setAttribute('cy', cy + photoSize / 2);
    circle.setAttribute('r', photoSize / 2);
    circle.setAttribute('fill', stringToColor(booking.userName));
    circle.style.pointerEvents = 'none';

    const initialsText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    initialsText.setAttribute('x', cx + photoSize / 2);
    initialsText.setAttribute('y', cy + photoSize / 2);
    initialsText.setAttribute('text-anchor', 'middle');
    initialsText.setAttribute('dominant-baseline', 'central');
    initialsText.setAttribute('font-size', '11');
    initialsText.setAttribute('fill', '#fff');
    initialsText.setAttribute('font-family', 'system-ui, sans-serif');
    initialsText.setAttribute('font-weight', '600');
    initialsText.textContent = initials;
    initialsText.style.pointerEvents = 'none';

    initialsEl.appendChild(circle);
    initialsEl.appendChild(initialsText);
    desk.appendChild(initialsEl);

    // Try to load photo
    const img = document.createElementNS('http://www.w3.org/2000/svg', 'image');
    img.classList.add('desk-photo');
    img.setAttribute('x', cx);
    img.setAttribute('y', cy);
    img.setAttribute('width', photoSize);
    img.setAttribute('height', photoSize);
    img.setAttribute('clip-path', `circle(${photoSize / 2}px at ${photoSize / 2}px ${photoSize / 2}px)`);
    img.style.pointerEvents = 'none';

    img.addEventListener('load', () => {
      // Photo loaded, remove initials
      const fallback = desk.querySelector('.desk-initials');
      if (fallback) fallback.remove();
    });

    img.addEventListener('error', () => {
      // Photo failed, keep initials, remove image
      img.remove();
    });

    img.setAttributeNS('http://www.w3.org/1999/xlink', 'href', API.getPhotoUrl(booking.userEmail));
    desk.appendChild(img);
  });
}

function getInitials(name) {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0][0].toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function stringToColor(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue}, 45%, 55%)`;
}

function showNotification(message, type) {
  const existing = document.querySelector('.notification');
  if (existing) existing.remove();

  const el = document.createElement('div');
  el.className = `notification notification-${type}`;
  el.textContent = message;
  document.body.appendChild(el);

  setTimeout(() => el.classList.add('show'), 10);
  setTimeout(() => {
    el.classList.remove('show');
    setTimeout(() => el.remove(), 300);
  }, 3000);
}
