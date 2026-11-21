const root = document.getElementById('adminApp');
let tab = 'overview', stats = {}, products = [], orders = [], enquiries = [], subscribers = [], refreshTimer = null;

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

async function api(url, opts = {}) {
  const response = await fetch(url, { credentials: 'same-origin', headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) }, ...opts });
  let data = {};
  try { data = await response.json(); } catch {}
  if (!response.ok) {
    const error = Error(data.message || 'Request failed');
    error.status = response.status;
    throw error;
  }
  return data;
}

function login(errorMessage = '') {
  root.innerHTML = `<div class="login-wrap"><form class="login-card" id="loginForm"><div class="brand"><img class="logoimg" src="/images/logo.png" alt="Kalaai"/> Kalaai</div><div class="tag">ADMINISTRATION PORTAL</div><h1>Welcome Back</h1><p class="sub">Sign in to manage your storefront</p><label class="field">Username<input name="user" autocomplete="username" required></label><label class="field">Password<input name="pass" type="password" autocomplete="current-password" required placeholder="Enter admin password"></label><p class="error" id="loginError"></p><button class="btn full">Sign In Securely</button><p class="notice">Private access · Kalaai management</p></form></div>`;
  document.getElementById('loginError').textContent = errorMessage;
  document.getElementById('loginForm').onsubmit = async event => {
    event.preventDefault();
    const form = new FormData(event.target);
    try {
      await api('/api/admin/login', { method: 'POST', body: JSON.stringify({ user: form.get('user'), pass: form.get('pass') }) });
      await loadDashboard();
    } catch (error) {
      document.getElementById('loginError').textContent = error.message;
    }
  };
}

async function loadDashboard() {
  try {
    await api('/api/admin/me');
    await refresh();
    render();
    if (!refreshTimer) refreshTimer = setInterval(async () => {
      if (document.hidden || !['overview', 'orders'].includes(tab)) return;
      try {
        await refresh();
        render();
      } catch (error) {
        if (error.status === 401) {
          clearInterval(refreshTimer);
          refreshTimer = null;
          login('Your session expired. Please sign in again.');
        } else {
          showActionError(error);
        }
      }
    }, 15000);
  } catch (error) {
    login(error.status && error.status < 500 ? '' : error.message);
  }
}

async function refresh() {
  [stats, products, orders, enquiries, subscribers] = await Promise.all([
    api('/api/admin/stats'),
    api('/api/admin/products'),
    api('/api/admin/orders'),
    api('/api/admin/enquiries'),
    api('/api/admin/subscribers'),
  ]);
}

function layout(content) {
  root.innerHTML = `<div class="shell"><aside class="sidebar"><div class="sidebrand"><img class="logoimg" src="/images/logo.png" alt="Kalaai"/> Kalaai<small>ADMIN PANEL</small></div><button class="navbtn ${tab === 'overview' ? 'active' : ''}" data-tab="overview">◫ Overview</button><button class="navbtn ${tab === 'products' ? 'active' : ''}" data-tab="products">◇ Products</button><button class="navbtn ${tab === 'orders' ? 'active' : ''}" data-tab="orders">▤ Orders</button><button class="navbtn ${tab === 'enquiries' ? 'active' : ''}" data-tab="enquiries">✉ Enquiries</button><button class="navbtn ${tab === 'subscribers' ? 'active' : ''}" data-tab="subscribers">✉ Newsletter</button><div class="sidebottom"><button class="navbtn" data-action="logout">↪ Sign Out</button></div></aside><main class="main"><div class="topbar"><div><h1>${({overview:'Dashboard Overview',products:'Product Management',orders:'Customer Orders',enquiries:'Customer Enquiries',subscribers:'Newsletter Subscribers'})[tab]}</h1><div class="muted">Manage your Kalaai store</div></div><a class="btn ghost" href="/" target="_blank">View Store ↗</a></div><p class="error action-error" id="actionError" role="alert"></p>${content}</main></div>`;
  root.querySelectorAll('[data-tab]').forEach(button => button.onclick = () => { tab = button.dataset.tab; render(); });
  root.onclick = async event => {
    if (!(event.target instanceof Element)) return;
    const button = event.target.closest('[data-action]');
    if (!button) return;
    switch (button.dataset.action) {
      case 'logout':
        try {
          await api('/api/admin/logout', { method: 'POST' });
          login();
        } catch (error) {
          showActionError(error);
        }
        break;
      case 'add-product':
        productModal();
        break;
      case 'edit-product':
        productModal(Number(button.dataset.id));
        break;
      case 'set-product-active':
        setProductActive(Number(button.dataset.id), button.dataset.active === 'true');
        break;
      case 'close-product-modal':
        document.getElementById('productModal').remove();
        break;
    }
  };
  root.onchange = event => {
    if (!(event.target instanceof Element)) return;
    const select = event.target.closest('[data-action="update-status"]');
    if (select) updateStatus(select.dataset.type, select.dataset.id, select);
  };
}

