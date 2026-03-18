const express = require('express');
const { query } = require('../models/database');
const { authenticate, requireStudent, requireAdmin } = require('../middleware/auth');

const router = express.Router();

// @route   GET /api/students/profile
// @desc    Get current student profile
// @access  Private/Student
router.get('/profile', authenticate, requireStudent, async (req, res) => {
  try {
    const result = await query(`
      SELECT 
        s.id, s.user_id, u.name, u.email, u.profile_picture,
        s.grade_level, s.parent_contact, s.location
      FROM students s
      JOIN users u ON s.user_id = u.id
      WHERE s.user_id = $1
    `, [req.user.id]);

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Student profile not found'
      });
    }

    res.json({
      success: true,
      data: result.rows[0]
    });
  } catch (error) {
    console.error('Get student profile error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get student profile'
    });
  }
});

// @route   PUT /api/students/profile
// @desc    Update student profile
// @access  Private/Student
router.put('/profile', authenticate, requireStudent, async (req, res) => {
  try {
    const { gradeLevel, parentContact, location } = req.body;

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

    const updates = [];
    const values = [];
    let paramCount = 1;

    if (gradeLevel !== undefined) {
      updates.push(`grade_level = $${paramCount}`);
      values.push(gradeLevel);
      paramCount++;
    }

    if (parentContact !== undefined) {
      updates.push(`parent_contact = $${paramCount}`);
      values.push(parentContact);
      paramCount++;
    }

    if (location !== undefined) {
      updates.push(`location = $${paramCount}`);
      values.push(location);
      paramCount++;
    }

    if (updates.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No fields to update'
      });
    }

    values.push(studentId);

    await query(
      `UPDATE students SET ${updates.join(', ')}, updated_at = NOW()
       WHERE id = $${paramCount}`,
      values
    );

    res.json({
      success: true,
      message: 'Profile updated successfully'
    });
  } catch (error) {
    console.error('Update student profile error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update profile'
    });
  }
});

// @route   GET /api/students/my-teachers
// @desc    Get student's teachers
// @access  Private/Student
router.get('/my-teachers', authenticate, requireStudent, async (req, res) => {
  try {
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

    const result = await query(`
      SELECT DISTINCT
        t.id, u.name, u.email, u.profile_picture,
        t.bio, t.meeting_link
      FROM bookings b
      JOIN teachers t ON b.teacher_id = t.id
      JOIN users u ON t.user_id = u.id
      WHERE b.student_id = $1 AND b.status IN ('confirmed', 'completed')
    `, [studentId]);

    res.json({
      success: true,
      count: result.rows.length,
      data: result.rows
    });
  } catch (error) {
    console.error('Get my teachers error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get teachers'
    });
  }
});

// @route   GET /api/students/stats
// @desc    Get student statistics
// @access  Private/Student
router.get('/stats', authenticate, requireStudent, async (req, res) => {
  try {
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

    // Get stats
    const totalBookings = await query(
      'SELECT COUNT(*) FROM bookings WHERE student_id = $1',
      [studentId]
    );

    const upcomingClasses = await query(
      `SELECT COUNT(*) FROM bookings 
       WHERE student_id = $1 AND status = 'confirmed' AND scheduled_date > NOW()`,
      [studentId]
    );

    const completedClasses = await query(
      `SELECT COUNT(*) FROM bookings 
       WHERE student_id = $1 AND status = 'completed'`,
      [studentId]
    );

    const totalSpent = await query(
      `SELECT COALESCE(SUM(total_amount), 0) FROM bookings 
       WHERE student_id = $1 AND status IN ('confirmed', 'completed')`,
      [studentId]
    );

    const favoriteTeachers = await query(`
      SELECT COUNT(DISTINCT teacher_id) FROM bookings 
      WHERE student_id = $1 AND status IN ('confirmed', 'completed')
    `, [studentId]);

    res.json({
      success: true,
      data: {
        totalBookings: parseInt(totalBookings.rows[0].count),
        upcomingClasses: parseInt(upcomingClasses.rows[0].count),
        completedClasses: parseInt(completedClasses.rows[0].count),
        totalSpent: parseFloat(totalSpent.rows[0].coalesce),
        favoriteTeachers: parseInt(favoriteTeachers.rows[0].count)
      }
    });
  } catch (error) {
    console.error('Get stats error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get statistics'
    });
  }
});

// @route   GET /api/students/all
// @desc    Get all students (admin only)
// @access  Private/Admin
router.get('/all', authenticate, requireAdmin, async (req, res) => {
  try {
    const result = await query(`
      SELECT 
        s.id, s.user_id, u.name, u.email, u.profile_picture,
        s.grade_level, s.parent_contact, s.location,
        s.created_at
      FROM students s
      JOIN users u ON s.user_id = u.id
      ORDER BY s.created_at DESC
    `);

    res.json({
      success: true,
      count: result.rows.length,
      data: result.rows
    });
  } catch (error) {
    console.error('Get all students error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get students'
    });
  }
});

module.exports = router;
