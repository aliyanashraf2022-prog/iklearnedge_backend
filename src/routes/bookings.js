const express = require('express');
const { body, validationResult } = require('express-validator');
const { query, transaction } = require('../models/database');
const { authenticate, requireStudent, requireTeacher } = require('../middleware/auth');
const { createNotification } = require('./notifications');

const router = express.Router();

// @route   GET /api/bookings
// @desc    Get user's bookings
// @access  Private
router.get('/', authenticate, async (req, res) => {
  try {
    let sql;
    let params;

    if (req.user.role === 'student') {
      // Get student ID
      const studentResult = await query(
        'SELECT id FROM students WHERE user_id = $1',
        [req.user.id]
      );
      
      if (studentResult.rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'Student not found'
        });
      }

      const studentId = studentResult.rows[0].id;

      sql = `
        SELECT 
          b.*,
          u.name as teacher_name,
          u.profile_picture as teacher_picture,
          s.name as subject_name
        FROM bookings b
        JOIN teachers t ON b.teacher_id = t.id
        JOIN users u ON t.user_id = u.id
        JOIN subjects s ON b.subject_id = s.id
        WHERE b.student_id = $1
        ORDER BY b.created_at DESC
      `;
      params = [studentId];
    } else if (req.user.role === 'teacher') {
      // Get teacher ID
      const teacherResult = await query(
        'SELECT id FROM teachers WHERE user_id = $1',
        [req.user.id]
      );
      
      if (teacherResult.rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'Teacher not found'
        });
      }

      const teacherId = teacherResult.rows[0].id;

      sql = `
        SELECT 
          b.*,
          u.name as student_name,
          u.profile_picture as student_picture,
          s.name as subject_name
        FROM bookings b
        JOIN students st ON b.student_id = st.id
        JOIN users u ON st.user_id = u.id
        JOIN subjects s ON b.subject_id = s.id
        WHERE b.teacher_id = $1
        ORDER BY b.created_at DESC
      `;
      params = [teacherId];
    } else {
      return res.status(403).json({
        success: false,
        message: 'Not authorized'
      });
    }

    const result = await query(sql, params);

    res.json({
      success: true,
      count: result.rows.length,
      data: result.rows
    });
  } catch (error) {
    console.error('Get bookings error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get bookings'
    });
  }
});

// @route   GET /api/bookings/:id
// @desc    Get booking by ID
// @access  Private
router.get('/:id', authenticate, async (req, res) => {
  try {
    const { id } = req.params;

    const result = await query(`
      SELECT 
        b.*,
        tu.name as teacher_name,
        tu.profile_picture as teacher_picture,
        su.name as student_name,
        su.profile_picture as student_picture,
        sub.name as subject_name
      FROM bookings b
      JOIN teachers t ON b.teacher_id = t.id
      JOIN users tu ON t.user_id = tu.id
      JOIN students s ON b.student_id = s.id
      JOIN users su ON s.user_id = su.id
      JOIN subjects sub ON b.subject_id = sub.id
      WHERE b.id = $1
    `, [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Booking not found'
      });
    }

    const booking = result.rows[0];

    // Check authorization
    if (req.user.role !== 'admin') {
      const studentResult = await query(
        'SELECT id FROM students WHERE user_id = $1',
        [req.user.id]
      );
      const teacherResult = await query(
        'SELECT id FROM teachers WHERE user_id = $1',
        [req.user.id]
      );

      const isStudent = studentResult.rows.length > 0 && studentResult.rows[0].id === booking.student_id;
      const isTeacher = teacherResult.rows.length > 0 && teacherResult.rows[0].id === booking.teacher_id;

      if (!isStudent && !isTeacher) {
        return res.status(403).json({
          success: false,
          message: 'Not authorized'
        });
      }
    }

    res.json({
      success: true,
      data: booking
    });
  } catch (error) {
    console.error('Get booking error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get booking'
    });
  }
});