function render() {
  if (tab === 'overview') {
    return layout(`<div class="stats"><div class="stat"><span>Active Products</span><strong>${stats.products}</strong></div><div class="stat"><span>Total Orders</span><strong>${stats.orders}</strong></div><div class="stat"><span>New Enquiries</span><strong>${stats.newEnquiries}</strong></div><div class="stat"><span>Paid Order Value</span><strong>₹${Number(stats.revenue || 0).toLocaleString('en-IN')}</strong></div></div><div class="panel"><h2>Store activity</h2><p class="muted">You have <b>${stats.newOrders}</b> new orders, <b>${stats.newEnquiries}</b> new enquiries and <b>${stats.subscribers}</b> newsletter subscribers.</p><p class="notice">Paid order value includes only payments verified by the server. Orders must be paid before they can be marked shipped or completed.</p><div class="actions"><button class="btn" data-tab="products">Manage Products</button><button class="btn ghost" data-tab="orders">Review Orders</button></div></div>`);
  }

  if (tab === 'products') {
    layout(`<div class="toolbar"><input id="productSearch" type="search" aria-label="Search products" placeholder="Search products..."><button class="btn" data-action="add-product">＋ Add Product</button></div><div class="tablewrap"><table><thead><tr><th>Image</th><th>Product</th><th>Category</th><th>Price</th><th>Visibility</th><th>Actions</th></tr></thead><tbody id="productRows"></tbody></table></div>`);
    const search = document.getElementById('productSearch');
    search.oninput = () => renderProductRows(search.value);
    renderProductRows();
    return;
  }

  if (tab === 'orders') {
    return layout(`<div class="tablewrap"><table><thead><tr><th>Order</th><th>Customer</th><th>Items / delivery details</th><th>Subtotal</th><th>Shipping</th><th>Total</th><th>Payment</th><th>WhatsApp alert</th><th>Date</th><th>Status</th></tr></thead><tbody>${orders.map(order => `<tr><td>${esc(order.orderNumber)}</td><td>${esc(order.customer?.name)}<br><span class="muted">${esc(order.customer?.email)} · ${esc(order.customer?.phone)}</span></td><td><details><summary>${order.items.length} item(s) · View details</summary><ul>${order.items.map(item => `<li>${esc(item.name)} × ${item.quantity} — ₹${Number(item.price * item.quantity).toLocaleString('en-IN')}${Object.entries(item.custom || {}).filter(([, value]) => value).map(([key, value]) => `<br><span class="muted">${esc(key)}: ${esc(value)}</span>`).join('')}</li>`).join('')}</ul><strong>Delivery address:</strong> ${esc(order.customer?.address)}</details></td><td>₹${Number(order.subtotal).toLocaleString('en-IN')}</td><td>₹${Number(order.shippingFee || 0).toLocaleString('en-IN')}</td><td>₹${Number(order.total || order.subtotal).toLocaleString('en-IN')}</td><td>${esc(order.paymentStatus || 'Not recorded')}</td><td>${esc(order.whatsappNotificationStatus || 'Not configured')}</td><td>${new Date(order.createdAt).toLocaleDateString()}</td><td><select data-action="update-status" data-type="orders" data-id="${order._id}">${['New','Confirmed','In Progress','Shipped','Completed','Cancelled'].map(status => `<option ${order.status === status ? 'selected' : ''}>${status}</option>`).join('')}</select></td></tr>`).join('') || '<tr><td colspan="10" class="empty">No orders received yet.</td></tr>'}</tbody></table></div>`);
  }

  if (tab === 'subscribers') {
    return layout(`<div class="tablewrap"><table><thead><tr><th>Email</th><th>Subscribed</th></tr></thead><tbody>${subscribers.map(subscriber => `<tr><td>${esc(subscriber.email)}</td><td>${new Date(subscriber.createdAt).toLocaleDateString()}</td></tr>`).join('') || '<tr><td colspan="2" class="empty">No newsletter subscribers yet.</td></tr>'}</tbody></table></div><p class="notice">Addresses are stored in Kalaai’s database for the app only. No emails are sent by this site.</p>`);
  }

  return layout(`<div class="tablewrap"><table><thead><tr><th>Received</th><th>Customer</th><th>Type / Category</th><th>Message / Brief</th><th>Reference</th><th>Status</th></tr></thead><tbody>${enquiries.map(enquiry => `<tr><td>${new Date(enquiry.createdAt).toLocaleDateString()}</td><td>${esc(enquiry.name)}<br><span class="muted">${esc(enquiry.email)} · ${esc(enquiry.phone)}</span></td><td>${esc(enquiry.type)}<br>${esc(enquiry.category || enquiry.subject)}</td><td>${esc(enquiry.designDescription || enquiry.message)}</td><td>${enquiry.referenceImage?.url ? `<a href="${esc(enquiry.referenceImage.url)}" target="_blank" rel="noopener noreferrer">${esc(enquiry.referenceImage.originalName || 'View image')}</a>` : '<span class="muted">None</span>'}</td><td><select data-action="update-status" data-type="enquiries" data-id="${enquiry._id}">${['New','Contacted','In Progress','Closed'].map(status => `<option ${status === enquiry.status ? 'selected' : ''}>${status}</option>`).join('')}</select></td></tr>`).join('') || '<tr><td colspan="6" class="empty">No enquiries received yet.</td></tr>'}</tbody></table></div>`);
}

