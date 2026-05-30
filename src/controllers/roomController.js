/**
 * Room Controller
 * Handles room CRUD operations, availability checks, and status management
 * @version 1.0.0
 */

const Room = require('../models/Room');
const Booking = require('../models/Booking');
const { validationResult } = require('express-validator');
const logger = require('../config/logger');
const mongoose = require('mongoose');
const { escapeRegex, sanitizeSortField, toSafeString } = require('../utils/sanitize');

/**
 * @desc    Get all rooms with filters and pagination
 * @route   GET /api/v1/rooms
 * @access  Private
 */
const getRooms = async (req, res) => {
  try {
    const { 
      page = 1, 
      limit = 10, 
      search, 
      status,
      type,
      floor,
      available,
      sortBy = 'number',
      sortOrder = 'asc'
    } = req.query;

    const skip = (parseInt(page) - 1) * parseInt(limit);

    // Build query
    const query = { isActive: true };

    // Search by room number
    if (search) {
      const safeSearch = escapeRegex(search);
      query.$or = [
        { number: { $regex: safeSearch, $options: 'i' } },
        { type: { $regex: safeSearch, $options: 'i' } }
      ];
    }

    // Status filter
    if (status && status !== 'all') {
      query.status = status;
    }

    // Type filter
    if (type && type !== 'all') {
      query.type = type;
    }

    // Floor filter
    if (floor) {
      query.floor = parseInt(floor);
    }

    // Available filter
    if (available === 'true') {
      query.status = 'available';
    }

    // Build sort object
    const sort = {};
    const safeSortBy = sanitizeSortField(sortBy, 'rooms', 'number');
    sort[safeSortBy] = sortOrder === 'asc' ? 1 : -1;

    const rooms = await Room.find(query)
      .sort(sort)
      .skip(skip)
      .limit(parseInt(limit))
      .lean();

    const total = await Room.countDocuments(query);

    // Get status counts
    const statusCounts = await Room.aggregate([
      { $match: { isActive: true } },
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 }
        }
      }
    ]);

    const summary = {
      total,
      available: statusCounts.find(s => s._id === 'available')?.count || 0,
      occupied: statusCounts.find(s => s._id === 'occupied')?.count || 0,
      reserved: statusCounts.find(s => s._id === 'reserved')?.count || 0,
      maintenance: statusCounts.find(s => s._id === 'maintenance')?.count || 0,
      dirty: statusCounts.find(s => s._id === 'dirty')?.count || 0
    };

    logger.info(`Fetched ${rooms.length} rooms`);

    res.json({
      success: true,
      data: {
        rooms,
        pagination: {
          total,
          page: parseInt(page),
          limit: parseInt(limit),
          pages: Math.ceil(total / parseInt(limit)),
          hasMore: skip + rooms.length < total
        },
        summary
      }
    });

  } catch (error) {
    logger.error('Get rooms error:', {
      error: error.message,
      stack: error.stack,
      query: req.query
    });

    res.status(500).json({
      success: false,
      message: 'Failed to fetch rooms',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

/**
 * @desc    Get single room by ID
 * @route   GET /api/v1/rooms/:id
 * @access  Private
 */
const getRoom = async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid room ID'
      });
    }

    const room = await Room.findById(req.params.id).lean();

    if (!room) {
      return res.status(404).json({
        success: false,
        message: 'Room not found'
      });
    }

    // Get current booking if occupied
    let currentBooking = null;
    if (room.status === 'occupied' || room.status === 'reserved') {
      currentBooking = await Booking.findOne({
        room: req.params.id,
        status: { $in: ['confirmed', 'checked-in'] }
      })
        .populate('guest', 'name email phone')
        .lean();
    }

    logger.info(`Room fetched: ${req.params.id}`);

    res.json({
      success: true,
      data: {
        room: {
          ...room,
          currentBooking
        }
      }
    });

  } catch (error) {
    logger.error('Get room error:', {
      error: error.message,
      roomId: req.params.id
    });

    res.status(500).json({
      success: false,
      message: 'Failed to fetch room',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

/**
 * @desc    Create new room
 * @route   POST /api/v1/rooms
 * @access  Private (admin/manager)
 */
const createRoom = async (req, res) => {
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
    const { number } = req.body;
    const safeNumber = toSafeString(number);

    // Check for duplicate room number
    const existingRoom = await Room.findOne({ number: safeNumber });
    if (existingRoom) {
      return res.status(400).json({
        success: false,
        message: 'Room with this number already exists'
      });
    }

    const room = await Room.create(req.body);

    logger.info(`Room created: ${room._id} by user: ${req.user?.id}`);

    res.status(201).json({
      success: true,
      message: 'Room created successfully',
      data: { room }
    });

  } catch (error) {
    logger.error('Create room error:', {
      error: error.message,
      stack: error.stack
    });

    if (error.code === 11000) {
      return res.status(400).json({
        success: false,
        message: 'Room with this number already exists'
      });
    }

    res.status(500).json({
      success: false,
      message: 'Failed to create room',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

/**
 * @desc    Update room
 * @route   PUT /api/v1/rooms/:id
 * @access  Private (admin/manager)
 */
const updateRoom = async (req, res) => {
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
        message: 'Invalid room ID'
      });
    }

    // Check for duplicate room number
    if (req.body.number) {
      const existingRoom = await Room.findOne({
        number: req.body.number,
        _id: { $ne: req.params.id }
      });
      if (existingRoom) {
        return res.status(400).json({
          success: false,
          message: 'Another room with this number already exists'
        });
      }
    }

    const room = await Room.findByIdAndUpdate(
      req.params.id,
      { ...req.body, updatedAt: new Date() },
      { new: true, runValidators: true }
    );

    if (!room) {
      return res.status(404).json({
        success: false,
        message: 'Room not found'
      });
    }

    // Emit real-time update
    const io = req.app.get('io');
    if (io) {
      io.to(`hotel_${req.user.hotelId || 'hotel_001'}`).emit('room_status_change', {
        roomId: room._id,
        roomNumber: room.number,
        status: room.status
      });
    }

    logger.info(`Room updated: ${req.params.id} by user: ${req.user.id}`);

    res.json({
      success: true,
      message: 'Room updated successfully',
      data: { room }
    });

  } catch (error) {
    logger.error('Update room error:', {
      error: error.message,
      roomId: req.params.id
    });

    res.status(500).json({
      success: false,
      message: 'Failed to update room',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

/**
 * @desc    Delete room (soft delete)
 * @route   DELETE /api/v1/rooms/:id
 * @access  Private (admin only)
 */
const deleteRoom = async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid room ID'
      });
    }

    const room = await Room.findById(req.params.id);

    if (!room) {
      return res.status(404).json({
        success: false,
        message: 'Room not found'
      });
    }

    // Check for active bookings
    const activeBookings = await Booking.countDocuments({
      room: req.params.id,
      status: { $in: ['confirmed', 'checked-in'] }
    });

    if (activeBookings > 0) {
      return res.status(400).json({
        success: false,
        message: 'Cannot delete room with active bookings'
      });
    }

    // Soft delete
    room.isActive = false;
    room.status = 'maintenance';
    await room.save();

    logger.info(`Room soft deleted: ${req.params.id} by user: ${req.user.id}`);

    res.json({
      success: true,
      message: 'Room deactivated successfully'
    });

  } catch (error) {
    logger.error('Delete room error:', {
      error: error.message,
      roomId: req.params.id
    });

    res.status(500).json({
      success: false,
      message: 'Failed to delete room',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

/**
 * @desc    Check room availability for date range
 * @route   POST /api/v1/rooms/check-availability
 * @access  Public
 */
const checkAvailability = async (req, res) => {
  try {
    const { checkInDate, checkOutDate, roomType, guests } = req.body;

    if (!checkInDate || !checkOutDate) {
      return res.status(400).json({
        success: false,
        message: 'Check-in and check-out dates are required'
      });
    }

    const checkIn = new Date(checkInDate);
    const checkOut = new Date(checkOutDate);

    if (checkOut <= checkIn) {
      return res.status(400).json({
        success: false,
        message: 'Check-out date must be after check-in date'
      });
    }

    // Build room query
    const roomQuery = { isActive: true, status: { $in: ['available', 'dirty'] } };
    if (roomType && roomType !== 'all') {
      roomQuery.type = toSafeString(roomType);
    }

    // Get all potentially available rooms
    const allRooms = await Room.find(roomQuery).lean();

    // Check which rooms have conflicting bookings
    const bookedRooms = await Booking.find({
      status: { $in: ['confirmed', 'checked-in'] },
      $or: [
        {
          checkInDate: { $lt: checkOut },
          checkOutDate: { $gt: checkIn }
        }
      ]
    }).distinct('room');

    // Filter out booked rooms
    const availableRooms = allRooms.filter(room => 
      !bookedRooms.some(bookedId => bookedId.toString() === room._id.toString())
    );

    // Filter by guest capacity if provided
    let filteredRooms = availableRooms;
    if (guests) {
      filteredRooms = availableRooms.filter(room => {
        const capacity = (room.capacity?.adults || 2) + (room.capacity?.children || 0);
        return capacity >= guests;
      });
    }

    logger.info(`Availability check: ${filteredRooms.length} rooms available`);

    res.json({
      success: true,
      data: {
        availableRooms: filteredRooms,
        total: filteredRooms.length,
        checkIn: checkInDate,
        checkOut: checkOutDate,
        nights: Math.ceil((checkOut - checkIn) / (1000 * 60 * 60 * 24))
      }
    });

  } catch (error) {
    logger.error('Check availability error:', {
      error: error.message,
      stack: error.stack
    });

    res.status(500).json({
      success: false,
      message: 'Failed to check availability',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

/**
 * @desc    Update room status
 * @route   PUT /api/v1/rooms/:id/status
 * @access  Private
 */
const updateRoomStatus = async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid room ID'
      });
    }

    const { status, notes: _notes } = req.body;

    const room = await Room.findByIdAndUpdate(
      req.params.id,
      { status, updatedAt: new Date() },
      { new: true, runValidators: true }
    );

    if (!room) {
      return res.status(404).json({
        success: false,
        message: 'Room not found'
      });
    }

    // Emit real-time update
    const io = req.app.get('io');
    if (io) {
      io.to(`hotel_${req.user.hotelId || 'hotel_001'}`).emit('room_status_change', {
        roomId: room._id,
        roomNumber: room.number,
        status: room.status,
        updatedBy: req.user.id
      });
    }

    logger.info(`Room status updated: ${req.params.id} to ${status} by user: ${req.user.id}`);

    res.json({
      success: true,
      message: 'Room status updated successfully',
      data: { room }
    });

  } catch (error) {
    logger.error('Update room status error:', {
      error: error.message,
      roomId: req.params.id
    });

    res.status(500).json({
      success: false,
      message: 'Failed to update room status',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

/**
 * @desc    Get room statistics
 * @route   GET /api/v1/rooms/statistics
 * @access  Private
 */
const getRoomStatistics = async (req, res) => {
  try {
    const [total, available, occupied, maintenance, reserved] = await Promise.all([
      Room.countDocuments({ isActive: true }),
      Room.countDocuments({ isActive: true, status: 'available' }),
      Room.countDocuments({ isActive: true, status: 'occupied' }),
      Room.countDocuments({ isActive: true, status: 'maintenance' }),
      Room.countDocuments({ isActive: true, status: 'reserved' })
    ]);

    const byType = await Room.aggregate([
      { $match: { isActive: true } },
      { $group: { _id: '$type', count: { $sum: 1 } } }
    ]);

    res.json({
      success: true,
      data: {
        total,
        byStatus: {
          available,
          occupied,
          maintenance,
          reserved,
          other: total - available - occupied - maintenance - reserved
        },
        byType: byType.reduce((acc, item) => {
          acc[item._id] = item.count;
          return acc;
        }, {})
      }
    });

  } catch (error) {
    logger.error('Get room statistics error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get room statistics',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};


/**
 * @desc    Get room availability calendar for month
 * @route   GET /api/v1/rooms/:id/availability
 * @access  Private
 */
const getRoomAvailabilityCalendar = async (req, res) => {
  try {
    const { id } = req.params;
    const month = parseInt(req.query.month) || new Date().getMonth() + 1;
    const year = parseInt(req.query.year) || new Date().getFullYear();

    const startDate = new Date(year, month - 1, 1);
    const endDate = new Date(year, month, 0, 23, 59, 59, 999);

    const room = await Room.findById(id);
    if (!room) {
      return res.status(404).json({ success: false, message: 'Room not found' });
    }

    const bookings = await Booking.find({
      room: id,
      status: { $in: ['confirmed', 'checked-in'] },
      $or: [
        { checkInDate: { $lte: endDate }, checkOutDate: { $gte: startDate } }
      ]
    }).select('checkInDate checkOutDate status');

    res.json({
      success: true,
      data: {
        roomId: id,
        month,
        year,
        bookings
      }
    });
  } catch (error) {
    logger.error('Get room availability calendar error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get room availability calendar',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

/**
 * @desc    Assign room to booking
 * @route   POST /api/v1/rooms/:id/assign
 * @access  Private
 */
const assignRoomToBooking = async (req, res) => {
  try {
    const { id } = req.params;
    const { bookingId } = req.body;

    const room = await Room.findById(id);
    if (!room) {
      return res.status(404).json({ success: false, message: 'Room not found' });
    }

    const booking = await Booking.findById(bookingId);
    if (!booking) {
      return res.status(404).json({ success: false, message: 'Booking not found' });
    }

    // Check availability
    const isAvailable = await Booking.checkAvailability(id, booking.checkInDate, booking.checkOutDate, bookingId);
    if (!isAvailable) {
      return res.status(400).json({ success: false, message: 'Room is not available for this booking dates' });
    }

    booking.room = id;
    await booking.save();

    // Optionally update room status if checking in today
    const today = new Date();
    today.setHours(0,0,0,0);
    const checkIn = new Date(booking.checkInDate);
    checkIn.setHours(0,0,0,0);

    if (checkIn.getTime() === today.getTime() && room.status === 'available') {
        room.status = 'reserved';
        await room.save();
    }

    res.json({
      success: true,
      message: 'Room assigned to booking successfully',
      data: { booking }
    });
  } catch (error) {
    logger.error('Assign room to booking error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to assign room to booking',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

/**
 * @desc    Add maintenance record
 * @route   POST /api/v1/rooms/:id/maintenance
 * @access  Private
 */
const addMaintenanceRecord = async (req, res) => {
  try {
    const room = await Room.findById(req.params.id);
    if (!room) {
      return res.status(404).json({ success: false, message: 'Room not found' });
    }

    await room.addMaintenance(req.body, req.user.id);

    res.status(201).json({
      success: true,
      message: 'Maintenance record added successfully',
      data: { room }
    });
  } catch (error) {
    logger.error('Add maintenance record error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to add maintenance record',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

/**
 * @desc    Update maintenance record
 * @route   PUT /api/v1/rooms/:id/maintenance/:maintenanceId
 * @access  Private
 */
const updateMaintenanceRecord = async (req, res) => {
  try {
    const { id, maintenanceId } = req.params;
    const room = await Room.findById(id);

    if (!room) {
      return res.status(404).json({ success: false, message: 'Room not found' });
    }

    const record = room.maintenanceSchedule.id(maintenanceId);
    if (!record) {
      return res.status(404).json({ success: false, message: 'Maintenance record not found' });
    }

    if (req.body.status) record.status = req.body.status;
    if (req.body.completedDate) record.completedDate = req.body.completedDate;
    if (req.body.cost !== undefined) record.cost = req.body.cost;
    if (req.body.notes) record.notes = req.body.notes;

    if (record.status === 'completed' && room.status === 'maintenance') {
      room.status = 'available';
    }

    await room.save();

    res.json({
      success: true,
      message: 'Maintenance record updated successfully',
      data: { record }
    });
  } catch (error) {
    logger.error('Update maintenance record error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update maintenance record',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

/**
 * @desc    Get maintenance schedule for room
 * @route   GET /api/v1/rooms/:id/maintenance
 * @access  Private
 */
const getMaintenanceSchedule = async (req, res) => {
  try {
    const room = await Room.findById(req.params.id);
    if (!room) {
      return res.status(404).json({ success: false, message: 'Room not found' });
    }

    res.json({
      success: true,
      data: { maintenanceSchedule: room.maintenanceSchedule }
    });
  } catch (error) {
    logger.error('Get maintenance schedule error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get maintenance schedule',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

/**
 * @desc    Upload room images
 * @route   POST /api/v1/rooms/:id/images
 * @access  Private
 */
const uploadRoomImages = async (req, res) => {
  try {
    const room = await Room.findById(req.params.id);
    if (!room) {
      return res.status(404).json({ success: false, message: 'Room not found' });
    }

    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ success: false, message: 'No images uploaded' });
    }

    const newImages = req.files.map(file => ({
      url: `/uploads/images/${file.filename}`,
      caption: file.originalname
    }));

    room.images.push(...newImages);
    await room.save();

    res.status(201).json({
      success: true,
      message: 'Images uploaded successfully',
      data: { images: room.images }
    });
  } catch (error) {
    logger.error('Upload room images error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to upload room images',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

/**
 * @desc    Delete room image
 * @route   DELETE /api/v1/rooms/:id/images/:imageId
 * @access  Private
 */
const deleteRoomImage = async (req, res) => {
  try {
    const { id, imageId } = req.params;
    const room = await Room.findById(id);

    if (!room) {
      return res.status(404).json({ success: false, message: 'Room not found' });
    }

    const image = room.images.id(imageId);
    if (!image) {
      return res.status(404).json({ success: false, message: 'Image not found' });
    }

    room.images.pull(imageId);
    await room.save();

    res.json({
      success: true,
      message: 'Image deleted successfully'
    });
  } catch (error) {
    logger.error('Delete room image error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete room image',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

/**
 * @desc    Get room revenue
 * @route   GET /api/v1/rooms/:id/revenue
 * @access  Private
 */
const getRoomRevenue = async (req, res) => {
  try {
    const { id } = req.params;
    const { startDate, endDate } = req.query;

    const room = await Room.findById(id);
    if (!room) {
      return res.status(404).json({ success: false, message: 'Room not found' });
    }

    const revenue = await room.calculateRevenue(new Date(startDate), new Date(endDate));

    res.json({
      success: true,
      data: { roomId: id, revenue, startDate, endDate }
    });
  } catch (error) {
    logger.error('Get room revenue error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get room revenue',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

/**
 * @desc    Bulk update room status
 * @route   PUT /api/v1/rooms/bulk-update-status
 * @access  Private
 */
const bulkUpdateRoomStatus = async (req, res) => {
  try {
    const { roomIds, status } = req.body;

    if (!roomIds || !Array.isArray(roomIds) || roomIds.length === 0) {
      return res.status(400).json({ success: false, message: 'roomIds array is required' });
    }

    await Room.updateMany(
      { _id: { $in: roomIds } },
      { $set: { status, updatedAt: new Date(), updatedBy: req.user.id } }
    );

    res.json({
      success: true,
      message: `Successfully updated status for ${roomIds.length} rooms`
    });
  } catch (error) {
    logger.error('Bulk update room status error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to bulk update room status',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

/**
 * @desc    Get occupancy report
 * @route   GET /api/v1/rooms/occupancy-report
 * @access  Private
 */
const getOccupancyReport = async (req, res) => {
  try {
    const { startDate, endDate } = req.query;

    const start = new Date(startDate);
    const end = new Date(endDate);

    if (start > end) {
        return res.status(400).json({ success: false, message: 'Start date must be before end date' });
    }

    const stats = await Room.getOccupancyStats(start, end);

    res.json({
      success: true,
      data: stats
    });
  } catch (error) {
    logger.error('Get occupancy report error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get occupancy report',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

module.exports = {
  getRooms,
  getRoom,
  createRoom,
  updateRoom,
  deleteRoom,
  checkAvailability,
  updateRoomStatus,
  getRoomStatistics,
  getRoomAvailabilityCalendar,
  assignRoomToBooking,
  addMaintenanceRecord,
  updateMaintenanceRecord,
  getMaintenanceSchedule,
  uploadRoomImages,
  deleteRoomImage,
  getRoomRevenue,
  bulkUpdateRoomStatus,
  getOccupancyReport
};
