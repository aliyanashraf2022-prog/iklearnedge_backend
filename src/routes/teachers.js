const express = require('express');
const { body, validationResult } = require('express-validator');
const { query, transaction } = require('../models/database');
const { authenticate, requireAdmin, requireTeacher } = require('../middleware/auth');
const {
  createNotification,
  getTeacherAvailability,
  getTeacherDocuments,
  getTeacherProfile,
  getTeacherSubjects,
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

const getTeacherBase = async (teacherId) => {
  const result = await query(
    `SELECT
       t.id,
       t.user_id AS "userId",
       t.bio,
       t.verification_status AS "verificationStatus",
       t.is_live AS "isLive",
       t.meeting_link AS "meetingLink",
       t.verification_notes AS "verificationNotes",
       t.created_at AS "createdAt",
       t.updated_at AS "updatedAt",
       u.name,
       u.email,
       u.profile_picture AS "profilePicture"
     FROM teachers t
     JOIN users u ON t.user_id = u.id
     WHERE t.id = $1`,
    [teacherId],
  );
  return result.rows[0] || null;
};

const buildTeacherPayload = async (teacherId) => {
  const teacher = await getTeacherBase(teacherId);
  if (!teacher) {
    return null;
  }

  const [subjects, availability, documents] = await Promise.all([
    getTeacherSubjects(teacherId),
    getTeacherAvailability(teacherId),
    getTeacherDocuments(teacherId),
  ]);

  const highestDegree = documents.find((item) => item.type === 'degree') || null;
  const identityDocument = documents.find((item) => item.type === 'identity') || null;
  const teachingCertificates = documents.filter((item) => item.type === 'certificate');

  return {
    ...teacher,
    subjects,
    availability,
    documents,
    highestDegree,
    identityDocument,
    teachingCertificates,
  };
};

router.get('/', async (req, res) => {
  try {
    const { subject, search } = req.query;
    const params = [];
    const filters = [
      `t.is_live = true`,
      `t.verification_status = 'approved'`,
    ];

    if (subject) {
      params.push(subject);
      filters.push(`EXISTS (
        SELECT 1
        FROM teacher_subjects ts
        WHERE ts.teacher_id = t.id AND ts.subject_id = $${params.length}
      )`);
    }

    if (search) {
      params.push(`%${search}%`);
      filters.push(`(u.name ILIKE $${params.length} OR COALESCE(t.bio, '') ILIKE $${params.length})`);
    }

    const result = await query(
      `SELECT
         t.id,
         t.user_id AS "userId",
         t.bio,
         t.verification_status AS "verificationStatus",
         t.is_live AS "isLive",
         t.meeting_link AS "meetingLink",
         t.created_at AS "createdAt",
         t.updated_at AS "updatedAt",
         u.name,
         u.email,
         u.profile_picture AS "profilePicture"
       FROM teachers t
       JOIN users u ON t.user_id = u.id
       WHERE ${filters.join(' AND ')}
       ORDER BY u.name`,
      params,
    );

    const teachers = await Promise.all(
      result.rows.map(async (teacher) => ({
        ...teacher,
        subjects: await getTeacherSubjects(teacher.id),
        availability: await getTeacherAvailability(teacher.id),
      })),
    );

    return res.json({
      success: true,
      count: teachers.length,
      data: teachers,
    });
  } catch (error) {
    console.error('Get public teachers error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to get teachers',
    });
  }
});

