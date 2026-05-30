const transformBooking = (booking) => ({
  id: booking._id,
  bookingNumber: `BK${booking._id.toString().slice(-6).toUpperCase()}`,
  guestName: booking.guest?.name || 'Unknown Guest',
  guestEmail: booking.guest?.email || '',
  guestPhone: booking.guest?.phone || '',
  roomNumber: booking.room?.number || 'N/A',
  roomType: booking.room?.type || 'N/A',
  roomImage: booking.room?.images?.[0] || null,
  checkIn: booking.checkInDate,
  checkOut: booking.checkOutDate,
  status: booking.status,
  totalAmount: booking.totalAmount,
  paidAmount: booking.paidAmount || 0,
  pendingAmount: booking.totalAmount - (booking.paidAmount || 0),
  adults: booking.adults,
  children: booking.children,
  source: booking.source || 'direct',
  specialRequests: booking.specialRequests,
  createdBy: booking.createdBy?.name || 'System',
  createdAt: booking.createdAt,
  updatedAt: booking.updatedAt
});

module.exports = { transformBooking };
