const express = require('express');
const { query } = require('../models/database');
const { authenticate, requireAdmin } = require('../middleware/auth');
const {
  BOOKING_STATUS,
  DB_BOOKING_STATUS,
  getDemoBookingPredicate,
  getTeacherSubjects,
  toBookingPayloads,
} = require('../utils/workflow');

const router = express.Router();

const requireAdminAccess = [authenticate, requireAdmin];

router.get('/stats', ...requireAdminAccess, async (req, res) => {
  try {
    const [
      teachersCount,
      pendingVerifications,
      studentsCount,
      pendingPayments,
      bookingsCount,
      completedClasses,
      subjectsCount,
      activeSubjects,
      revenue,
    ] = await Promise.all([
      query('SELECT COUNT(*) FROM teachers'),
      query(`SELECT COUNT(*) FROM teachers WHERE verification_status = 'pending'`),
      query('SELECT COUNT(*) FROM students'),
      query(`SELECT COUNT(*) FROM payment_proofs WHERE status = 'pending'`),
      query('SELECT COUNT(*) FROM bookings'),
      query(`SELECT COUNT(*) FROM bookings WHERE status = $1`, [DB_BOOKING_STATUS.COMPLETED]),
      query('SELECT COUNT(*) FROM subjects'),
      query('SELECT COUNT(*) FROM subjects WHERE is_active = true'),
      query(
        `SELECT COALESCE(SUM(total_amount), 0) AS amount
         FROM bookings
         WHERE status IN ($1, $2)`,
        [DB_BOOKING_STATUS.CONFIRMED, DB_BOOKING_STATUS.COMPLETED],
      ),
    ]);

    return res.json({
      success: true,
      data: {
        totalTeachers: Number(teachersCount.rows[0].count || 0),
        pendingVerifications: Number(pendingVerifications.rows[0].count || 0),
        totalStudents: Number(studentsCount.rows[0].count || 0),
        pendingPayments: Number(pendingPayments.rows[0].count || 0),
        totalBookings: Number(bookingsCount.rows[0].count || 0),
        completedClasses: Number(completedClasses.rows[0].count || 0),
        totalSubjects: Number(subjectsCount.rows[0].count || 0),
        activeSubjects: Number(activeSubjects.rows[0].count || 0),
        totalRevenue: Number(revenue.rows[0].amount || 0),
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

router.get('/verifications/pending', ...requireAdminAccess, async (req, res) => {
  try {
    const result = await query(
      `SELECT
         t.id,
         t.user_id AS "userId",
         t.bio,
         t.verification_status AS "verificationStatus",
         t.verification_notes AS "verificationNotes",
         t.is_live AS "isLive",
         t.created_at AS "createdAt",
         u.name,
         u.email,
         u.profile_picture AS "profilePicture"
       FROM teachers t
       JOIN users u ON t.user_id = u.id
       WHERE t.verification_status = 'pending'
       ORDER BY t.created_at DESC`,
    );

    const teachers = await Promise.all(
      result.rows.map(async (teacher) => ({
        ...teacher,
        subjects: await getTeacherSubjects(teacher.id),
      })),
    );

    return res.json({
      success: true,
      count: teachers.length,
      data: teachers,
    });
  } catch (error) {
    console.error('Get pending verifications error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to get pending verifications',
    });
  }
});

router.get('/recent-activity', ...requireAdminAccess, async (req, res) => {
  try {
    const [recentTeachers, recentBookings, recentPayments] = await Promise.all([
      query(
        `SELECT
           t.id,
           u.name,
           u.email,
           t.verification_status AS status,
           t.created_at AS "createdAt",
           'teacher_application' AS type
         FROM teachers t
         JOIN users u ON t.user_id = u.id
         ORDER BY t.created_at DESC
         LIMIT 5`,
      ),
      query(
        `SELECT
           b.id,
           su.name AS "studentName",
           tu.name AS "teacherName",
           s.name AS "subjectName",
           b.status,
           b.created_at AS "createdAt",
           'booking' AS type
         FROM bookings b
         JOIN students st ON b.student_id = st.id
         JOIN users su ON st.user_id = su.id
         JOIN teachers t ON b.teacher_id = t.id
         JOIN users tu ON t.user_id = tu.id
         JOIN subjects s ON b.subject_id = s.id
         ORDER BY b.created_at DESC
         LIMIT 5`,
      ),
      query(
        `SELECT
           pp.id,
           su.name AS "studentName",
           b.total_amount AS "totalAmount",
           pp.status,
           pp.uploaded_at AS "createdAt",
           'payment' AS type
         FROM payment_proofs pp
         JOIN bookings b ON pp.booking_id = b.id
         JOIN students st ON b.student_id = st.id
         JOIN users su ON st.user_id = su.id
         ORDER BY pp.uploaded_at DESC
         LIMIT 5`,
      ),
    ]);

    const activity = [
      ...recentTeachers.rows,
      ...recentBookings.rows,
      ...recentPayments.rows,
    ]
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .slice(0, 10);

    return res.json({
      success: true,
      data: activity,
    });
  } catch (error) {
    console.error('Get recent activity error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to get recent activity',
    });
  }
});

router.get('/users', ...requireAdminAccess, async (req, res) => {
  try {
    const result = await query(
      `SELECT
         id,
         email,
         name,
         role,
         profile_picture AS "profilePicture",
         created_at AS "createdAt",
         updated_at AS "updatedAt"
       FROM users
       ORDER BY created_at DESC`,
    );

    return res.json({
      success: true,
      count: result.rows.length,
      data: result.rows,
    });
  } catch (error) {
    console.error('Get users error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to get users',
    });
  }
});

router.put('/users/:id', ...requireAdminAccess, async (req, res) => {
  try {
    const { id } = req.params;
    const { name, role } = req.body;
    const updates = [];
    const values = [];

    if (name !== undefined) {
      values.push(name);
      updates.push(`name = $${values.length}`);
    }

    if (role !== undefined) {
      values.push(role);
      updates.push(`role = $${values.length}`);
    }

    if (!updates.length) {
      return res.status(400).json({
        success: false,
        message: 'No fields to update',
      });
    }

    values.push(id);

    const result = await query(
      `UPDATE users
       SET ${updates.join(', ')}, updated_at = NOW()
       WHERE id = $${values.length}
       RETURNING
         id,
         email,
         name,
         role,
         profile_picture AS "profilePicture"`,
      values,
    );

    if (!result.rows.length) {
      return res.status(404).json({
        success: false,
        message: 'User not found',
      });
    }

    return res.json({
      success: true,
      message: 'User updated successfully',
      data: result.rows[0],
    });
  } catch (error) {
    console.error('Update user error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to update user',
    });
  }
});

router.delete('/users/:id', ...requireAdminAccess, async (req, res) => {
  try {
    const { id } = req.params;
    const exists = await query('SELECT id FROM users WHERE id = $1', [id]);

    if (!exists.rows.length) {
      return res.status(404).json({
        success: false,
        message: 'User not found',
      });
    }

    await query('DELETE FROM users WHERE id = $1', [id]);

    return res.json({
      success: true,
      message: 'User deleted successfully',
    });
  } catch (error) {
    console.error('Delete user error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to delete user',
    });
  }
});

router.get('/revenue', ...requireAdminAccess, async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    const filters = ['b.status IN ($1, $2)'];
    const params = [DB_BOOKING_STATUS.CONFIRMED, DB_BOOKING_STATUS.COMPLETED];

    if (startDate && endDate) {
      params.push(startDate, endDate);
      filters.push(`b.created_at BETWEEN $${params.length - 1} AND $${params.length}`);
    }

    const whereClause = filters.join(' AND ');

    const [bySubject, byMonth] = await Promise.all([
      query(
        `SELECT
           s.name AS subject,
           COUNT(b.id) AS "bookingCount",
           COALESCE(SUM(b.total_amount), 0) AS "totalRevenue"
         FROM bookings b
         JOIN subjects s ON b.subject_id = s.id
         WHERE ${whereClause}
         GROUP BY s.id, s.name
         ORDER BY "totalRevenue" DESC`,
        params,
      ),
      query(
        `SELECT
           DATE_TRUNC('month', b.created_at) AS month,
           COUNT(b.id) AS "bookingCount",
           COALESCE(SUM(b.total_amount), 0) AS "totalRevenue"
         FROM bookings b
         WHERE ${whereClause}
         GROUP BY DATE_TRUNC('month', b.created_at)
         ORDER BY month DESC`,
        params,
      ),
    ]);

    return res.json({
      success: true,
      data: {
        bySubject: bySubject.rows,
        byMonth: byMonth.rows,
      },
    });
  } catch (error) {
    console.error('Get revenue error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to get revenue report',
    });
  }
});

