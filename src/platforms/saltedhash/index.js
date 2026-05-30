'use strict';
const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../../config/jsonDb');

const JWT_SECRET = process.env.JWT_SECRET || 'saltedhash_secret_key_123';

const SALTEDHASH_MODULES = {
  fundamentals: ['lessons', 'concepts', 'scenarios'],
  exam: ['quiz_attempts', 'progress'],
  career: ['guidance_rules', 'budgets'],
  community: ['issues', 'resources', 'members', 'threads', 'events', 'sponsors'],
  creator: ['profile', 'canvas_pages', 'content_feed', 'analytics_logs'],
};

Object.entries(SALTEDHASH_MODULES).forEach(([category, collections]) => {
  collections.forEach(col => {
    const colPath = `saltedhash_${col}`;
    if (!db.find(colPath, {}).length) {
      db.insert(colPath, { _id: db.generateId(), name: `${col}_default`, category, createdAt: new Date().toISOString() });
    }
  });
});

router.get('/health', (req, res) => {
  res.json({
    success: true,
    platform: 'SALTEDHASH',
    version: '2.0.0',
    modules: SALTEDHASH_MODULES,
  });
});

router.get('/manifest', (req, res) => {
  res.json({ success: true, data: { sku: req.query.sku || 'default', modules: SALTEDHASH_MODULES } });
});

router.get('/manifest.webmanifest', (req, res) => {
  res.json({
    name: "SALTEDHASH",
    short_name: "SALTEDHASH",
    start_url: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#000000",
    icons: [
      {
        src: "/icons/icon-192x192.png",
        sizes: "192x192",
        type: "image/png"
      },
      {
        src: "/icons/icon-512x512.png",
        sizes: "512x512",
        type: "image/png"
      }
    ]
  });
});

router.get('/service-worker.js', (req, res) => {
  res.type('application/javascript');
  res.send(`
    const CACHE_NAME = 'saltedhash-pwa-v1';
    const ASSETS = ['/', '/offline.html', '/manifest.webmanifest'];

    self.addEventListener('install', event => {
      event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS)));
    });

    self.addEventListener('fetch', event => {
      if (event.request.method !== 'GET') return;
      event.respondWith(
        fetch(event.request).catch(() => caches.match(event.request).then(res => res || caches.match('/offline.html')))
      );
    });
  `);
});

