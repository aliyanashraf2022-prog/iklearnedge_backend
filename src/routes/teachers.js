// ...existing code...
const express = require('express');
const { body, validationResult } = require('express-validator');
const { query, transaction } = require('../models/database');
const { authenticate, requireTeacher, requireAdmin } = require('../middleware/auth');

const router = express.Router();

// @route   GET /api/teachers/top
// @desc    Get top teachers (Public)
// @access  Public
router.get('/top', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 5;
    
    let result = await query(`
      SELECT 
        t.id, t.user_id, u.name, u.profile_picture, t.bio,
        COALESCE(ARRAY_AGG(DISTINCT s.name) FILTER (WHERE s.name IS NOT NULL), '{}') as subject_names
      FROM top_verified_teachers tvt
      JOIN teachers t ON tvt.teacher_id = t.id
      JOIN users u ON t.user_id = u.id
      LEFT JOIN teacher_subjects ts ON t.id = ts.teacher_id
      LEFT JOIN subjects s ON ts.subject_id = s.id
      WHERE t.verification_status = 'approved'
      GROUP BY t.id, u.id, tvt.position
      ORDER BY tvt.position ASC, tvt.created_at ASC
      LIMIT $1
    `, [limit]);

    if (result.rows.length === 0) {
      result = await query(`
        SELECT 
          t.id, t.user_id, u.name, u.profile_picture, t.bio,
          COALESCE(ARRAY_AGG(DISTINCT s.name) FILTER (WHERE s.name IS NOT NULL), '{}') as subject_names
        FROM teachers t
        JOIN users u ON t.user_id = u.id
        LEFT JOIN teacher_subjects ts ON t.id = ts.teacher_id
        LEFT JOIN subjects s ON ts.subject_id = s.id
        WHERE t.verification_status = 'approved' AND t.is_live = true
        GROUP BY t.id, u.id
        ORDER BY t.created_at DESC
        LIMIT $1
      `, [limit]);
    }
    
    res.json({
      success: true,
      count: result.rows.length,
      data: result.rows
    });
  } catch (error) {
    console.error('Get public top teachers error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get top teachers'
    });
  }
});

// @route   GET /api/teachers/all
// @desc    Get all teachers (admin only)
// @access  Private/Admin
router.get('/all', authenticate, requireAdmin, async (req, res) => {
  try {
    const { subject, search } = req.query;

    let sql = `
      SELECT 
        t.id, t.user_id, u.name, u.email, u.profile_picture,
        t.bio, t.verification_status, t.is_live, t.meeting_link,
        ARRAY_AGG(DISTINCT s.name) as subject_names,
        ARRAY_AGG(DISTINCT s.id) as subject_ids
      FROM teachers t
      JOIN users u ON t.user_id = u.id
      LEFT JOIN teacher_subjects ts ON t.id = ts.teacher_id
      LEFT JOIN subjects s ON ts.subject_id = s.id
      WHERE t.is_live = true AND t.verification_status = 'approved'
    `;

    const params = [];
    let paramCount = 1;

    if (subject) {
      sql += ` AND ts.subject_id = $${paramCount}`;
      params.push(subject);
      paramCount++;
    }

    if (search) {
      sql += ` AND (u.name ILIKE $${paramCount} OR t.bio ILIKE $${paramCount})`;
      params.push(`%${search}%`);
      paramCount++;
    }

    sql += ` GROUP BY t.id, u.id ORDER BY u.name`;

    const result = await query(sql, params);

    res.json({
      success: true,
      count: result.rows.length,
      data: result.rows
    });
  } catch (error) {
    console.error('Get teachers error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get teachers'
    });
  }
});

// @route   GET /api/teachers/all
// @desc    Get all teachers (admin only)
// @access  Private/Admin
router.get('/all', authenticate, requireAdmin, async (req, res) => {
  try {
    const result = await query(`
      SELECT 
        t.id,
        t.user_id,
        u.name,
        u.email,
        u.profile_picture,
        t.bio,
        t.verification_status,
        t.is_live,
        t.meeting_link,
        t.verification_notes,
        t.created_at,
        ARRAY_AGG(DISTINCT s.name) as subject_names
      FROM teachers t
      JOIN users u ON t.user_id = u.id
      LEFT JOIN teacher_subjects ts ON t.id = ts.teacher_id
      LEFT JOIN subjects s ON ts.subject_id = s.id
      GROUP BY t.id, u.id
      ORDER BY t.created_at DESC
    `);

    res.json({
      success: true,
      count: result.rows.length,
      data: result.rows
    });
  } catch (error) {
    console.error('Get all teachers error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get teachers'
    });
  }
});