router.get('/teachers', ...requireAdminAccess, async (req, res) => {
  try {
    const result = await query(
      `SELECT
         t.id,
         t.user_id AS "userId",
         t.bio,
         t.verification_status AS "verificationStatus",
         t.is_live AS "isLive",
         t.meeting_link AS "meetingLink",
         t.created_at AS "createdAt",
         u.name,
         u.email,
         u.profile_picture AS "profilePicture"
       FROM teachers t
       JOIN users u ON t.user_id = u.id
       ORDER BY t.created_at DESC`,
    );

    const teachers = await Promise.all(
      result.rows.map(async (teacher) => ({
        ...teacher,
        subjects: await getTeacherSubjects(teacher.id),
      })),
    );

    return res.json({
      success: true,
      count: teachers.length,
      data: teachers,
    });
  } catch (error) {
    console.error('Get teachers error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to get teachers',
    });
  }
});

router.get('/students', ...requireAdminAccess, async (req, res) => {
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
    console.error('Get students error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to get students',
    });
  }
});

router.get('/classes', ...requireAdminAccess, async (req, res) => {
  try {
    const { status } = req.query;
    const result = await query(
      `SELECT
         b.id,
         b.scheduled_date AS "scheduledDate",
         b.duration,
         b.price_per_hour AS "pricePerHour",
         b.total_amount AS "totalAmount",
         b.status AS "dbStatus",
         b.meeting_link AS "meetingLink",
         b.notes,
         CASE WHEN ${getDemoBookingPredicate('b')} THEN true ELSE false END AS "isDemo",
         b.created_at AS "createdAt",
         su.name AS "studentName",
         su.profile_picture AS "studentPicture",
         tu.name AS "teacherName",
         tu.profile_picture AS "teacherPicture",
         s.name AS "subjectName",
         s.id AS "subjectId"
       FROM bookings b
       JOIN students st ON b.student_id = st.id
       JOIN users su ON st.user_id = su.id
       JOIN teachers t ON b.teacher_id = t.id
       JOIN users tu ON t.user_id = tu.id
       JOIN subjects s ON b.subject_id = s.id
       ORDER BY b.scheduled_date DESC, b.created_at DESC`,
    );

    const all = toBookingPayloads(result.rows);
    const upcoming = all.filter(
      (row) => row.status === BOOKING_STATUS.ACCEPTED && new Date(row.scheduledDate) >= new Date(),
    );
    const completed = all.filter((row) => row.status === BOOKING_STATUS.COMPLETED);
    const pending = all.filter(
      (row) => [BOOKING_STATUS.PENDING_ADMIN, BOOKING_STATUS.PENDING_TEACHER].includes(row.status),
    );

    return res.json({
      success: true,
      data: {
        all: status === 'upcoming'
          ? upcoming
          : status === 'completed'
            ? completed
            : status === 'pending'
              ? pending
              : all,
        upcoming,
        completed,
        pending,
      },
      counts: {
        total: all.length,
        upcoming: upcoming.length,
        completed: completed.length,
        pending: pending.length,
      },
    });
  } catch (error) {
    console.error('Get classes error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to get classes',
    });
  }
});

