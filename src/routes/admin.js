const express = require('express');
const { query } = require('../models/database');
const { authenticate, requireAdmin } = require('../middleware/auth');

const router = express.Router();

// @route   GET /api/admin/stats
// @desc    Get admin dashboard statistics
// @access  Private/Admin
router.get('/stats', authenticate, requireAdmin, async (req, res) => {
  try {
    // Total teachers
    const teachersCount = await query('SELECT COUNT(*) FROM teachers');
    
    // Pending verifications
    const pendingVerifications = await query(
      "SELECT COUNT(*) FROM teachers WHERE verification_status = 'pending'"
    );
    
    // Total students
    const studentsCount = await query('SELECT COUNT(*) FROM students');
    
    // Pending payments
    const pendingPayments = await query(
      "SELECT COUNT(*) FROM payment_proofs WHERE status = 'pending'"
    );
    
    // Total bookings
    const bookingsCount = await query('SELECT COUNT(*) FROM bookings');
    
    // Completed classes
    const completedClasses = await query(
      "SELECT COUNT(*) FROM bookings WHERE status = 'completed'"
    );
    
    // Total subjects
    const subjectsCount = await query('SELECT COUNT(*) FROM subjects');
    
    // Active subjects
    const activeSubjects = await query(
      'SELECT COUNT(*) FROM subjects WHERE is_active = true'
    );
    
    // Total revenue
    const revenue = await query(
      "SELECT COALESCE(SUM(total_amount), 0) FROM bookings WHERE status IN ('confirmed', 'completed')"
    );

    res.json({
      success: true,
      data: {
        totalTeachers: parseInt(teachersCount.rows[0].count),
        pendingVerifications: parseInt(pendingVerifications.rows[0].count),
        totalStudents: parseInt(studentsCount.rows[0].count),
        pendingPayments: parseInt(pendingPayments.rows[0].count),
        totalBookings: parseInt(bookingsCount.rows[0].count),
        completedClasses: parseInt(completedClasses.rows[0].count),
        totalSubjects: parseInt(subjectsCount.rows[0].count),
        activeSubjects: parseInt(activeSubjects.rows[0].count),
        totalRevenue: parseFloat(revenue.rows[0].coalesce || revenue.rows[0].sum || 0)
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

// @route   GET /api/admin/verifications/pending
// @desc    Get pending teacher verifications
// @access  Private/Admin
router.get('/verifications/pending', authenticate, requireAdmin, async (req, res) => {
  try {
    // ✅ FIXED: Return fields that match frontend expectations
    const result = await query(`
      SELECT 
        t.id,
        t.user_id,
        u.name as full_name,
        u.name,
        u.email,
        u.profile_picture,
        u.profile_picture as profilePicture,
        t.bio,
        t.verification_status,
        t.verification_notes,
        t.created_at,
        t.created_at as createdAt,
        t.qualification,
        t.id_document,
        t.id_document as identityDocument,
        COALESCE(
          ARRAY_AGG(DISTINCT ts.subject_id) FILTER (WHERE ts.subject_id IS NOT NULL),
          ARRAY[]::uuid[]
        ) as subjects
      FROM teachers t
      JOIN users u ON t.user_id = u.id
      LEFT JOIN teacher_subjects ts ON t.id = ts.teacher_id
      WHERE t.verification_status = 'pending'
      GROUP BY t.id, u.id
      ORDER BY t.created_at DESC
    `);

    res.json({
      success: true,
      count: result.rows.length,
      data: result.rows
    });
  } catch (error) {
    console.error('Get pending verifications error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get pending verifications',
      error: error.message
    });
  }
});

// @route   GET /api/admin/recent-activity
// @desc    Get recent activity
// @access  Private/Admin
router.get('/recent-activity', authenticate, requireAdmin, async (req, res) => {
  try {
    // Recent teacher applications
    const recentTeachers = await query(`
      SELECT 
        t.id, u.name, u.email, t.verification_status, t.created_at,
        'teacher_application' as type
      FROM teachers t
      JOIN users u ON t.user_id = u.id
      ORDER BY t.created_at DESC
      LIMIT 5
    `);

    // Recent bookings
    const recentBookings = await query(`
      SELECT 
        b.id, su.name as student_name, tu.name as teacher_name,
        s.name as subject_name, b.status, b.created_at,
        'booking' as type
      FROM bookings b
      JOIN students st ON b.student_id = st.id
      JOIN teachers t ON b.teacher_id = t.id
      JOIN users su ON st.user_id = su.id
      JOIN users tu ON t.user_id = tu.id
      JOIN subjects s ON b.subject_id = s.id
      ORDER BY b.created_at DESC
      LIMIT 5
    `);

    // Recent payments
    const recentPayments = await query(`
      SELECT 
        pp.id, su.name as student_name, b.total_amount,
        pp.status, pp.uploaded_at as created_at,
        'payment' as type
      FROM payment_proofs pp
      JOIN bookings b ON pp.booking_id = b.id
      JOIN students st ON b.student_id = st.id
      JOIN users su ON st.user_id = su.id
      ORDER BY pp.uploaded_at DESC
      LIMIT 5
    `);

    // Combine and sort by date
    const allActivity = [
      ...recentTeachers.rows,
      ...recentBookings.rows,
      ...recentPayments.rows
    ].sort((a, b) => new Date(b.created_at) - new Date(a.created_at)).slice(0, 10);

    res.json({
      success: true,
      data: allActivity
    });
  } catch (error) {
    console.error('Get recent activity error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get recent activity'
    });
  }
});

// @route   GET /api/admin/users
// @desc    Get all users
// @access  Private/Admin
router.get('/users', authenticate, requireAdmin, async (req, res) => {
  try {
    const result = await query(`
      SELECT 
        id, email, name, role, profile_picture, created_at, updated_at
      FROM users
      ORDER BY created_at DESC
    `);

    res.json({
      success: true,
      count: result.rows.length,
      data: result.rows
    });
  } catch (error) {
    console.error('Get users error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get users'
    });
  }
});

// @route   PUT /api/admin/users/:id
// @desc    Update user
// @access  Private/Admin
router.put('/users/:id', authenticate, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { name, role, isActive } = req.body;

    const updates = [];
    const values = [];
    let paramCount = 1;

    if (name !== undefined) {
      updates.push(`name = $${paramCount}`);
      values.push(name);
      paramCount++;
    }

    if (role !== undefined) {
      updates.push(`role = $${paramCount}`);
      values.push(role);
      paramCount++;
    }

    if (updates.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No fields to update'
      });
    }

    values.push(id);

    const result = await query(
      `UPDATE users SET ${updates.join(', ')}, updated_at = NOW()
       WHERE id = $${paramCount}
       RETURNING id, email, name, role, profile_picture`,
      values
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    res.json({
      success: true,
      message: 'User updated successfully',
      data: result.rows[0]
    });
  } catch (error) {
    console.error('Update user error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update user'
    });
  }
});

