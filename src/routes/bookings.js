const express = require('express');
const { body, validationResult } = require('express-validator');
const { query, transaction } = require('../models/database');
const { authenticate, requireStudent, requireTeacher } = require('../middleware/auth');

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
    const result = await query(`
      INSERT INTO bookings (
        student_id, teacher_id, subject_id, grade_level,
        scheduled_date, duration, price_per_hour, total_amount,
        status, meeting_link, notes
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'pending_payment', $9, $10)
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

    const validStatuses = ['pending_payment', 'payment_under_review', 'confirmed', 'completed', 'cancelled'];
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

      // Teachers can only confirm/complete their own bookings
      if (isTeacher && !['confirmed', 'completed'].includes(status)) {
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
        WHERE b.student_id = $1 AND b.status = 'confirmed' AND b.scheduled_date > NOW()
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
        WHERE b.teacher_id = $1 AND b.status = 'confirmed' AND b.scheduled_date > NOW()
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

module.exports = router;
