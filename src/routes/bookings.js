const express = require('express');
const { body, validationResult } = require('express-validator');
const { query, transaction } = require('../models/database');
const {
  authenticate,
  requireAdmin,
  requireStudent,
  requireTeacher,
} = require('../middleware/auth');
const {
  BOOKING_STATUS,
  BOOKING_NOTE_MARKERS,
  DB_BOOKING_STATUS,
  bookingSelect,
  createNotification,
  getDemoBookingPredicate,
  getBookingById,
  getPricingForGrade,
  getStudentProfile,
  getTeacherProfile,
  requireTeacherSubject,
  toBookingPayloads,
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

const getOwnerContext = async (user) => {
  if (user.role === 'student') {
    const student = await getStudentProfile(user.id);
    return student
      ? { profile: student, column: 'student_id' }
      : null;
  }

  if (user.role === 'teacher') {
    const teacher = await getTeacherProfile(user.id);
    return teacher
      ? { profile: teacher, column: 'teacher_id' }
      : null;
  }

  return null;
};

const getTeacherRecord = async (teacherId) => {
  const result = await query(
    `SELECT
       t.id,
       t.user_id AS "userId",
       t.verification_status AS "verificationStatus",
       t.is_live AS "isLive",
       u.name
     FROM teachers t
     JOIN users u ON t.user_id = u.id
     WHERE t.id = $1`,
    [teacherId],
  );
  return result.rows[0] || null;
};

const getSubjectRecord = async (subjectId) => {
  const result = await query(
    'SELECT id, name FROM subjects WHERE id = $1 AND is_active = true',
    [subjectId],
  );
  return result.rows[0] || null;
};

const getStudentUserName = async (userId) => {
  const result = await query('SELECT name FROM users WHERE id = $1', [userId]);
  return result.rows[0]?.name || 'Student';
};

router.get('/upcoming/classes', authenticate, async (req, res) => {
  try {
    if (!['student', 'teacher'].includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized',
      });
    }

    const owner = await getOwnerContext(req.user);
    if (!owner) {
      return res.status(404).json({
        success: false,
        message: `${req.user.role} profile not found`,
      });
    }

    const result = await query(
      `${bookingSelect}
       WHERE b.${owner.column} = $1
         AND b.status = $2
         AND b.meeting_link IS NOT NULL
         AND b.scheduled_date >= NOW()
       ORDER BY b.scheduled_date ASC, b.created_at DESC`,
      [owner.profile.id, DB_BOOKING_STATUS.CONFIRMED],
    );

    const data = toBookingPayloads(result.rows);

    return res.json({
      success: true,
      count: data.length,
      data,
    });
  } catch (error) {
    console.error('Get upcoming classes error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to get upcoming classes',
    });
  }
});

router.get('/demo/requests', authenticate, requireTeacher, async (req, res) => {
  try {
    const teacher = await getTeacherProfile(req.user.id);
    if (!teacher) {
      return res.status(404).json({
        success: false,
        message: 'Teacher profile not found',
      });
    }

    const result = await query(
      `${bookingSelect}
       WHERE b.teacher_id = $1
         AND ${getDemoBookingPredicate('b')}
         AND b.status = $2
       ORDER BY b.created_at DESC`,
      [teacher.id, DB_BOOKING_STATUS.PENDING_PAYMENT],
    );

    const data = toBookingPayloads(result.rows);

    return res.json({
      success: true,
      count: data.length,
      data,
    });
  } catch (error) {
    console.error('Get demo requests error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to get demo requests',
    });
  }
});

router.get('/pending-admin', authenticate, requireAdmin, async (req, res) => {
  try {
    const result = await query(
      `${bookingSelect}
       WHERE b.status = $1
         AND NOT ${getDemoBookingPredicate('b')}
       ORDER BY b.created_at DESC`,
      [DB_BOOKING_STATUS.PAYMENT_UNDER_REVIEW],
    );

    const data = toBookingPayloads(result.rows);

    return res.json({
      success: true,
      count: data.length,
      data,
    });
  } catch (error) {
    console.error('Get pending admin bookings error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to get pending admin bookings',
    });
  }
});

router.get('/teacher', authenticate, requireTeacher, async (req, res) => {
  try {
    const teacher = await getTeacherProfile(req.user.id);
    if (!teacher) {
      return res.status(404).json({
        success: false,
        message: 'Teacher profile not found',
      });
    }

    const result = await query(
      `${bookingSelect}
       WHERE b.teacher_id = $1
       ORDER BY b.scheduled_date ASC, b.created_at DESC`,
      [teacher.id],
    );

    const data = toBookingPayloads(result.rows);

    return res.json({
      success: true,
      count: data.length,
      data,
    });
  } catch (error) {
    console.error('Get teacher bookings error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to get teacher bookings',
    });
  }
});

