const express = require('express');
const { query, transaction } = require('../models/database');
const { authenticate, requireStudent, requireAdmin } = require('../middleware/auth');

const router = express.Router();

// @route   GET /api/payments
// @desc    Get user's payments
// @access  Private
router.get('/', authenticate, async (req, res) => {
  try {
    let sql;
    let params;

    if (req.user.role === 'student') {
      const studentResult = await query(
        'SELECT id FROM students WHERE user_id = $1',
        [req.user.id]
      );
      const studentId = studentResult.rows[0].id;

      sql = `
        SELECT 
          pp.*,
          b.total_amount,
          b.subject_id,
          s.name as subject_name
        FROM payment_proofs pp
        JOIN bookings b ON pp.booking_id = b.id
        JOIN subjects s ON b.subject_id = s.id
        WHERE b.student_id = $1
        ORDER BY pp.uploaded_at DESC
      `;
      params = [studentId];
    } else if (req.user.role === 'teacher') {
      const teacherResult = await query(
        'SELECT id FROM teachers WHERE user_id = $1',
        [req.user.id]
      );
      const teacherId = teacherResult.rows[0].id;

      sql = `
        SELECT 
          pp.*,
          b.total_amount,
          b.subject_id,
          s.name as subject_name
        FROM payment_proofs pp
        JOIN bookings b ON pp.booking_id = b.id
        JOIN subjects s ON b.subject_id = s.id
        WHERE b.teacher_id = $1
        ORDER BY pp.uploaded_at DESC
      `;
      params = [teacherId];
    } else {
      sql = `
        SELECT 
          pp.*,
          b.total_amount,
          b.subject_id,
          s.name as subject_name
        FROM payment_proofs pp
        JOIN bookings b ON pp.booking_id = b.id
        JOIN subjects s ON b.subject_id = s.id
        ORDER BY pp.uploaded_at DESC
      `;
      params = [];
    }

    const result = await query(sql, params);

    res.json({
      success: true,
      count: result.rows.length,
      data: result.rows
    });
  } catch (error) {
    console.error('Get payments error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get payments'
    });
  }
});

// @route   GET /api/payments/pending
// @desc    Get pending payments (admin only)
// @access  Private/Admin
router.get('/pending', authenticate, requireAdmin, async (req, res) => {
  try {
    const result = await query(`
      SELECT 
        pp.*,
        b.total_amount,
        b.subject_id,
        s.name as subject_name,
        su.name as student_name,
        tu.name as teacher_name
      FROM payment_proofs pp
      JOIN bookings b ON pp.booking_id = b.id
      JOIN subjects s ON b.subject_id = s.id
      JOIN students st ON b.student_id = st.id
      JOIN users su ON st.user_id = su.id
      JOIN teachers t ON b.teacher_id = t.id
      JOIN users tu ON t.user_id = tu.id
      WHERE pp.status = 'pending'
      ORDER BY pp.uploaded_at ASC
    `);

    res.json({
      success: true,
      count: result.rows.length,
      data: result.rows
    });
  } catch (error) {
    console.error('Get pending payments error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get pending payments'
    });
  }
});

// @route   POST /api/payments
// @desc    Upload payment proof
// @access  Private/Student
router.post('/', authenticate, requireStudent, async (req, res) => {
  try {
    const { bookingId, fileUrl, fileName } = req.body;

    if (!bookingId || !fileUrl) {
      return res.status(400).json({
        success: false,
        message: 'Booking ID and file URL are required'
      });
    }

    // Get student ID
    const studentResult = await query(
      'SELECT id FROM students WHERE user_id = $1',
      [req.user.id]
    );
    const studentId = studentResult.rows[0].id;

    // Verify booking belongs to student
    const bookingResult = await query(
      'SELECT id FROM bookings WHERE id = $1 AND student_id = $2',
      [bookingId, studentId]
    );

    if (bookingResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Booking not found'
      });
    }

    await transaction(async (client) => {
      // Create payment proof
      await client.query(`
        INSERT INTO payment_proofs (booking_id, file_url, file_name, status)
        VALUES ($1, $2, $3, 'pending')
      `, [bookingId, fileUrl, fileName || 'payment-proof']);

      // Update booking status
      await client.query(
        "UPDATE bookings SET status = 'payment_under_review', updated_at = NOW() WHERE id = $1",
        [bookingId]
      );
    });

    res.status(201).json({
      success: true,
      message: 'Payment proof uploaded successfully'
    });
  } catch (error) {
    console.error('Upload payment error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to upload payment proof'
    });
  }
});

// @route   PUT /api/payments/:id/verify
// @desc    Verify/reject payment (admin only)
// @access  Private/Admin
router.put('/:id/verify', authenticate, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { status, notes } = req.body;

    if (!['approved', 'rejected'].includes(status)) {
      return res.status(400).json({
        success: false,
        message: 'Status must be approved or rejected'
      });
    }

    await transaction(async (client) => {
      // Update payment proof
      await client.query(`
        UPDATE payment_proofs 
        SET status = $1, review_notes = $2, reviewed_at = NOW()
        WHERE id = $3
      `, [status, notes || '', id]);

      // Get booking ID
      const paymentResult = await client.query(
        'SELECT booking_id FROM payment_proofs WHERE id = $1',
        [id]
      );

      const bookingId = paymentResult.rows[0].booking_id;

      // Update booking status
      const newBookingStatus = status === 'approved' ? 'confirmed' : 'pending_payment';
      await client.query(
        'UPDATE bookings SET status = $1, updated_at = NOW() WHERE id = $2',
        [newBookingStatus, bookingId]
      );
    });

    res.json({
      success: true,
      message: `Payment ${status} successfully`
    });
  } catch (error) {
    console.error('Verify payment error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to verify payment'
    });
  }
});

module.exports = router;
