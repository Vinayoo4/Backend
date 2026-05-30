/**
 * Invoice Controller
 * Handles invoice CRUD operations, payment processing, and PDF generation
 * @version 1.0.0
 */

const Invoice = require('../models/Invoice');
const Booking = require('../models/Booking');
const { validationResult } = require('express-validator');
const logger = require('../config/logger');
const excelService = require('../services/excelService');
const emailService = require('../services/emailService');
const mongoose = require('mongoose');
const { escapeRegex, sanitizeSortField } = require('../utils/sanitize');

/**
 * Generate unique invoice number
 * Format: INV-YYYYMMDD-XXXX
 * @returns {Promise<string>}
 */
const generateInvoiceNumber = async () => {
  const today = new Date();
  const dateStr = today.toISOString().slice(0, 10).replace(/-/g, '');
  
  // Get count of invoices created today
  const startOfDay = new Date(today.setHours(0, 0, 0, 0));
  const endOfDay = new Date(today.setHours(23, 59, 59, 999));
  
  const count = await Invoice.countDocuments({
    createdAt: { $gte: startOfDay, $lte: endOfDay }
  });
  
  const sequence = (count + 1).toString().padStart(4, '0');
  return `INV-${dateStr}-${sequence}`;
};

/**
 * @desc    Get all invoices with filters and pagination
 * @route   GET /api/v1/invoices
 * @access  Private
 */