// @route   POST /api/bookings
// @desc    Create new booking
// @access  Private/Student
router.post('/', authenticate, requireStudent, [
  body('teacherId').isInt(),
  body('subjectId').isInt(),
  body('scheduledDate').isISO8601(),
  body('duration').isInt({ min: 30, max: 240 })
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        errors: errors.array()
      });
    }

    const { teacherId, subjectId, scheduledDate, duration, notes } = req.body;

    // Get student ID
    const studentResult = await query(
      'SELECT id, grade_level FROM students WHERE user_id = $1',
      [req.user.id]
    );

    if (studentResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Student not found'
      });
    }

    const studentId = studentResult.rows[0].id;
    const gradeLevel = studentResult.rows[0].grade_level;

    // Get price for subject and grade
    const priceResult = await query(
      'SELECT price_per_hour FROM pricing_tiers WHERE subject_id = $1 AND grade_level = $2',
      [subjectId, gradeLevel]
    );

    if (priceResult.rows.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Price not found for this subject and grade level'
      });
    }

    const pricePerHour = priceResult.rows[0].price_per_hour;
    const totalAmount = Math.round((pricePerHour * duration) / 60);

    // Get teacher's meeting link
    const teacherResult = await query(
      'SELECT meeting_link FROM teachers WHERE id = $1',
      [teacherId]
    );

    const meetingLink = teacherResult.rows[0]?.meeting_link || '';

    // Create booking
    // Status: 'pending_admin' - admin needs to verify payment first
    const result = await query(`
      INSERT INTO bookings (
        student_id, teacher_id, subject_id, grade_level,
        scheduled_date, duration, price_per_hour, total_amount,
        status, meeting_link, notes, is_demo
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'pending_admin', $9, $10, false)
      RETURNING *
    `, [studentId, teacherId, subjectId, gradeLevel, scheduledDate, duration, pricePerHour, totalAmount, meetingLink, notes || '']);

    res.status(201).json({
      success: true,
      message: 'Booking created successfully',
      data: result.rows[0]
    });
  } catch (error) {
    console.error('Create booking error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create booking'
    });
  }
});

// @route   PUT /api/bookings/:id/status
// @desc    Update booking status
// @access  Private
router.put('/:id/status', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    const validStatuses = [
      'pending_admin',      // Paid booking - waiting for admin to verify payment
      'pending_teacher',    // Demo or verified booking - waiting for teacher to accept
      'accepted',           // Teacher accepted with meeting link
      'completed',          // Class completed
      'cancelled'          // Cancelled
    ];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid status'
      });
    }

    // Get booking
    const bookingResult = await query(
      'SELECT student_id, teacher_id FROM bookings WHERE id = $1',
      [id]
    );

    if (bookingResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Booking not found'
      });
    }

    const booking = bookingResult.rows[0];

    // Check authorization
    if (req.user.role !== 'admin') {
      const studentResult = await query(
        'SELECT id FROM students WHERE user_id = $1',
        [req.user.id]
      );
      const teacherResult = await query(
        'SELECT id FROM teachers WHERE user_id = $1',
        [req.user.id]
      );

      const isStudent = studentResult.rows.length > 0 && studentResult.rows[0].id === booking.student_id;
      const isTeacher = teacherResult.rows.length > 0 && teacherResult.rows[0].id === booking.teacher_id;

      // Students can only cancel their own bookings
      if (isStudent && status !== 'cancelled') {
        return res.status(403).json({
          success: false,
          message: 'Not authorized'
        });
      }

      // Teachers can only accept/complete their own bookings
      if (isTeacher && !['accepted', 'completed'].includes(status)) {
        return res.status(403).json({
          success: false,
          message: 'Not authorized'
        });
      }

      if (!isStudent && !isTeacher) {
        return res.status(403).json({
          success: false,
          message: 'Not authorized'
        });
      }
    }

    const result = await query(
      `UPDATE bookings SET status = $1, updated_at = NOW() WHERE id = $2 RETURNING *`,
      [status, id]
    );

    res.json({
      success: true,
      message: 'Booking status updated',
      data: result.rows[0]
    });
  } catch (error) {
    console.error('Update booking status error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update booking status'
    });
  }
});