router.get('/', authenticate, async (req, res) => {
  try {
    if (!['student', 'teacher'].includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized',
      });
    }

    const owner = await getOwnerContext(req.user);
    if (!owner) {
      return res.status(404).json({
        success: false,
        message: `${req.user.role} profile not found`,
      });
    }

    const result = await query(
      `${bookingSelect}
       WHERE b.${owner.column} = $1
       ORDER BY b.scheduled_date ASC, b.created_at DESC`,
      [owner.profile.id],
    );

    const data = toBookingPayloads(result.rows);

    return res.json({
      success: true,
      count: data.length,
      data,
    });
  } catch (error) {
    console.error('Get bookings error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to get bookings',
    });
  }
});

router.post(
  '/',
  authenticate,
  requireStudent,
  validate([
    body('teacherId').notEmpty(),
    body('subjectId').notEmpty(),
    body('scheduledDate').isISO8601(),
    body('duration').isInt({ min: 30, max: 240 }),
    body('notes').optional().isString(),
  ]),
  async (req, res) => {
    try {
      const { teacherId, subjectId, scheduledDate, duration, notes } = req.body;
      const student = await getStudentProfile(req.user.id);

      if (!student) {
        return res.status(404).json({
          success: false,
          message: 'Student profile not found',
        });
      }

      const teacher = await getTeacherRecord(teacherId);
      if (!teacher || !teacher.isLive || teacher.verificationStatus !== 'approved') {
        return res.status(404).json({
          success: false,
          message: 'Teacher not found',
        });
      }

      const subject = await getSubjectRecord(subjectId);
      if (!subject) {
        return res.status(404).json({
          success: false,
          message: 'Subject not found',
        });
      }

      const teachesSubject = await requireTeacherSubject(teacherId, subjectId);
      if (!teachesSubject) {
        return res.status(400).json({
          success: false,
          message: 'Selected teacher does not teach this subject',
        });
      }

      const pricing = await getPricingForGrade(subjectId, student.gradeLevel);
      if (!pricing) {
        return res.status(400).json({
          success: false,
          message: 'No pricing tier found for this grade level',
        });
      }

      const pricePerHour = Number(pricing.pricePerHour);
      const totalAmount = Math.round((pricePerHour * Number(duration)) / 60);

      const result = await query(
        `INSERT INTO bookings (
          student_id,
          teacher_id,
          subject_id,
          grade_level,
          scheduled_date,
          duration,
          price_per_hour,
          total_amount,
          status,
          notes
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        RETURNING id`,
        [
          student.id,
          teacherId,
          subjectId,
          student.gradeLevel || '',
          scheduledDate,
          duration,
          pricePerHour,
          totalAmount,
          DB_BOOKING_STATUS.PENDING_PAYMENT,
          notes || '',
        ],
      );

      const createdBooking = await getBookingById(result.rows[0].id);

      return res.status(201).json({
        success: true,
        message: 'Class request created successfully',
        data: createdBooking,
      });
    } catch (error) {
      console.error('Create booking error:', error);
      return res.status(500).json({
        success: false,
        message: 'Failed to create booking',
      });
    }
  },
);