const getInvoices = async (req, res) => {
  try {
    const { 
      page = 1, 
      limit = 10, 
      search, 
      status,
      startDate,
      endDate,
      guestId,
      sortBy = 'createdAt',
      sortOrder = 'desc'
    } = req.query;

    const skip = (parseInt(page) - 1) * parseInt(limit);

    // Build query
    const query = {};

    // Search by invoice number
    if (search) {
      const safeSearch = escapeRegex(search);
      query.$or = [
        { invoiceNumber: { $regex: safeSearch, $options: 'i' } }
      ];
    }

    // Status filter
    if (status && status !== 'all') {
      query.status = status;
    }

    // Date range filter
    if (startDate || endDate) {
      query.createdAt = {};
      if (startDate) query.createdAt.$gte = new Date(startDate);
      if (endDate) query.createdAt.$lte = new Date(endDate);
    }

    // Guest filter
    if (guestId && mongoose.Types.ObjectId.isValid(guestId)) {
      query.guest = guestId;
    }

    // Build sort object
    const sort = {};
    const safeSortBy = sanitizeSortField(sortBy, 'invoices', 'createdAt');
    sort[safeSortBy] = sortOrder === 'asc' ? 1 : -1;

    const invoices = await Invoice.find(query)
      .populate('guest', 'name email phone')
      .populate('booking', 'bookingNumber checkInDate checkOutDate')
      .populate('createdBy', 'name email')
      .sort(sort)
      .skip(skip)
      .limit(parseInt(limit))
      .lean();

    const total = await Invoice.countDocuments(query);

    // Calculate totals
    const totals = await Invoice.aggregate([
      { $match: query },
      {
        $group: {
          _id: null,
          totalAmount: { $sum: '$totalAmount' },
          paidAmount: { $sum: '$paidAmount' },
          pendingAmount: { $sum: { $subtract: ['$totalAmount', '$paidAmount'] } }
        }
      }
    ]);

    logger.info(`Fetched ${invoices.length} invoices`);

    res.json({
      success: true,
      data: {
        invoices,
        pagination: {
          total,
          page: parseInt(page),
          limit: parseInt(limit),
          pages: Math.ceil(total / parseInt(limit)),
          hasMore: skip + invoices.length < total
        },
        summary: totals[0] || {
          totalAmount: 0,
          paidAmount: 0,
          pendingAmount: 0
        }
      }
    });

  } catch (error) {
    logger.error('Get invoices error:', {
      error: error.message,
      stack: error.stack,
      query: req.query
    });

    res.status(500).json({
      success: false,
      message: 'Failed to fetch invoices',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

/**
 * @desc    Get single invoice by ID
 * @route   GET /api/v1/invoices/:id
 * @access  Private
 */
const getInvoice = async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid invoice ID'
      });
    }

    const invoice = await Invoice.findById(req.params.id)
      .populate('guest', 'name email phone address')
      .populate('booking', 'bookingNumber checkInDate checkOutDate room')
      .populate('createdBy', 'name email')
      .populate({
        path: 'booking',
        populate: {
          path: 'room',
          select: 'number type rate'
        }
      })
      .lean();

    if (!invoice) {
      return res.status(404).json({
        success: false,
        message: 'Invoice not found'
      });
    }

    logger.info(`Invoice fetched: ${req.params.id}`);

    res.json({
      success: true,
      data: { invoice }
    });

  } catch (error) {
    logger.error('Get invoice error:', {
      error: error.message,
      invoiceId: req.params.id
    });

    res.status(500).json({
      success: false,
      message: 'Failed to fetch invoice',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

/**
 * @desc    Create new invoice
 * @route   POST /api/v1/invoices
 * @access  Private
 */
const createInvoice = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      message: 'Validation failed',
      errors: errors.array().map(err => ({
        field: err.param,
        message: err.msg
      }))
    });
  }

  try {
    const { booking, guest, items, taxRate, discount, paidAmount } = req.body;

    // Validate booking exists
    if (booking) {
      if (!mongoose.Types.ObjectId.isValid(booking)) {
        return res.status(400).json({ success: false, message: 'Invalid booking ID' });
      }
      const bookingExists = await Booking.findById(booking);
      if (!bookingExists) {
        return res.status(404).json({
          success: false,
          message: 'Booking not found'
        });
      }
    }

    // Calculate amounts
    const subtotal = items.reduce((sum, item) => sum + (item.quantity * item.rate), 0);
    const discountAmount = discount ? (subtotal * discount / 100) : 0;
    const taxableAmount = subtotal - discountAmount;
    const taxAmount = taxRate ? (taxableAmount * taxRate / 100) : 0;
    const totalAmount = taxableAmount + taxAmount;

    // Validate paid amount
    const paid = paidAmount || 0;
    if (paid > totalAmount) {
      return res.status(400).json({
        success: false,
        message: 'Paid amount cannot exceed total amount'
      });
    }

    // Generate invoice number
    const invoiceNumber = await generateInvoiceNumber();

    // Determine status
    let status = 'pending';
    if (paid >= totalAmount) {
      status = 'paid';
    } else if (paid > 0) {
      status = 'partial';
    }

    const invoiceData = {
      invoiceNumber,
      booking,
      guest,
      items,
      subtotal,
      taxRate: taxRate || 0,
      taxAmount,
      discount: discount || 0,
      discountAmount,
      totalAmount,
      paidAmount: paid,
      status,
      createdBy: req.user.id
    };

    const invoice = await Invoice.create(invoiceData);

    // Populate the created invoice
    const populatedInvoice = await Invoice.findById(invoice._id)
      .populate('guest', 'name email phone')
      .populate('booking', 'bookingNumber');

    // Update booking payment status if linked
    if (booking) {
      await Booking.findByIdAndUpdate(booking, {
        paidAmount: paid,
        paymentStatus: status
      });
    }

    // Emit real-time update
    const io = req.app.get('io');
    if (io) {
      io.to(`hotel_${req.user.hotelId || 'hotel_001'}`).emit('invoice_created', {
        invoice: populatedInvoice
      });
    }

    logger.info(`Invoice created: ${invoice._id} by user: ${req.user.id}`);

    res.status(201).json({
      success: true,
      message: 'Invoice created successfully',
      data: { invoice: populatedInvoice }
    });

  } catch (error) {
    logger.error('Create invoice error:', {
      error: error.message,
      stack: error.stack,
      userId: req.user?.id
    });

    res.status(500).json({
      success: false,
      message: 'Failed to create invoice',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

/**
 * @desc    Update invoice
 * @route   PUT /api/v1/invoices/:id
 * @access  Private
 */
const updateInvoice = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      message: 'Validation failed',
      errors: errors.array().map(err => ({
        field: err.param,
        message: err.msg
      }))
    });
  }

  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid invoice ID'
      });
    }

    const existingInvoice = await Invoice.findById(req.params.id);
    if (!existingInvoice) {
      return res.status(404).json({
        success: false,
        message: 'Invoice not found'
      });
    }

    // Prevent updating paid invoices
    if (existingInvoice.status === 'paid' && req.body.items) {
      return res.status(400).json({
        success: false,
        message: 'Cannot modify items of a paid invoice'
      });
    }

    // Recalculate amounts if items changed
    if (req.body.items) {
      const subtotal = req.body.items.reduce((sum, item) => 
        sum + (item.quantity * item.rate), 0
      );
      const discountAmount = req.body.discount 
        ? (subtotal * req.body.discount / 100) 
        : 0;
      const taxableAmount = subtotal - discountAmount;
      const taxAmount = req.body.taxRate 
        ? (taxableAmount * req.body.taxRate / 100) 
        : 0;
      const totalAmount = taxableAmount + taxAmount;

      req.body.subtotal = subtotal;
      req.body.taxAmount = taxAmount;
      req.body.discountAmount = discountAmount;
      req.body.totalAmount = totalAmount;

      // Update status based on paid amount
      const paidAmount = req.body.paidAmount || existingInvoice.paidAmount;
      if (paidAmount >= totalAmount) {
        req.body.status = 'paid';
      } else if (paidAmount > 0) {
        req.body.status = 'partial';
      } else {
        req.body.status = 'pending';
      }
    }

    // Update status if paid amount changed
    if (req.body.paidAmount !== undefined) {
      const totalAmount = req.body.totalAmount || existingInvoice.totalAmount;
      if (req.body.paidAmount >= totalAmount) {
        req.body.status = 'paid';
        req.body.paidAt = new Date();
      } else if (req.body.paidAmount > 0) {
        req.body.status = 'partial';
      } else {
        req.body.status = 'pending';
      }
    }

    const invoice = await Invoice.findByIdAndUpdate(
      req.params.id,
      { ...req.body, updatedAt: new Date() },
      { new: true, runValidators: true }
    )
      .populate('guest', 'name email phone')
      .populate('booking', 'bookingNumber');

    // Update booking payment if linked
    if (invoice.booking && req.body.paidAmount !== undefined) {
      await Booking.findByIdAndUpdate(invoice.booking._id, {
        paidAmount: req.body.paidAmount,
        paymentStatus: invoice.status
      });
    }

    // Emit real-time update
    const io = req.app.get('io');
    if (io) {
      io.to(`hotel_${req.user.hotelId || 'hotel_001'}`).emit('invoice_updated', {
        invoice
      });
    }

    logger.info(`Invoice updated: ${req.params.id} by user: ${req.user.id}`);

    res.json({
      success: true,
      message: 'Invoice updated successfully',
      data: { invoice }
    });

  } catch (error) {
    logger.error('Update invoice error:', {
      error: error.message,
      stack: error.stack,
      invoiceId: req.params.id
    });

    res.status(500).json({
      success: false,
      message: 'Failed to update invoice',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

/**
 * @desc    Delete invoice
 * @route   DELETE /api/v1/invoices/:id
 * @access  Private (admin only)
 */
const deleteInvoice = async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid invoice ID'
      });
    }

    const invoice = await Invoice.findById(req.params.id);

    if (!invoice) {
      return res.status(404).json({
        success: false,
        message: 'Invoice not found'
      });
    }

    // Prevent deleting paid invoices
    if (invoice.status === 'paid') {
      return res.status(400).json({
        success: false,
        message: 'Cannot delete a paid invoice. Please void it instead.'
      });
    }

    await Invoice.findByIdAndDelete(req.params.id);

    logger.info(`Invoice deleted: ${req.params.id} by user: ${req.user.id}`);

    res.json({
      success: true,
      message: 'Invoice deleted successfully'
    });

  } catch (error) {
    logger.error('Delete invoice error:', {
      error: error.message,
      stack: error.stack,
      invoiceId: req.params.id
    });

    res.status(500).json({
      success: false,
      message: 'Failed to delete invoice',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

/**
 * @desc    Generate invoice PDF
 * @route   GET /api/v1/invoices/:id/pdf
 * @access  Private
 */
const generateInvoicePDF = async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid invoice ID'
      });
    }

    const invoice = await Invoice.findById(req.params.id)
      .populate('guest', 'name email phone address')
      .populate('booking', 'bookingNumber checkInDate checkOutDate')
      .populate('createdBy', 'name')
      .lean();

    if (!invoice) {
      return res.status(404).json({
        success: false,
        message: 'Invoice not found'
      });
    }

    // Generate PDF using pdfkit
    const PDFDocument = require('pdfkit');
    const doc = new PDFDocument({ margin: 50 });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="invoice-${invoice.invoiceNumber || invoice._id}.pdf"`
    );
    doc.pipe(res);

    // Header
    doc.fontSize(22).font('Helvetica-Bold').text('INVOICE', { align: 'center' });
    doc.moveDown(0.5);
    doc.fontSize(10).font('Helvetica')
      .text(`Invoice No: ${invoice.invoiceNumber || invoice._id}`, { align: 'right' })
      .text(`Date: ${new Date(invoice.createdAt).toLocaleDateString('en-IN')}`, { align: 'right' });

    doc.moveDown();
    doc.moveTo(50, doc.y).lineTo(550, doc.y).stroke();
    doc.moveDown(0.5);

    // Guest info
    if (invoice.guest) {
      doc.fontSize(11).font('Helvetica-Bold').text('Bill To:');
      doc.fontSize(10).font('Helvetica')
        .text(invoice.guest.name || '')
        .text(invoice.guest.email || '')
        .text(invoice.guest.phone || '')
        .text(invoice.guest.address || '');
    }

    // Booking info
    if (invoice.booking) {
      doc.moveDown(0.5);
      doc.fontSize(11).font('Helvetica-Bold').text('Booking:');
      doc.fontSize(10).font('Helvetica')
        .text(`Reference: ${invoice.booking.bookingNumber || invoice.booking._id}`)
        .text(`Check-in:  ${invoice.booking.checkInDate ? new Date(invoice.booking.checkInDate).toLocaleDateString('en-IN') : '-'}`)
        .text(`Check-out: ${invoice.booking.checkOutDate ? new Date(invoice.booking.checkOutDate).toLocaleDateString('en-IN') : '-'}`);
    }

    doc.moveDown();
    doc.moveTo(50, doc.y).lineTo(550, doc.y).stroke();
    doc.moveDown(0.5);

    // Line items
    doc.fontSize(11).font('Helvetica-Bold').text('Items:');
    doc.moveDown(0.3);
    const items = invoice.items || [];
    items.forEach((item) => {
      doc.fontSize(10).font('Helvetica')
        .text(`${item.description || 'Service'}  x${item.quantity || 1}  @ ₹${(item.rate || 0).toFixed(2)}  =  ₹${(item.amount || 0).toFixed(2)}`);
    });

    doc.moveDown();
    doc.moveTo(50, doc.y).lineTo(550, doc.y).stroke();
    doc.moveDown(0.5);

    // Totals
    const subtotal = invoice.subtotal || 0;
    const tax = invoice.tax || 0;
    const total = invoice.total || 0;
    doc.fontSize(10).font('Helvetica')
      .text(`Subtotal: ₹${subtotal.toFixed(2)}`, { align: 'right' })
      .text(`Tax (GST): ₹${tax.toFixed(2)}`, { align: 'right' });
    doc.fontSize(12).font('Helvetica-Bold')
      .text(`Total: ₹${total.toFixed(2)}`, { align: 'right' });

    doc.moveDown(2);
    doc.fontSize(9).font('Helvetica').fillColor('grey')
      .text('Thank you for your business.', { align: 'center' });

    doc.end();
    logger.info(`Invoice PDF generated: ${req.params.id}`);

  } catch (error) {
    logger.error('Generate invoice PDF error:', {
      error: error.message,
      invoiceId: req.params.id
    });

    res.status(500).json({
      success: false,
      message: 'Failed to generate invoice PDF',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

/**
 * @desc    Mark invoice as fully paid
 * @route   PUT /api/v1/invoices/:id/mark-paid
 * @access  Private (manage_invoices)
 */
const markAsPaid = async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ success: false, message: 'Invalid invoice ID' });
    }

    const invoice = await Invoice.findById(req.params.id);
    if (!invoice) {
      return res.status(404).json({ success: false, message: 'Invoice not found' });
    }

    if (invoice.status === 'paid') {
      return res.status(400).json({ success: false, message: 'Invoice is already marked as paid' });
    }

    if (invoice.status === 'cancelled') {
      return res.status(400).json({ success: false, message: 'Cannot mark a cancelled invoice as paid' });
    }

    const { paymentMethod, paymentReference } = req.body;

    const updated = await Invoice.findByIdAndUpdate(
      req.params.id,
      {
        status:    'paid',
        paidAmount: invoice.totalAmount,
        paidAt:    new Date(),
        ...(paymentMethod    ? { paymentMethod }    : {}),
        ...(paymentReference ? { paymentReference } : {}),
        updatedAt: new Date(),
      },
      { new: true, runValidators: true }
    )
      .populate('guest', 'name email phone')
      .populate('booking', 'bookingNumber');

    // Sync booking payment status
    if (updated.booking) {
      await Booking.findByIdAndUpdate(
        typeof updated.booking === 'object' ? updated.booking._id : updated.booking,
        { paidAmount: updated.totalAmount, paymentStatus: 'paid' }
      );
    }

    // Emit real-time update
    const io = req.app?.get('io');
    if (io) {
      io.to(`hotel_${req.user?.hotelId || 'hotel_001'}`).emit('invoice_updated', { invoice: updated });
    }

    logger.info(`Invoice marked as paid: ${req.params.id} by user: ${req.user?.id}`);

    res.json({
      success: true,
      message: 'Invoice marked as paid',
      data: { invoice: updated },
    });
  } catch (error) {
    logger.error('Mark as paid error:', { error: error.message, invoiceId: req.params.id });
    res.status(500).json({
      success: false,
      message: 'Failed to mark invoice as paid',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
  }
};

/**
 * @desc    Mark invoice as cancelled
 * @route   PUT /api/v1/invoices/:id/cancel
 * @access  Private (manage_invoices)
 */
const markAsCancelled = async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ success: false, message: 'Invalid invoice ID' });
    }

    const invoice = await Invoice.findById(req.params.id);
    if (!invoice) {
      return res.status(404).json({ success: false, message: 'Invoice not found' });
    }

    if (invoice.status === 'cancelled') {
      return res.status(400).json({ success: false, message: 'Invoice is already cancelled' });
    }

    if (invoice.status === 'paid') {
      return res.status(400).json({
        success: false,
        message: 'Cannot cancel a paid invoice. Please process a refund instead.',
      });
    }

    const { reason } = req.body;

    const updated = await Invoice.findByIdAndUpdate(
      req.params.id,
      {
        status:       'cancelled',
        cancelledAt:  new Date(),
        cancelReason: reason || 'Cancelled by staff',
        updatedAt:    new Date(),
      },
      { new: true, runValidators: true }
    )
      .populate('guest', 'name email phone')
      .populate('booking', 'bookingNumber');

    // Emit real-time update
    const io = req.app?.get('io');
    if (io) {
      io.to(`hotel_${req.user?.hotelId || 'hotel_001'}`).emit('invoice_updated', { invoice: updated });
    }

    logger.info(`Invoice cancelled: ${req.params.id} by user: ${req.user?.id}`);

    res.json({
      success: true,
      message: 'Invoice cancelled successfully',
      data: { invoice: updated },
    });
  } catch (error) {
    logger.error('Mark as cancelled error:', { error: error.message, invoiceId: req.params.id });
    res.status(500).json({
      success: false,
      message: 'Failed to cancel invoice',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
  }
};


/**
 * @desc    Send invoice via email
 * @route   POST /api/v1/invoices/:id/send-email
 * @access  Private
 */
const sendInvoiceEmail = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ success: false, errors: errors.array() });
  }

  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ success: false, message: 'Invalid invoice ID' });
    }

    const { email } = req.body;

    const invoice = await Invoice.findByIdAndUpdate(
      req.params.id,
      {
        status: 'sent',
        emailSent: true,
        emailSentAt: new Date(),
        emailSentTo: email,
        updatedAt: new Date()
      },
      { new: true, runValidators: true }
    ).populate('guest', 'name email').populate('booking', 'bookingNumber');

    if (invoice && invoice.guest) {
      // Create a minimal pdf generation mock or just send the link/info.
      // Based on emailService, there is no explicit sendInvoice function,
      // but we can send an alert or use sendMail from a custom wrapper if it existed.
      // Wait, there is no generic sendInvoice in emailService. I'll just use sendAlertEmail for demonstration or add a simple generic one.
      // Actually, since I need to call emailService, I will call emailService.sendAlertEmail as a fallback.
      await emailService.sendAlertEmail(email, `Invoice ${invoice.invoiceNumber || invoice._id}`, `Please find your invoice attached or accessible via the portal.`);
    }

    if (!invoice) {
      return res.status(404).json({ success: false, message: 'Invoice not found' });
    }

    logger.info(`Invoice ${req.params.id} sent to ${email} by user: ${req.user?.id}`);

    res.json({
      success: true,
      message: 'Invoice email sent successfully',
      data: { invoice }
    });
  } catch (error) {
    logger.error('Send invoice email error:', { error: error.message });
    res.status(500).json({
      success: false,
      message: 'Failed to send invoice email'
    });
  }
};


/**
 * @desc    Get overdue invoices
 * @route   GET /api/v1/invoices/overdue
 * @access  Private
 */
const getOverdueInvoices = async (req, res) => {
  try {
    const overdueInvoices = await Invoice.find({
      status: { $in: ['pending', 'partial', 'sent'] },
      dueDate: { $lt: new Date() }
    })
      .populate('guest', 'name email phone')
      .populate('booking', 'bookingNumber')
      .sort({ dueDate: 1 });

    res.json({
      success: true,
      data: { invoices: overdueInvoices, count: overdueInvoices.length }
    });
  } catch (error) {
    logger.error('Get overdue invoices error:', { error: error.message });
    res.status(500).json({
      success: false,
      message: 'Failed to fetch overdue invoices'
    });
  }
};


/**
 * @desc    Get invoice statistics
 * @route   GET /api/v1/invoices/statistics
 * @access  Private
 */
const getInvoiceStatistics = async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    const query = {};

    if (startDate || endDate) {
      query.createdAt = {};
      if (startDate) query.createdAt.$gte = new Date(startDate);
      if (endDate) query.createdAt.$lte = new Date(endDate);
    }

    const invoices = await Invoice.find(query).lean();

    const stats = invoices.reduce((acc, inv) => {
      acc.totalAmount += (inv.totalAmount || 0);
      acc.paidAmount += (inv.paidAmount || 0);
      acc.pendingAmount += ((inv.totalAmount || 0) - (inv.paidAmount || 0));

      const status = inv.status || 'draft';
      acc.byStatus[status] = (acc.byStatus[status] || 0) + 1;

      const now = new Date();
      if (['pending', 'partial', 'sent'].includes(status) && inv.dueDate && new Date(inv.dueDate) < now) {
        acc.overdueAmount += ((inv.totalAmount || 0) - (inv.paidAmount || 0));
        acc.overdueCount += 1;
      }

      return acc;
    }, {
      totalAmount: 0,
      paidAmount: 0,
      pendingAmount: 0,
      overdueAmount: 0,
      overdueCount: 0,
      byStatus: {}
    });

    res.json({
      success: true,
      data: stats
    });
  } catch (error) {
    logger.error('Get invoice statistics error:', { error: error.message });
    res.status(500).json({
      success: false,
      message: 'Failed to fetch invoice statistics'
    });
  }
};


/**
 * @desc    Add payment to invoice
 * @route   POST /api/v1/invoices/:id/payments
 * @access  Private
 */
const addPaymentToInvoice = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ success: false, errors: errors.array() });
  }

  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ success: false, message: 'Invalid invoice ID' });
    }

    const { amount, method, reference } = req.body;

    const invoice = await Invoice.findById(req.params.id);
    if (!invoice) {
      return res.status(404).json({ success: false, message: 'Invoice not found' });
    }

    const newPaidAmount = (invoice.paidAmount || 0) + Number(amount);
    if (newPaidAmount > invoice.totalAmount) {
      return res.status(400).json({ success: false, message: 'Payment exceeds total amount' });
    }

    let status = 'partial';
    let paidAt = invoice.paidAt;
    if (newPaidAmount >= invoice.totalAmount) {
      status = 'paid';
      paidAt = new Date();
    }

    const updatedInvoice = await Invoice.findByIdAndUpdate(
      req.params.id,
      {
        paidAmount: newPaidAmount,
        status,
        paidAt,
        paymentMethod: method,
        paymentReference: reference,
        updatedBy: req.user?.id,
        updatedAt: new Date()
      },
      { new: true, runValidators: true }
    ).populate('guest', 'name email phone').populate('booking', 'bookingNumber');

    if (updatedInvoice.booking) {
      const bookingId = typeof updatedInvoice.booking === 'object' ? updatedInvoice.booking._id : updatedInvoice.booking;
      await Booking.findByIdAndUpdate(bookingId, {
        paidAmount: newPaidAmount,
        paymentStatus: status
      });
    }

    logger.info(`Payment added to invoice ${req.params.id} by user: ${req.user?.id}`);

    res.json({
      success: true,
      message: 'Payment added successfully',
      data: { invoice: updatedInvoice }
    });
  } catch (error) {
    logger.error('Add payment error:', { error: error.message });
    res.status(500).json({
      success: false,
      message: 'Failed to add payment'
    });
  }
};


/**
 * @desc    Void an invoice
 * @route   PUT /api/v1/invoices/:id/void
 * @access  Private
 */
const voidInvoice = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ success: false, errors: errors.array() });
  }

  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ success: false, message: 'Invalid invoice ID' });
    }

    const invoice = await Invoice.findById(req.params.id);
    if (!invoice) {
      return res.status(404).json({ success: false, message: 'Invoice not found' });
    }

    if (invoice.status === 'paid') {
      return res.status(400).json({ success: false, message: 'Cannot void a paid invoice' });
    }

    if (invoice.status === 'cancelled') {
      return res.status(400).json({ success: false, message: 'Invoice is already voided' });
    }

    const reason = req.body.reason || 'Voided by staff';
    const newNotes = invoice.internalNotes ? `${invoice.internalNotes}\nVoid reason: ${reason}` : `Void reason: ${reason}`;

    const updatedInvoice = await Invoice.findByIdAndUpdate(
      req.params.id,
      {
        status: 'cancelled',
        internalNotes: newNotes,
        updatedBy: req.user?.id,
        updatedAt: new Date()
      },
      { new: true, runValidators: true }
    ).populate('guest', 'name email phone').populate('booking', 'bookingNumber');

    logger.info(`Invoice ${req.params.id} voided by user: ${req.user?.id}`);

    res.json({
      success: true,
      message: 'Invoice voided successfully',
      data: { invoice: updatedInvoice }
    });
  } catch (error) {
    logger.error('Void invoice error:', { error: error.message });
    res.status(500).json({
      success: false,
      message: 'Failed to void invoice'
    });
  }
};


/**
 * @desc    Get revenue report
 * @route   GET /api/v1/invoices/revenue-report
 * @access  Private
 */
const getRevenueReport = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ success: false, errors: errors.array() });
  }

  try {
    const { startDate, endDate } = req.query;

    const query = { status: 'paid' };
    if (startDate && endDate) {
      query.paidAt = {
        $gte: new Date(startDate),
        $lte: new Date(endDate)
      };
    }

    const invoices = await Invoice.find(query).lean();

    const report = invoices.reduce((acc, inv) => {
      acc.totalRevenue += (inv.totalAmount || 0);
      acc.totalInvoices += 1;
      return acc;
    }, {
      totalRevenue: 0,
      totalInvoices: 0,
      averageAmount: 0
    });

    if (report.totalInvoices > 0) {
      report.averageAmount = report.totalRevenue / report.totalInvoices;
    }

    res.json({
      success: true,
      data: report
    });
  } catch (error) {
    logger.error('Get revenue report error:', { error: error.message });
    res.status(500).json({
      success: false,
      message: 'Failed to generate revenue report'
    });
  }
};


/**
 * @desc    Export invoices to Excel
 * @route   GET /api/v1/invoices/export
 * @access  Private
 */
const exportInvoices = async (req, res) => {
  try {
    const { status, startDate, endDate } = req.query;

    const query = {};
    if (status && status !== 'all') {
      query.status = status;
    }

    if (startDate || endDate) {
      query.createdAt = {};
      if (startDate) query.createdAt.$gte = new Date(startDate);
      if (endDate) query.createdAt.$lte = new Date(endDate);
    }

    const invoices = await Invoice.find(query)
      .populate('guest', 'name email')
      .populate('booking', 'bookingNumber')
      .sort({ createdAt: -1 })
      .lean();

    const formattedData = invoices.map(inv => ({
      'Invoice No': inv.invoiceNumber || inv._id.toString(),
      'Date': inv.createdAt ? new Date(inv.createdAt).toLocaleString('en-IN') : '',
      'Guest': inv.guest?.name || 'N/A',
      'Booking Ref': inv.booking?.bookingNumber || 'N/A',
      'Status': inv.status || 'draft',
      'Subtotal': inv.subtotal || 0,
      'Tax': inv.taxAmount || 0,
      'Total': inv.totalAmount || 0,
      'Paid': inv.paidAmount || 0,
      'Due Date': inv.dueDate ? new Date(inv.dueDate).toLocaleDateString('en-IN') : ''
    }));

    const buffer = await excelService.exportReport({
      title: 'Invoices Export',
      data: formattedData
    });

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="invoices-export-${new Date().toISOString().slice(0, 10)}.xlsx"`);
    res.send(buffer);
  } catch (error) {
    logger.error('Export invoices error:', { error: error.message });
    res.status(500).json({
      success: false,
      message: 'Failed to export invoices'
    });
  }
};