// @route   GET /api/bookings/upcoming/classes
// @desc    Get upcoming classes
// @access  Private
router.get('/upcoming/classes', authenticate, async (req, res) => {
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
          b.*,
          u.name as teacher_name,
          u.profile_picture as teacher_picture,
          s.name as subject_name
        FROM bookings b
        JOIN teachers t ON b.teacher_id = t.id
        JOIN users u ON t.user_id = u.id
        JOIN subjects s ON b.subject_id = s.id
        WHERE b.student_id = $1 AND b.status = 'accepted' AND b.scheduled_date > NOW()
        ORDER BY b.scheduled_date ASC
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
          b.*,
          u.name as student_name,
          u.profile_picture as student_picture,
          s.name as subject_name
        FROM bookings b
        JOIN students st ON b.student_id = st.id
        JOIN users u ON st.user_id = u.id
        JOIN subjects s ON b.subject_id = s.id
        WHERE b.teacher_id = $1 AND b.status = 'accepted' AND b.scheduled_date > NOW()
        ORDER BY b.scheduled_date ASC
      `;
      params = [teacherId];
    } else {
      return res.status(403).json({
        success: false,
        message: 'Not authorized'
      });
    }

    const result = await query(sql, params);

    res.json({
      success: true,
      count: result.rows.length,
      data: result.rows
    });
  } catch (error) {
    console.error('Get upcoming classes error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get upcoming classes'
    });
  }
});

// @route   GET /api/bookings/demo/requests
// @desc    Get demo booking requests (for teachers)
// @access  Private/Teacher
router.get('/demo/requests', authenticate, requireTeacher, async (req, res) => {
  try {
    const teacherResult = await query(
      'SELECT id FROM teachers WHERE user_id = $1',
      [req.user.id]
    );
    const teacherId = teacherResult.rows[0].id;

    const sql = `
      SELECT 
        b.*,
        u.name as student_name,
        u.email as student_email,
        u.profile_picture as student_picture,
        s.name as subject_name
      FROM bookings b
      JOIN students st ON b.student_id = st.id
      JOIN users u ON st.user_id = u.id
      JOIN subjects s ON b.subject_id = s.id
      WHERE b.teacher_id = $1 AND b.is_demo = true
      ORDER BY b.created_at DESC
    `;

    const result = await query(sql, [teacherId]);

    res.json({
      success: true,
      count: result.rows.length,
      data: result.rows
    });
  } catch (error) {
    console.error('Get demo requests error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get demo requests'
    });
  }
});

// @route   GET /api/bookings/pending-admin
// @desc    Get bookings pending admin verification
// @access  Private/Admin
router.get('/pending-admin', authenticate, async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Only admins can access this'
      });
    }

    const sql = `
      SELECT 
        b.*,
        su.name as student_name,
        su.email as student_email,
        tu.name as teacher_name,
        tu.email as teacher_email,
        s.name as subject_name
      FROM bookings b
      JOIN students st ON b.student_id = st.id
      JOIN users su ON st.user_id = su.id
      JOIN teachers t ON b.teacher_id = t.id
      JOIN users tu ON t.user_id = tu.id
      JOIN subjects s ON b.subject_id = s.id
      WHERE b.status = 'pending_admin'
      ORDER BY b.created_at DESC
    `;

    const result = await query(sql);

    res.json({
      success: true,
      count: result.rows.length,
      data: result.rows
    });
  } catch (error) {
    console.error('Get pending admin bookings error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get pending admin bookings'
    });
  }
});

// @route   GET /api/bookings/teacher
// @desc    Get all bookings for a teacher
// @access  Private/Teacher
router.get('/teacher', authenticate, requireTeacher, async (req, res) => {
  try {
    const teacherResult = await query(
      'SELECT id FROM teachers WHERE user_id = $1',
      [req.user.id]
    );
    const teacherId = teacherResult.rows[0].id;

    const sql = `
      SELECT 
        b.*,
        u.name as student_name,
        u.email as student_email,
        u.profile_picture as student_picture,
        s.name as subject_name
      FROM bookings b
      JOIN students st ON b.student_id = st.id
      JOIN users u ON st.user_id = u.id
      JOIN subjects s ON b.subject_id = s.id
      WHERE b.teacher_id = $1
      ORDER BY b.created_at DESC
    `;

    const result = await query(sql, [teacherId]);

    res.json({
      success: true,
      count: result.rows.length,
      data: result.rows
    });
  } catch (error) {
    console.error('Get teacher bookings error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get teacher bookings'
    });
  }
});

// @route   POST /api/bookings/demo
// @desc    Create demo booking request
// @access  Private/Student
router.post('/demo', authenticate, requireStudent, [
  body('teacherId').isInt(),
  body('subjectId').isInt(),
  body('scheduledDate').isISO8601()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        errors: errors.array()
      });
    }

    const { teacherId, subjectId, scheduledDate } = req.body;

    // Get student ID
    const studentResult = await query(
      'SELECT id FROM students WHERE user_id = $1',
      [req.user.id]
    );

    if (studentResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Student not found'
      });
    }

    const studentId = studentResult.rows[0].id;

    // Check if student already has a demo with this teacher
    const existingDemo = await query(
      `SELECT id FROM bookings 
       WHERE student_id = $1 AND teacher_id = $2 AND notes = 'demo'`,
      [studentId, teacherId]
    );

    if (existingDemo.rows.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'You already have a pending or confirmed demo with this teacher'
      });
    }

    // Create demo booking (free, no payment required)
    // Status: 'pending_teacher' - teacher needs to accept
    // is_demo: true - identifies as demo class
    const result = await query(`
      INSERT INTO bookings (
        student_id, teacher_id, subject_id, 
        scheduled_date, duration, price_per_hour, total_amount,
        status, notes, is_demo
      ) VALUES ($1, $2, $3, $4, 30, 0, 0, 'pending_teacher', 'demo', true)
      RETURNING *
    `, [studentId, teacherId, subjectId, scheduledDate]);

    // Get teacher's user_id for notification
    const teacherUserResult = await query(
      'SELECT user_id FROM teachers WHERE id = $1',
      [teacherId]
    );

    // Get student name for notification
    const studentUserResult = await query(
      'SELECT name FROM users WHERE id = $1',
      [req.user.id]
    );

    // Get subject name
    const subjectResult = await query(
      'SELECT name FROM subjects WHERE id = $1',
      [subjectId]
    );

    const studentName = studentUserResult.rows[0]?.name || 'A student';
    const subjectName = subjectResult.rows[0]?.name || 'a subject';

    // Notify the teacher
    if (teacherUserResult.rows[0]?.user_id) {
      await createNotification(
        teacherUserResult.rows[0].user_id,
        'New Demo Request',
        `${studentName} requested a demo class for ${subjectName}`,
        'demo_request'
      );
    }

    res.status(201).json({
      success: true,
      message: 'Demo request sent successfully!',
      data: result.rows[0]
    });
  } catch (error) {
    console.error('Create demo booking error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create demo booking'
    });
  }
});

// @route   PUT /api/bookings/:id/meeting
// @desc    Accept demo and set meeting link
// @access  Private/Teacher
router.put('/:id/meeting', authenticate, requireTeacher, async (req, res) => {
  try {
    const { id } = req.params;
    const { meetingLink } = req.body;

    if (!meetingLink) {
      return res.status(400).json({
        success: false,
        message: 'Meeting link is required'
      });
    }

    // Verify teacher owns this booking
    const teacherResult = await query(
      'SELECT id FROM teachers WHERE user_id = $1',
      [req.user.id]
    );
    const teacherId = teacherResult.rows[0].id;

    const bookingResult = await query(
      'SELECT id, status FROM bookings WHERE id = $1 AND teacher_id = $2',
      [id, teacherId]
    );

    if (bookingResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Booking not found or not authorized'
      });
    }

    const booking = bookingResult.rows[0];

    // Only allow accepting bookings in pending_teacher status
    if (booking.status !== 'pending_teacher') {
      return res.status(400).json({
        success: false,
        message: 'This booking cannot be accepted'
      });
    }

    // Update booking with meeting link and set status to 'accepted'
    const result = await query(`
      UPDATE bookings 
      SET meeting_link = $1, status = 'accepted', updated_at = NOW()
      WHERE id = $2
      RETURNING *
    `, [meetingLink, id]);

    // Get student's user_id for notification
    const bookingWithStudent = await query(`
      SELECT b.*, st.user_id as student_user_id, u.name as teacher_name
      FROM bookings b
      JOIN students st ON b.student_id = st.id
      JOIN teachers t ON b.teacher_id = t.id
      JOIN users u ON t.user_id = u.id
      WHERE b.id = $1
    `, [id]);

    const bookingData = bookingWithStudent.rows[0];

    // Notify the student
    if (bookingData?.student_user_id) {
      await createNotification(
        bookingData.student_user_id,
        'Class Accepted!',
        `Your class with ${bookingData.teacher_name} has been accepted. Meeting link: ${meetingLink}`,
        'accepted'
      );
    }

    res.json({
      success: true,
      message: 'Demo confirmed! Meeting link has been shared with the student.',
      data: result.rows[0]
    });
  } catch (error) {
    console.error('Update meeting link error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update meeting link'
    });
  }
});

// @route   PUT /api/bookings/:id/confirm
// @desc    Confirm demo booking (alternative to meeting link)
// @access  Private/Teacher
router.put('/:id/confirm', authenticate, requireTeacher, async (req, res) => {
  try {
    const { id } = req.params;
    const { meetingLink } = req.body;

    // Verify teacher owns this booking
    const teacherResult = await query(
      'SELECT id FROM teachers WHERE user_id = $1',
      [req.user.id]
    );
    const teacherId = teacherResult.rows[0].id;

    const bookingResult = await query(
      'SELECT id, status FROM bookings WHERE id = $1 AND teacher_id = $2',
      [id, teacherId]
    );

    if (bookingResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Booking not found or not authorized'
      });
    }

    const booking = bookingResult.rows[0];

    // Only allow confirming demo bookings (pending_payment with notes='demo')
    if (booking.status !== 'pending_payment' || booking.notes !== 'demo') {
      return res.status(400).json({
        success: false,
        message: 'This booking cannot be confirmed'
      });
    }

    // Update booking status
    const updateData = meetingLink 
      ? { status: 'confirmed', meeting_link: meetingLink }
      : { status: 'confirmed' };

    const result = await query(`
      UPDATE bookings 
      SET status = $1, meeting_link = COALESCE($2, meeting_link), updated_at = NOW()
      WHERE id = $3
      RETURNING *
    `, [updateData.status, updateData.meeting_link, id]);

    // Get student's user_id for notification
    const bookingWithStudent = await query(`
      SELECT b.*, st.user_id as student_user_id, u.name as teacher_name
      FROM bookings b
      JOIN students st ON b.student_id = st.id
      JOIN teachers t ON b.teacher_id = t.id
      JOIN users u ON t.user_id = u.id
      WHERE b.id = $1
    `, [id]);

    const bookingData = bookingWithStudent.rows[0];

    // Notify the student
    if (bookingData?.student_user_id) {
      await createNotification(
        bookingData.student_user_id,
        'Demo Class Confirmed!',
        `Your demo class with ${bookingData.teacher_name} has been confirmed.`,
        'confirmed'
      );
    }

    res.json({
      success: true,
      message: 'Demo booking confirmed!',
      data: result.rows[0]
    });
  } catch (error) {
    console.error('Confirm booking error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to confirm booking'
    });
  }
});

// @route   PUT /api/bookings/:id/verify-payment
// @desc    Admin verifies payment and moves booking to pending_teacher
// @access  Private/Admin
router.put('/:id/verify-payment', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const { receiptUrl } = req.body;

    // Verify admin
    if (req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Only admins can verify payments'
      });
    }

    // Get booking
    const bookingResult = await query(
      'SELECT * FROM bookings WHERE id = $1',
      [id]
    );

    if (bookingResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Booking not found'
      });
    }

    const booking = bookingResult.rows[0];

    // Only allow verifying pending_admin bookings
    if (booking.status !== 'pending_admin') {
      return res.status(400).json({
        success: false,
        message: 'This booking is not pending payment verification'
      });
    }

    // Update booking
    const updateData = {
      status: 'pending_teacher',
      receipt_url: receiptUrl || booking.receipt_url
    };

    const result = await query(`
      UPDATE bookings 
      SET status = $1, receipt_url = $2, updated_at = NOW()
      WHERE id = $3
      RETURNING *
    `, [updateData.status, updateData.receipt_url, id]);

    // Get teacher user_id for notification
    const teacherResult = await query(`
      SELECT t.user_id as teacher_user_id, u.name as teacher_name
      FROM bookings b
      JOIN teachers t ON b.teacher_id = t.id
      JOIN users u ON t.user_id = u.id
      WHERE b.id = $1
    `, [id]);

    const teacherData = teacherResult.rows[0];

    // Notify teacher
    if (teacherData?.teacher_user_id) {
      await createNotification(
        teacherData.teacher_user_id,
        'Payment Verified!',
        `Your booking has been verified. Please add a meeting link to confirm.`,
        'payment_verified'
      );
    }

    res.json({
      success: true,
      message: 'Payment verified! Booking moved to teacher for confirmation.',
      data: result.rows[0]
    });
  } catch (error) {
    console.error('Verify payment error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to verify payment'
    });
  }
});

// @route   DELETE /api/bookings/:id/demo
// @desc    Cancel demo booking
// @access  Private
router.delete('/:id/demo', authenticate, async (req, res) => {
  try {
    const { id } = req.params;

    // Get booking and verify ownership
    const bookingResult = await query(
      'SELECT student_id, teacher_id, status, is_demo FROM bookings WHERE id = $1',
      [id]
    );

    if (bookingResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Booking not found'
      });
    }

    const booking = bookingResult.rows[0];

    // Only allow cancelling demo bookings in pending_teacher status
    if (booking.status !== 'pending_teacher' || booking.is_demo !== true) {
      return res.status(400).json({
        success: false,
        message: 'This demo booking cannot be cancelled'
      });
    }

    // Verify user is the student or teacher
    let isAuthorized = false;
    
    if (req.user.role === 'student') {
      const studentResult = await query(
        'SELECT id FROM students WHERE user_id = $1',
        [req.user.id]
      );
      isAuthorized = studentResult.rows.length > 0 && studentResult.rows[0].id === booking.student_id;
    } else if (req.user.role === 'teacher') {
      const teacherResult = await query(
        'SELECT id FROM teachers WHERE user_id = $1',
        [req.user.id]
      );
      isAuthorized = teacherResult.rows.length > 0 && teacherResult.rows[0].id === booking.teacher_id;
    }

    if (!isAuthorized) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized'
      });
    }

    // Update status to cancelled
    await query(
      `UPDATE bookings SET status = 'cancelled', updated_at = NOW() WHERE id = $1`,
      [id]
    );

    res.json({
      success: true,
      message: 'Demo booking cancelled successfully'
    });
  } catch (error) {
    console.error('Cancel demo booking error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to cancel demo booking'
    });
  }
});

module.exports = router;
