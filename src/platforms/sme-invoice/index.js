'use strict';
const express = require('express');
const router = express.Router();
const db = require('../../config/jsonDb');

const generateInvoiceNumber = () => `INV-${String(Date.now()).slice(-6)}`;
const GST_RATES = [0, 0.5, 3, 5, 12, 18, 28];

const calculateGST = (amount, rate) => {
  const gst = (amount * rate) / 100;
  return { cgst: gst / 2, sgst: gst / 2, igst: 0, totalGST: gst, taxableAmount: amount };
};

router.get('/health', (req, res) => {
  res.json({ success: true, platform: 'SME Invoice Cockpit', version: '1.0.0', gstRates: GST_RATES });
});

router.get('/dashboard', (req, res) => {
  try {
    const invoices = db.find('sme_invoices', {});
    const payments = db.find('sme_payments', {});
    const customers = db.find('sme_customers', {});
    const totalRevenue = invoices.filter(i => i.status === 'paid').reduce((s, i) => s + (i.total || 0), 0);
    const outstanding = invoices.filter(i => i.status === 'sent' || i.status === 'overdue').reduce((s, i) => s + (i.total || 0), 0);
    const overdue = invoices.filter(i => i.status === 'overdue').reduce((s, i) => s + (i.total || 0), 0);
    res.json({
      success: true,
      data: { totalInvoices: invoices.length, totalRevenue, outstanding, overdue, totalCustomers: customers.length, totalPayments: payments.length, recentInvoices: invoices.slice(-5).reverse() },
    });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

router.get('/invoices', (req, res) => {
  try {
    const { status, customerId } = req.query;
    let invoices = db.find('sme_invoices', {});
    if (status) invoices = invoices.filter(i => i.status === status);
    if (customerId) invoices = invoices.filter(i => i.customerId === customerId);
    invoices.forEach(i => {
      if (i.status === 'sent' && i.dueDate && new Date(i.dueDate) < new Date()) i.status = 'overdue';
    });
    res.json({ success: true, data: invoices.reverse() });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

router.post('/invoices', (req, res) => {
  try {
    const { items } = req.body;
    let subtotal = 0, totalGST = 0;
    const lineItems = (items || []).map(item => {
      const amt = item.quantity * item.rate;
      const gstRate = item.gstRate || 18;
      const { cgst, sgst, totalGST: gst } = calculateGST(amt, gstRate);
      subtotal += amt;
      totalGST += gst;
      return { ...item, amount: amt, cgst, sgst, gstRate, gstAmount: gst };
    });
    const total = subtotal + totalGST;
    const invoice = {
      _id: db.generateId(), invoiceNumber: generateInvoiceNumber(), ...req.body, items: lineItems,
      subtotal, taxAmount: totalGST, total, status: 'draft', amountPaid: 0,
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    };
    db.insert('sme_invoices', invoice);
    res.status(201).json({ success: true, data: invoice });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

router.get('/invoices/:id', (req, res) => {
  try {
    const invoice = db.findById('sme_invoices', req.params.id);
    res.json({ success: true, data: invoice || {} });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

router.patch('/invoices/:id', (req, res) => {
  try {
    db.update('sme_invoices', { _id: req.params.id }, { $set: { ...req.body, updatedAt: new Date().toISOString() } });
    res.json({ success: true, data: db.findById('sme_invoices', req.params.id) });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

router.post('/invoices/:id/payment-link', (req, res) => {
  res.json({ success: true, data: { url: `/pay/invoice/${req.params.id}`, id: req.params.id } });
});

router.get('/customers', (req, res) => {
  try {
    const customers = db.find('sme_customers', {});
    res.json({ success: true, data: customers });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

router.post('/customers', (req, res) => {
  try {
    const customer = { _id: db.generateId(), totalInvoiced: 0, totalPaid: 0, ...req.body, createdAt: new Date().toISOString() };
    db.insert('sme_customers', customer);
    res.status(201).json({ success: true, data: customer });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

router.get('/items', (req, res) => {
  try {
    res.json({ success: true, data: db.find('sme_items', {}) });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

router.post('/items', (req, res) => {
  try {
    const item = { _id: db.generateId(), ...req.body, createdAt: new Date().toISOString() };
    db.insert('sme_items', item);
    res.status(201).json({ success: true, data: item });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

router.get('/payments', (req, res) => {
  try {
    res.json({ success: true, data: db.find('sme_payments', {}) });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

router.post('/payments', (req, res) => {
  try {
    const payment = { _id: db.generateId(), ...req.body, createdAt: new Date().toISOString() };
    db.insert('sme_payments', payment);
    if (req.body.invoiceId) {
      const invoice = db.findById('sme_invoices', req.body.invoiceId);
      if (invoice) {
        const amountPaid = (invoice.amountPaid || 0) + (req.body.amount || 0);
        const newStatus = amountPaid >= invoice.total ? 'paid' : 'partial';
        db.update('sme_invoices', { _id: req.body.invoiceId }, { $set: { amountPaid, status: newStatus } });
      }
    }
    res.status(201).json({ success: true, data: payment });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

router.get('/reports', (req, res) => {
  try {
    const invoices = db.find('sme_invoices', {});
    const payments = db.find('sme_payments', {});
    const monthlyReport = {};
    invoices.forEach(inv => {
      const month = inv.createdAt?.slice(0, 7);
      if (!monthlyReport[month]) monthlyReport[month] = { count: 0, total: 0, paid: 0 };
      monthlyReport[month].count++;
      monthlyReport[month].total += inv.total || 0;
      if (inv.status === 'paid') monthlyReport[month].paid += inv.total || 0;
    });
    res.json({ success: true, data: { monthlyReport, totalRevenue: invoices.filter(i => i.status === 'paid').reduce((s, i) => s + (i.total || 0), 0), totalInvoices: invoices.length, totalPayments: payments.length } });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

router.post('/webhooks/razorpay', (req, res) => {
  const { event, payload } = req.body;
  if (event === 'payment.captured' && payload?.payment?.entity) {
    const p = payload.payment.entity;
    db.insert('sme_payments', { _id: db.generateId(), amount: p.amount / 100, method: 'razorpay', reference: p.id, invoiceId: p.notes?.invoiceId, createdAt: new Date().toISOString() });
  }
  res.json({ success: true });
});

router.post('/webhooks/whatsapp', (req, res) => {
  const { entry } = req.body;
  const msg = entry?.[0]?.changes?.[0]?.value?.messages?.[0];
  const text = msg?.text?.body?.toLowerCase() || '';
  if (text.includes('invoices') || text.includes('overdue')) {
    const invoices = db.find('sme_invoices', {}).filter(i => i.status === 'overdue').slice(0, 5);
    res.json({ success: true, data: { reply: invoices.length ? `You have ${invoices.length} overdue invoices` : 'No overdue invoices' } });
  } else {
    res.json({ success: true, data: { reply: 'Reply with "invoices" or "overdue" to check status' } });
  }
});

module.exports = router;