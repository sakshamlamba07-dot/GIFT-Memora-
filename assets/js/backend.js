/* ============================================================
   The Giftè Memora — backend (Supabase)
   Auth, order storage, a customer dashboard, a studio admin panel
   and public reviews — same feature set as the reference build,
   wired to this project's own Supabase instance.
   ============================================================ */
(function () {
'use strict';

/* Project: gifte-memora-site (kept separate from the studio's original
   Supabase project on purpose — this is a different backend). */
const SUPABASE_URL = 'https://eiktdtesxvzriemtytdo.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVpa3RkdGVzeHZ6cmllbXR5dGRvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODk1NTU0MDgsImV4cCI6MjEwNTEzMTQwOH0.6bf1p3Nu_tLZLRdoKC_AzXIUdx7OIvIWXyGE3jdcCUw';
const ADMIN_EMAIL   = 'thegiftememora@gmail.com';

if (!window.supabase || !window.supabase.createClient){
  console.warn('[memora] Supabase SDK did not load — backend features are disabled.');
  return;
}
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

const $  = s => document.querySelector(s);
const $$ = s => [].slice.call(document.querySelectorAll(s));
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => (
  { '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));

let currentUser = null;

/* ---------------------------------------------------------- toast */
let toastT = null;
function showToast(msg){
  const t = $('#toast'); if (!t) return;
  t.textContent = msg; t.classList.add('show');
  clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), 3600);
}

/* ---------------------------------------------------------- modal helpers */
function openModal(el){ el.classList.add('show'); }
function closeModal(el){ el.classList.remove('show'); }

function wireModalChrome(){
  const auth = $('#authModal');
  $('#authClose').addEventListener('click', () => closeModal(auth));
  auth.addEventListener('click', e => { if (e.target === auth) closeModal(auth); });

  const dash = $('#dashPanel');
  $('#dashClose').addEventListener('click', () => closeModal(dash));
  dash.addEventListener('click', e => { if (e.target === dash) closeModal(dash); });

  const admin = $('#adminPanel');
  $('#adminClose').addEventListener('click', () => closeModal(admin));
  admin.addEventListener('click', e => { if (e.target === admin) closeModal(admin); });

  addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    [auth, dash, admin].forEach(closeModal);
  });

  $('#tabLogin').addEventListener('click', () => switchTab('login'));
  $('#tabSignup').addEventListener('click', () => switchTab('signup'));
}
function switchTab(which){
  const login = which === 'login';
  $('#tabLogin').classList.toggle('on', login);
  $('#tabSignup').classList.toggle('on', !login);
  $('#loginForm').style.display = login ? '' : 'none';
  $('#signupForm').style.display = login ? 'none' : '';
}

/* ---------------------------------------------------------- account button */
function wireAccountButton(){
  const acct = $('#acct'), btn = $('#acctBtn');
  btn.addEventListener('click', () => {
    if (currentUser){ acct.classList.toggle('open'); }
    else { switchTab('login'); openModal($('#authModal')); }
  });
  document.addEventListener('click', e => {
    if (!acct.contains(e.target)) acct.classList.remove('open');
  });
  $('#acctOrders').addEventListener('click', () => { acct.classList.remove('open'); openDashboard(); });
  $('#acctAdmin').addEventListener('click',  () => { acct.classList.remove('open'); openAdmin(); });
  $('#acctSignout').addEventListener('click', async () => {
    acct.classList.remove('open');
    await sb.auth.signOut();
  });
}

/* ---------------------------------------------------------- auth forms */
function wireAuthForms(){
  $('#loginForm').addEventListener('submit', async e => {
    e.preventDefault();
    const msg = $('#loginMsg'); msg.className = 'modal-msg'; msg.textContent = 'Signing in…';
    const { error } = await sb.auth.signInWithPassword({
      email: $('#loginEmail').value.trim(),
      password: $('#loginPass').value
    });
    if (error){ msg.className = 'modal-msg err'; msg.textContent = error.message; return; }
    msg.className = 'modal-msg ok'; msg.textContent = 'Welcome back.';
    setTimeout(() => closeModal($('#authModal')), 500);
  });

  $('#signupForm').addEventListener('submit', async e => {
    e.preventDefault();
    const msg = $('#signupMsg'); msg.className = 'modal-msg'; msg.textContent = 'Creating your account…';
    const { error } = await sb.auth.signUp({
      email: $('#signupEmail').value.trim(),
      password: $('#signupPass').value,
      options: { data: { name: $('#signupName').value.trim() } }
    });
    if (error){ msg.className = 'modal-msg err'; msg.textContent = error.message; return; }
    msg.className = 'modal-msg ok';
    msg.textContent = 'Account created — check your email if confirmation is required.';
    setTimeout(() => closeModal($('#authModal')), 900);
  });
}