// @route   DELETE /api/admin/users/:id
// @desc    Delete user
// @access  Private/Admin
router.delete('/users/:id', authenticate, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;

    // Check if user exists
    const userResult = await query('SELECT id FROM users WHERE id = $1', [id]);
    
    if (userResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Delete user (cascade will handle related records)
    await query('DELETE FROM users WHERE id = $1', [id]);

    res.json({
      success: true,
      message: 'User deleted successfully'
    });
  } catch (error) {
    console.error('Delete user error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete user'
    });
  }
});

// @route   GET /api/admin/revenue
// @desc    Get revenue report
// @access  Private/Admin
router.get('/revenue', authenticate, requireAdmin, async (req, res) => {
  try {
    const { startDate, endDate } = req.query;

    let dateFilter = '';
    const params = [];

    if (startDate && endDate) {
      dateFilter = 'AND b.created_at BETWEEN $1 AND $2';
      params.push(startDate, endDate);
    }

    // Revenue by subject
    const revenueBySubject = await query(`
      SELECT 
        s.name as subject,
        COUNT(b.id) as booking_count,
        SUM(b.total_amount) as total_revenue
      FROM bookings b
      JOIN subjects s ON b.subject_id = s.id
      WHERE b.status IN ('confirmed', 'completed')
      ${dateFilter}
      GROUP BY s.id, s.name
      ORDER BY total_revenue DESC
    `, params);

    // Revenue by month
    const revenueByMonth = await query(`
      SELECT 
        DATE_TRUNC('month', b.created_at) as month,
        COUNT(b.id) as booking_count,
        SUM(b.total_amount) as total_revenue
      FROM bookings b
      WHERE b.status IN ('confirmed', 'completed')
      ${dateFilter}
      GROUP BY DATE_TRUNC('month', b.created_at)
      ORDER BY month DESC
    `, params);

    res.json({
      success: true,
      data: {
        bySubject: revenueBySubject.rows,
        byMonth: revenueByMonth.rows
      }
    });
  } catch (error) {
    console.error('Get revenue error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get revenue report'
    });
  }
});

module.exports = router;