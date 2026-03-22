const express = require('express');
const { body, validationResult } = require('express-validator');
const { query } = require('../models/database');
const { authenticate, requireAdmin, requireStudent } = require('../middleware/auth');
const {
  DB_BOOKING_STATUS,
  getStudentProfile,
} = require('../utils/workflow');

const router = express.Router();

const validate = (rules) => [
  ...rules,
  (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        errors: errors.array(),
      });
    }
    return next();
  },
];

router.get('/profile', authenticate, requireStudent, async (req, res) => {
  try {
    const student = await getStudentProfile(req.user.id);

    if (!student) {
      return res.status(404).json({
        success: false,
        message: 'Student profile not found',
      });
    }

    return res.json({
      success: true,
      data: student,
    });
  } catch (error) {
    console.error('Get student profile error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to get student profile',
    });
  }
});

router.put(
  '/profile',
  authenticate,
  requireStudent,
  validate([
    body('gradeLevel').optional().isString(),
    body('parentContact').optional().isString(),
    body('location').optional().isString(),
  ]),
  async (req, res) => {
    try {
      const student = await getStudentProfile(req.user.id);
      if (!student) {
        return res.status(404).json({
          success: false,
          message: 'Student profile not found',
        });
      }

      const { gradeLevel, parentContact, location } = req.body;
      const updates = [];
      const values = [];

      if (gradeLevel !== undefined) {
        values.push(gradeLevel);
        updates.push(`grade_level = $${values.length}`);
      }

      if (parentContact !== undefined) {
        values.push(parentContact);
        updates.push(`parent_contact = $${values.length}`);
      }

      if (location !== undefined) {
        values.push(location);
        updates.push(`location = $${values.length}`);
      }

      if (!updates.length) {
        return res.status(400).json({
          success: false,
          message: 'No fields to update',
        });
      }

      values.push(student.id);

      await query(
        `UPDATE students
         SET ${updates.join(', ')}, updated_at = NOW()
         WHERE id = $${values.length}`,
        values,
      );

      const updated = await getStudentProfile(req.user.id);

      return res.json({
        success: true,
        message: 'Profile updated successfully',
        data: updated,
      });
    } catch (error) {
      console.error('Update student profile error:', error);
      return res.status(500).json({
        success: false,
        message: 'Failed to update profile',
      });
    }
  },
);

router.get('/my-teachers', authenticate, requireStudent, async (req, res) => {
  try {
    const student = await getStudentProfile(req.user.id);
    if (!student) {
      return res.status(404).json({
        success: false,
        message: 'Student profile not found',
      });
    }

    const result = await query(
      `SELECT DISTINCT
         t.id,
         t.user_id AS "userId",
         t.bio,
         t.verification_status AS "verificationStatus",
         t.is_live AS "isLive",
         t.meeting_link AS "meetingLink",
         u.name,
         u.email,
         u.profile_picture AS "profilePicture"
       FROM bookings b
       JOIN teachers t ON b.teacher_id = t.id
       JOIN users u ON t.user_id = u.id
       WHERE b.student_id = $1
         AND (
           (b.status = $2 AND b.meeting_link IS NOT NULL)
           OR b.status = $3
         )
       ORDER BY u.name`,
      [
        student.id,
        DB_BOOKING_STATUS.CONFIRMED,
        DB_BOOKING_STATUS.COMPLETED,
      ],
    );

    return res.json({
      success: true,
      count: result.rows.length,
      data: result.rows,
    });
  } catch (error) {
    console.error('Get my teachers error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to get teachers',
    });
  }
});

router.get('/stats', authenticate, requireStudent, async (req, res) => {
  try {
    const student = await getStudentProfile(req.user.id);
    if (!student) {
      return res.status(404).json({
        success: false,
        message: 'Student profile not found',
      });
    }

    const [totals, upcoming, completed, spent, favoriteTeachers] = await Promise.all([
      query('SELECT COUNT(*) FROM bookings WHERE student_id = $1', [student.id]),
      query(
        `SELECT COUNT(*)
         FROM bookings
         WHERE student_id = $1
           AND status = $2
           AND meeting_link IS NOT NULL
           AND scheduled_date >= NOW()`,
        [student.id, DB_BOOKING_STATUS.CONFIRMED],
      ),
      query(
        `SELECT COUNT(*)
         FROM bookings
         WHERE student_id = $1
           AND status = $2`,
        [student.id, DB_BOOKING_STATUS.COMPLETED],
      ),
      query(
        `SELECT COALESCE(SUM(total_amount), 0) AS amount
         FROM bookings
         WHERE student_id = $1
           AND status IN ($2, $3)`,
        [student.id, DB_BOOKING_STATUS.CONFIRMED, DB_BOOKING_STATUS.COMPLETED],
      ),
      query(
        `SELECT COUNT(DISTINCT teacher_id)
         FROM bookings
         WHERE student_id = $1
           AND status IN ($2, $3)`,
        [student.id, DB_BOOKING_STATUS.CONFIRMED, DB_BOOKING_STATUS.COMPLETED],
      ),
    ]);

    return res.json({
      success: true,
      data: {
        totalBookings: Number(totals.rows[0].count || 0),
        upcomingClasses: Number(upcoming.rows[0].count || 0),
        completedClasses: Number(completed.rows[0].count || 0),
        totalSpent: Number(spent.rows[0].amount || 0),
        favoriteTeachers: Number(favoriteTeachers.rows[0].count || 0),
      },
    });
  } catch (error) {
    console.error('Get stats error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to get statistics',
    });
  }
});

router.get('/all', authenticate, requireAdmin, async (req, res) => {
  try {
    const result = await query(
      `SELECT
         s.id,
         s.user_id AS "userId",
         s.grade_level AS "gradeLevel",
         s.parent_contact AS "parentContact",
         s.location,
         s.created_at AS "createdAt",
         u.name,
         u.email,
         u.profile_picture AS "profilePicture"
       FROM students s
       JOIN users u ON s.user_id = u.id
       ORDER BY s.created_at DESC`,
    );

    return res.json({
      success: true,
      count: result.rows.length,
      data: result.rows,
    });
  } catch (error) {
    console.error('Get all students error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to get students',
    });
  }
});

module.exports = router;