/* ---------------------------------------------------------- auth state */
function reflectAuthUI(){
  const btn = $('#acctBtn'), adminItem = $('#acctAdmin');
  if (currentUser){
    btn.textContent = (currentUser.user_metadata && currentUser.user_metadata.name) || 'Account';
    adminItem.style.display = currentUser.email === ADMIN_EMAIL ? '' : 'none';
  } else {
    btn.textContent = 'Sign In';
    adminItem.style.display = 'none';
  }
}

function wireAuthState(){
  sb.auth.getSession().then(({ data }) => {
    currentUser = data.session ? data.session.user : null;
    reflectAuthUI();
    prefillOrderForm();
  });
  sb.auth.onAuthStateChange((_evt, session) => {
    currentUser = session ? session.user : null;
    reflectAuthUI();
    prefillOrderForm();
    if (!currentUser){ closeModal($('#dashPanel')); closeModal($('#adminPanel')); }
  });
}

function prefillOrderForm(){
  const email = $('#oform [name="email"]');
  if (email && currentUser && !email.value) email.value = currentUser.email || '';
}

/* ---------------------------------------------------------- orders: submit */
function statusLabel(s){
  return { pending:'Pending', confirmed:'Confirmed', 'in progress':'In Progress', delivered:'Delivered' }[s] || s;
}
function statusClass(s){
  return { pending:'pending', confirmed:'confirmed', 'in progress':'progress', delivered:'delivered' }[s] || 'pending';
}
function parseAmount(productText){
  const m = /[—-]\s*(₹[\d,]+)/.exec(productText || '');
  return m ? m[1] : '';
}

function wireOrderSubmit(){
  window.MemoraBackend = window.MemoraBackend || {};
  window.MemoraBackend.submitOrder = async (f, note) => {
    const d = new FormData(f);
    const btn = f.querySelector('button[type="submit"]');
    if (btn) btn.setAttribute('disabled', 'true');
    note.textContent = 'Sending your order…';
    const { error } = await sb.from('orders').insert({
      user_id: currentUser ? currentUser.id : null,
      name: d.get('name') || '',
      email: d.get('email') || '',
      phone: d.get('phone') || '',
      product: d.get('product') || '',
      address: d.get('address') || '',
      customization: [d.get('occasion') ? 'Occasion: ' + d.get('occasion') : '', d.get('custom') || '']
        .filter(Boolean).join(' — '),
      amount: parseAmount(d.get('product'))
    });
    if (btn) btn.removeAttribute('disabled');
    if (error){
      note.textContent = "Couldn't send that — please try WhatsApp/Instagram instead, or try again.";
      showToast('Order failed: ' + error.message);
      return;
    }
    note.textContent = 'Order received — we reply within 24 hours. Thank you!';
    showToast('Order placed! We\u2019ll be in touch soon.');
    f.reset();
  };
}

/* ---------------------------------------------------------- dashboard */
async function openDashboard(){
  if (!currentUser){ switchTab('login'); openModal($('#authModal')); return; }
  const body = $('#myOrders');
  body.innerHTML = '<p class="no-orders">Loading…</p>';
  openModal($('#dashPanel'));
  const { data, error } = await sb.from('orders').select('*')
    .eq('user_id', currentUser.id).order('created_at', { ascending:false });
  if (error){ body.innerHTML = '<p class="no-orders">Could not load your orders.</p>'; return; }
  if (!data || !data.length){ body.innerHTML = '<p class="no-orders">No orders yet — place your first one below.</p>'; return; }
  body.innerHTML = data.map(o => (
    '<div class="ord-card"><div><h4>' + esc(o.product) + '</h4><p>' +
    new Date(o.created_at).toLocaleDateString('en-IN', { day:'numeric', month:'short', year:'numeric' }) +
    (o.amount ? ' · ' + esc(o.amount) : '') + '</p></div>' +
    '<span class="status-pill ' + statusClass(o.status) + '">' + esc(statusLabel(o.status)) + '</span></div>'
  )).join('');
}