router.post(
  '/demo',
  authenticate,
  requireStudent,
  validate([
    body('teacherId').notEmpty(),
    body('subjectId').notEmpty(),
    body('scheduledDate').isISO8601(),
  ]),
  async (req, res) => {
    try {
      const { teacherId, subjectId, scheduledDate } = req.body;
      const student = await getStudentProfile(req.user.id);

      if (!student) {
        return res.status(404).json({
          success: false,
          message: 'Student profile not found',
        });
      }

      const teacher = await getTeacherRecord(teacherId);
      if (!teacher || !teacher.isLive || teacher.verificationStatus !== 'approved') {
        return res.status(404).json({
          success: false,
          message: 'Teacher not found',
        });
      }

      const subject = await getSubjectRecord(subjectId);
      if (!subject) {
        return res.status(404).json({
          success: false,
          message: 'Subject not found',
        });
      }

      const teachesSubject = await requireTeacherSubject(teacherId, subjectId);
      if (!teachesSubject) {
        return res.status(400).json({
          success: false,
          message: 'Selected teacher does not teach this subject',
        });
      }

      const existingDemo = await query(
        `SELECT id
         FROM bookings
         WHERE student_id = $1
           AND teacher_id = $2
           AND ${getDemoBookingPredicate()}
           AND status IN ($3, $4)`,
        [
          student.id,
          teacherId,
          DB_BOOKING_STATUS.PENDING_PAYMENT,
          DB_BOOKING_STATUS.CONFIRMED,
        ],
      );

      if (existingDemo.rows.length > 0) {
        return res.status(400).json({
          success: false,
          message: 'You already have an active demo request with this teacher',
        });
      }

      const studentName = await getStudentUserName(req.user.id);

      const booking = await transaction(async (client) => {
        const insertResult = await client.query(
          `INSERT INTO bookings (
            student_id,
            teacher_id,
            subject_id,
            grade_level,
            scheduled_date,
            duration,
            price_per_hour,
            total_amount,
            status,
            notes
          ) VALUES ($1, $2, $3, $4, $5, 30, 0, 0, $6, 'demo')
          RETURNING id`,
          [
            student.id,
            teacherId,
            subjectId,
            student.gradeLevel || '',
            scheduledDate,
            DB_BOOKING_STATUS.PENDING_PAYMENT,
          ],
        );

        await createNotification(
          client,
          teacher.userId,
          'New demo request',
          `${studentName} requested a demo class for ${subject.name}.`,
          'demo_request',
        );

        return getBookingById(insertResult.rows[0].id, client);
      });

      return res.status(201).json({
        success: true,
        message: 'Demo request sent successfully',
        data: booking,
      });
    } catch (error) {
      console.error('Create demo booking error:', error);
      return res.status(500).json({
        success: false,
        message: 'Failed to create demo booking',
      });
    }
  },
);

router.put(
  '/:id/respond',
  authenticate,
  requireTeacher,
  validate([
    body('decision').isIn(['accept', 'reject']),
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

      const { id } = req.params;
      const { decision, meetingLink } = req.body;
      const booking = await getBookingById(id);

      if (!booking || booking.teacherId !== teacher.id) {
        return res.status(404).json({
          success: false,
          message: 'Booking not found',
        });
      }

      if (booking.status !== BOOKING_STATUS.PENDING_TEACHER) {
        return res.status(400).json({
          success: false,
          message: 'Only pending teacher requests can be reviewed',
        });
      }

      if (decision === 'accept' && !meetingLink) {
        return res.status(400).json({
          success: false,
          message: 'Meeting link is required to accept a booking',
        });
      }

      const nextStatus = decision === 'accept'
        ? DB_BOOKING_STATUS.CONFIRMED
        : DB_BOOKING_STATUS.CANCELLED;

      const title = decision === 'accept'
        ? booking.isDemo ? 'Demo accepted' : 'Class accepted'
        : booking.isDemo ? 'Demo rejected' : 'Class rejected';

      const message = decision === 'accept'
        ? `${booking.teacherName} accepted your ${booking.isDemo ? 'demo' : 'class'} request for ${booking.subjectName}.`
        : `${booking.teacherName} rejected your ${booking.isDemo ? 'demo' : 'class'} request for ${booking.subjectName}.`;

      const updated = await transaction(async (client) => {
        const nextNotes = decision === 'reject'
          && !String(booking.notes || '').includes(BOOKING_NOTE_MARKERS.REJECTED)
          ? [booking.notes, BOOKING_NOTE_MARKERS.REJECTED].filter(Boolean).join('\n')
          : booking.notes || null;

        const updateResult = await client.query(
          `UPDATE bookings
           SET status = $1,
               meeting_link = $2,
               notes = $3,
               updated_at = NOW()
           WHERE id = $4
           RETURNING id`,
          [nextStatus, decision === 'accept' ? meetingLink : null, nextNotes, id],
        );

        await createNotification(
          client,
          booking.studentUserId,
          title,
          decision === 'accept' && meetingLink
            ? `${message} Join link: ${meetingLink}`
            : message,
          decision === 'accept' ? 'booking_accepted' : 'booking_rejected',
        );

        return getBookingById(updateResult.rows[0].id, client);
      });

      return res.json({
        success: true,
        message: decision === 'accept' ? 'Booking accepted successfully' : 'Booking rejected successfully',
        data: updated,
      });
    } catch (error) {
      console.error('Respond to booking error:', error);
      return res.status(500).json({
        success: false,
        message: 'Failed to update booking',
      });
    }
  },
);

