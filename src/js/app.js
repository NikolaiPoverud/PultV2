import API from './api.js';
import { init as initMap, loadBookingsForDate } from './map.js';

let currentUser = null;
let selectedDate = null;

document.addEventListener('DOMContentLoaded', async () => {
  await initAuth();
  initDatePicker();
  initMap(currentUser);

  // Load today's bookings
  const today = formatDate(new Date());
  selectDate(today);
});

async function initAuth() {
  try {
    currentUser = await API.getUser();
  } catch {
    currentUser = null;
  }

  const userInfo = document.getElementById('user-info');
  if (currentUser) {
    userInfo.textContent = currentUser.name || currentUser.email;
  } else {
    userInfo.innerHTML = '<a href="/.auth/login/aad">Sign in</a>';
  }
}

function initDatePicker() {
  const datePicker = document.getElementById('date-picker');
  const today = new Date();
  const maxDate = new Date(today);
  maxDate.setDate(maxDate.getDate() + 14);

  datePicker.min = formatDate(today);
  datePicker.max = formatDate(maxDate);
  datePicker.value = formatDate(today);

  datePicker.addEventListener('change', (e) => {
    selectDate(e.target.value);
  });

  // Prevent weekend selection
  datePicker.addEventListener('input', (e) => {
    const d = new Date(e.target.value + 'T00:00:00');
    if (d.getDay() === 0 || d.getDay() === 6) {
      e.target.value = selectedDate || formatDate(today);
    }
  });

  renderQuickNav(today, maxDate);
}

function renderQuickNav(today, maxDate) {
  const container = document.getElementById('quick-nav');
  container.innerHTML = '';

  const days = [];
  const d = new Date(today);
  while (d <= maxDate) {
    if (d.getDay() !== 0 && d.getDay() !== 6) {
      days.push(new Date(d));
    }
    d.setDate(d.getDate() + 1);
  }

  days.forEach((day, i) => {
    const btn = document.createElement('button');
    btn.className = 'quick-nav-btn';
    btn.dataset.date = formatDate(day);

    if (i === 0) {
      btn.textContent = 'Today';
    } else if (i === 1) {
      btn.textContent = 'Tomorrow';
    } else {
      btn.textContent = day.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
    }

    btn.addEventListener('click', () => {
      document.getElementById('date-picker').value = formatDate(day);
      selectDate(formatDate(day));
    });

    container.appendChild(btn);
  });
}

function selectDate(date) {
  selectedDate = date;

  // Update active state on quick nav buttons
  document.querySelectorAll('.quick-nav-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.date === date);
  });

  // Update header date display
  const display = document.getElementById('selected-date-display');
  const d = new Date(date + 'T00:00:00');
  display.textContent = d.toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  loadBookingsForDate(date);
}

function formatDate(d) {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