router.get('/all', authenticate, requireAdmin, async (req, res) => {
  try {
    const result = await query(
      `SELECT
         t.id,
         t.user_id AS "userId",
         t.bio,
         t.verification_status AS "verificationStatus",
         t.is_live AS "isLive",
         t.meeting_link AS "meetingLink",
         t.verification_notes AS "verificationNotes",
         t.created_at AS "createdAt",
         t.updated_at AS "updatedAt",
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
    console.error('Get all teachers error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to get teachers',
    });
  }
});

router.get('/profile', authenticate, requireTeacher, async (req, res) => {
  try {
    const teacher = await getTeacherProfile(req.user.id);
    if (!teacher) {
      return res.status(404).json({
        success: false,
        message: 'Teacher profile not found',
      });
    }

    const payload = await buildTeacherPayload(teacher.id);

    return res.json({
      success: true,
      data: payload,
    });
  } catch (error) {
    console.error('Get teacher profile error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to get teacher profile',
    });
  }
});

router.put(
  '/profile',
  authenticate,
  requireTeacher,
  validate([
    body('bio').optional().isString(),
    body('meetingLink').optional({ nullable: true }).isURL({ require_protocol: true }),
  ]),
  async (req, res) => {
    try {
      const teacher = await getTeacherProfile(req.user.id);
      if (!teacher) {
        return res.status(404).json({
          success: false,
          message: 'Teacher profile not found',
        });
      }

      const { bio, meetingLink } = req.body;
      const updates = [];
      const values = [];

      if (bio !== undefined) {
        values.push(bio);
        updates.push(`bio = $${values.length}`);
      }

      if (meetingLink !== undefined) {
        values.push(meetingLink || null);
        updates.push(`meeting_link = $${values.length}`);
      }

      if (!updates.length) {
        return res.status(400).json({
          success: false,
          message: 'No fields to update',
        });
      }

      values.push(teacher.id);

      await query(
        `UPDATE teachers
         SET ${updates.join(', ')}, updated_at = NOW()
         WHERE id = $${values.length}`,
        values,
      );

      const payload = await buildTeacherPayload(teacher.id);

      return res.json({
        success: true,
        message: 'Profile updated successfully',
        data: payload,
      });
    } catch (error) {
      console.error('Update teacher profile error:', error);
      return res.status(500).json({
        success: false,
        message: 'Failed to update profile',
      });
    }
  },
);

router.get('/availability', authenticate, requireTeacher, async (req, res) => {
  try {
    const teacher = await getTeacherProfile(req.user.id);
    if (!teacher) {
      return res.json({
        success: true,
        data: [],
      });
    }

    const availability = await getTeacherAvailability(teacher.id);

    return res.json({
      success: true,
      data: availability,
    });
  } catch (error) {
    console.error('Get availability error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to get availability',
    });
  }
});

router.put(
  '/availability',
  authenticate,
  requireTeacher,
  validate([
    body('availability').isArray(),
    body('availability.*.day').isString(),
    body('availability.*.startTime').isString(),
    body('availability.*.endTime').isString(),
    body('availability.*.isAvailable').optional().isBoolean(),
  ]),
  async (req, res) => {
    try {
      const teacher = await getTeacherProfile(req.user.id);
      if (!teacher) {
        return res.status(404).json({
          success: false,
          message: 'Teacher profile not found',
        });
      }

      const { availability } = req.body;

      await transaction(async (client) => {
        await client.query('DELETE FROM availability WHERE teacher_id = $1', [teacher.id]);

        for (const slot of availability) {
          await client.query(
            `INSERT INTO availability (teacher_id, day, start_time, end_time, is_available)
             VALUES ($1, $2, $3, $4, $5)`,
            [
              teacher.id,
              slot.day,
              slot.startTime,
              slot.endTime,
              slot.isAvailable !== false,
            ],
          );
        }
      });

      const updatedAvailability = await getTeacherAvailability(teacher.id);

      return res.json({
        success: true,
        message: 'Availability updated successfully',
        data: updatedAvailability,
      });
    } catch (error) {
      console.error('Update availability error:', error);
      return res.status(500).json({
        success: false,
        message: 'Failed to update availability',
      });
    }
  },
);

router.put(
  '/:id/verify',
  authenticate,
  requireAdmin,
  validate([
    body('status').isIn(['approved', 'rejected']),
    body('notes').optional().isString(),
  ]),
  async (req, res) => {
    try {
      const { id } = req.params;
      const { status, notes } = req.body;

      const teacher = await getTeacherBase(id);
      if (!teacher) {
        return res.status(404).json({
          success: false,
          message: 'Teacher not found',
        });
      }

      await transaction(async (client) => {
        await client.query(
          `UPDATE teachers
           SET verification_status = $1,
               verification_notes = $2,
               is_live = $3,
               updated_at = NOW()
           WHERE id = $4`,
          [status, notes || '', status === 'approved', id],
        );

        await createNotification(
          client,
          teacher.userId,
          status === 'approved' ? 'Teacher profile approved' : 'Teacher profile rejected',
          status === 'approved'
            ? 'Your teacher profile has been approved and is now live.'
            : (notes
              ? `Your teacher profile was rejected: ${notes}`
              : 'Your teacher profile was rejected.'),
          'teacher_verification',
        );
      });

      const payload = await buildTeacherPayload(id);

      return res.json({
        success: true,
        message: `Teacher ${status} successfully`,
        data: payload,
      });
    } catch (error) {
      console.error('Verify teacher error:', error);
      return res.status(500).json({
        success: false,
        message: 'Failed to verify teacher',
      });
    }
  },
);

router.get('/:id/documents', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const teacher = await getTeacherBase(id);

    if (!teacher) {
      return res.status(404).json({
        success: false,
        message: 'Teacher not found',
      });
    }

    if (req.user.role !== 'admin' && teacher.userId !== req.user.id) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized',
      });
    }

    const documents = await getTeacherDocuments(id);

    return res.json({
      success: true,
      data: documents,
    });
  } catch (error) {
    console.error('Get documents error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to get documents',
    });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const teacher = await buildTeacherPayload(id);

    if (!teacher || !teacher.isLive) {
      return res.status(404).json({
        success: false,
        message: 'Teacher not found',
      });
    }

    return res.json({
      success: true,
      data: teacher,
    });
  } catch (error) {
    console.error('Get teacher error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to get teacher',
    });
  }
});

module.exports = router;