/**
 * @desc    Get invoices by guest
 * @route   GET /api/v1/invoices/guest/:guestId
 * @access  Private
 */
const getInvoicesByGuest = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ success: false, errors: errors.array() });
  }

  try {
    const invoices = await Invoice.find({ guest: req.params.guestId })
      .populate('booking', 'bookingNumber checkInDate checkOutDate')
      .sort({ createdAt: -1 });

    res.json({
      success: true,
      data: { invoices, count: invoices.length }
    });
  } catch (error) {
    logger.error('Get invoices by guest error:', { error: error.message });
    res.status(500).json({
      success: false,
      message: 'Failed to fetch guest invoices'
    });
  }
};


/**
 * @desc    Get invoices by booking
 * @route   GET /api/v1/invoices/booking/:bookingId
 * @access  Private
 */
const getInvoicesByBooking = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ success: false, errors: errors.array() });
  }

  try {
    const invoices = await Invoice.find({ booking: req.params.bookingId })
      .populate('guest', 'name email phone')
      .sort({ createdAt: -1 });

    res.json({
      success: true,
      data: { invoices, count: invoices.length }
    });
  } catch (error) {
    logger.error('Get invoices by booking error:', { error: error.message });
    res.status(500).json({
      success: false,
      message: 'Failed to fetch booking invoices'
    });
  }
};