router.get('/offline.html', (req, res) => {
  res.type('text/html');
  res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>SALTEDHASH - Offline</title>
      <style>
        body { font-family: sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; background: #fafafa; color: #333; margin: 0; }
        .container { text-align: center; padding: 20px; }
        h1 { margin-bottom: 10px; }
      </style>
    </head>
    <body>
      <div class="container">
        <h1>You're Offline</h1>
        <p>Please check your internet connection and try again.</p>
        <p>Your local drafts are safely stored on your device.</p>
      </div>
    </body>
    </html>
  `);
});

const createCollectionRoutes = (base, collection) => {
  router.get(`/${base}`, (req, res) => {
    try {
      const data = db.find(`saltedhash_${collection}`, {});
      res.json({ success: true, data });
    } catch (e) { res.status(500).json({ success: false, message: e.message }); }
  });

  router.get(`/${base}/:id`, (req, res) => {
    try {
      const item = db.findById(`saltedhash_${collection}`, req.params.id);
      if (!item) return res.status(404).json({ success: false, message: 'Not found' });
      res.json({ success: true, data: item });
    } catch (e) { res.status(500).json({ success: false, message: e.message }); }
  });

  router.post(`/${base}`, (req, res) => {
    try {
      const now = new Date().toISOString();
      const item = {
        _id: db.generateId(),
        ...req.body,
        _version: 1,
        createdAt: now,
        updatedAt: now
      };
      db.insert(`saltedhash_${collection}`, item);
      res.status(201).json({ success: true, data: item });
    } catch (e) { res.status(500).json({ success: false, message: e.message }); }
  });

  router.put(`/${base}/:id`, (req, res) => {
    try {
      const existing = db.findById(`saltedhash_${collection}`, req.params.id);
      if (!existing) return res.status(404).json({ success: false, message: 'Not found' });

      const updateData = {
        ...req.body,
        _version: (existing._version || 1) + 1,
        updatedAt: new Date().toISOString()
      };
      delete updateData._id;
      delete updateData.createdAt;

      db.update(`saltedhash_${collection}`, { _id: req.params.id }, { $set: updateData });

      const updated = db.findById(`saltedhash_${collection}`, req.params.id);
      res.json({ success: true, data: updated });
    } catch (e) { res.status(500).json({ success: false, message: e.message }); }
  });

  router.delete(`/${base}/:id`, (req, res) => {
    try {
      const existing = db.findById(`saltedhash_${collection}`, req.params.id);
      if (!existing) return res.status(404).json({ success: false, message: 'Not found' });

      db.removeById(`saltedhash_${collection}`, req.params.id);
      res.json({ success: true, message: 'Deleted' });
    } catch (e) { res.status(500).json({ success: false, message: e.message }); }
  });
};

for (const [_category, collections] of Object.entries(SALTEDHASH_MODULES)) {
  collections.forEach(col => createCollectionRoutes(col, col));
}

// Authentication Middleware
const authMiddleware = (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }
    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (error) {
    res.status(401).json({ success: false, message: 'Invalid token' });
  }
};

router.post('/auth/register', async (req, res) => {
  try {
    const { email, password, name } = req.body;
    if (!email || !password) {
      return res.status(400).json({ success: false, message: 'Email and password required' });
    }

    const existing = db.findOne('saltedhash_users', { email });
    if (existing) {
      return res.status(400).json({ success: false, message: 'User already exists' });
    }

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    const now = new Date().toISOString();
    const user = {
      _id: db.generateId(),
      email,
      name,
      password: hashedPassword,
      createdAt: now,
      updatedAt: now
    };

    db.insert('saltedhash_users', user);

    const token = jwt.sign({ id: user._id, email: user.email }, JWT_SECRET, { expiresIn: '7d' });

    const userResponse = { ...user };
    delete userResponse.password;

    res.status(201).json({ success: true, data: { user: userResponse, token } });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

router.post('/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ success: false, message: 'Email and password required' });
    }

    const user = db.findOne('saltedhash_users', { email });
    if (!user) {
      return res.status(401).json({ success: false, message: 'Invalid credentials' });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({ success: false, message: 'Invalid credentials' });
    }

    const token = jwt.sign({ id: user._id, email: user.email }, JWT_SECRET, { expiresIn: '7d' });

    const userResponse = { ...user };
    delete userResponse.password;

    res.json({ success: true, data: { user: userResponse, token } });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

router.get('/auth/me', authMiddleware, (req, res) => {
  try {
    const user = db.findById('saltedhash_users', req.user.id);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    const userResponse = { ...user };
    delete userResponse.password;
    res.json({ success: true, data: userResponse });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

router.post('/sync', (req, res) => {
  try {
    const { updates = [] } = req.body;
    const conflicts = [];
    const resolved = [];

    updates.forEach(update => {
      const { collection, data } = update;
      if (!collection || !data || !data._id) return;

      const colPath = `saltedhash_${collection}`;
      const existing = db.findById(colPath, data._id);

      if (!existing) {
        // New item from client
        const now = new Date().toISOString();
        const item = { ...data, _version: 1, createdAt: now, updatedAt: now };
        db.insert(colPath, item);
        resolved.push({ collection, _id: data._id, status: 'inserted', _version: 1 });
      } else {
        // Compare versions for conflict resolution
        const clientVersion = data._version || 0;
        const serverVersion = existing._version || 1;

        if (clientVersion >= serverVersion) {
          // Client is newer or same (force overwrite), update server
          const updateData = { ...data, _version: clientVersion + 1, updatedAt: new Date().toISOString() };
          delete updateData._id;
          delete updateData.createdAt;
          db.update(colPath, { _id: data._id }, { $set: updateData });
          resolved.push({ collection, _id: data._id, status: 'updated', _version: updateData._version });
        } else {
          // Conflict: server is newer
          conflicts.push({ collection, _id: data._id, serverData: existing, clientVersion, serverVersion });
        }
      }
    });

    res.json({ success: true, resolved, conflicts });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

router.get('/creator/profile', (req, res) => {
  try {
    const profiles = db.find('saltedhash_profile', {});
    res.json({ success: true, data: profiles[0] || { $schema_version: '1.0.0', tenant_id: null, auth_profile: {}, branding_tokens: {} } });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

router.get('/creator/canvas', (req, res) => {
  try {
    const pages = db.find('saltedhash_canvas_pages', {});
    res.json({ success: true, data: pages[0]?.canvas_layouts || [] });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

router.post('/creator/canvas/blocks', (req, res) => {
  try {
    const pages = db.find('saltedhash_canvas_pages', {})[0];
    if (!pages?.canvas_layouts) {
      db.insert('saltedhash_canvas_pages', { _id: db.generateId(), canvas_layouts: [{ page_id: 'page_1', blocks: [req.body] }], createdAt: new Date().toISOString() });
    }
    res.status(201).json({ success: true, data: req.body });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

router.get('/creator/analytics', (req, res) => {
  try {
    const logs = db.find('saltedhash_analytics_logs', {});
    res.json({ success: true, data: logs });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

router.post('/creator/metrics/event', (req, res) => {
  try {
    const event = { _id: db.generateId(), event_id: `evt_${Date.now()}`, timestamp: Math.floor(Date.now() / 1000), ...req.body };
    db.insert('saltedhash_analytics_logs', event);
    res.status(201).json({ success: true, data: event });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

module.exports = router;