function productRow(product) {
  const action = product.active
    ? `<button class="btn danger small" data-action="set-product-active" data-id="${product.id}" data-active="false">Archive</button>`
    : `<button class="btn ghost small" data-action="set-product-active" data-id="${product.id}" data-active="true">Restore</button>`;
  return `<tr><td><img src="${esc(product.image)}" alt=""></td><td>${esc(product.name)}</td><td>${esc(product.category)}</td><td>₹${Number(product.price).toLocaleString('en-IN')}</td><td><span class="badge">${product.active ? 'Active' : 'Archived'}</span></td><td><div class="actions"><button class="btn ghost small" data-action="edit-product" data-id="${product.id}">Edit</button>${action}</div></td></tr>`;
}

function renderProductRows(query = '') {
  const term = query.trim().toLocaleLowerCase();
  const filtered = products.filter(product => [product.id, product.name, product.category, product.productType, product.description, ...(product.tags || [])]
    .some(value => String(value || '').toLocaleLowerCase().includes(term)));
  document.getElementById('productRows').innerHTML = filtered.map(productRow).join('')
    || `<tr><td colspan="6" class="empty">${term ? 'No matching products.' : 'No products found.'}</td></tr>`;
}

function productModal(id) {
  const product = products.find(item => item.id === id) || {name:'',category:'',productType:'',price:0,description:'',image:'/images/products/catalogue-01.jpg',availability:'Made to Order',featured:false,occasions:[],personalisationTypes:[],tags:[]};
  root.insertAdjacentHTML('beforeend', `<div class="modalback" id="productModal"><form class="modal" id="productForm"><h2>${id ? 'Edit Product' : 'Add Product'}</h2><div class="formgrid"><label class="field">Product name<input name="name" required value="${esc(product.name)}"></label><label class="field">Category<input name="category" required value="${esc(product.category)}"></label><label class="field">Product type<input name="productType" value="${esc(product.productType)}"></label><label class="field">Price (INR)<input name="price" type="number" min="0" step="1" required value="${product.price}"></label><label class="field wide">Image path<input name="image" value="${esc(product.image)}" required><small class="muted">Use an existing /images/products/... path. Upload UI can be added later.</small></label><label class="field wide">Description<textarea name="description" rows="3">${esc(product.description)}</textarea></label><label class="field">Availability<input name="availability" value="${esc(product.availability || 'Made to Order')}"></label><label class="field">Featured<select name="featured"><option value="false" ${!product.featured ? 'selected' : ''}>No</option><option value="true" ${product.featured ? 'selected' : ''}>Yes</option></select></label><label class="field wide">Occasions (comma separated)<input name="occasions" value="${esc((product.occasions || []).join(', '))}"></label><label class="field wide">Personalisation types (comma separated)<input name="personalisationTypes" value="${esc((product.personalisationTypes || []).join(', '))}"></label></div><p class="error" id="productError"></p><div class="modalfoot"><button type="button" class="btn ghost" data-action="close-product-modal">Cancel</button><button class="btn">Save Product</button></div></form></div>`);
  document.getElementById('productForm').onsubmit = async event => {
    event.preventDefault();
    const form = new FormData(event.target), data = Object.fromEntries(form);
    data.price = Number(data.price);
    data.featured = data.featured === 'true';
    data.occasions = data.occasions.split(',').map(value => value.trim()).filter(Boolean);
    data.personalisationTypes = data.personalisationTypes.split(',').map(value => value.trim()).filter(Boolean);
    data.personalised = data.personalisationTypes.length > 0;
    data.images = [data.image];
    data.tags = [data.name.toLowerCase(), data.category.toLowerCase()];
    try {
      await api(id ? `/api/admin/products/${id}` : '/api/admin/products', { method: id ? 'PUT' : 'POST', body: JSON.stringify(data) });
      await refresh();
      render();
    } catch (error) {
      document.getElementById('productError').textContent = error.message;
    }
  };
}

async function setProductActive(id, active) {
  if (!active && !confirm('Archive this product? It will no longer appear in the storefront.')) return;
  try {
    await api(`/api/admin/products/${id}`, { method: 'PATCH', body: JSON.stringify({ active }) });
    const product = products.find(item => item.id === id);
    if (product) product.active = active;
    try {
      await refresh();
    } catch (error) {
      render();
      showActionError(error);
      return;
    }
    render();
  } catch (error) {
    showActionError(error);
  }
}

async function updateStatus(type, id, select) {
  const status = select.value;
  const records = type === 'orders' ? orders : enquiries;
  const record = records.find(item => item._id === id);
  try {
    await api(`/api/admin/${type}/${id}`, { method: 'PATCH', body: JSON.stringify({ status }) });
    if (record) record.status = status;
    try {
      await refresh();
    } catch (error) {
      render();
      showActionError(error);
      return;
    }
    render();
  } catch (error) {
    showActionError(error);
    if (record) select.value = record.status;
  }
}

function showActionError(error) {
  const message = document.getElementById('actionError');
  if (message) message.textContent = error.message;
}

loadDashboard();