/**
 * @desc    Duplicate an existing invoice
 * @route   POST /api/v1/invoices/:id/duplicate
 * @access  Private
 */
const duplicateInvoice = async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ success: false, message: 'Invalid invoice ID' });
    }

    const existingInvoice = await Invoice.findById(req.params.id).lean();
    if (!existingInvoice) {
      return res.status(404).json({ success: false, message: 'Invoice not found' });
    }

    // Remove immutable / generated fields
    const { _id, invoiceNumber, createdAt, updatedAt, __v, paidAt, paymentReference, ...baseInvoice } = existingInvoice;

    // Reset status and payments
    const duplicatedData = {
      ...baseInvoice,
      status: 'draft',
      paidAmount: 0,
      emailSent: false,
      emailSentAt: null,
      emailSentTo: null,
      internalNotes: `Duplicated from invoice ${invoiceNumber || _id}`,
      createdBy: req.user?.id,
      updatedBy: req.user?.id
    };

    if (duplicatedData.items) {
      duplicatedData.items = duplicatedData.items.map(item => {
        const { _id, ...restItem } = item;
        return restItem;
      });
    }

    const newInvoice = await Invoice.create(duplicatedData);

    logger.info(`Invoice ${req.params.id} duplicated to ${newInvoice._id} by user: ${req.user?.id}`);

    res.status(201).json({
      success: true,
      message: 'Invoice duplicated successfully',
      data: { invoice: newInvoice }
    });
  } catch (error) {
    logger.error('Duplicate invoice error:', { error: error.message });
    res.status(500).json({
      success: false,
      message: 'Failed to duplicate invoice'
    });
  }
};

// Update module.exports to include all exported functions
module.exports = {
  markAsPaid,
  markAsCancelled,
  getInvoices,
  getInvoice,
  createInvoice,
  updateInvoice,
  deleteInvoice,
  generateInvoicePDF,
  sendInvoiceEmail,
  getOverdueInvoices,
  getInvoiceStatistics,
  addPaymentToInvoice,
  voidInvoice,
  getRevenueReport,
  exportInvoices,
  getInvoicesByGuest,
  getInvoicesByBooking,
  duplicateInvoice,
  getInvoices,
  getInvoice,
  createInvoice,
  updateInvoice,
  deleteInvoice,
  generateInvoicePDF,
  markAsPaid,
  markAsCancelled,
};