router.get('/settings', ...requireAdminAccess, async (req, res) => {
  try {
    const result = await query('SELECT * FROM site_settings ORDER BY setting_key');
    const settings = {};

    result.rows.forEach((row) => {
      if (row.setting_type === 'number') {
        settings[row.setting_key] = Number(row.setting_value);
      } else if (row.setting_type === 'boolean') {
        settings[row.setting_key] = row.setting_value === 'true';
      } else {
        settings[row.setting_key] = row.setting_value;
      }
    });

    return res.json({
      success: true,
      data: settings,
    });
  } catch (error) {
    console.error('Get settings error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to get settings',
    });
  }
});

router.put('/settings', ...requireAdminAccess, async (req, res) => {
  try {
    const entries = Object.entries(req.body || {});

    for (const [key, value] of entries) {
      await query(
        `INSERT INTO site_settings (setting_key, setting_value, setting_type, updated_at)
         VALUES ($1, $2, $3, NOW())
         ON CONFLICT (setting_key)
         DO UPDATE SET setting_value = EXCLUDED.setting_value, setting_type = EXCLUDED.setting_type, updated_at = NOW()`,
        [
          key,
          String(value),
          typeof value === 'number'
            ? 'number'
            : typeof value === 'boolean'
              ? 'boolean'
              : 'string',
        ],
      );
    }

    return res.json({
      success: true,
      message: 'Settings updated successfully',
    });
  } catch (error) {
    console.error('Update settings error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to update settings',
    });
  }
});

module.exports = router;