/* ---------------------------------------------------------- admin */
async function openAdmin(){
  if (!currentUser || currentUser.email !== ADMIN_EMAIL){ showToast('Admin access only.'); return; }
  openModal($('#adminPanel'));
  const ordersBody = $('#adminOrdersBody'), reviewsBody = $('#adminReviewsBody');
  ordersBody.innerHTML = '<tr><td colspan="7">Loading…</td></tr>';
  reviewsBody.innerHTML = '<tr><td colspan="5">Loading…</td></tr>';

  const [{ data:orders, error:oErr }, { data:reviews, error:rErr }] = await Promise.all([
    sb.from('orders').select('*').order('created_at', { ascending:false }),
    sb.from('reviews').select('*').order('created_at', { ascending:false })
  ]);

  $('#statOrders').textContent = orders ? orders.length : 0;
  $('#statPending').textContent = orders ? orders.filter(o => o.status === 'pending').length : 0;
  $('#statReviews').textContent = reviews ? reviews.length : 0;

  if (oErr || !orders || !orders.length){
    ordersBody.innerHTML = '<tr><td colspan="7">' + (oErr ? 'Could not load orders.' : 'No orders yet.') + '</td></tr>';
  } else {
    ordersBody.innerHTML = orders.map(o => (
      '<tr data-id="' + o.id + '"><td>' +
      new Date(o.created_at).toLocaleDateString('en-IN', { day:'numeric', month:'short' }) + '</td>' +
      '<td>' + esc(o.name) + '</td>' +
      '<td>' + esc(o.email) + (o.phone ? '<br>' + esc(o.phone) : '') + '</td>' +
      '<td>' + esc(o.product) + '</td>' +
      '<td>' + esc(o.address) + (o.customization ? '<br><i>' + esc(o.customization) + '</i>' : '') + '</td>' +
      '<td>' + esc(o.amount) + '</td>' +
      '<td><select class="status-select" data-id="' + o.id + '">' +
        ['pending','confirmed','in progress','delivered'].map(s =>
          '<option value="' + s + '"' + (s === o.status ? ' selected' : '') + '>' + statusLabel(s) + '</option>'
        ).join('') +
      '</select></td></tr>'
    )).join('');
    $$('#adminOrdersBody .status-select').forEach(sel => {
      sel.addEventListener('change', async () => {
        const { error } = await sb.from('orders').update({ status: sel.value }).eq('id', sel.dataset.id);
        showToast(error ? 'Could not update status.' : 'Status updated.');
      });
    });
  }

  if (rErr || !reviews || !reviews.length){
    reviewsBody.innerHTML = '<tr><td colspan="5">' + (rErr ? 'Could not load reviews.' : 'No reviews yet.') + '</td></tr>';
  } else {
    reviewsBody.innerHTML = reviews.map(r => (
      '<tr><td>' + new Date(r.created_at).toLocaleDateString('en-IN', { day:'numeric', month:'short' }) + '</td>' +
      '<td>' + esc(r.name) + '</td><td>' + esc(r.product) + '</td>' +
      '<td>' + '★'.repeat(r.stars) + '</td><td>' + esc(r.review) + '</td></tr>'
    )).join('');
  }
}

/* ---------------------------------------------------------- public reviews */
let pubStarValue = 0;
function wirePublicReviews(){
  $$('.pub-star').forEach(b => {
    b.addEventListener('click', () => {
      pubStarValue = parseInt(b.dataset.v, 10);
      $$('.pub-star').forEach(s => s.classList.toggle('on', parseInt(s.dataset.v,10) <= pubStarValue));
    });
  });
  $('#pubSubmit').addEventListener('click', async () => {
    const msg = $('#pubMsg'), name = $('#pubName').value.trim(),
      product = $('#pubProduct').value.trim(), text = $('#pubText').value.trim();
    if (!name || !text || !pubStarValue){
      msg.className = 'modal-msg err'; msg.textContent = 'Please add your name, a rating and a few words.';
      return;
    }
    msg.className = 'modal-msg'; msg.textContent = 'Submitting…';
    const { error } = await sb.from('reviews').insert({ name, product, review: text, stars: pubStarValue });
    if (error){ msg.className = 'modal-msg err'; msg.textContent = error.message; return; }
    msg.className = 'modal-msg ok'; msg.textContent = 'Thank you — your review is live below.';
    $('#pubName').value = ''; $('#pubProduct').value = ''; $('#pubText').value = '';
    pubStarValue = 0; $$('.pub-star').forEach(s => s.classList.remove('on'));
    loadPublicReviews();
    showToast('Thank you for the review!');
  });
}

async function loadPublicReviews(){
  const wrap = $('#liveReviews'); if (!wrap) return;
  const { data, error } = await sb.from('reviews').select('*').order('created_at', { ascending:false }).limit(20);
  if (error || !data || !data.length){
    wrap.innerHTML = '<p class="rev-empty">Be the first to leave a review.</p>';
    return;
  }
  wrap.innerHTML = data.map(r => (
    '<div class="live-rev-item"><div class="live-rev-top"><span class="live-rev-name">' + esc(r.name) +
    '</span><span class="live-rev-stars">' + '★'.repeat(r.stars) + '</span></div>' +
    (r.product ? '<div class="live-rev-prod">' + esc(r.product) + '</div>' : '') +
    '<p class="live-rev-text">' + esc(r.review) + '</p></div>'
  )).join('');
}

/* ---------------------------------------------------------------- boot */
function boot(){
  wireModalChrome();
  wireAccountButton();
  wireAuthForms();
  wireAuthState();
  wireOrderSubmit();
  wirePublicReviews();
  loadPublicReviews();
}
if (document.readyState === 'complete' || document.readyState === 'interactive') setTimeout(boot, 0);
else addEventListener('DOMContentLoaded', boot);
})();