router.put(
  '/:id/status',
  authenticate,
  validate([
    body('status').isIn([BOOKING_STATUS.CANCELLED, BOOKING_STATUS.COMPLETED]),
  ]),
  async (req, res) => {
    try {
      const { id } = req.params;
      const { status } = req.body;
      const booking = await getBookingById(id);

      if (!booking) {
        return res.status(404).json({
          success: false,
          message: 'Booking not found',
        });
      }

      const student = req.user.role === 'student'
        ? await getStudentProfile(req.user.id)
        : null;
      const teacher = req.user.role === 'teacher'
        ? await getTeacherProfile(req.user.id)
        : null;

      const canCancel = status === BOOKING_STATUS.CANCELLED
        && (
          req.user.role === 'admin'
          || (student && booking.studentId === student.id)
          || (teacher && booking.teacherId === teacher.id)
        );

      const canComplete = status === BOOKING_STATUS.COMPLETED
        && (
          req.user.role === 'admin'
          || (teacher && booking.teacherId === teacher.id)
        );

      if (!canCancel && !canComplete) {
        return res.status(403).json({
          success: false,
          message: 'Not authorized',
        });
      }

      const result = await query(
        `UPDATE bookings
         SET status = $1,
             notes = $2,
             updated_at = NOW()
         WHERE id = $3
         RETURNING id`,
        [
          status === BOOKING_STATUS.COMPLETED
            ? DB_BOOKING_STATUS.COMPLETED
            : DB_BOOKING_STATUS.CANCELLED,
          status === BOOKING_STATUS.CANCELLED
            && !String(booking.notes || '').includes(BOOKING_NOTE_MARKERS.CANCELLED)
            ? [booking.notes, BOOKING_NOTE_MARKERS.CANCELLED].filter(Boolean).join('\n')
            : booking.notes || null,
          id,
        ],
      );

      const updatedBooking = await getBookingById(result.rows[0].id);

      return res.json({
        success: true,
        message: 'Booking updated successfully',
        data: updatedBooking,
      });
    } catch (error) {
      console.error('Update booking status error:', error);
      return res.status(500).json({
        success: false,
        message: 'Failed to update booking',
      });
    }
  },
);

router.delete('/:id/demo', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const booking = await getBookingById(id);

    if (!booking) {
      return res.status(404).json({
        success: false,
        message: 'Booking not found',
      });
    }

    if (!booking.isDemo || booking.status !== BOOKING_STATUS.PENDING_TEACHER) {
      return res.status(400).json({
        success: false,
        message: 'Only pending demo requests can be cancelled',
      });
    }

    const student = req.user.role === 'student'
      ? await getStudentProfile(req.user.id)
      : null;
    const teacher = req.user.role === 'teacher'
      ? await getTeacherProfile(req.user.id)
      : null;

    const isOwner = (
      req.user.role === 'admin'
      || (student && booking.studentId === student.id)
      || (teacher && booking.teacherId === teacher.id)
    );

    if (!isOwner) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized',
      });
    }

    await transaction(async (client) => {
      await client.query(
        `UPDATE bookings
         SET status = $1,
             notes = $2,
             updated_at = NOW()
         WHERE id = $3`,
        [
          DB_BOOKING_STATUS.CANCELLED,
          !String(booking.notes || '').includes(BOOKING_NOTE_MARKERS.CANCELLED)
            ? [booking.notes, BOOKING_NOTE_MARKERS.CANCELLED].filter(Boolean).join('\n')
            : booking.notes || null,
          id,
        ],
      );

      if (req.user.role === 'student') {
        await createNotification(
          client,
          booking.teacherUserId,
          'Demo request cancelled',
          `${booking.studentName} cancelled the demo request for ${booking.subjectName}.`,
          'demo_cancelled',
        );
      }

      if (req.user.role === 'teacher') {
        await createNotification(
          client,
          booking.studentUserId,
          'Demo request cancelled',
          `${booking.teacherName} cancelled your demo request for ${booking.subjectName}.`,
          'demo_cancelled',
        );
      }
    });

    return res.json({
      success: true,
      message: 'Demo request cancelled successfully',
    });
  } catch (error) {
    console.error('Cancel demo booking error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to cancel demo booking',
    });
  }
});

router.get('/:id', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const booking = await getBookingById(id);

    if (!booking) {
      return res.status(404).json({
        success: false,
        message: 'Booking not found',
      });
    }

    const student = req.user.role === 'student'
      ? await getStudentProfile(req.user.id)
      : null;
    const teacher = req.user.role === 'teacher'
      ? await getTeacherProfile(req.user.id)
      : null;

    const isOwner = (
      req.user.role === 'admin'
      || (student && booking.studentId === student.id)
      || (teacher && booking.teacherId === teacher.id)
    );

    if (!isOwner) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized',
      });
    }

    return res.json({
      success: true,
      data: booking,
    });
  } catch (error) {
    console.error('Get booking error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to get booking',
    });
  }
});

module.exports = router;