// @route   GET /api/teachers/profile
// @desc    Get current teacher profile
// @access  Private/Teacher
router.get('/profile', authenticate, requireTeacher, async (req, res) => {
  try {
    const result = await query(`
      SELECT 
        t.id, t.user_id, u.name, u.email, u.profile_picture,
        t.bio, t.verification_status, t.is_live, t.meeting_link,
        ARRAY_AGG(DISTINCT jsonb_build_object(
          'id', s.id,
          'name', s.name
        )) as subjects
      FROM teachers t
      JOIN users u ON t.user_id = u.id
      LEFT JOIN teacher_subjects ts ON t.id = ts.teacher_id
      LEFT JOIN subjects s ON ts.subject_id = s.id
      WHERE t.user_id = $1
      GROUP BY t.id, u.id
    `, [req.user.id]);

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Teacher profile not found'
      });
    }

    // Get availability
    const availabilityResult = await query(
      'SELECT id, day, start_time, end_time, is_available FROM availability WHERE teacher_id = $1',
      [result.rows[0].id]
    );

    // Get documents
    const documentsResult = await query(
      'SELECT id, type, file_url, file_name FROM documents WHERE teacher_id = $1',
      [result.rows[0].id]
    );

    res.json({
      success: true,
      data: {
        ...result.rows[0],
        availability: availabilityResult.rows,
        documents: documentsResult.rows
      }
    });
  } catch (error) {
    console.error('Get teacher profile error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get teacher profile'
    });
  }
});

// @route   GET /api/teachers/:id
// @desc    Get teacher by ID
// @access  Public
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const result = await query(`
      SELECT 
        t.id, t.user_id, u.name, u.email, u.profile_picture,
        t.bio, t.verification_status, t.is_live, t.meeting_link,
        ARRAY_AGG(DISTINCT jsonb_build_object(
          'id', s.id,
          'name', s.name
        )) as subjects
      FROM teachers t
      JOIN users u ON t.user_id = u.id
      LEFT JOIN teacher_subjects ts ON t.id = ts.teacher_id
      LEFT JOIN subjects s ON ts.subject_id = s.id
      WHERE t.id = $1 AND t.is_live = true
      GROUP BY t.id, u.id
    `, [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Teacher not found'
      });
    }

    // Get availability
    const availabilityResult = await query(
      'SELECT id, day, start_time, end_time, is_available FROM availability WHERE teacher_id = $1',
      [id]
    );

    res.json({
      success: true,
      data: {
        ...result.rows[0],
        availability: availabilityResult.rows
      }
    });
  } catch (error) {
    console.error('Get teacher error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get teacher'
    });
  }
});

// @route   PUT /api/teachers/profile
// @desc    Update teacher profile
// @access  Private/Teacher
router.put('/profile', authenticate, requireTeacher, async (req, res) => {
  try {
    const { bio, meetingLink } = req.body;

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

    const updates = [];
    const values = [];
    let paramCount = 1;

    if (bio !== undefined) {
      updates.push(`bio = $${paramCount}`);
      values.push(bio);
      paramCount++;
    }

    if (meetingLink !== undefined) {
      updates.push(`meeting_link = $${paramCount}`);
      values.push(meetingLink);
      paramCount++;
    }

    if (updates.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No fields to update'
      });
    }

    values.push(teacherId);

    await query(
      `UPDATE teachers SET ${updates.join(', ')}, updated_at = NOW()
       WHERE id = $${paramCount}`,
      values
    );

    res.json({
      success: true,
      message: 'Profile updated successfully'
    });
  } catch (error) {
    console.error('Update teacher profile error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update profile'
    });
  }
});

// @route   PUT /api/teachers/availability
// @desc    Update teacher availability
// @access  Private/Teacher
router.put('/availability', authenticate, requireTeacher, async (req, res) => {
  try {
    const { availability } = req.body;

    if (!availability || !Array.isArray(availability)) {
      return res.status(400).json({
        success: false,
        message: 'Availability array is required'
      });
    }

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

    await transaction(async (client) => {
      // Delete existing availability
      await client.query(
        'DELETE FROM availability WHERE teacher_id = $1',
        [teacherId]
      );

      // Insert new availability
      for (const slot of availability) {
        await client.query(
          `INSERT INTO availability (teacher_id, day, start_time, end_time, is_available)
           VALUES ($1, $2, $3, $4, $5)`,
          [teacherId, slot.day, slot.startTime, slot.endTime, slot.isAvailable]
        );
      }
    });

    res.json({
      success: true,
      message: 'Availability updated successfully'
    });
  } catch (error) {
    console.error('Update availability error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update availability'
    });
  }
});

// @route   PUT /api/teachers/:id/verify
// @desc    Verify/reject teacher - Admin only
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

    const result = await query(
      `UPDATE teachers 
       SET verification_status = $1, 
           verification_notes = $2,
           is_live = $3,
           updated_at = NOW()
       WHERE id = $4
       RETURNING *`,
      [status, notes || '', status === 'approved', id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Teacher not found'
      });
    }

    res.json({
      success: true,
      message: `Teacher ${status} successfully`,
      data: result.rows[0]
    });
  } catch (error) {
    console.error('Verify teacher error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to verify teacher'
    });
  }
});

// @route   GET /api/teachers/:id/documents
// @desc    Get teacher documents
// @access  Private/Admin or Owner
router.get('/:id/documents', authenticate, async (req, res) => {
  try {
    const { id } = req.params;

    // Check if user is admin or the teacher themselves
    const teacherResult = await query(
      'SELECT user_id FROM teachers WHERE id = $1',
      [id]
    );

    if (teacherResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Teacher not found'
      });
    }

    if (req.user.role !== 'admin' && teacherResult.rows[0].user_id !== req.user.id) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized'
      });
    }

    const result = await query(
      'SELECT id, type, file_url, file_name, uploaded_at FROM documents WHERE teacher_id = $1',
      [id]
    );

    res.json({
      success: true,
      data: result.rows
    });
  } catch (error) {
    console.error('Get documents error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get documents'
    });
  }
});

module.exports = router;
